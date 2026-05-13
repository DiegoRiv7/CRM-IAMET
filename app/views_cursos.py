"""Vistas de Cursos (módulo Marketing).

CRUD JSON sobre Curso. Igual que Eventos/Certificaciones, no visible
para ingenieros. Al completarse un curso, ofrece "subir certificado"
que abre el composer de Certificacion pre-llenado.
"""
import json
from datetime import date, datetime, timedelta

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.views.decorators.http import require_http_methods

from .models import Curso, Certificacion, CursoComentario, CursoArchivo, Actividad
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


# ── Comentarios ───────────────────────────────────────────────────────
def _iniciales_u(u):
    if not u: return '?'
    return _iniciales(u)


def _archivo_comentario_to_dict(a):
    nombre = a.nombre or (a.archivo.name.rsplit('/', 1)[-1] if a.archivo else '')
    ext = nombre.rsplit('.', 1)[-1].lower() if '.' in nombre else ''
    return {
        'id': a.id,
        'nombre': nombre,
        'url': a.archivo.url if a.archivo else '',
        'extension': ext,
        'es_imagen': ext in ('png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'),
        'es_pdf': ext == 'pdf',
    }


def _comentario_to_dict(c):
    return {
        'id': c.id,
        'autor_id': c.autor_id,
        'autor_nombre': (c.autor.get_full_name() or c.autor.username) if c.autor else 'Usuario',
        'autor_iniciales': _iniciales_u(c.autor),
        'texto': c.texto,
        'fecha': c.fecha_creacion.strftime('%d %b %Y · %H:%M') if c.fecha_creacion else '',
        'archivos': [_archivo_comentario_to_dict(a) for a in c.archivos.all()],
    }


@login_required
@require_http_methods(['GET'])
def api_curso_comentarios_list(request, curso_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    qs = (
        CursoComentario.objects
        .filter(curso_id=curso_id)
        .select_related('autor')
        .prefetch_related('archivos')
        .order_by('fecha_creacion')
    )
    return JsonResponse({'comentarios': [_comentario_to_dict(c) for c in qs]})


@login_required
@require_http_methods(['POST'])
def api_curso_comentario_crear(request, curso_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(Curso, id=curso_id)
    # Soporta multipart (con archivos) o JSON (solo texto).
    if request.content_type and request.content_type.startswith('multipart/'):
        texto = (request.POST.get('texto') or '').strip()
        archivos = request.FILES.getlist('archivos')
    else:
        try:
            data = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        texto = (data.get('texto') or '').strip()
        archivos = []
    if not texto and not archivos:
        return JsonResponse({'error': 'El comentario está vacío'}, status=400)
    com = CursoComentario.objects.create(curso=c, autor=request.user, texto=texto)
    for f in archivos:
        CursoArchivo.objects.create(comentario=com, archivo=f, nombre=f.name)
    com = CursoComentario.objects.select_related('autor').prefetch_related('archivos').get(id=com.id)
    return JsonResponse({'ok': True, 'comentario': _comentario_to_dict(com)})


@login_required
@require_http_methods(['POST'])
def api_curso_comentario_eliminar(request, comentario_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    com = get_object_or_404(CursoComentario, id=comentario_id)
    # Solo el autor (o supervisor) puede eliminar
    from .views_utils import is_supervisor
    if com.autor_id != request.user.id and not is_supervisor(request.user):
        return HttpResponseForbidden()
    # Borra los archivos físicos
    for a in com.archivos.all():
        try: a.archivo.delete(save=False)
        except Exception: pass
    com.delete()
    return JsonResponse({'ok': True})


# ── Agendar al calendario ─────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_curso_agendar(request, curso_id):
    """Crea una Actividad en el calendario vinculada al curso.
    Payload: {fecha: 'YYYY-MM-DD', hora_inicio: 'HH:MM', duracion_minutos: int}
    """
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(Curso, id=curso_id)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    fecha_s = (data.get('fecha') or '').strip()
    hora_s = (data.get('hora_inicio') or '').strip()
    try:
        duracion = int(data.get('duracion_minutos') or 60)
    except (TypeError, ValueError):
        duracion = 60
    duracion = max(15, min(8 * 60, duracion))  # entre 15min y 8h

    if not fecha_s or not hora_s:
        return JsonResponse({'error': 'Fecha y hora son requeridas'}, status=400)
    try:
        fecha_inicio = datetime.fromisoformat(f'{fecha_s}T{hora_s}')
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Formato de fecha/hora inválido'}, status=400)
    if timezone.is_naive(fecha_inicio):
        fecha_inicio = timezone.make_aware(fecha_inicio)
    fecha_fin = fecha_inicio + timedelta(minutes=duracion)

    titulo = f'📚 {c.nombre}'
    descripcion = f'Sesión de estudio del curso "{c.nombre}"'
    if c.plataforma:
        descripcion += f' · {c.plataforma}'
    if c.url:
        descripcion += f'\n{c.url}'

    act = Actividad.objects.create(
        titulo=titulo[:200],
        tipo_actividad='tarea',
        descripcion=descripcion,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        creado_por=c.usuario,  # aparece en el calendario del que toma el curso
        color='#0369A1',
        curso=c,
    )
    # Si quien agenda no es la persona del curso (supervisor), también
    # lo agregamos como participante para que ambos lo vean.
    if request.user.id != c.usuario_id:
        act.participantes.add(request.user)
    return JsonResponse({
        'ok': True,
        'actividad_id': act.id,
        'fecha_inicio': act.fecha_inicio.isoformat(),
    })


# Cuenta de actividades agendadas para mostrar en el detalle.
@login_required
@require_http_methods(['GET'])
def api_curso_sesiones(request, curso_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    qs = Actividad.objects.filter(curso_id=curso_id).order_by('fecha_inicio')
    items = [
        {
            'id': a.id,
            'titulo': a.titulo,
            'fecha_inicio': a.fecha_inicio.isoformat() if a.fecha_inicio else None,
            'fecha_inicio_display': a.fecha_inicio.strftime('%a %d %b · %H:%M') if a.fecha_inicio else '',
            'completada': a.completada,
        }
        for a in qs
    ]
    return JsonResponse({'sesiones': items, 'total': len(items)})
