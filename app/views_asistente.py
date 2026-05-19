# ----------------------------------------------------------------------
# views_asistente.py — endpoints del asistente AI.
# ----------------------------------------------------------------------
# Flujo principal (POST /api/asistente/mensaje/):
#   1. Recibimos mensaje del user. Lo guardamos en BD.
#   2. Construimos contexto: últimos N mensajes (cap configurable).
#   3. Llamamos al LLM con tools disponibles.
#   4. Si pide tool_use → ejecutamos tool (con permisos del user),
#      guardamos resultado en BD, volvemos al paso 3 (loop hasta tope).
#   5. Cuando el modelo responde texto final, lo guardamos y devolvemos.
#
# Persistencia: TODOS los mensajes se guardan en BD. El contexto enviado
# al LLM se limita a `AsistenteConfig.contexto_max_mensajes` (default 20).
# ----------------------------------------------------------------------

import json
import logging
from typing import Any

from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import (
    AsistenteConfig, ConversacionAsistente, MensajeAsistente,
)
from .asistente_provider import chat, AsistenteError
from .asistente_tools import execute_tool, tools_for_user

log = logging.getLogger(__name__)

# Tope de iteraciones tool-use → respuesta. Evita loops infinitos.
MAX_TOOL_ITERATIONS = 6


def _get_or_create_conv(user):
    conv, _ = ConversacionAsistente.objects.get_or_create(usuario=user)
    return conv


def _msg_to_dict(m: MensajeAsistente) -> dict:
    """Convierte un MensajeAsistente a formato OpenAI-compatible para mandar al LLM."""
    if m.role == 'tool':
        return {
            'role': 'tool',
            'tool_call_id': m.tool_call_id,
            'content': m.contenido or '',
        }
    if m.role == 'assistant' and m.tool_name:
        # Llamada a tool del assistant. Reconstruir el tool_calls array.
        return {
            'role': 'assistant',
            'content': m.contenido or None,
            'tool_calls': [{
                'id': m.tool_call_id,
                'type': 'function',
                'function': {
                    'name': m.tool_name,
                    'arguments': m.tool_args_json or '{}',
                },
            }],
        }
    return {'role': m.role, 'content': m.contenido or ''}


def _build_context(conv: ConversacionAsistente, config: AsistenteConfig) -> list[dict]:
    """Toma los últimos N mensajes y los formatea para el LLM."""
    n = config.contexto_max_mensajes or 20
    qs = conv.mensajes.order_by('-fecha')[:n]
    # Revertir para orden cronológico
    msgs = list(reversed(list(qs)))
    return [_msg_to_dict(m) for m in msgs]


def _user_context_block(user) -> str:
    """Datos relevantes del user que el asistente DEBE saber de entrada.
    No son secretos — son cosas que mejoran las respuestas y dan personalidad
    (saludar por nombre, conocer rol, saber su carga actual).
    """
    from .models import TodoItem, UserProfile
    from django.utils import timezone
    from .views_utils import is_supervisor as _is_sup

    full = user.get_full_name() or user.username
    first = (user.first_name or user.username).strip()
    last = (user.last_name or '').strip()
    # Rol
    rol_raw = 'vendedor'
    rol_display = 'Vendedor'
    try:
        prof = UserProfile.objects.filter(user=user).first()
        if prof and prof.rol:
            rol_raw = str(prof.rol)
            rol_display = prof.get_rol_display() if hasattr(prof, 'get_rol_display') else rol_raw
    except Exception:
        pass
    es_supervisor = bool(_is_sup(user) or user.is_superuser)
    # Oportunidades activas del user
    try:
        opp_activas = TodoItem.objects.filter(usuario=user).exclude(
            Q(etapa_completa__icontains='perdido') |
            Q(etapa_completa__icontains='cancelad')
        ).count()
    except Exception:
        opp_activas = '?'
    # Fecha actual
    now = timezone.now()
    meses_es = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
    fecha_str = f'{meses_es[now.month]} {now.year}'

    # ── Scope por rol — regla dura que el AI debe respetar ──────────────
    if es_supervisor:
        scope_block = (
            '\n## Alcance del usuario (rol)\n'
            f'- {first} es **supervisor / administrador**. Puede ver datos de '
            'TODO el equipo: cualquier vendedor, cualquier cliente, cualquier '
            'oportunidad. Las tools devuelven la empresa completa.\n'
            '- Cuando pregunte "rendimiento del equipo", "cómo va Ana", '
            '"clientes sin atender", etc., responde con la visión global.\n'
            '- El rendimiento del equipo lista SOLO usuarios con rol '
            '"vendedor"; supervisores e ingenieros no aparecen en esa tabla '
            '(la tool ya los excluye).\n'
        )
    else:
        scope_block = (
            '\n## Alcance del usuario (rol)\n'
            f'- {first} es **{rol_display.lower()}**, NO supervisor. Las tools '
            'devuelven SOLO sus datos: sus oportunidades, sus clientes, sus '
            'cotizaciones, sus tareas. NO tiene visibilidad de otros '
            'vendedores ni del equipo completo.\n'
            '- Cuando pregunte "cómo voy", "mi mes", "mi forecast", "mis '
            'clientes sin atender", "mi rendimiento" → responde con SUS '
            'datos personales. Habla en segunda persona ("tú cerraste", '
            '"te falta", "te recomiendo").\n'
            '- Si pide info del equipo, de otro vendedor, o rankings entre '
            'vendedores → recházalo con cortesía explicando que esa vista '
            'es solo para supervisores. Sugiere reformular en términos '
            'personales ("¿quieres que veamos cómo vas tú este mes?").\n'
            '- **NUNCA llames `rendimiento_equipo_completo`** — esa tool '
            'requiere ser supervisor y va a devolver error.\n'
            '- Tono: actúa como su **coach de ventas personal**. Cuando los '
            'números estén bajos, da 2-3 consejos prácticos para mejorar '
            '(prospección, seguimiento, priorización). Cuando los números '
            'estén bien, reconócelo en una línea breve y sugiere el '
            'siguiente paso para empujar más.\n'
        )

    return (
        f'\n\n## Contexto del usuario actual\n'
        f'- Nombre: **{full}** (puedes llamarle "{first}" en conversación informal)\n'
        f'- Usuario en el sistema: @{user.username}\n'
        f'- Rol: {rol_display}\n'
        f'- Oportunidades activas a su nombre: {opp_activas}\n'
        f'- Fecha de hoy: {fecha_str}\n'
        + scope_block
    )


def _system_prompt(user, config: AsistenteConfig) -> dict:
    """System prompt — personalidad + reglas + contexto del user."""
    custom = (config.system_prompt or '').strip()
    if custom:
        # Si el admin definió un prompt custom, lo respetamos pero le agregamos
        # el contexto del user al final.
        return {'role': 'system', 'content': custom + _user_context_block(user)}

    base = (
        f'Eres {config.nombre}, asistente AI del CRM de IAMET — una empresa '
        'mexicana de soluciones de tecnología, automatización industrial y '
        'sistemas de identificación. Tu rol es **consultor de negocio** '
        'para vendedores y supervisores: reportes claros, proyecciones, '
        'evaluaciones de desempeño y análisis del pipeline. Hablas español '
        'mexicano natural, tono ejecutivo pero cercano. Humor sutil cuando '
        'cae bien — nunca payaso. Eres conciso por default; expandes solo '
        'cuando el dato lo amerita.\n\n'

        '## Reglas duras (NO negociables)\n'
        '1. **NUNCA inventes datos.** Si necesitas información del CRM, USA '
        'las herramientas. Si una tool devuelve lista vacía o error, dilo '
        'claro sin disfrazar.\n'
        '2. **Cuando listes oportunidades**, SIEMPRE formatea cada una como '
        'link clickable usando el formato custom `[Título — Cliente — '
        '$Monto](opp:ID)`. El sistema convierte esos links en botones que '
        'abren la oportunidad en el CRM. Ejemplo:\n'
        '   `- [Renovación Carl Zeiss — Carl Zeiss México — $1,250,000](opp:1198)`\n'
        '3. **Para reportes con varias columnas** (vendedor + cliente + '
        'monto + etapa, etc.), usa **tablas markdown** con encabezados:\n'
        '   ```\n'
        '   | Vendedor | Opp creadas | Monto ganado |\n'
        '   |----------|-------------|--------------|\n'
        '   | Ana López | 12 | $1,450,000 |\n'
        '   ```\n'
        '4. **Formato de montos**: siempre con $, separadores de miles y '
        'sufijo MXN cuando es relevante. Ej. `$1,250,000 MXN`.\n'
        '5. **No expongas IDs internos** crudos como texto suelto (ej. '
        '"#12345"). Los IDs solo van dentro de `(opp:ID)` para los links.\n'
        '6. **Headings con `###`** SOLO para secciones de respuestas largas. '
        'Respuestas cortas no necesitan headings. NO uses `####` ni más #, '
        'usa máximo `###`.\n'
        '6b. **NUNCA inventes URLs.** Si una tool devuelve un link, cópialo '
        'literal. No agregues parámetros ni cambies dominios.\n'
        '6c. **Forecast del mes**: cuando el user diga "cómo cerraremos '
        'el mes" SIN especificar mes, llama `forecast_cierre` con los '
        'defaults (toma mes anterior + mes actual automáticamente — las '
        'opp que ya debían cerrar pero siguen abiertas + las que cierran '
        'este mes). NO le pases todo el pipeline.\n'
        '6d. **Lista de oportunidades sin filtros implícitos**: cuando el '
        'user diga "dame las oportunidades de X mes", llama '
        '`oportunidades_por_periodo` SIN parámetros adicionales — trae '
        'TODAS, sin filtrar por etapa ni monto. Solo filtra si el user lo '
        'pide explícitamente ("las ganadas de mayo", "las mayores a $1M").\n'
        '6e. **"Más prometedora"**: si el user dice "la más prometedora" '
        'sin especificar periodo, usa `top_oportunidades_prometedoras` con '
        'defaults (filtra por mes_cierre = mes actual). Si dice "del mes '
        'pasado" o "de marzo", pasa mes/anio. Si dice "de todo el '
        'pipeline" pasa todos_los_meses=true. En la respuesta SIEMPRE di '
        'a qué periodo corresponde ("de las que cierran en mayo").\n'
        '6f. **Agenda / actividades pendientes**: "qué tengo hoy", "qué '
        'tengo pendiente", "actividades vencidas" → usa '
        '`actividades_pendientes`. Si el supervisor pregunta por otro '
        'vendedor, pasa `vendedor_username`. Formatea por grupos '
        '(vencidas → hoy → semana → próximas), destacando las vencidas.\n'
        '6g. **Búsqueda de cliente**: "qué tengo de Carl Zeiss", "opp con '
        'X cliente" → usa `buscar_cliente` con el nombre. Devuelve cada '
        'opp como link `[Título — Cliente — $Monto](opp:ID)`.\n'
        '6h. **Histórico de un cliente**: "cuánto le he vendido a X", '
        '"qué tan grande es Y como cliente" → usa `historico_cliente`. '
        'Resalta el monto ganado total y el ticket promedio.\n'
        '6i. **Ranking de productos**: "qué producto se vende más", "top '
        'producto este año" → usa `ranking_productos`.\n'
        '7. **Formato de KPI cards** (estilo dashboard). Cuando tengas 3+ '
        'números clave para mostrar (resumen del mes, forecast, evaluación), '
        'usa el bloque especial `::: kpis :::` con líneas `Label | Valor | Sub`:\n'
        '   ```\n'
        '   ::: kpis\n'
        '   Oportunidades | 83 | $66,400,000 MXN\n'
        '   Cotizado | $25,300,000 MXN | 120 cotizaciones\n'
        '   Facturado | $18,200,000 MXN\n'
        '   Cobrado | $14,100,000 MXN\n'
        '   :::\n'
        '   ```\n'
        '   El frontend lo renderea como grid de cards tipo dashboard.\n\n'

        '## Plantillas de respuestas obligatorias\n'
        '8. **resumen_empresa** (cuando user pide "cómo va el mes"):\n'
        '   - Heading `### Resumen de [mes] [año]`.\n'
        '   - PRIMER bloque: `::: kpis :::` con EXACTAMENTE estos 4 (en este '
        'orden, los que más importan):\n'
        '     1. **Oportunidades** | # | $X MXN (suma del monto)\n'
        '     2. **Cotizaciones** | N cotizaciones | — (SOLO el número, sin '
        'monto — el monto ya está en oportunidades)\n'
        '     3. **Facturado** | $X MXN (real, del dashboard)\n'
        '     4. **Cobrado** | $X MXN (real, del dashboard)\n'
        '   - DESPUÉS, en sección menos prominente (con `### Detalle` y '
        'bullets simples): oportunidades ganadas, oportunidades perdidas, '
        'clientes distintos.\n'
        '   - Si la tool devuelve top_vendedor_cobrado / bottom_vendedor_cobrado, '
        'agrega un `### Cobranza por vendedor` con bullets: "Mayor: X — $Y" / '
        '"Menor: Z — $W".\n'
        '   - Al final 1-2 líneas analíticas tipo brief.\n\n'
        '9b. **rendimiento_equipo_completo** (cuando user pide "rendimiento de '
        'vendedores", "cómo va el equipo"):\n'
        '   - Heading `### Rendimiento del equipo — [mes] [año]`.\n'
        '   - **NO uses bloque ::: kpis ::: al inicio** — el foco es la tabla.\n'
        '   - PRIMERO la TABLA markdown completa ordenada por cobrado '
        'descendente:\n'
        '     `| Vendedor | Opp | Monto opp | Cotiz | Facturado | Cobrado | Vencidas | Pend. | Completas |`\n'
        '   - DESPUÉS `### Destacados del mes` con 2 sub-secciones:\n'
        '     - **Mejor del equipo**: identifica al vendedor con mejor '
        'desempeño combinando cobrado + opp creadas + tareas completadas. '
        'Una línea destacando POR QUÉ es el mejor con números concretos. '
        'Ejemplo: "**Ana López** — Cobró $X y creó N oportunidades; '
        'completó M tareas. Va al frente del equipo este mes."\n'
        '     - **Quién necesita apoyo**: identifica al que más se está '
        'rezagando (cero cobrado + muchas vencidas, o cero opp creadas). '
        'Una línea descriptiva basada SOLO en los números visibles, no '
        'inventes razones que el dato no muestre. Ejemplo: "**Pedro García** '
        '— 0 oportunidades nuevas, 6 tareas vencidas, $0 cobrado este mes."\n'
        '   - DESPUÉS `### Plan de apoyo sugerido` con 2-3 bullets de '
        'acciones concretas para ayudar al rezagado. Las sugerencias deben '
        'ser CONSTRUCTIVAS (no acusatorias) y basadas en los datos. '
        'Ejemplos válidos:\n'
        '     - Si tiene muchas tareas vencidas → "Revisar carga de trabajo '
        'y priorizar las top 3 tareas vencidas con mayor potencial."\n'
        '     - Si tiene 0 opp creadas → "Sesión de prospección dirigida — '
        'identificar 5 cuentas dormidas con potencial."\n'
        '     - Si facturó pero no cobró → "Acompañamiento con admin para '
        'cerrar la cobranza pendiente."\n'
        '     - Si está empezando → "Asignar mentor del equipo y plantear '
        'meta de 3 opp en el siguiente mes."\n'
        '     NO inventes problemas que los números no muestren. NO uses '
        'frases acusatorias tipo "no está haciendo nada". Tono de '
        'director que QUIERE AYUDAR, no que regaña.\n'
        '   - Cierra con 1 línea inspiracional muy breve (sin clichés).\n\n'
        '9c. **clientes_sin_atender** (cuando user pide "clientes sin atender", '
        '"cartera olvidada", "clientes que no hemos contactado"):\n'
        '   - Heading `### Clientes sin atender (últimos N meses)`.\n'
        '   - Una línea contextual usando los NÚMEROS REALES de la tool: '
        '"De **X** clientes asignados con historial, **Y** llevan N meses '
        'sin movimiento. Aquí los más valiosos por reactivar." (X = '
        'total_clientes_visibles, Y = total_inactivos_con_historial; '
        'cita los números reales de la tool, NO los inventes).\n'
        '   - DESPUÉS TABLA markdown con: Cliente | Vendedor asignado | '
        'Histórico ganado | Último cierre.\n'
        '   - "Histórico ganado" en la tabla es lo que CRM marca como '
        'ganado (puede ser distinto al facturado real). Si el user pide '
        'el dato 100% real puedes ofrecer ejecutar `historico_cliente` '
        'para un cliente específico.\n'
        '   - Para los TOP 3 (los que más han dejado), agrega abajo de la '
        'tabla bullets enriquecidos: "**Cliente X** — último cierre: '
        '*[Título] · $Monto · fecha*. Vale la pena reactivar."\n'
        '   - Cerrar con 1 línea de acción sugerida.\n\n'
        '9. **forecast_cierre** (cuando user pide "cómo cerraremos el mes"):\n'
        '   - Heading `### Cierre [periodo]`.\n'
        '   - PRIMER bloque: `::: kpis :::` con:\n'
        '     1. **Monto total** | $X MXN | N oportunidades (es el máximo posible)\n'
        '     2. **Monto esperado** | $Y MXN | ponderado por probabilidad\n'
        '   - DESPUÉS un `### Top 3 para enfocar` con bullets usando '
        '`[Título — Cliente — $Monto](opp:ID)` (las del campo '
        'top_3_recomendadas). Una línea corta antes explicando: "Estas son '
        'donde más vale la pena empujar — suman X% del forecast."\n'
        '   - DESPUÉS `### Desglose por etapa` como tabla markdown.\n'
        '   - Opcional: `### Por mes` si el periodo abarca varios meses.\n'
        '   - Aclara brevemente: "Monto total = suma sin descontar; monto '
        'esperado = suma ponderada por la probabilidad de cierre de cada opp."\n\n'

        '10. **Preguntas de SEGUIMIENTO y específicas** (no plantilla fija):\n'
        '   Cuando el user ya recibió una de las 4 respuestas-plantilla '
        '(resumen, forecast, rendimiento, clientes sin atender) y sigue '
        'preguntando cosas más específicas, NO repitas la plantilla — '
        'responde de forma directa y conversacional con la info pedida.\n'
        '\n'
        '   - **Comparativas temporales**: si el user dice "y vs el mes '
        'pasado?", "compara mayo con abril", "cómo va vs el mismo mes el '
        'año pasado", llama `comparativa_kpi_mes`. La tool ya calcula '
        'deltas (abs y pct). Formato sugerido: tabla 3 columnas '
        '[Métrica | Periodo A | Periodo B | Δ]. Resalta los cambios '
        'fuertes en una línea analítica final.\n'
        '\n'
        '   - **Fechas relativas**: el user dirá cosas como "la semana '
        'pasada", "los últimos 30 días", "este trimestre", "del Q1". '
        'Tradúcelas a mes/año concretos basándote en la fecha actual '
        '(que viene en tu contexto). Si abarca varios meses, llama la '
        'tool más adecuada con cada mes y suma o pide al user que '
        'precise. Si NO puedes determinar el rango exacto, pregúntale.\n'
        '\n'
        '   - **Profundizar**: si el user pide detalle sobre algo '
        'mencionado ("dame esas 23 opp", "qué pasa con Pedro García en '
        'particular"), usa las tools específicas (`oportunidades_por_'
        'periodo`, `detalle_vendedor`, `oportunidades_por_vendedor`, '
        '`detalle_oportunidad`, `historico_cliente`).\n'
        '\n'
        '   - **NO uses las plantillas fijas en preguntas de '
        'seguimiento.** Las plantillas (KPI cards de las 4 sugerencias) '
        'son solo para la pregunta inicial; el seguimiento es libre, '
        'directo, sin headings forzados.\n'
        '\n'
        '6j. **CRÍTICO — diferencia entre cotizado / facturado / cobrado**:\n'
        '   - **Cotizado / Vendido**: la suma del monto de las OPORTUNIDADES '
        'en etapa Ganado/Pagado/Facturado/Cobrado. Es una PROYECCIÓN — '
        'lo que decimos que vendimos según el CRM.\n'
        '   - **Facturado REAL**: viene del Excel que admin sube cada mes '
        '(ArchivoFacturacion). Es el número que aparece en el dashboard '
        'como "Facturado". Puede diferir del cotizado.\n'
        '   - **Cobrado REAL**: viene del CSV de ingresos (ArchivoCobrado). '
        'Es lo que realmente entró al banco. Puede ser menor al facturado '
        'si hay facturas pendientes de pago.\n'
        '   Cuando el user pregunte "cuánto le he vendido a X", aclara la '
        '**diferencia** y muéstrale las 3 métricas si están disponibles. '
        'Ejemplo: "A Carl Zeiss en 2026: cotizado $4.5K, facturado real '
        '$3.8K, cobrado real $2.1K (hay $1.7K facturado por cobrar)".\n'
        '   Cuando el user diga genéricamente "lo que he vendido", usa '
        'el COTIZADO. Cuando diga "lo facturado" → facturado_real. '
        'Cuando diga "lo cobrado" o "lo que realmente entró" → cobrado_real.\n'
        '7. **NO uses emojis decorativos** (sin "✨", "🎉", "💰", etc.). '
        'Si quieres énfasis usa **negritas**. Los símbolos como ↗ o ✓ están '
        'bien si suman información.\n'
        '8. **No te disculpes en exceso.** Corrige y sigue.\n\n'

        '## Cómo respondes\n'
        '- **Pregunta corta** (saludo, "qué tal"): respuesta corta, sin menús.\n'
        '- **Pregunta de un dato**: respuesta en 1-3 líneas con el número '
        'destacado en **negritas**.\n'
        '- **Pregunta tipo reporte** ("cómo va el mes", "ranking"): heading '
        '`### Título` + bullets o tabla con los KPIs clave + 1-2 líneas de '
        'lectura analítica al final ("destaca X", "ojo con Y"). Como un '
        'consultor entregando un brief.\n'
        '- **Lista de oportunidades**: bullets con cada opp como link '
        '`[Título — Cliente — $Monto](opp:ID)`. Agrupa por vendedor o etapa '
        'si tiene sentido.\n'
        '- **Evaluación de un vendedor**: usa `detalle_vendedor` y arma una '
        'mini-evaluación: pipeline, monto ganado del mes vs año, # clientes, '
        'lectura ("tiene buen ritmo", "está debajo del promedio del equipo").\n\n'

        '## Personalidad (sutil)\n'
        '- Saluda por nombre en el primer mensaje del día.\n'
        '- Mexicanismos suaves OK ("va", "órale", "andamos") con moderación.\n'
        '- Números buenos: una línea de reconocimiento breve. Números malos: '
        'sé honesto pero constructivo ("este mes fue retador; el pipeline '
        'sigue sólido para junio").\n'
        '- Si te preguntan algo fuera del CRM, redirige con cortesía.\n'
    )
    return {'role': 'system', 'content': base + _user_context_block(user)}


# ─── Endpoints ────────────────────────────────────────────────────────


@login_required
@require_http_methods(['GET'])
def api_asistente_config(request):
    """Devuelve la config visible (nombre + logo) y el rol del user para que
    el frontend pueda mostrar sugerencias contextuales."""
    from .models import UserProfile
    from .views_utils import is_supervisor as _is_sup, is_administrador as _is_admin
    cfg = AsistenteConfig.get_singleton()
    logo_url = cfg.logo.url if cfg.logo else ''

    # Rol del user
    rol = 'vendedor'
    try:
        prof = UserProfile.objects.filter(user=request.user).first()
        if prof and prof.rol:
            rol = str(prof.rol)
    except Exception:
        pass
    es_supervisor = bool(_is_sup(request.user) or _is_admin(request.user) or request.user.is_superuser)

    return JsonResponse({
        'ok': True,
        'nombre': cfg.nombre,
        'logo_url': logo_url,
        'activo': cfg.activo,
        'user': {
            'nombre': request.user.get_full_name() or request.user.username,
            'first_name': request.user.first_name or request.user.username,
            'rol': rol,
            'es_supervisor': es_supervisor,
        },
    })


@login_required
@require_http_methods(['GET'])
def api_asistente_conversacion(request):
    """Devuelve el historial COMPLETO de la conversación del user (para mostrar en UI)."""
    conv = _get_or_create_conv(request.user)
    # Filtramos: solo mostramos al user los mensajes user + assistant final.
    # Los tool/assistant-con-tool-call quedan ocultos (son ruido para el user).
    msgs = []
    for m in conv.mensajes.all():
        if m.role == 'user':
            msgs.append({
                'id': m.id,
                'role': 'user',
                'contenido': m.contenido,
                'fecha': m.fecha.isoformat(),
            })
        elif m.role == 'assistant' and not m.tool_name and m.contenido:
            msgs.append({
                'id': m.id,
                'role': 'assistant',
                'contenido': m.contenido,
                'fecha': m.fecha.isoformat(),
            })
    return JsonResponse({'ok': True, 'mensajes': msgs})


@login_required
@require_http_methods(['DELETE'])
def api_asistente_conversacion_eliminar(request):
    """Limpia el historial completo del user. Empieza la conversación de cero."""
    conv = _get_or_create_conv(request.user)
    conv.mensajes.all().delete()
    return JsonResponse({'ok': True})


@login_required
@require_http_methods(['GET'])
def api_asistente_reporte_xlsx(request):
    """Genera un reporte Excel a partir de un token de un solo uso creado
    por la tool `generar_reporte_excel`. El token vive 1 hora y guarda los
    filtros + el user_id que lo solicitó (para preservar permisos).
    """
    from django.core.cache import cache
    from django.http import HttpResponse
    token = (request.GET.get('token') or '').strip()
    if not token:
        return JsonResponse({'ok': False, 'error': 'Falta token.'}, status=400)
    payload = cache.get('asist_xlsx_' + token)
    if not payload:
        return JsonResponse({'ok': False, 'error': 'Token expirado o inválido.'}, status=410)
    if payload.get('user_id') != request.user.id:
        return JsonResponse({'ok': False, 'error': 'Token no pertenece a este usuario.'}, status=403)

    tipo = payload.get('tipo') or 'oportunidades'
    if tipo != 'oportunidades':
        return JsonResponse({'ok': False, 'error': f'Tipo de reporte no soportado: {tipo}'}, status=400)

    # Construir queryset con permisos del user solicitante.
    from .models import TodoItem
    from .views_utils import is_supervisor
    from .views_grupos import get_usuarios_visibles_ids
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    mes = payload.get('mes')
    anio = payload.get('anio')
    vendedor_username = payload.get('vendedor_username')

    qs = TodoItem.objects.select_related('cliente', 'usuario')
    if mes and anio:
        qs = qs.filter(fecha_creacion__year=anio, fecha_creacion__month=mes)
    if not (is_supervisor(request.user) or request.user.is_superuser):
        try:
            ids = list(get_usuarios_visibles_ids(request.user)) or [request.user.id]
            qs = qs.filter(usuario_id__in=ids)
        except Exception:
            qs = qs.filter(usuario=request.user)
    if vendedor_username:
        from django.contrib.auth.models import User as _User
        try:
            v = _User.objects.get(username=vendedor_username)
            qs = qs.filter(usuario=v)
        except _User.DoesNotExist:
            pass

    qs = qs.order_by('-monto')

    # Construir el workbook
    wb = Workbook()
    ws = wb.active
    ws.title = f'Oportunidades {mes or "X"}-{anio or "X"}'

    headers = ['ID', 'Oportunidad', 'Cliente', 'Vendedor', 'Monto MXN',
               'Probabilidad %', 'Etapa', 'Producto', 'Área',
               'Tipo negociación', 'Mes cierre', 'Año cierre',
               'Fecha creación', 'PO', 'Factura']
    header_fill = PatternFill('solid', fgColor='0066FF')
    header_font = Font(bold=True, color='FFFFFF', size=11)
    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center')

    for row_idx, opp in enumerate(qs, start=2):
        ws.cell(row=row_idx, column=1, value=opp.id)
        ws.cell(row=row_idx, column=2, value=opp.oportunidad)
        ws.cell(row=row_idx, column=3, value=opp.cliente.nombre_empresa if opp.cliente_id else '')
        ws.cell(row=row_idx, column=4, value=(opp.usuario.get_full_name() or opp.usuario.username) if opp.usuario_id else '')
        ws.cell(row=row_idx, column=5, value=float(opp.monto or 0))
        ws.cell(row=row_idx, column=6, value=opp.probabilidad_cierre or 0)
        ws.cell(row=row_idx, column=7, value=opp.etapa_corta or opp.etapa_completa or '')
        ws.cell(row=row_idx, column=8, value=opp.producto or '')
        ws.cell(row=row_idx, column=9, value=opp.area or '')
        ws.cell(row=row_idx, column=10, value=opp.tipo_negociacion or '')
        ws.cell(row=row_idx, column=11, value=opp.mes_cierre or '')
        ws.cell(row=row_idx, column=12, value=opp.anio_cierre or '')
        ws.cell(row=row_idx, column=13, value=opp.fecha_creacion.strftime('%Y-%m-%d') if opp.fecha_creacion else '')
        ws.cell(row=row_idx, column=14, value=opp.po_number or '')
        ws.cell(row=row_idx, column=15, value=opp.factura_numero or '')

    # Anchos automáticos rough
    widths = [8, 36, 28, 24, 14, 8, 18, 14, 14, 14, 8, 8, 12, 14, 14]
    for i, w in enumerate(widths, start=1):
        col_letter = ws.cell(row=1, column=i).column_letter
        ws.column_dimensions[col_letter].width = w

    # Formato moneda en col E (Monto)
    for row in range(2, ws.max_row + 1):
        ws.cell(row=row, column=5).number_format = '"$"#,##0.00'

    ws.freeze_panes = 'A2'

    # Servir como descarga
    import io
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f'oportunidades_{mes or "all"}-{anio or "all"}.xlsx'
    resp = HttpResponse(
        buf.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    resp['Content-Disposition'] = f'attachment; filename="{filename}"'
    # Token de un solo uso: invalidamos después de la descarga.
    cache.delete('asist_xlsx_' + token)
    return resp


@login_required
@require_http_methods(['POST'])
def api_asistente_mensaje(request):
    """Recibe mensaje del user, llama al LLM (con tool use loop), devuelve respuesta.

    Body: { "texto": "string" }
    """
    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    texto = (data.get('texto') or '').strip()
    if not texto:
        return JsonResponse({'ok': False, 'error': 'Mensaje vacío'}, status=400)
    if len(texto) > 4000:
        return JsonResponse({'ok': False, 'error': 'Mensaje demasiado largo (>4000 chars)'}, status=400)

    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'ok': False, 'error': 'El asistente está deshabilitado.'}, status=503)

    conv = _get_or_create_conv(request.user)

    # 1) Guardar mensaje del user
    user_msg = MensajeAsistente.objects.create(
        conversacion=conv, role='user', contenido=texto,
    )

    # 2) Loop de tool use
    tools = tools_for_user(request.user)
    sys_msg = _system_prompt(request.user, cfg)
    final_text = None

    try:
        for iteration in range(MAX_TOOL_ITERATIONS):
            # Reconstruir contexto en cada iteración (incluye los tool_results
            # recién agregados).
            context_msgs = _build_context(conv, cfg)
            messages = [sys_msg] + context_msgs

            resp = chat(
                messages=messages,
                tools=tools,
                model=cfg.modelo,
                temperature=0.3,
                max_tokens=1024,
            )

            # Si el modelo regresó texto sin pedir tools, terminamos.
            if not resp.get('tool_calls'):
                final_text = (resp.get('text') or '').strip() or '(sin respuesta)'
                MensajeAsistente.objects.create(
                    conversacion=conv, role='assistant', contenido=final_text,
                )
                break

            # El modelo pidió tools. Guardar mensaje assistant con tool_calls,
            # luego ejecutar cada tool y guardar sus resultados.
            for tc in resp['tool_calls']:
                MensajeAsistente.objects.create(
                    conversacion=conv,
                    role='assistant',
                    contenido=resp.get('text') or '',
                    tool_name=tc['name'],
                    tool_args_json=tc.get('arguments_str') or json.dumps(tc.get('arguments') or {}),
                    tool_call_id=tc['id'],
                )
                tool_result = execute_tool(tc['name'], tc.get('arguments') or {}, request.user)
                MensajeAsistente.objects.create(
                    conversacion=conv,
                    role='tool',
                    contenido=json.dumps(tool_result, ensure_ascii=False, default=str),
                    tool_name=tc['name'],
                    tool_call_id=tc['id'],
                )
            # Siguiente iteración: el modelo verá los resultados y responderá.
        else:
            # Salió del for sin break → llegó al tope sin texto final.
            final_text = (
                'Lo siento, no pude llegar a una respuesta después de varias '
                'consultas. Intenta reformular tu pregunta.'
            )
            MensajeAsistente.objects.create(
                conversacion=conv, role='assistant', contenido=final_text,
            )

    except AsistenteError as e:
        # Borrar el user_msg para que el user pueda reintentar sin duplicar.
        # No: lo dejamos en BD para que vea su intento. Solo devolvemos error.
        log.warning('Asistente error: %s', e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=502)
    except Exception as e:
        log.exception('Error inesperado en asistente: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error inesperado: {e}'}, status=500)

    return JsonResponse({
        'ok': True,
        'mensaje_user_id': user_msg.id,
        'respuesta': final_text or '(sin respuesta)',
    })
