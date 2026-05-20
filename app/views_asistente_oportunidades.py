# ----------------------------------------------------------------------
# views_asistente_oportunidades.py — Asistente AI por Oportunidad.
# ----------------------------------------------------------------------
# Hilo independiente del consultor general, del asistente de ideas y del
# de prospección. Cada Oportunidad (TodoItem) tiene su propia conversación
# persistida en OportunidadAsistenteMensaje.
#
# El AI actúa como **coach táctico de cierre** — lee el contexto rico de
# la oportunidad (etapa, días en etapa, cotizaciones, tareas, actividades,
# bitácora, histórico del cliente) y ayuda a destrabar deals concretos.
# Su filosofía: NO decide por el vendedor en cosas delicadas (descuentos,
# despidos, cancelaciones); SÍ propone próximos pasos, redacta correos
# de seguimiento y agenda actividades.
#
# Permisos: vendedor dueño + compañeros de grupo + supervisores/admins.
#
# Endpoints:
#   GET  /app/api/oportunidades/<id>/asistente/mensajes/           historial
#   POST /app/api/oportunidades/<id>/asistente/mensaje/            chat (+ tools)
#   POST /app/api/oportunidades/<id>/asistente/resumen/            resumen → MensajeOportunidad
#   POST /app/api/oportunidades/<id>/asistente/reset/              vaciar hilo
#   POST /app/api/oportunidades/<id>/asistente/actividad-rapida/   agendar
# ----------------------------------------------------------------------

import json
import logging
from datetime import timedelta

from django.contrib.auth.decorators import login_required
from django.db.models import Sum, Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import (
    AsistenteConfig, TodoItem, Cotizacion, TareaOportunidad, Actividad,
    MensajeOportunidad, Cliente, OportunidadAsistenteMensaje,
    Prospecto, ProspectoActividad, MailCorreo,
)
from .asistente_provider import chat, AsistenteError
from .views_grupos import comparten_grupo
from .views_utils import is_supervisor

log = logging.getLogger(__name__)


# Ventana de contexto que mandamos al LLM por turno.
MAX_HISTORY_MSGS = 20

# Tope de turnos del USUARIO antes de disparar auto-save.
MAX_USER_TURNS = 8

# Prefijo del resumen AI — para reconocerlo en MensajeOportunidad.
RESUMEN_AI_PREFIX = 'Resumen de IAMET AI'


# ─── Permisos ──────────────────────────────────────────────────────────


def _can_access_oportunidad(opp: TodoItem, user) -> bool:
    """Vendedor dueño, sus compañeros de grupo, supervisores y admins
    pueden chatear sobre la oportunidad."""
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or is_supervisor(user):
        return True
    if opp.usuario_id == user.id:
        return True
    try:
        if comparten_grupo(user, opp.usuario):
            return True
    except Exception:
        pass
    return False


def _get_opp_with_access(opp_id: int, user):
    """Devuelve (opp, access) — access ∈ {'not_found', 'no_access', 'ok'}."""
    try:
        opp = (TodoItem.objects
               .select_related('cliente', 'contacto', 'usuario')
               .get(pk=opp_id))
    except TodoItem.DoesNotExist:
        return (None, 'not_found')
    if not _can_access_oportunidad(opp, user):
        return (opp, 'no_access')
    return (opp, 'ok')


def _msg_no_access(opp: TodoItem) -> str:
    nombre = (opp.usuario.first_name or opp.usuario.username) if opp.usuario_id else 'el vendedor responsable'
    return (
        f'Esta oportunidad es de **{nombre}**. No puedo opinar aquí — '
        'solo le contesto al vendedor responsable, a su equipo de '
        'trabajo o a supervisores. Si necesitas analizarla, pídele '
        f'a {nombre} que te incluya en su grupo.'
    )


# ─── Helpers de datos del CRM (contexto que el AI debe ver) ────────────


def _dias_desde(dt) -> int | None:
    if not dt:
        return None
    try:
        return max(0, (timezone.now() - dt).days)
    except Exception:
        return None


def _humanize_dias(dias) -> str:
    if dias is None:
        return 'desconocido'
    if dias == 0:
        return 'hoy'
    if dias == 1:
        return 'hace 1 día'
    if dias < 30:
        return f'hace {dias} días'
    meses = dias // 30
    if meses == 1:
        return 'hace ~1 mes'
    return f'hace ~{meses} meses'


def _money(value) -> str:
    if value is None:
        return '—'
    try:
        return f'${float(value):,.0f} MXN'
    except Exception:
        return str(value)


def _count_user_turns(opp: TodoItem) -> int:
    return OportunidadAsistenteMensaje.objects.filter(
        oportunidad=opp, role='user'
    ).count()


def _ultimo_resumen_ai(opp: TodoItem) -> str:
    """Último MensajeOportunidad cuyo texto empieza con el prefijo del
    resumen AI."""
    m = (MensajeOportunidad.objects
         .filter(oportunidad=opp, texto__startswith=RESUMEN_AI_PREFIX)
         .order_by('-fecha')
         .first())
    return m.texto if m else ''


def _historico_cliente(cliente: Cliente, opp_actual_id: int) -> dict:
    """Resumen del cliente para inyectar al AI: opps cerradas, ganadas,
    perdidas, ticket promedio, días promedio a cierre."""
    if not cliente:
        return {}
    base = TodoItem.objects.filter(cliente=cliente).exclude(pk=opp_actual_id)
    cerradas = base.filter(etapa_corta__in=['Ganado', 'Pagado'])
    perdidas = base.filter(
        Q(etapa_completa__icontains='perdido') |
        Q(etapa_completa__icontains='cancelad')
    )
    total_ganado = cerradas.aggregate(t=Sum('monto')).get('t') or 0
    n_ganadas = cerradas.count()
    n_perdidas = perdidas.count()
    ticket_promedio = (float(total_ganado) / n_ganadas) if n_ganadas else 0
    return {
        'ganadas': n_ganadas,
        'perdidas': n_perdidas,
        'monto_ganado_historico': float(total_ganado),
        'ticket_promedio': ticket_promedio,
    }


def _opp_context_block(opp: TodoItem) -> str:
    """Bloque markdown con el contexto rico de la oportunidad. Esto es
    lo que más mueve la aguja en consejos no-genéricos."""
    cliente_nombre = opp.cliente.nombre_empresa if opp.cliente_id else '—'
    contacto = opp.contacto.nombre if opp.contacto_id else '—'
    vendedor = (opp.usuario.get_full_name() or opp.usuario.username) if opp.usuario_id else '—'
    etapa = opp.etapa_corta or opp.etapa_completa or '—'
    probabilidad = f'{opp.probabilidad_cierre}%' if getattr(opp, 'probabilidad_cierre', None) is not None else '—'
    mes_cierre = opp.mes_cierre or '—'
    anio_cierre = opp.anio_cierre or '—'

    dias_desde_creacion = _dias_desde(opp.fecha_creacion)
    dias_desde_act = _dias_desde(opp.fecha_actualizacion)

    # Tiempo en etapa actual: aproximación = días desde última actualización
    # (el log de cambios de etapa no siempre está en este sistema).
    tiempo_en_etapa = _humanize_dias(dias_desde_act)

    # Cotizaciones vinculadas — con detalle de items (productos/servicios)
    # para que el AI pueda responder "qué incluye la última cotización"
    # con precisión. Limitamos a 3 cotizaciones y 8 items por cot.
    cots = list(Cotizacion.objects.filter(oportunidad=opp).order_by('-fecha_creacion')[:3])
    cot_lines = []
    if cots:
        for c in cots:
            fecha = c.fecha_creacion.strftime('%Y-%m-%d') if c.fecha_creacion else '—'
            total_cot = _money(c.total)
            titulo = (c.titulo or 'Cotización').strip()
            tipo = c.tipo_cotizacion or '—'
            moneda = c.moneda or 'MXN'
            cot_lines.append(
                f'  - **{titulo}** ({fecha}) · {total_cot} {moneda} · {tipo}'
            )
            if c.descripcion:
                desc_short = c.descripcion.strip()
                if len(desc_short) > 200:
                    desc_short = desc_short[:197] + '...'
                cot_lines.append(f'    · Descripción: {desc_short}')
            # Items / DetalleCotizacion — los más importantes
            detalles = list(c.detalles.all().order_by('orden')[:8])
            if detalles:
                cot_lines.append('    · Items:')
                for d in detalles:
                    qty = d.cantidad or 1
                    marca = d.marca or ''
                    parte = d.no_parte or ''
                    precio = _money(d.total or d.precio_unitario)
                    nombre = (d.nombre_producto or '').strip()[:120]
                    extra = []
                    if marca: extra.append(marca)
                    if parte: extra.append('NP ' + parte)
                    extra_str = (' · ' + ' · '.join(extra)) if extra else ''
                    cot_lines.append(
                        f'       {qty}× {nombre}{extra_str} → {precio}'
                    )
                total_items = c.detalles.count()
                if total_items > 8:
                    cot_lines.append(f'       (+ {total_items - 8} items más)')
            if c.comentarios:
                com_short = c.comentarios.strip()
                if len(com_short) > 200:
                    com_short = com_short[:197] + '...'
                cot_lines.append(f'    · Comentarios: {com_short}')
    else:
        cot_lines.append('  - **Sin cotizaciones vinculadas** todavía.')

    # Tareas pendientes / vencidas
    ahora = timezone.now()
    tareas_pend = TareaOportunidad.objects.filter(
        oportunidad=opp, estado='pendiente'
    ).order_by('fecha_limite')[:5]
    tareas_lines = []
    if tareas_pend.exists():
        for t in tareas_pend:
            estado_t = 'vencida' if (t.fecha_limite and t.fecha_limite < ahora) else 'pendiente'
            fl = t.fecha_limite.strftime('%Y-%m-%d') if t.fecha_limite else '—'
            tareas_lines.append(f'  - [{estado_t}] {fl} · {(t.titulo or "")[:80]}')
    else:
        tareas_lines.append('  - **Sin tareas pendientes registradas.**')

    # Actividades del calendario vinculadas
    acts = Actividad.objects.filter(
        oportunidad=opp, completada=False, fecha_inicio__gte=ahora
    ).order_by('fecha_inicio')[:3]
    acts_vencidas = Actividad.objects.filter(
        oportunidad=opp, completada=False, fecha_inicio__lt=ahora
    ).order_by('fecha_inicio')[:3]
    act_lines = []
    if acts_vencidas.exists():
        for a in acts_vencidas:
            fi = a.fecha_inicio.strftime('%Y-%m-%d %H:%M') if a.fecha_inicio else '—'
            act_lines.append(f'  - [vencida] {fi} · {(a.titulo or "")[:80]}')
    if acts.exists():
        for a in acts:
            fi = a.fecha_inicio.strftime('%Y-%m-%d %H:%M') if a.fecha_inicio else '—'
            act_lines.append(f'  - [agendada] {fi} · {(a.titulo or "")[:80]}')
    if not act_lines:
        act_lines.append('  - **Sin actividades agendadas** (red flag — nadie está empujando).')

    # Bitácora / mensajes de la conversación (últimos 10)
    msgs = list(MensajeOportunidad.objects.filter(oportunidad=opp).order_by('-fecha')[:10])
    msgs.reverse()
    msg_lines = []
    for m in msgs:
        if not m.texto:
            continue
        autor = (m.usuario.get_full_name() or m.usuario.username) if m.usuario_id else 'desconocido'
        fecha = m.fecha.strftime('%Y-%m-%d') if m.fecha else ''
        msg_lines.append(f'  - **{autor}** ({fecha}): {m.texto[:280]}')
    if not msg_lines:
        msg_lines.append('  - (sin mensajes en la conversación todavía)')

    # Cadena de correos vinculada a la opp (últimos 3) — muy útil para
    # entender el estado real del deal: qué se mandó, qué respondieron,
    # tono, objeciones, fechas. Capped a 400 chars por cuerpo para no
    # inflar el contexto.
    emails = list(MailCorreo.objects.filter(oportunidad=opp).order_by('-fecha_envio')[:3])
    emails.reverse()  # cronológico ascendente para que la "última" sea la más reciente
    email_lines = []
    for em in emails:
        sentido = 'enviado' if em.carpeta_display == 'SENT' else 'recibido'
        de_para = em.remitente_email or em.remitente_nombre or '—'
        fecha_em = em.fecha_envio.strftime('%Y-%m-%d %H:%M') if em.fecha_envio else '—'
        asunto = (em.asunto or '(sin asunto)').strip()
        # cuerpo_texto puede no estar cargado todavía si nunca se abrió.
        body = (em.cuerpo_texto or '').strip()
        # Colapsamos saltos de línea y limitamos
        if body:
            body = ' '.join(body.split())
            if len(body) > 400:
                body = body[:397] + '...'
        else:
            body = '(cuerpo no descargado todavía)'
        email_lines.append(
            f'  - **[{sentido}]** {fecha_em} · de {de_para}\n'
            f'    Asunto: {asunto[:200]}\n'
            f'    Cuerpo: {body}'
        )
    email_block = ''
    if email_lines:
        email_block = (
            '\n## Correos vinculados a esta oportunidad (últimos 3, cronológicos)\n'
            + '\n'.join(email_lines) + '\n'
        )
    else:
        email_block = (
            '\n## Correos vinculados\n'
            '- (sin correos vinculados a esta opp)\n'
        )

    # Histórico del cliente
    hist = _historico_cliente(opp.cliente, opp.id) if opp.cliente_id else {}
    hist_block = ''
    if hist:
        if hist['ganadas'] > 0:
            hist_block = (
                f'\n## Histórico de este cliente con IAMET\n'
                f'- **Opps ganadas/pagadas anteriores:** {hist["ganadas"]}\n'
                f'- **Monto ganado histórico:** {_money(hist["monto_ganado_historico"])}\n'
                f'- **Ticket promedio:** {_money(hist["ticket_promedio"])}\n'
                f'- **Opps perdidas/canceladas:** {hist["perdidas"]}\n'
            )
        else:
            hist_block = (
                '\n## Histórico de este cliente con IAMET\n'
                '- **Es el PRIMER deal con IAMET** (sin opps ganadas previas). '
                'Esto suele significar más fricción de confianza y proceso '
                'de evaluación más largo.\n'
            )

    # Si vino de prospecto
    prospecto_block = ''
    try:
        prospecto_origen = Prospecto.objects.filter(oportunidad_creada=opp).first()
        if prospecto_origen:
            prospecto_block = (
                f'\n## Origen: Prospecto\n'
                f'- Esta oportunidad se generó del prospecto '
                f'"{prospecto_origen.nombre}" (etapa: {prospecto_origen.get_etapa_display()}).\n'
            )
    except Exception:
        pass

    # Señal: cotización pero sin movimiento reciente
    senial_extra = ''
    if cots and dias_desde_act and dias_desde_act >= 7:
        ultima_cot = cots[0]
        dias_cot = _dias_desde(ultima_cot.fecha_creacion) if ultima_cot.fecha_creacion else None
        if dias_cot and dias_cot >= 5:
            senial_extra = (
                f'\n**Señal detectada**: la última cotización es de {_humanize_dias(dias_cot)} '
                f'y la opp no se actualiza desde {_humanize_dias(dias_desde_act)}. '
                'Es momento de un seguimiento explícito.\n'
            )

    return (
        '\n## La oportunidad sobre la que estamos hablando\n'
        f'- **Título:** {opp.oportunidad}\n'
        f'- **Cliente:** {cliente_nombre}\n'
        f'- **Contacto principal:** {contacto}\n'
        f'- **Vendedor responsable:** {vendedor}\n'
        f'- **Producto/Marca:** {opp.producto}\n'
        f'- **Área:** {opp.area}\n'
        f'- **Etapa actual:** {etapa}\n'
        f'- **Monto:** {_money(opp.monto)}\n'
        f'- **Probabilidad:** {probabilidad}\n'
        f'- **Mes/año de cierre esperado:** {mes_cierre}/{anio_cierre}\n'
        f'- **Tipo:** {opp.tipo_negociacion}\n'
        f'- **Creada:** {_humanize_dias(dias_desde_creacion)}\n'
        f'- **Última actualización:** {tiempo_en_etapa}'
        + (' — la opp está **estancada**' if dias_desde_act and dias_desde_act >= 14 else '')
        + '\n\n'
        '## Cotizaciones vinculadas\n'
        + '\n'.join(cot_lines) + '\n\n'
        '## Tareas\n'
        + '\n'.join(tareas_lines) + '\n\n'
        '## Actividades del calendario\n'
        + '\n'.join(act_lines) + '\n\n'
        '## Conversación / bitácora (últimos 10 mensajes)\n'
        + '\n'.join(msg_lines) + '\n'
        + email_block
        + hist_block + prospecto_block + senial_extra
    )


# ─── System prompt ─────────────────────────────────────────────────────


def _closure_guidance(turn_number: int) -> str:
    if turn_number <= 2:
        return (
            'ETAPA TEMPRANA. Puedes hacer 1 pregunta clave al final si '
            'genuinamente la necesitas para destrabar el deal.'
        )
    if turn_number <= 4:
        return (
            'ETAPA INTERMEDIA. Reduce preguntas; propon acciones '
            'concretas. Si vas a preguntar, que sea LA pregunta clave.'
        )
    if turn_number <= 6:
        return (
            'ETAPA DE CIERRE. NO termines con pregunta nueva. Resume '
            'el siguiente paso concreto y sugiere "Guardar resumen" '
            'para tener el plan en la conversación del deal. '
            f'Turno {turn_number} de {MAX_USER_TURNS}.'
        )
    return (
        'ÚLTIMOS TURNOS. NO hagas preguntas. Tu respuesta debe ser un '
        'plan de acción claro: 1-2 líneas de contexto + UN próximo '
        'paso concreto. Cierra con: "Guarda el resumen para tenerlo '
        f'en la conversación." Turno {turn_number} de {MAX_USER_TURNS} '
        '(próximo se auto-guardará).'
    )


def _system_prompt(opp: TodoItem, config: AsistenteConfig, user,
                   turn_number: int = 1, previous_resumen: str = '') -> dict:
    """System prompt del coach de cierre de oportunidades."""
    first = (user.first_name or user.username).strip()
    nombre_asist = config.nombre or 'el asistente'
    base = (
        f'Eres {nombre_asist}, asistente AI de IAMET en su rol de '
        f'**coach táctico de cierre de oportunidades**. Estás hablando '
        f'con {first} sobre una oportunidad activa del pipeline. Tu '
        'trabajo NO es decidir por el vendedor: es leer el contexto '
        'rico del deal (etapa, días en etapa, cotizaciones, tareas, '
        'actividades, bitácora, histórico del cliente) y ayudarle a '
        'aclarar ideas, identificar red flags y dar siguientes pasos '
        'concretos para mover el deal.\n\n'

        '## Filosofía de coach (no negociable)\n'
        '- **Aclaras, no decides.** El vendedor manda. Tú das panorama '
        'y opciones.\n'
        '- **Concreto, escrappy.** "Mándale este correo hoy", "llama '
        'al técnico esta semana", NO "implementa un proceso multi-'
        'touch enterprise".\n'
        '- **Lee el contexto** del deal y construye SOBRE eso. NO '
        'inventes datos que no están en el contexto.\n'
        '- **Conciso por default**: 4-7 líneas por turno. Expandes '
        'solo si el vendedor pide profundidad.\n'
        '- Español mexicano natural, tono colega senior.\n'
        '- NO uses emojis decorativos. Énfasis = **negritas**.\n'
        '- NO uses frases sycophantic ("excelente deal", "gran '
        'oportunidad"). Sé pragmático.\n\n'

        '## Contexto IAMET\n'
        'IAMET es empresa pequeña B2B mexicana de tecnología, '
        'automatización industrial y sistemas de identificación. '
        'Marcas: Zebra, Panduit, APC, Avigilon, Genetec, Axis, etc. '
        'Equipo de ventas chico. Las recomendaciones útiles son '
        'manuales: una llamada, una visita, un correo bien escrito, '
        'una propuesta clara — no campañas multinacionales.\n\n'

        '## Detectores en el contexto (señales a buscar)\n'
        'Antes de responder, identifica:\n'
        '- **Opp estancada**: última actualización ≥14 días → el deal '
        'se está enfriando.\n'
        '- **Sin actividades agendadas**: red flag — nadie empuja.\n'
        '- **Tarea o actividad vencida**: compromiso no cumplido — '
        'abórdalo primero.\n'
        '- **Cotización enviada hace ≥5 días sin movimiento**: hay '
        'que hacer seguimiento.\n'
        '- **Cliente con histórico fuerte**: confía; puedes pedir '
        'cierre más directo.\n'
        '- **Primer deal del cliente**: más fricción; sugiere demo '
        'o piloto antes de presionar.\n'
        '- **Probabilidad alta pero etapa atrasada**: revisar si la '
        'probabilidad refleja la realidad.\n\n'

        '## Las 3 funciones principales — TIENEN PROPÓSITOS DISTINTOS\n\n'

        '**A) "Cómo va este deal"** — DIAGNÓSTICO PROFUNDO, NO acciones.\n'
        'Esta es la función ESTRELLA y la más rica. El vendedor quiere '
        'un análisis razonado del deal, no una sugerencia. Estructura:\n\n'
        '   ### Estado del deal\n'
        '   1-2 líneas: dónde está la opp (etapa, días, monto, '
        'probabilidad), qué tan caliente o fría está en este momento.\n\n'
        '   ### Lo que veo bien\n'
        '   1-2 bullets con señales POSITIVAS detectadas en el '
        'contexto: actividad reciente, correos con buen tono, cliente '
        'con histórico, etc. Si NO hay nada bueno, dilo así sin '
        'forzar positividad.\n\n'
        '   ### Errores / red flags\n'
        '   2-4 bullets con problemas CONCRETOS detectados:\n'
        '   - Tarea vencida o actividad no realizada en plazo\n'
        '   - Cotización enviada sin follow-up\n'
        '   - Silencio prolongado del cliente en correos\n'
        '   - Sin actividad agendada\n'
        '   - Tono escalando hacia objeción no atendida\n'
        '   - Probabilidad del vendedor desalineada con la evidencia\n'
        '   - Cambios bruscos de scope en la conversación\n'
        '   Lee los CORREOS si están — son la mejor fuente de señal '
        'real (qué dijo el cliente la última vez, qué tono usa, qué '
        'pidieron y nunca contestaste).\n\n'
        '   ### Recomendaciones (qué hacer ahora)\n'
        '   2-3 acciones concretas que el vendedor debería tomar — '
        'NO te limites a una. Estas son sugerencias para PENSAR, no '
        'para agendar inmediatamente. Cada una con un por qué corto.\n\n'
        'Reglas duras para "Cómo va":\n'
        '- Razona ANTES de escribir — NO empieces a redactar sin '
        'haber leído el contexto entero (etapa, cotizaciones, tareas, '
        'actividades, conversación, correos, histórico cliente).\n'
        '- NO inventes errores que no están en el contexto. Si el '
        'deal va decente, dilo: "no detecto red flags duros, sigue '
        'el plan".\n'
        '- Cita evidencia específica: "tu cotización del 8 de mayo "  \n'
        '  "lleva 12 días sin seguimiento", no "hay que dar '
        '  seguimiento".\n'
        '- NO uses el botón de Agendar — esta función NO crea '
        'actividades, solo diagnostica.\n\n'

        '**B) "Próximo paso recomendado"** — UNA acción urgente, lista '
        'para agendar.\n'
        'Propósito DISTINTO de "Cómo va": aquí NO razones largo. '
        'Identifica la ACCIÓN MÁS URGENTE que detectes en el contexto '
        '(tareas, actividades, correos, cotizaciones) y dala lista '
        'para que el vendedor la agende con 1 click. Estructura:\n\n'
        '   - 1 línea de contexto: por qué esto AHORA (ej. "El '
        'cliente preguntó por tiempos de entrega hace 4 días y no '
        'has contestado").\n'
        '   - **El próximo paso:** verbo + objeto concreto, accionable. '
        'Ejemplo: "Llamar a Carlos Pérez mañana para confirmar '
        'tiempos de entrega del Zebra ZD420." — UNA acción, no varias.\n'
        '   - Sugiere implícitamente que el user lo agende (el botón '
        'Agendar aparece debajo).\n\n'
        'Reglas duras para "Próximo paso":\n'
        '- NO incluyas alternativas, análisis ni red flags — esos '
        'son para "Cómo va este deal".\n'
        '- Sé telegráfico: 4-5 líneas TOTALES máximo.\n'
        '- Que la acción sea AGENDABLE en formato calendario '
        '(verbo + objeto + persona/cosa, no abstracta tipo "mejorar '
        'la comunicación").\n\n'

        '**C) "Redactar seguimiento"** — la función más usada día a día.\n'
        'Cuando el user pide redactar correo / mensaje:\n'
        '   - Entrégale **el correo/mensaje listo** para copiar.\n'
        '   - Tono cordial mexicano B2B, profesional pero cercano.\n'
        '   - Incluye **asunto** si es correo.\n'
        '   - Si hay correos previos en el contexto, **REFERENCIA** '
        'el último ("dando seguimiento a tu correo del [fecha]") o el '
        'tema concreto que dejaron pendiente.\n'
        '   - Adapta tono según contexto:\n'
        '     · Tiempo sin movimiento → directo, recordatorio.\n'
        '     · Cotización fresca → educado, "¿pudieron revisarla?".\n'
        '     · Objeción en bitácora/correo → respuesta dirigida.\n'
        '   - NO inventes datos que no estén en el contexto.\n\n'

        '## Preguntas de seguimiento — sé el "ojo crítico" del deal\n'
        'Después de un diagnóstico ("Cómo va este deal") es COMÚN que '
        'el user (especialmente un supervisor) pregunte cosas '
        'específicas para profundizar. Tienes TODA la data del deal '
        'en tu contexto inicial: cotizaciones, tareas, actividades, '
        'mensajes de la conversación, correos vinculados, histórico '
        'del cliente. Responde con la data LITERAL — sin alucinar.\n\n'
        'Ejemplos de preguntas que debes responder con precisión:\n'
        '- "¿Cuál fue la última tarea?" → cita el título, fecha y '
        'estado de la tarea más reciente que está en tu contexto.\n'
        '- "¿Qué decía el último correo?" / "¿Qué nos respondieron?" '
        '→ resume en 2-3 líneas el cuerpo del correo más reciente '
        'del contexto, citando remitente y fecha.\n'
        '- "¿Cuánto fue la cotización más reciente?" → da total, '
        'fecha, moneda y tipo (Bajanet/Iamet).\n'
        '- "¿Qué incluye la cotización?" / "¿Qué productos cotizamos?" '
        '→ lista los items literales con cantidad, marca, no. de '
        'parte y precio total. NO inventes productos.\n'
        '- "¿Qué actividades tiene agendadas?" / "¿Tiene algo '
        'vencido?" → lista lo que esté en el contexto.\n'
        '- "¿Cuántas opps cerradas ha tenido este cliente?" → cita '
        'el histórico que ya viene en tu contexto.\n'
        '- "¿Hay alguna objeción pendiente?" → busca señales en los '
        'mensajes y correos. Cita la fuente.\n\n'
        'Reglas duras para seguimientos:\n'
        '- SIEMPRE cita la fuente: fecha del correo, fecha de la '
        'tarea, autor del comentario. Ej. "El correo del 12 de mayo '
        'de carlos.garcia@... preguntaba por…".\n'
        '- Si el dato NO está en tu contexto, dilo claro: "No tengo '
        'esa información en el contexto cargado; abre la conversación '
        'o la pestaña de cotizaciones para verlo a detalle."\n'
        '- Responde directo, sin volver a hacer todo el diagnóstico '
        '— el user ya lo vio.\n'
        '- Tono más breve en seguimientos: 2-4 líneas suelen ser '
        'suficientes.\n\n'

        '## Tool disponible: crear_actividad_oportunidad\n'
        'Tienes acceso a una función que agenda una actividad en el '
        'calendario del vendedor de la oportunidad.\n\n'
        '**ÚSALA SOLO cuando el usuario te dé una instrucción DIRECTA**, '
        'imperativa:\n'
        '   - "agenda una llamada para mañana"\n'
        '   - "agéndame seguimiento en 3 días"\n'
        '   - "crea una actividad para visitar el viernes"\n'
        '   - "ponme en el calendario que llame al contacto"\n\n'
        '**NO la uses** cuando el user:\n'
        '   - pide consejo, opinión, "cómo va el deal" o "próximo paso"\n'
        '   - explora dudas\n'
        '   - solo redacta un correo\n'
        '   (En esos casos responde en texto; el botón Agendar manual '
        'aparece debajo cuando aplique).\n\n'
        'Al usar la tool: extrae `descripcion` corta (verbo + objeto), '
        'infiere `tipo` (llámale→llamada; visítalo→visita; correo→'
        'correo; etc.), y `dias_desde_hoy` por el plazo (mañana=1, '
        'pasado mañana=2, en una semana=7, default 2). Confirma '
        'después en 1 línea.\n\n'

        '## Reglas duras\n'
        '- NO digas que el deal va a cerrar o no cerrar — eso es '
        'incierto.\n'
        '- NO sugieras descuentos sin que el user lo pida.\n'
        '- NO recomiendes cancelar/dropear la opp — si el user '
        'pregunta, dale criterios y dile que lo evalúe con su '
        'supervisor.\n'
        '- NO inventes contactos, montos, ni hechos no presentes en '
        'el contexto.\n'
        '- Si el user pide una decisión irreversible (cerrar como '
        'perdida, dar 30% descuento), aplica veredicto de prudencia: '
        '"Esta decisión es muy delicada para tomarla solo basándote '
        'en una conversación conmigo. Analízala con tu supervisor."\n\n'

        '## Formato visual\n'
        '- `### Título` para secciones (máx `###`).\n'
        '- **Tablas markdown** para comparar opciones.\n'
        '- `::: kpis :::` cuando tengas 3+ números clave (monto, días, '
        '# cotizaciones, probabilidad). Formato `Label | Valor | Sub`.\n'
        '- Bullets `-` para enumerar.\n'
    )

    # Bloques dinámicos
    closure_block = (
        '\n\n## Etapa de cierre del chat (turno actual)\n'
        + _closure_guidance(turn_number) + '\n'
    )
    resumen_block = ''
    if previous_resumen:
        resumen_block = (
            '\n\n## Resumen de la conversación anterior (continuidad)\n'
            'Anteriormente conversaste con el vendedor sobre esta '
            'oportunidad. Cuando se llenó el chat, guardaste este '
            'resumen en la conversación del deal. Úsalo como base; '
            'no repitas las mismas preguntas:\n\n'
            + previous_resumen.strip() + '\n'
        )
    return {
        'role': 'system',
        'content': (
            base + _opp_context_block(opp) + resumen_block + closure_block
        ),
    }


# ─── Helpers internos ──────────────────────────────────────────────────


def _build_context(opp: TodoItem) -> list[dict]:
    msgs = list(
        OportunidadAsistenteMensaje.objects
        .filter(oportunidad=opp)
        .order_by('-fecha')[:MAX_HISTORY_MSGS]
    )
    msgs.reverse()
    return [{'role': m.role, 'content': m.contenido} for m in msgs]


def _msg_to_dict(m: OportunidadAsistenteMensaje) -> dict:
    return {
        'id': m.id,
        'role': m.role,
        'contenido': m.contenido,
        'fecha': m.fecha.isoformat() if m.fecha else None,
    }


def _generar_resumen_llm(opp: TodoItem, msgs, cfg: AsistenteConfig) -> tuple[str, str]:
    """Genera un resumen plain-text del hilo. Devuelve (texto, error)."""
    if not msgs:
        return ('', 'No hay conversación que resumir todavía.')
    transcript = '\n\n'.join(
        f'[{m.role.upper()}] {m.contenido}' for m in msgs if m.contenido
    )
    sys_msg = {
        'role': 'system',
        'content': (
            'Eres un asistente que SINTETIZA conversaciones de coaching '
            'de ventas — no las copia. Te paso la transcripción de un '
            'chat entre un vendedor y un AI sobre una oportunidad. '
            'Devuelve un resumen MUY corto que cualquiera pueda leer '
            'en 20 segundos: dónde está el deal y qué sigue.\n\n'
            'Reglas duras:\n'
            '- NO copies frases textuales del chat.\n'
            '- NO transcribas el ida-y-vuelta.\n'
            '- NO incluyas tu opinión ni preguntas abiertas.\n'
            '- Tono ejecutivo, accionable.\n\n'
            'Formato OBLIGATORIO — PLAIN TEXT, sin markdown:\n\n'
            '  Resumen de IAMET AI\n'
            '\n'
            '  Estado del deal:\n'
            '  · 1 a 2 bullets describiendo dónde está y qué señales\n'
            '\n'
            '  Próximo paso:\n'
            '  · 1 a 3 bullets con acciones concretas\n\n'
            'Reglas de formato:\n'
            '- Usa · (middot) para bullets, no - ni *.\n'
            '- Máximo 8 líneas totales.\n'
            '- NO uses emojis.\n'
        ),
    }
    user_msg = {
        'role': 'user',
        'content': (
            f'Oportunidad: {opp.oportunidad}\n'
            f'Cliente: {opp.cliente.nombre_empresa if opp.cliente_id else "—"}\n'
            f'Etapa: {opp.etapa_corta or "—"}\n\n'
            f'Transcripción:\n\n{transcript}'
        ),
    }
    try:
        resp = chat(
            messages=[sys_msg, user_msg],
            tools=None,
            model=cfg.modelo,
            temperature=0.3,
            max_tokens=500,
        )
        resumen = (resp.get('text') or '').strip()
    except AsistenteError as e:
        log.warning('Opp resumen error: %s', e)
        return ('', str(e))
    except Exception as e:
        log.exception('Error inesperado en opp resumen: %s', e)
        return ('', f'Error inesperado: {e}')
    if not resumen:
        return ('', 'El asistente no generó resumen.')
    import re as _re
    resumen = _re.sub(r'\*\*', '', resumen)
    resumen = _re.sub(r'^#+\s*', '', resumen, flags=_re.MULTILINE)
    resumen = _re.sub(r'^[-*]\s+', '· ', resumen, flags=_re.MULTILINE)
    return (resumen, '')


# ─── Helper: crear actividad para la oportunidad ───────────────────────


def _crear_actividad_para_opp(opp: TodoItem, request_user, descripcion: str,
                              tipo: str = 'tarea', fecha_iso: str = '',
                              dias_desde_hoy: int = 2):
    """Crea Actividad de calendario para el vendedor dueño de la opp.
    Reusable entre el botón "Agendar" del frontend y la function-calling
    tool del AI. Título = nombre/título de la opp (no la descripción).
    """
    if not descripcion or not descripcion.strip():
        return (None, 'Falta descripción.')
    import re as _re
    descripcion = _re.sub(r'\*\*', '', descripcion)
    descripcion = _re.sub(r'^#+\s*', '', descripcion, flags=_re.MULTILINE)
    descripcion = _re.sub(r'`+', '', descripcion).strip()
    if len(descripcion) > 300:
        descripcion = descripcion[:297].rstrip() + '...'

    # Actividad.tipo_actividad choices: llamada, reunion, tarea, email, otro.
    # Mapeamos sinónimos comunes del LLM al enum válido.
    valid_tipos = {'llamada', 'reunion', 'tarea', 'email', 'otro'}
    tipo = (tipo or 'tarea').strip().lower()
    sinonimos = {
        'correo': 'email',
        'visita': 'reunion',          # visita es reunión presencial
        'reunion_virtual': 'reunion',
    }
    tipo = sinonimos.get(tipo, tipo)
    if tipo not in valid_tipos:
        tipo = 'tarea'

    # Fecha: priorizamos lo que mande el cliente (su hora local en ISO
    # con offset). Fallback al cálculo del servidor.
    fecha = None
    if fecha_iso:
        try:
            from datetime import datetime as _dt
            iso_clean = fecha_iso.replace('Z', '+00:00')
            fecha = _dt.fromisoformat(iso_clean)
            if timezone.is_naive(fecha):
                fecha = timezone.make_aware(fecha)
        except Exception:
            fecha = None
    if fecha is None:
        fecha = timezone.now() + timedelta(days=dias_desde_hoy)
        if fecha.weekday() == 5:
            fecha = fecha + timedelta(days=2)
        elif fecha.weekday() == 6:
            fecha = fecha + timedelta(days=1)

    try:
        act = Actividad.objects.create(
            titulo=(opp.oportunidad or 'Seguimiento')[:200],
            tipo_actividad=tipo,
            descripcion=descripcion,
            fecha_inicio=fecha,
            fecha_fin=fecha + timedelta(hours=1),
            creado_por=opp.usuario,
            oportunidad=opp,
            color='#0052D4',
        )
        return ({
            'id': act.id,
            'tipo': act.tipo_actividad,
            'titulo': act.titulo,
            'descripcion': act.descripcion,
            'fecha_inicio': act.fecha_inicio.isoformat() if act.fecha_inicio else None,
            'vendedor_id': opp.usuario_id,
        }, '')
    except Exception as e:
        log.exception('No se pudo crear Actividad de calendario: %s', e)
        return (None, f'No se pudo crear la actividad: {e}')


def _tool_crear_actividad_schema() -> dict:
    """OpenAI-compatible tool schema para function calling."""
    return {
        'type': 'function',
        'function': {
            'name': 'crear_actividad_oportunidad',
            'description': (
                'Crea una actividad de seguimiento en el calendario del '
                'vendedor responsable de la oportunidad. USA esta '
                'función SOLO con instrucciones DIRECTAS imperativas '
                '("agenda", "agéndame", "ponme en calendario", "crea '
                'actividad"). NO la uses para sugerencias, consejos, '
                'redacción de correos, ni "cómo va el deal" — en esos '
                'casos responde en texto.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'tipo': {
                        'type': 'string',
                        'enum': ['llamada', 'email', 'reunion',
                                 'tarea', 'otro'],
                        'description': (
                            'Tipo. Default "tarea". "llámale"→llamada, '
                            '"correo"→email, "reunión"/"visita"→reunion '
                            '(la visita se modela como reunión).'
                        ),
                    },
                    'descripcion': {
                        'type': 'string',
                        'description': (
                            'Acción corta accionable. Ejemplo: "Llamar '
                            'a Carlos Pérez para confirmar cotización". '
                            'Sin headers ni meta-comentarios. Máximo '
                            '200 caracteres.'
                        ),
                    },
                    'dias_desde_hoy': {
                        'type': 'integer',
                        'description': (
                            'Días naturales desde hoy. "mañana"=1, '
                            '"pasado mañana"=2, "en una semana"=7, '
                            'default 2.'
                        ),
                        'default': 2,
                    },
                },
                'required': ['descripcion'],
            },
        },
    }


# ─── Endpoints ─────────────────────────────────────────────────────────


@login_required
@require_http_methods(['GET'])
def api_oportunidad_asistente_mensajes(request, opp_id: int):
    """Historial del chat AI sobre una oportunidad."""
    opp, access = _get_opp_with_access(opp_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Oportunidad no encontrada.'}, status=404)
    if access == 'no_access':
        return JsonResponse({'ok': True, 'mensajes': []})
    msgs = OportunidadAsistenteMensaje.objects.filter(oportunidad=opp).order_by('fecha')
    return JsonResponse({'ok': True, 'mensajes': [_msg_to_dict(m) for m in msgs]})


@login_required
@require_http_methods(['POST'])
def api_oportunidad_asistente_mensaje(request, opp_id: int):
    """Mensaje del user → respuesta del AI. Maneja auto-save al tope de
    turnos y function calling con la tool crear_actividad_oportunidad."""
    opp, access = _get_opp_with_access(opp_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Oportunidad no encontrada.'}, status=404)
    if access == 'no_access':
        return JsonResponse({
            'ok': True,
            'mensaje': {
                'id': None, 'role': 'assistant',
                'contenido': _msg_no_access(opp), 'fecha': None,
            },
        })
    try:
        payload = json.loads(request.body or '{}')
    except Exception:
        payload = {}
    texto = (payload.get('texto') or '').strip()
    if not texto:
        return JsonResponse({'ok': False, 'error': 'Texto vacío.'}, status=400)
    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)

    # Auto-save al pasar MAX_USER_TURNS
    auto_saved_resumen = None
    if _count_user_turns(opp) >= MAX_USER_TURNS:
        msgs_existentes = list(OportunidadAsistenteMensaje.objects
                               .filter(oportunidad=opp).order_by('fecha'))
        resumen_auto, err_auto = _generar_resumen_llm(opp, msgs_existentes, cfg)
        if err_auto:
            return JsonResponse({
                'ok': False,
                'error': (
                    'Llegamos al límite del chat pero no pude generar '
                    'el resumen automático. Intenta de nuevo o usa el '
                    f'botón "Guardar resumen" manualmente. Detalle: {err_auto}'
                ),
            }, status=502)
        # Insertamos resumen en la conversación de la oportunidad
        # (MensajeOportunidad — la sección que el user llama "conversación").
        auto_saved_msg = MensajeOportunidad.objects.create(
            oportunidad=opp, usuario=request.user, texto=resumen_auto,
        )
        OportunidadAsistenteMensaje.objects.filter(oportunidad=opp).delete()
        auto_saved_resumen = {
            'id': auto_saved_msg.id,
            'texto': auto_saved_msg.texto,
            'fecha': auto_saved_msg.fecha.isoformat() if auto_saved_msg.fecha else None,
        }

    # Persistir mensaje del user
    OportunidadAsistenteMensaje.objects.create(
        oportunidad=opp, role='user', contenido=texto,
    )
    turn_actual = _count_user_turns(opp)
    previous_resumen = _ultimo_resumen_ai(opp) if turn_actual == 1 else ''

    sys_msg = _system_prompt(
        opp, cfg, request.user,
        turn_number=turn_actual,
        previous_resumen=previous_resumen,
    )
    messages = [sys_msg] + _build_context(opp)
    tools = [_tool_crear_actividad_schema()]
    actividad_creada = None

    try:
        resp = chat(
            messages=messages,
            tools=tools,
            model=cfg.modelo,
            temperature=0.5,
            max_tokens=900,
        )
        # Loop de tool calling — máximo 2 iteraciones
        for _iter in range(2):
            tc_list = resp.get('tool_calls') or []
            if not tc_list:
                break
            for tc in tc_list:
                if tc.get('name') != 'crear_actividad_oportunidad':
                    continue
                args = tc.get('arguments') or {}
                actividad, err = _crear_actividad_para_opp(
                    opp=opp,
                    request_user=request.user,
                    descripcion=args.get('descripcion') or '',
                    tipo=args.get('tipo') or 'tarea',
                    dias_desde_hoy=int(args.get('dias_desde_hoy') or 2),
                )
                if not err:
                    actividad_creada = actividad
                messages.append({
                    'role': 'assistant',
                    'content': resp.get('text') or '',
                    'tool_calls': [{
                        'id': tc['id'],
                        'type': 'function',
                        'function': {
                            'name': tc['name'],
                            'arguments': tc.get('arguments_str') or json.dumps(args),
                        },
                    }],
                })
                tool_result = (
                    json.dumps({'ok': True, 'actividad': actividad}, default=str)
                    if not err else json.dumps({'ok': False, 'error': err})
                )
                messages.append({
                    'role': 'tool',
                    'tool_call_id': tc['id'],
                    'content': tool_result,
                })
            resp = chat(
                messages=messages,
                tools=tools,
                model=cfg.modelo,
                temperature=0.5,
                max_tokens=600,
            )
        final_text = (resp.get('text') or '').strip() or '(sin respuesta)'
    except AsistenteError as e:
        log.warning('Opp asistente error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado opp asistente: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error inesperado: {e}'}, status=500)

    if auto_saved_resumen:
        final_text = (
            'Llegamos al tope de este chat. Guardé un resumen en la '
            'conversación de la oportunidad y arranqué un chat nuevo '
            'con ese resumen como contexto. Aquí va mi respuesta:\n\n'
            + final_text
        )

    assistant_msg = OportunidadAsistenteMensaje.objects.create(
        oportunidad=opp, role='assistant', contenido=final_text,
    )
    payload_resp = {'ok': True, 'mensaje': _msg_to_dict(assistant_msg)}
    if auto_saved_resumen:
        payload_resp['auto_saved_resumen'] = auto_saved_resumen
    if actividad_creada:
        payload_resp['actividad_creada'] = actividad_creada
    return JsonResponse(payload_resp)


@login_required
@require_http_methods(['POST'])
def api_oportunidad_asistente_resumen(request, opp_id: int):
    """Genera resumen y lo inserta como MensajeOportunidad en la
    conversación del deal."""
    opp, access = _get_opp_with_access(opp_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Oportunidad no encontrada.'}, status=404)
    if access == 'no_access':
        return JsonResponse({'ok': False, 'error': 'Sin permisos.'}, status=403)
    msgs = list(OportunidadAsistenteMensaje.objects.filter(oportunidad=opp).order_by('fecha'))
    if not msgs:
        return JsonResponse({'ok': False, 'error': 'No hay conversación que resumir todavía.'}, status=400)
    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'Asistente desactivado.'}, status=403)
    resumen, err = _generar_resumen_llm(opp, msgs, cfg)
    if err:
        return JsonResponse({'ok': False, 'error': err}, status=502)
    mensaje = MensajeOportunidad.objects.create(
        oportunidad=opp, usuario=request.user, texto=resumen,
    )
    return JsonResponse({
        'ok': True,
        'mensaje': {
            'id': mensaje.id,
            'usuario_nombre': request.user.get_full_name() or request.user.username,
            'texto': mensaje.texto,
            'fecha': mensaje.fecha.isoformat() if mensaje.fecha else None,
        },
    })


@login_required
@require_http_methods(['POST'])
def api_oportunidad_asistente_reset(request, opp_id: int):
    """Borra el hilo del AI (botón Nuevo chat)."""
    opp, access = _get_opp_with_access(opp_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Oportunidad no encontrada.'}, status=404)
    if access == 'no_access':
        return JsonResponse({'ok': False, 'error': 'Sin permisos.'}, status=403)
    deleted, _ = OportunidadAsistenteMensaje.objects.filter(oportunidad=opp).delete()
    return JsonResponse({'ok': True, 'borrados': deleted})


@login_required
@require_http_methods(['POST'])
def api_oportunidad_actividad_rapida(request, opp_id: int):
    """Agenda rápida disparada desde el botón "Agendar" del chat (debajo
    de la respuesta del AI a "Próximo paso"). Mismo helper que usa la
    tool de function calling."""
    opp, access = _get_opp_with_access(opp_id, request.user)
    if access == 'not_found':
        return JsonResponse({'ok': False, 'error': 'Oportunidad no encontrada.'}, status=404)
    if access == 'no_access':
        return JsonResponse({'ok': False, 'error': 'Sin permisos.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except Exception:
        payload = {}
    actividad, err = _crear_actividad_para_opp(
        opp=opp,
        request_user=request.user,
        descripcion=(payload.get('descripcion') or '').strip(),
        tipo=(payload.get('tipo') or 'tarea').strip(),
        fecha_iso=(payload.get('fecha_iso') or '').strip(),
        dias_desde_hoy=int(payload.get('dias_desde_hoy') or 2),
    )
    if err:
        return JsonResponse({'ok': False, 'error': err}, status=400)
    return JsonResponse({'ok': True, 'actividad': actividad})
