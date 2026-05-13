"""Vistas de Cursos (módulo Marketing).

CRUD JSON sobre Curso. Igual que Eventos/Certificaciones, no visible
para ingenieros. Al completarse un curso, ofrece "subir certificado"
que abre el composer de Certificacion pre-llenado.
"""
import json
from datetime import date

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_http_methods

from .models import Curso, Certificacion
from .views_utils import is_ingeniero


def _access_ok(user):
    return not is_ingeniero(user)


def _iniciales(u):
    if u.first_name and u.last_name:
        return (u.first_name[0] + u.last_name[0]).upper()
    if u.first_name:
        return u.first_name[0].upper()
    return (u.username[0].upper() if u.username else '?')


def _curso_to_dict(c):
    u = c.usuario
    return {
        'id': c.id,
        'nombre': c.nombre,
        'marca': c.marca,
        'plataforma': c.plataforma,
        'url': c.url,
        'nivel': c.nivel,
        'nivel_display': c.get_nivel_display() if c.nivel else '',
        'estado': c.estado,
        'estado_display': c.get_estado_display(),
        'progreso': c.progreso or 0,
        'fecha_inicio': c.fecha_inicio.isoformat() if c.fecha_inicio else None,
        'fecha_inicio_display': c.fecha_inicio.strftime('%d %b %Y') if c.fecha_inicio else '',
        'fecha_compromiso': c.fecha_compromiso.isoformat() if c.fecha_compromiso else None,
        'fecha_compromiso_display': c.fecha_compromiso.strftime('%d %b %Y') if c.fecha_compromiso else '',
        'fecha_completado': c.fecha_completado.isoformat() if c.fecha_completado else None,
        'fecha_completado_display': c.fecha_completado.strftime('%d %b %Y') if c.fecha_completado else '',
        'notas': c.notas,
        'usuario_id': u.id,
        'usuario_nombre': u.get_full_name() or u.username,
        'usuario_iniciales': _iniciales(u),
        'certificacion_resultante_id': c.certificacion_resultante_id,
        'fecha_creacion': c.fecha_creacion.strftime('%d %b %Y') if c.fecha_creacion else '',
    }


# ── Lista ─────────────────────────────────────────────────────────────
@login_required
@require_http_methods(['GET'])
def api_cursos_list(request):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    qs = Curso.objects.select_related('usuario')

    marca = (request.GET.get('marca') or '').strip().upper()
    nivel = (request.GET.get('nivel') or '').strip()
    estado = (request.GET.get('estado') or '').strip()
    usuario_id = request.GET.get('usuario_id')

    if marca:
        qs = qs.filter(marca__iexact=marca)
    if nivel:
        qs = qs.filter(nivel=nivel)
    if estado:
        qs = qs.filter(estado=estado)
    if usuario_id:
        try:
            qs = qs.filter(usuario_id=int(usuario_id))
        except (TypeError, ValueError):
            pass

    return JsonResponse({'cursos': [_curso_to_dict(c) for c in qs]})


# ── Detalle ───────────────────────────────────────────────────────────
@login_required
@require_http_methods(['GET'])
def api_curso_detalle(request, curso_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(Curso.objects.select_related('usuario', 'certificacion_resultante'),
                          id=curso_id)
    return JsonResponse({'curso': _curso_to_dict(c)})


# ── Crear ─────────────────────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_curso_crear(request):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    nombre = (data.get('nombre') or '').strip()
    marca = (data.get('marca') or '').strip().upper()

    if not nombre:
        return JsonResponse({'error': 'El nombre del curso es requerido'}, status=400)
    if not marca:
        return JsonResponse({'error': 'La marca es requerida'}, status=400)

    usuario_id = data.get('usuario_id')
    usuario = User.objects.filter(id=usuario_id).first() if usuario_id else None
    if not usuario:
        usuario = request.user

    progreso = data.get('progreso')
    try:
        progreso = max(0, min(100, int(progreso or 0)))
    except (TypeError, ValueError):
        progreso = 0

    nivel = (data.get('nivel') or '').strip()
    if nivel and nivel not in dict(Curso.NIVEL_CHOICES):
        nivel = ''

    estado = (data.get('estado') or 'en_progreso').strip()
    if estado not in dict(Curso.ESTADO_CHOICES):
        estado = 'en_progreso'
    # Si el progreso es 100 forzamos completado (regla simple del UI).
    if progreso >= 100 and estado != 'completado':
        estado = 'completado'

    fecha_inicio = parse_date((data.get('fecha_inicio') or '').strip()) if data.get('fecha_inicio') else None
    fecha_compromiso = parse_date((data.get('fecha_compromiso') or '').strip()) if data.get('fecha_compromiso') else None
    fecha_completado = parse_date((data.get('fecha_completado') or '').strip()) if data.get('fecha_completado') else None
    # Auto-rellena fecha_completado si está completado y no se mandó.
    if estado == 'completado' and not fecha_completado:
        fecha_completado = date.today()

    c = Curso.objects.create(
        usuario=usuario,
        marca=marca,
        nombre=nombre,
        plataforma=(data.get('plataforma') or '').strip(),
        url=(data.get('url') or '').strip(),
        nivel=nivel,
        estado=estado,
        progreso=progreso,
        fecha_inicio=fecha_inicio,
        fecha_compromiso=fecha_compromiso,
        fecha_completado=fecha_completado,
        notas=(data.get('notas') or '').strip(),
        creado_por=request.user,
    )
    return JsonResponse({'ok': True, 'curso': _curso_to_dict(c)})


# ── Editar ────────────────────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_curso_editar(request, curso_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(Curso, id=curso_id)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    if 'nombre' in data:
        v = (data['nombre'] or '').strip()
        if v: c.nombre = v
    if 'marca' in data:
        v = (data['marca'] or '').strip().upper()
        if v: c.marca = v
    if 'plataforma' in data:
        c.plataforma = (data['plataforma'] or '').strip()
    if 'url' in data:
        c.url = (data['url'] or '').strip()
    if 'nivel' in data:
        v = (data['nivel'] or '').strip()
        c.nivel = v if v in dict(Curso.NIVEL_CHOICES) else ''
    if 'progreso' in data:
        try:
            c.progreso = max(0, min(100, int(data['progreso'])))
        except (TypeError, ValueError):
            pass
    if 'estado' in data:
        v = (data['estado'] or '').strip()
        if v in dict(Curso.ESTADO_CHOICES):
            c.estado = v
    # Regla: progreso 100 fuerza completado.
    if c.progreso >= 100 and c.estado != 'completado':
        c.estado = 'completado'
    if 'fecha_inicio' in data:
        v = data['fecha_inicio']
        c.fecha_inicio = parse_date(v) if v else None
    if 'fecha_compromiso' in data:
        v = data['fecha_compromiso']
        c.fecha_compromiso = parse_date(v) if v else None
    if 'fecha_completado' in data:
        v = data['fecha_completado']
        c.fecha_completado = parse_date(v) if v else None
    # Si quedó completado y no tiene fecha_completado, ponerla hoy.
    if c.estado == 'completado' and not c.fecha_completado:
        c.fecha_completado = date.today()
    if 'notas' in data:
        c.notas = (data['notas'] or '').strip()
    if 'usuario_id' in data and data['usuario_id']:
        u = User.objects.filter(id=data['usuario_id']).first()
        if u: c.usuario = u
    c.save()
    return JsonResponse({'ok': True, 'curso': _curso_to_dict(c)})


# ── Eliminar ──────────────────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_curso_eliminar(request, curso_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(Curso, id=curso_id)
    c.delete()
    return JsonResponse({'ok': True})


# ── Stats para la tarjeta del dashboard ───────────────────────────────
@login_required
@require_http_methods(['GET'])
def api_cursos_stats(request):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    qs = Curso.objects.all()
    total = qs.count()
    en_progreso = qs.filter(estado='en_progreso').count()
    completados = qs.filter(estado='completado').count()
    personas = qs.values('usuario_id').distinct().count()
    # Cursos en progreso con compromiso ≤ 14 días o vencido.
    from datetime import timedelta
    hoy = date.today()
    proximos = qs.filter(
        estado='en_progreso',
        fecha_compromiso__isnull=False,
        fecha_compromiso__lte=hoy + timedelta(days=14),
    ).count()
    return JsonResponse({
        'total': total,
        'en_progreso': en_progreso,
        'completados': completados,
        'personas': personas,
        'proximos': proximos,
    })
