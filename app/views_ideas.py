# ----------------------------------------------------------------------
# views_ideas.py — endpoints REST para el módulo Ideas.
# ----------------------------------------------------------------------
# Patrón espejo a views_prospeccion.py pero más simple — las Ideas no
# tienen cliente/contacto obligatorios, viven antes en el funnel.
#
# Visibilidad: cada usuario ve SUS ideas. Supervisores y administradores
# ven todas las del equipo (mismo criterio que prospectos/oportunidades).
# ----------------------------------------------------------------------

import json
import logging
from decimal import Decimal, InvalidOperation

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db.models import Max, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from .models import Idea, IdeaComentario, Prospecto, Cliente
from .views_utils import is_supervisor

log = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────

def _can_see_all(user):
    """¿El user ve TODAS las ideas o solo las suyas?"""
    return is_supervisor(user) or user.is_superuser


def _idea_visible_qs(user):
    if _can_see_all(user):
        return Idea.objects.all()
    return Idea.objects.filter(autor=user)


def _can_edit_idea(user, idea):
    return idea.autor_id == user.id or _can_see_all(user)


def _user_short(u):
    if not u:
        return None
    nombre = (u.first_name + ' ' + u.last_name).strip() or u.username
    iniciales = ''
    if u.first_name:
        iniciales += u.first_name[0].upper()
    if u.last_name:
        iniciales += u.last_name[0].upper()
    if not iniciales:
        iniciales = (u.username[:2] or '?').upper()
    return {'id': u.id, 'nombre': nombre, 'iniciales': iniciales, 'username': u.username}


def _idea_to_dict(idea, include_descripcion=True):
    d = {
        'id': idea.id,
        'titulo': idea.titulo,
        'tipo': idea.tipo,
        'tipo_display': idea.get_tipo_display(),
        'potencial_comercial': idea.potencial_comercial,
        'potencial_display': idea.get_potencial_comercial_display(),
        'valor_estimado': float(idea.valor_estimado) if idea.valor_estimado is not None else None,
        'mercado_objetivo': idea.mercado_objetivo,
        'etapa': idea.etapa,
        'etapa_display': idea.get_etapa_display(),
        'orden': idea.orden,
        'etiquetas': [t.strip() for t in (idea.etiquetas or '').split(',') if t.strip()],
        'autor': _user_short(idea.autor),
        'fecha_creacion': idea.fecha_creacion.isoformat() if idea.fecha_creacion else None,
        'fecha_actualizacion': idea.fecha_actualizacion.isoformat() if idea.fecha_actualizacion else None,
        'prospecto_creado_id': idea.prospecto_creado_id,
    }
    if include_descripcion:
        d['descripcion'] = idea.descripcion
        d['inspiracion'] = idea.inspiracion
    return d


# ─── API Lista (kanban) ───────────────────────────────────────────────

@login_required
@require_http_methods(['GET'])
def api_ideas_lista(request):
    """Lista todas las ideas visibles para el user actual.
    Retorna agrupadas por etapa para alimentar directo el kanban."""
    qs = _idea_visible_qs(request.user).select_related('autor').order_by('etapa', 'orden', '-fecha_creacion')

    # Filtro opcional por user_id (supervisor mirando el tablero de alguien).
    user_id = request.GET.get('user_id', '').strip()
    if user_id and _can_see_all(request.user):
        try:
            qs = qs.filter(autor_id=int(user_id))
        except (ValueError, TypeError):
            pass

    grouped = {k: [] for k, _ in Idea.ETAPA_CHOICES}
    for idea in qs:
        grouped.setdefault(idea.etapa, []).append(_idea_to_dict(idea, include_descripcion=False))

    etapas = [{'id': k, 'nombre': v, 'cantidad': len(grouped.get(k, []))} for k, v in Idea.ETAPA_CHOICES]
    return JsonResponse({
        'ok': True,
        'etapas': etapas,
        'ideas_por_etapa': grouped,
        'can_see_all': _can_see_all(request.user),
        'total': sum(len(v) for v in grouped.values()),
    })


# ─── API Crear ────────────────────────────────────────────────────────

@login_required
@require_http_methods(['POST'])
def api_idea_crear(request):
    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    titulo = (data.get('titulo') or '').strip()
    if not titulo:
        return JsonResponse({'ok': False, 'error': 'El título es requerido'}, status=400)

    tipo = (data.get('tipo') or 'producto').strip()
    if tipo not in dict(Idea.TIPO_CHOICES):
        tipo = 'producto'
    potencial = (data.get('potencial_comercial') or 'medio').strip()
    if potencial not in dict(Idea.POTENCIAL_CHOICES):
        potencial = 'medio'

    valor = None
    raw_valor = data.get('valor_estimado')
    if raw_valor not in (None, '', 'null'):
        try:
            valor = Decimal(str(raw_valor))
        except (InvalidOperation, ValueError, TypeError):
            return JsonResponse({'ok': False, 'error': 'Valor estimado inválido'}, status=400)

    # Orden = al final de la columna "capturada" (siempre nace ahí).
    max_orden = Idea.objects.filter(etapa='capturada').aggregate(m=Max('orden')).get('m') or 0
    idea = Idea.objects.create(
        autor=request.user,
        titulo=titulo[:200],
        descripcion=(data.get('descripcion') or '').strip(),
        tipo=tipo,
        potencial_comercial=potencial,
        valor_estimado=valor,
        mercado_objetivo=(data.get('mercado_objetivo') or '').strip()[:200],
        inspiracion=(data.get('inspiracion') or '').strip(),
        etiquetas=(data.get('etiquetas') or '').strip()[:300],
        etapa='capturada',
        orden=max_orden + 1,
    )
    return JsonResponse({'ok': True, 'idea': _idea_to_dict(idea)}, status=201)


# ─── API Detalle / actualizar / eliminar ──────────────────────────────

@login_required
@require_http_methods(['GET', 'PATCH', 'DELETE'])
def api_idea_detalle(request, idea_id):
    idea = get_object_or_404(Idea, pk=idea_id)
    if not _can_edit_idea(request.user, idea) and request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)
    # GET puede verlo el autor o supervisor — no permitimos cross-user reads.
    if request.method == 'GET' and not (_can_see_all(request.user) or idea.autor_id == request.user.id):
        return JsonResponse({'ok': False, 'error': 'No encontrada'}, status=404)

    if request.method == 'GET':
        d = _idea_to_dict(idea)
        d['comentarios'] = [
            {
                'id': c.id,
                'texto': c.texto,
                'fecha': c.fecha.isoformat() if c.fecha else None,
                'usuario': _user_short(c.usuario),
            }
            for c in idea.comentarios.select_related('usuario').all()
        ]
        return JsonResponse({'ok': True, 'idea': d})

    if request.method == 'DELETE':
        idea.delete()
        return JsonResponse({'ok': True})

    # PATCH — actualización parcial.
    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    campos_str = ['titulo', 'descripcion', 'mercado_objetivo', 'inspiracion', 'etiquetas']
    for f in campos_str:
        if f in data:
            setattr(idea, f, (data.get(f) or '').strip())

    if 'tipo' in data and data['tipo'] in dict(Idea.TIPO_CHOICES):
        idea.tipo = data['tipo']
    if 'potencial_comercial' in data and data['potencial_comercial'] in dict(Idea.POTENCIAL_CHOICES):
        idea.potencial_comercial = data['potencial_comercial']

    if 'valor_estimado' in data:
        raw = data.get('valor_estimado')
        if raw in (None, '', 'null'):
            idea.valor_estimado = None
        else:
            try:
                idea.valor_estimado = Decimal(str(raw))
            except (InvalidOperation, ValueError, TypeError):
                return JsonResponse({'ok': False, 'error': 'Valor estimado inválido'}, status=400)

    if 'etapa' in data and data['etapa'] in dict(Idea.ETAPA_CHOICES):
        idea.etapa = data['etapa']
    if 'orden' in data:
        try:
            idea.orden = int(data['orden'])
        except (ValueError, TypeError):
            pass

    idea.save()
    return JsonResponse({'ok': True, 'idea': _idea_to_dict(idea)})


# ─── API Mover etapa (drag & drop kanban) ─────────────────────────────

@login_required
@require_http_methods(['POST'])
def api_idea_mover_etapa(request, idea_id):
    idea = get_object_or_404(Idea, pk=idea_id)
    if not _can_edit_idea(request.user, idea):
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)

    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    nueva = (data.get('etapa') or '').strip()
    if nueva not in dict(Idea.ETAPA_CHOICES):
        return JsonResponse({'ok': False, 'error': 'Etapa inválida'}, status=400)

    idea.etapa = nueva
    # Posición: al final de la columna destino (orden + 1 sobre el max).
    max_orden = Idea.objects.filter(etapa=nueva).exclude(pk=idea.pk).aggregate(m=Max('orden')).get('m') or 0
    idea.orden = max_orden + 1
    idea.save(update_fields=['etapa', 'orden', 'fecha_actualizacion'])
    return JsonResponse({'ok': True, 'idea': _idea_to_dict(idea)})


# ─── API Comentarios ──────────────────────────────────────────────────

@login_required
@require_http_methods(['POST'])
def api_idea_comentar(request, idea_id):
    idea = get_object_or_404(Idea, pk=idea_id)
    if not (_can_see_all(request.user) or idea.autor_id == request.user.id):
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)
    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
    texto = (data.get('texto') or '').strip()
    if not texto:
        return JsonResponse({'ok': False, 'error': 'Texto requerido'}, status=400)
    c = IdeaComentario.objects.create(idea=idea, usuario=request.user, texto=texto)
    return JsonResponse({
        'ok': True,
        'comentario': {
            'id': c.id,
            'texto': c.texto,
            'fecha': c.fecha.isoformat(),
            'usuario': _user_short(c.usuario),
        },
    }, status=201)


# ─── API Convertir idea → prospección ─────────────────────────────────

@login_required
@require_http_methods(['POST'])
def api_idea_convertir(request, idea_id):
    """Crea un Prospecto a partir de la idea y la mueve a 'convertida'.
    Body: { cliente_id } (requerido — el prospecto necesita cliente).
    """
    idea = get_object_or_404(Idea, pk=idea_id)
    if not _can_edit_idea(request.user, idea):
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)
    if idea.prospecto_creado_id:
        return JsonResponse({'ok': False, 'error': 'La idea ya fue convertida', 'prospecto_id': idea.prospecto_creado_id}, status=400)

    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    cliente_id = data.get('cliente_id')
    if not cliente_id:
        return JsonResponse({'ok': False, 'error': 'cliente_id es requerido'}, status=400)
    try:
        cliente = Cliente.objects.get(pk=int(cliente_id))
    except (Cliente.DoesNotExist, ValueError, TypeError):
        return JsonResponse({'ok': False, 'error': 'Cliente no encontrado'}, status=404)

    # Crear Prospecto. Etapa inicial "identificado", producto/area default.
    prospecto = Prospecto.objects.create(
        usuario=request.user,
        nombre=idea.titulo[:200],
        cliente=cliente,
        producto=data.get('producto') or 'ZEBRA',
        area=data.get('area') or 'SISTEMAS',
        tipo_pipeline=data.get('tipo_pipeline') or 'runrate',
        comentarios=idea.descripcion or idea.inspiracion or '',
        etapa='identificado',
    )

    idea.prospecto_creado = prospecto
    idea.etapa = 'convertida'
    idea.save(update_fields=['prospecto_creado', 'etapa', 'fecha_actualizacion'])

    return JsonResponse({
        'ok': True,
        'idea': _idea_to_dict(idea),
        'prospecto_id': prospecto.id,
    })
