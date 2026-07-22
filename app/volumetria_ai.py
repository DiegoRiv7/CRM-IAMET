# ----------------------------------------------------------------------
# volumetria_ai.py — Generación de borrador de volumetría con AI.
# (Fases 2-3 de PLAN_VOLUMETRIA_AI.md)
# ----------------------------------------------------------------------
# Flujo: el ingeniero termina Fases 1-2 del levantamiento (descripción,
# notas, fotos con comentario) y pide un borrador. Este módulo arma el
# contexto multimodal (texto + fotos), llama al LLM con tools
# (buscar_catalogo / proponer_volumetria) y escribe el borrador en
# ProyectoVolumetria.data con shape v4 {meta, version, secciones[]}.
#
# Líneas rojas (del plan):
# - Los precios autoritativos salen del catálogo. Lo que el modelo
#   proponga sin respaldo de catálogo queda marcado en `notas` como
#   "PRECIO ESTIMADO AI — VERIFICAR".
# - Nunca se escribe sobre una volumetría `completada`.
# - El borrador SIEMPRE lo revisa un humano (no auto-cotiza).
# ----------------------------------------------------------------------

import base64
import io
import json
import logging
import os
import uuid

from django.db.models import Q

from .asistente_provider import chat, AsistenteError

log = logging.getLogger(__name__)

# Modelo para generación: env dedicado > env general > default del provider.
# La generación necesita visión; gpt-4o-mini la tiene (dev). El switch a
# Sonnet/Opus es cambiar VOLUMETRIA_AI_MODEL en el servidor (último paso
# del plan).
def _modelo_generacion():
    return os.environ.get('VOLUMETRIA_AI_MODEL') or None  # None → default provider

MAX_TOOL_ROUNDS = 6
MAX_FOTOS = 12          # tope de imágenes enviadas al modelo
MAX_LADO_PX = 1024      # se reescala el lado mayor a esto (costo/latencia)

FEWSHOT_PATH = os.path.join(os.path.dirname(__file__), 'volumetria_ai_fewshot.json')

# Costos adicionales estándar observados en volumetrías reales (USD).
# El modelo puede ajustar días/cantidades, pero éstos son los conceptos base.
COSTOS_ADICIONALES_BASE = [
    {'descripcion': 'Supervisor', 'costoUnitario': 120.0},
    {'descripcion': 'Tecnico', 'costoUnitario': 40.0},
    {'descripcion': 'combustible', 'costoUnitario': 25.0},
    {'descripcion': 'casetas', 'costoUnitario': 12.0},
    {'descripcion': 'comidas', 'costoUnitario': 16.0},
]


# ──────────────────────────────────────────────────────────────
#  Tool 1: búsqueda en catálogo (misma lógica que api_catalogo_productos)
# ──────────────────────────────────────────────────────────────

def buscar_catalogo(q, limit=10):
    """Busca en CatalogoCableado + Producto. Devuelve lista de dicts
    con marca/parte/descripcion/precio. Fuente de verdad de precios."""
    from .models import CatalogoCableado, Producto
    q = (q or '').strip()
    limit = min(int(limit or 10), 25)
    results = []
    if not q:
        return results
    for p in CatalogoCableado.objects.filter(
        Q(descripcion__icontains=q) | Q(numero_parte__icontains=q) | Q(marca__icontains=q)
    ).filter(activo=True)[:limit]:
        results.append({
            'marca': p.marca or '', 'parte': p.numero_parte or '',
            'descripcion': p.descripcion or '',
            'precio_lista': float(p.precio_unitario or 0),
            'costo': float(p.precio_proveedor or 0),
            'fuente': 'CatalogoCableado',
        })
    restante = limit - len(results)
    if restante > 0:
        for p in Producto.objects.filter(estatus='activo').filter(
            Q(codigo__icontains=q) | Q(nombre__icontains=q) | Q(descripcion__icontains=q)
        )[:restante]:
            results.append({
                'marca': '', 'parte': p.codigo or '',
                'descripcion': p.nombre or p.descripcion or '',
                'precio_lista': float(p.costo or 0), 'costo': float(p.costo or 0),
                'fuente': 'Producto',
            })
    return results


def _precio_catalogo(marca, parte):
    """Match exacto por número de parte en catálogo. None si no está."""
    from .models import CatalogoCableado, Producto
    parte = (parte or '').strip()
    if not parte:
        return None
    p = CatalogoCableado.objects.filter(numero_parte__iexact=parte, activo=True).first()
    if p and p.precio_unitario:
        return {'precio_lista': float(p.precio_unitario), 'costo': float(p.precio_proveedor or 0)}
    pr = Producto.objects.filter(codigo__iexact=parte, estatus='activo').first()
    if pr and pr.costo:
        return {'precio_lista': float(pr.costo), 'costo': float(pr.costo)}
    return None


# ──────────────────────────────────────────────────────────────
#  Contexto multimodal del levantamiento
# ──────────────────────────────────────────────────────────────

def _contexto_texto(lev):
    f1 = lev.fase1_data or {}
    f2 = lev.fase2_data or {}
    partes = [
        f"LEVANTAMIENTO: {lev}",
        f"Cliente: {f1.get('cliente') or ''} | Área: {f1.get('area') or ''}",
        f"Servicios: {', '.join(f1.get('servicios') or [])}",
        f"Componentes: {', '.join(f1.get('componentes') or [])}",
        "",
        "DESCRIPCIÓN DE LA NECESIDAD (Fase 1):",
        (f1.get('descripcion') or '(sin descripción)').strip(),
        "",
        "NOTAS DE MATERIALES (Fase 1):",
        (f1.get('notas_materiales') or '(sin notas)').strip(),
        "",
        "ESPECIFICACIONES (Fase 2):",
        '\n'.join(f'- {e}' for e in (f2.get('especificaciones') or [])) or '(sin especificaciones)',
        "",
        "NOTAS DEL SITIO (Fase 2):",
        (f2.get('notas_evidencia') or '(sin notas del sitio)').strip(),
    ]
    programa = (f2.get('programa') or {})
    if any(programa.values()):
        partes += ["", "PROGRAMA DE IMPLEMENTACIÓN:",
                   json.dumps({k: v for k, v in programa.items() if v}, ensure_ascii=False)]
    return '\n'.join(partes)


def _foto_a_data_url(evidencia, max_px=MAX_LADO_PX):
    """Abre la foto, corrige orientación EXIF, reescala y devuelve data URL
    JPEG base64. None si no se puede leer."""
    try:
        from PIL import Image, ImageOps
        with evidencia.archivo.open('rb') as fh:
            img = Image.open(fh)
            img = ImageOps.exif_transpose(img)
            img = img.convert('RGB')
            img.thumbnail((max_px, max_px))
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=80)
        b64 = base64.b64encode(buf.getvalue()).decode('ascii')
        return f'data:image/jpeg;base64,{b64}'
    except Exception as e:
        log.warning('volumetria_ai: no se pudo procesar foto %s: %s', evidencia.id, e)
        return None


def _contenido_fotos(lev, max_fotos=MAX_FOTOS):
    """Lista de content-parts multimodales (texto del comentario + imagen)
    en formato OpenAI, para anexar al mensaje user."""
    from .models import LevantamientoEvidencia
    parts = []
    evidencias = LevantamientoEvidencia.objects.filter(levantamiento=lev).order_by('id')[:max_fotos]
    for i, ev in enumerate(evidencias, 1):
        url = _foto_a_data_url(ev)
        if not url:
            continue
        comentario = ev.comentario or '(sin comentario)'
        parts.append({'type': 'text', 'text': f'FOTO {i}: {comentario}'})
        parts.append({'type': 'image_url', 'image_url': {'url': url}})
    return parts


# ──────────────────────────────────────────────────────────────
#  Prompt + few-shot
# ──────────────────────────────────────────────────────────────

def _fewshot_block():
    try:
        with open(FEWSHOT_PATH, encoding='utf-8') as fh:
            ejemplos = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        log.warning('volumetria_ai: sin few-shot (%s)', e)
        return ''
    bloques = []
    for nombre, ej in ejemplos.items():
        bloques.append(
            f"### Ejemplo real «{nombre}»\n"
            f"ENTRADA (levantamiento):\n{json.dumps(ej['entrada'], ensure_ascii=False)}\n"
            f"SALIDA (volumetría que hizo el ingeniero):\n"
            f"{json.dumps(ej['salida_secciones'], ensure_ascii=False)}"
        )
    return '\n\n'.join(bloques)


def _system_prompt():
    return f"""Eres un ingeniero de preventa experto de IAMET/BAJANET (integrador de
cableado estructurado, CCTV, control de acceso y redes en Tijuana, MX). Tu tarea:
a partir de un levantamiento (descripción, notas del sitio y fotos comentadas),
generar el BORRADOR de la volumetría — la lista de materiales, mano de obra y
costos adicionales para cotizar el trabajo. Un ingeniero humano SIEMPRE revisará
tu borrador; sé útil pero conservador.

REGLAS DURAS:
1. Usa la tool `buscar_catalogo` para intentar respaldar cada material con un
   número de parte y precio del catálogo. Si un material no aparece en catálogo,
   proponlo igual con tu mejor estimación de precio en USD, pero será marcado
   automáticamente para verificación humana.
2. Todos los precios en USD (las volumetrías se manejan en dólares).
3. Estructura SIEMPRE en 3 secciones: equipamiento, mano_obra, costo_mo.
4. En equipamiento usa filas header para agrupar por zona/categoría cuando el
   trabajo tenga áreas distintas (como en los ejemplos).
5. Mano de obra: marca "BAJANET", parte "SERVICIOS PROFESIONALES", una partida
   por concepto de instalación. Considera jornadas especiales (fin de semana,
   nocturno) si el levantamiento las menciona.
6. Costos adicionales estándar (USD/día): Supervisor 120, Tecnico 40,
   combustible 25, casetas 12, comidas 16. Ajusta días/cantidades al tamaño
   del trabajo.
7. Incluye siempre consumibles obvios del tipo de trabajo (tubería y conectores
   si hay tubería; varilla roscada/mordazas si hay charola; MISCELANEOS marca
   BAJANET como partida de imprevistos chica).
8. NO inventes cantidades sin fundamento: básate en distancias, nodos y zonas
   mencionadas en la descripción, notas y fotos. Si un dato crítico no está
   (ej. metros de cable), estima con criterio y dilo en `notas` del item.
9. Cuando tengas todo, llama a la tool `proponer_volumetria` UNA sola vez con
   la propuesta completa. No respondas con texto plano.

EJEMPLOS REALES (aprende el estilo, granularidad y precios típicos):

{_fewshot_block()}"""


TOOLS_GENERACION = [
    {
        'type': 'function',
        'function': {
            'name': 'buscar_catalogo',
            'description': 'Busca productos en el catálogo de IAMET (fuente de verdad de precios). Busca por descripción, marca o número de parte.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'q': {'type': 'string', 'description': 'Texto a buscar, ej. "cable cat6a" o "PUR6A"'},
                    'limit': {'type': 'integer', 'description': 'Máx resultados (default 10)'},
                },
                'required': ['q'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'proponer_volumetria',
            'description': 'Entrega la propuesta final de volumetría. Llamar UNA sola vez, con las 3 secciones completas.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'resumen': {'type': 'string', 'description': 'Resumen de 2-4 líneas de qué contempla el borrador y qué supuestos se hicieron.'},
                    'secciones': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'properties': {
                                'tipo': {'type': 'string', 'enum': ['equipamiento', 'mano_obra', 'costo_mo']},
                                'titulo': {'type': 'string'},
                                'items': {
                                    'type': 'array',
                                    'items': {
                                        'type': 'object',
                                        'properties': {
                                            'row_type': {'type': 'string', 'enum': ['item', 'header']},
                                            'texto': {'type': 'string', 'description': 'Solo para header: título del grupo/zona'},
                                            'marca': {'type': 'string'},
                                            'parte': {'type': 'string', 'description': 'Número de parte o SKU'},
                                            'descripcion': {'type': 'string'},
                                            'cantidad': {'type': 'number'},
                                            'precioLista': {'type': 'number', 'description': 'USD'},
                                            'costoUnitario': {'type': 'number', 'description': 'USD (costo interno / costo_mo)'},
                                            'dias': {'type': 'number', 'description': 'Solo costo_mo'},
                                            'notas': {'type': 'string'},
                                        },
                                    },
                                },
                            },
                            'required': ['tipo', 'titulo', 'items'],
                        },
                    },
                },
                'required': ['resumen', 'secciones'],
            },
        },
    },
]


# ──────────────────────────────────────────────────────────────
#  Validación / normalización del borrador (shape v4)
# ──────────────────────────────────────────────────────────────

NOTA_VERIFICAR = 'PRECIO ESTIMADO AI — VERIFICAR'

def normalizar_secciones(propuesta_secciones):
    """Convierte la propuesta del LLM al shape v4 exacto que espera el
    frontend. Respalda precios contra catálogo; lo no respaldado se marca
    NOTA_VERIFICAR. Devuelve (secciones_v4, stats)."""
    orden = {'equipamiento': 0, 'mano_obra': 1, 'costo_mo': 2}
    stats = {'items': 0, 'headers': 0, 'con_catalogo': 0, 'a_verificar': 0}
    por_tipo = {}
    for s in propuesta_secciones or []:
        tipo = s.get('tipo')
        if tipo not in orden:
            continue
        items_v4 = []
        for it in s.get('items') or []:
            if it.get('row_type') == 'header' or (it.get('texto') and not it.get('descripcion')):
                items_v4.append({'id': str(uuid.uuid4()), 'texto': it.get('texto') or '', 'row_type': 'header'})
                stats['headers'] += 1
                continue
            stats['items'] += 1
            if tipo == 'costo_mo':
                items_v4.append({
                    'id': str(uuid.uuid4()),
                    'dias': float(it.get('dias') or 1),
                    'cantidad': float(it.get('cantidad') or 0),
                    'descripcion': it.get('descripcion') or '',
                    'costoUnitario': float(it.get('costoUnitario') or 0),
                })
                continue
            marca = (it.get('marca') or '').strip()
            parte = (it.get('parte') or '').strip()
            notas = (it.get('notas') or '').strip()
            precio = float(it.get('precioLista') or 0)
            costo = float(it.get('costoUnitario') or 0)
            cat = _precio_catalogo(marca, parte) if tipo == 'equipamiento' else None
            if cat:
                precio = cat['precio_lista']
                costo = cat['costo'] or costo
                stats['con_catalogo'] += 1
            elif tipo == 'equipamiento':
                stats['a_verificar'] += 1
                notas = f'{NOTA_VERIFICAR}. {notas}'.strip().rstrip('.')
            item = {
                'id': str(uuid.uuid4()), 'row_type': 'item',
                'marca': marca, 'parte': parte,
                'descripcion': it.get('descripcion') or '',
                'cantidad': float(it.get('cantidad') or 0),
                'precioLista': precio,
                'descuentoVenta': 0.0,
                'notas': notas,
            }
            if tipo == 'equipamiento':
                item.update({'costoUnitario': costo, 'descuentoCosto': 0.0,
                             'proveedor': '', 'entrega': ''})
            items_v4.append(item)
        clave = tipo
        if clave in por_tipo:  # merge si el modelo repitió tipo
            por_tipo[clave]['items'].extend(items_v4)
        else:
            por_tipo[clave] = {
                'id': str(uuid.uuid4()), 'tipo': tipo,
                'titulo': s.get('titulo') or tipo.replace('_', ' ').title(),
                'expanded': True, 'items': items_v4,
            }
    # Asegurar las 3 secciones y orden estándar
    defaults = {'equipamiento': 'Equipamiento', 'mano_obra': 'Mano de Obra', 'costo_mo': 'Costos Adicionales'}
    for tipo, titulo in defaults.items():
        if tipo not in por_tipo:
            por_tipo[tipo] = {'id': str(uuid.uuid4()), 'tipo': tipo, 'titulo': titulo,
                              'expanded': True, 'items': []}
    secciones = sorted(por_tipo.values(), key=lambda s: orden[s['tipo']])
    return secciones, stats


def escribir_borrador(vol, secciones_v4, user):
    """Escribe el borrador en ProyectoVolumetria.data (shape v4).
    Nunca sobre una volumetría completada."""
    if vol.status == 'completada':
        raise ValueError('No se puede escribir sobre una volumetría completada.')
    lev = vol.levantamiento
    f1 = (lev.fase1_data or {}) if lev else {}
    vol.data = {
        'meta': {
            'fecha': '', 'cliente': f1.get('cliente') or '',
            'elaboro': (user.get_full_name() or user.username) + ' + AI',
            'contacto': f1.get('contacto') or '',
        },
        'version': 4,
        'secciones': secciones_v4,
    }
    vol.actualizado_por = user
    vol.save(update_fields=['data', 'fecha_actualizacion', 'actualizado_por'])


# ──────────────────────────────────────────────────────────────
#  Generación (loop LLM + tools)
# ──────────────────────────────────────────────────────────────

def generar_borrador_volumetria(volumetria_id, user, dry_run=False, model=None):
    """Punto de entrada. Genera el borrador para la volumetría dada a partir
    de su levantamiento (Fases 1-2 + fotos). Devuelve dict con resumen y stats.

    dry_run=True: no escribe en BD, solo devuelve la propuesta normalizada.
    """
    from .models import ProyectoVolumetria
    vol = ProyectoVolumetria.objects.select_related('levantamiento').get(id=volumetria_id)
    lev = vol.levantamiento
    if not lev:
        raise ValueError('La volumetría no tiene levantamiento asociado.')
    if vol.status == 'completada':
        raise ValueError('La volumetría está completada; bájala a borrador para regenerar.')

    contenido_user = [{'type': 'text', 'text': _contexto_texto(lev)}]
    contenido_user += _contenido_fotos(lev)
    contenido_user.append({'type': 'text', 'text':
        'Genera el borrador de volumetría para este levantamiento. Consulta el '
        'catálogo para respaldar precios y al final llama a proponer_volumetria.'})

    messages = [
        {'role': 'system', 'content': _system_prompt()},
        {'role': 'user', 'content': contenido_user},
    ]
    propuesta = None
    for _ in range(MAX_TOOL_ROUNDS):
        resp = chat(messages=messages, tools=TOOLS_GENERACION,
                    model=model or _modelo_generacion(),
                    temperature=0.2, max_tokens=8000)
        tcs = resp.get('tool_calls') or []
        if not tcs:
            # el modelo respondió texto — pedirle que use la tool
            messages.append({'role': 'assistant', 'content': resp.get('text') or ''})
            messages.append({'role': 'user', 'content':
                'Recuerda: entrega la propuesta llamando a la tool proponer_volumetria.'})
            continue
        messages.append({
            'role': 'assistant', 'content': resp.get('text') or None,
            'tool_calls': [{'id': tc['id'], 'type': 'function',
                            'function': {'name': tc['name'], 'arguments': tc['arguments_str']}}
                           for tc in tcs],
        })
        for tc in tcs:
            if tc['name'] == 'proponer_volumetria':
                propuesta = tc['arguments']
                messages.append({'role': 'tool', 'tool_call_id': tc['id'],
                                 'content': json.dumps({'ok': True})})
            elif tc['name'] == 'buscar_catalogo':
                res = buscar_catalogo(tc['arguments'].get('q'), tc['arguments'].get('limit') or 10)
                messages.append({'role': 'tool', 'tool_call_id': tc['id'],
                                 'content': json.dumps(res, ensure_ascii=False)})
            else:
                messages.append({'role': 'tool', 'tool_call_id': tc['id'],
                                 'content': json.dumps({'error': 'tool desconocida'})})
        if propuesta:
            break
    if not propuesta:
        raise AsistenteError('El modelo no entregó una propuesta de volumetría.')

    secciones_v4, stats = normalizar_secciones(propuesta.get('secciones'))
    if not dry_run:
        escribir_borrador(vol, secciones_v4, user)
    return {
        'ok': True, 'dry_run': dry_run,
        'volumetria_id': vol.id, 'levantamiento_id': lev.id,
        'resumen': propuesta.get('resumen') or '',
        'stats': stats,
        'secciones': secciones_v4 if dry_run else None,
        'model_used': None,
    }
