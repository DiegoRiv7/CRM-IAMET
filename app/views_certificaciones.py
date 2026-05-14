"""Vistas de Certificaciones (módulo Marketing).

CRUD JSON sobre Certificacion y subida/eliminación de
CertificacionArchivo. La lista de la vista se renderiza server-side
desde views_crm.crm_home (cuando tab=prospeccion + vista=certificaciones);
este módulo expone las APIs para el composer y el modal de detalle.

Permisos: igual que Eventos, no visible para ingenieros.
"""
import json
from datetime import date

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_http_methods

from .models import Certificacion, CertificacionArchivo
from .views_utils import is_ingeniero


def _access_ok(user):
    """Marketing no es visible para ingenieros."""
    return not is_ingeniero(user)


def _iniciales(u):
    if u.first_name and u.last_name:
        return (u.first_name[0] + u.last_name[0]).upper()
    if u.first_name:
        return u.first_name[0].upper()
    return (u.username[0].upper() if u.username else '?')


def _estado_vencimiento(c):
    """Devuelve uno de: 'sin_vencimiento' | 'vigente' | 'por_vencer' | 'vencida'.
    'por_vencer' = quedan ≤ 60 días."""
    if not c.fecha_vencimiento:
        return 'sin_vencimiento'
    hoy = date.today()
    if c.fecha_vencimiento < hoy:
        return 'vencida'
    if (c.fecha_vencimiento - hoy).days <= 60:
        return 'por_vencer'
    return 'vigente'


def _archivo_to_dict(a):
    nombre = a.nombre or (a.archivo.name.rsplit('/', 1)[-1] if a.archivo else '')
    ext = nombre.rsplit('.', 1)[-1].lower() if '.' in nombre else ''
    return {
        'id': a.id,
        'nombre': nombre,
        'url': a.archivo.url if a.archivo else '',
        'extension': ext,
        'es_imagen': ext in ('png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'),
        'es_pdf': ext == 'pdf',
        'subido_por_nombre': (a.subido_por.get_full_name() or a.subido_por.username) if a.subido_por_id else '',
        'fecha_subida': a.fecha_subida.strftime('%d/%m/%Y · %H:%M') if a.fecha_subida else '',
    }


def _certificacion_to_dict(c, include_archivos=False):
    u = c.usuario
    out = {
        'id': c.id,
        'nombre': c.nombre,
        'marca': c.marca,
        'nivel': c.nivel,
        'nivel_display': c.get_nivel_display() if c.nivel else '',
        'numero': c.numero,
        'fecha_obtencion': c.fecha_obtencion.isoformat() if c.fecha_obtencion else None,
        'fecha_obtencion_display': c.fecha_obtencion.strftime('%d %b %Y') if c.fecha_obtencion else '',
        'fecha_vencimiento': c.fecha_vencimiento.isoformat() if c.fecha_vencimiento else None,
        'fecha_vencimiento_display': c.fecha_vencimiento.strftime('%d %b %Y') if c.fecha_vencimiento else '',
        'estado_vencimiento': _estado_vencimiento(c),
        'notas': c.notas,
        'usuario_id': u.id,
        'usuario_nombre': u.get_full_name() or u.username,
        'usuario_iniciales': _iniciales(u),
        'archivos_count': c.archivos.count(),
        'fecha_creacion': c.fecha_creacion.strftime('%d %b %Y') if c.fecha_creacion else '',
    }
    if include_archivos:
        out['archivos'] = [_archivo_to_dict(a) for a in c.archivos.all()]
    return out


# ── Lista ─────────────────────────────────────────────────────────────
@login_required
@require_http_methods(['GET'])
def api_certificaciones_list(request):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    qs = Certificacion.objects.select_related('usuario').prefetch_related('archivos')

    marca = (request.GET.get('marca') or '').strip().upper()
    usuario_id = request.GET.get('usuario_id')
    estado = (request.GET.get('estado') or '').strip()

    if marca:
        qs = qs.filter(marca__iexact=marca)
    if usuario_id:
        try:
            qs = qs.filter(usuario_id=int(usuario_id))
        except (TypeError, ValueError):
            pass

    items = [_certificacion_to_dict(c) for c in qs]
    if estado in ('sin_vencimiento', 'vigente', 'por_vencer', 'vencida'):
        items = [c for c in items if c['estado_vencimiento'] == estado]

    return JsonResponse({'certificaciones': items})


# ── Detalle ───────────────────────────────────────────────────────────
@login_required
@require_http_methods(['GET'])
def api_certificacion_detalle(request, certificacion_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(
        Certificacion.objects.select_related('usuario').prefetch_related('archivos'),
        id=certificacion_id,
    )
    return JsonResponse({'certificacion': _certificacion_to_dict(c, include_archivos=True)})


# ── Crear ─────────────────────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_certificacion_crear(request):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    nombre = (data.get('nombre') or '').strip()
    marca = (data.get('marca') or '').strip().upper()
    fecha_obtencion = parse_date((data.get('fecha_obtencion') or '').strip()) if data.get('fecha_obtencion') else None

    if not nombre:
        return JsonResponse({'error': 'El nombre de la certificación es requerido'}, status=400)
    if not marca:
        return JsonResponse({'error': 'La marca es requerida'}, status=400)
    if not fecha_obtencion:
        return JsonResponse({'error': 'La fecha de obtención es requerida'}, status=400)

    # Quién es el certificado: por defecto el usuario actual. Supervisores
    # pueden registrar la certificación de alguien más pasando usuario_id.
    usuario_id = data.get('usuario_id')
    usuario = User.objects.filter(id=usuario_id).first() if usuario_id else None
    if not usuario:
        usuario = request.user

    fecha_venc = parse_date((data.get('fecha_vencimiento') or '').strip()) if data.get('fecha_vencimiento') else None
    nivel = (data.get('nivel') or '').strip()
    if nivel and nivel not in dict(Certificacion.NIVEL_CHOICES):
        nivel = ''

    c = Certificacion.objects.create(
        usuario=usuario,
        marca=marca,
        nombre=nombre,
        nivel=nivel,
        numero=(data.get('numero') or '').strip(),
        fecha_obtencion=fecha_obtencion,
        fecha_vencimiento=fecha_venc,
        notas=(data.get('notas') or '').strip(),
        creado_por=request.user,
    )
    # Si esta cert nace de un curso (CTA "Subir certificado"), vincúlalos.
    curso_origen_id = data.get('curso_origen_id')
    if curso_origen_id:
        try:
            from .models import Curso
            Curso.objects.filter(id=int(curso_origen_id)).update(certificacion_resultante=c)
        except (TypeError, ValueError):
            pass
    return JsonResponse({'ok': True, 'certificacion': _certificacion_to_dict(c, include_archivos=True)})


# ── Editar ────────────────────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_certificacion_editar(request, certificacion_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(Certificacion, id=certificacion_id)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    if 'nombre' in data:
        v = (data['nombre'] or '').strip()
        if v:
            c.nombre = v
    if 'marca' in data:
        v = (data['marca'] or '').strip().upper()
        if v:
            c.marca = v
    if 'nivel' in data:
        v = (data['nivel'] or '').strip()
        c.nivel = v if v in dict(Certificacion.NIVEL_CHOICES) else ''
    if 'numero' in data:
        c.numero = (data['numero'] or '').strip()
    if 'fecha_obtencion' in data and data['fecha_obtencion']:
        d = parse_date(data['fecha_obtencion'])
        if d:
            c.fecha_obtencion = d
    if 'fecha_vencimiento' in data:
        v = data['fecha_vencimiento']
        c.fecha_vencimiento = parse_date(v) if v else None
    if 'notas' in data:
        c.notas = (data['notas'] or '').strip()
    if 'usuario_id' in data and data['usuario_id']:
        u = User.objects.filter(id=data['usuario_id']).first()
        if u:
            c.usuario = u
    c.save()
    return JsonResponse({'ok': True, 'certificacion': _certificacion_to_dict(c, include_archivos=True)})


# ── Eliminar ──────────────────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_certificacion_eliminar(request, certificacion_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(Certificacion, id=certificacion_id)
    # FileField.delete = False para no borrar el archivo físico aquí; lo hace
    # el cascade de cada CertificacionArchivo. En la práctica los archivos
    # quedan huérfanos en el FS — aceptable, los limpiamos en mantenimiento.
    c.delete()
    return JsonResponse({'ok': True})


# ── Subir archivo ─────────────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_certificacion_archivo_subir(request, certificacion_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    c = get_object_or_404(Certificacion, id=certificacion_id)
    uploaded = request.FILES.get('archivo')
    if not uploaded:
        return JsonResponse({'error': 'Falta el archivo'}, status=400)

    nombre = (request.POST.get('nombre') or uploaded.name or '').strip()
    a = CertificacionArchivo.objects.create(
        certificacion=c,
        archivo=uploaded,
        nombre=nombre,
        subido_por=request.user,
    )
    return JsonResponse({'ok': True, 'archivo': _archivo_to_dict(a)})


# ── Eliminar archivo ──────────────────────────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_certificacion_archivo_eliminar(request, certificacion_id, archivo_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    a = get_object_or_404(CertificacionArchivo, id=archivo_id, certificacion_id=certificacion_id)
    # FileField sí queremos borrarlo aquí (el comprobante puede pesar varios MB).
    try:
        a.archivo.delete(save=False)
    except Exception:
        pass
    a.delete()
    return JsonResponse({'ok': True})


# ── Reordenar (drag & drop de la pared) ───────────────────────────────
@login_required
@require_http_methods(['POST'])
def api_certificaciones_reordenar(request):
    """Persiste el orden manual establecido al arrastrar marcos en la
    vista pared. Recibe {'ids': [1, 5, 3, ...]} y asigna a cada uno la
    posición correspondiente. Las certificaciones no incluidas en la
    lista mantienen su orden actual (no se tocan)."""
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    ids = data.get('ids') or []
    if not isinstance(ids, list):
        return JsonResponse({'error': 'Formato inválido (esperaba lista)'}, status=400)

    # Bulk update: una query por certificación. N suele ser pequeño (<200).
    for posicion, cid in enumerate(ids):
        try:
            cid_int = int(cid)
        except (TypeError, ValueError):
            continue
        Certificacion.objects.filter(id=cid_int).update(orden=posicion)
    return JsonResponse({'ok': True, 'count': len(ids)})


# ── Stats para la tarjeta del dashboard ───────────────────────────────
@login_required
@require_http_methods(['GET'])
def api_certificaciones_stats(request):
    """Resumen para la tarjeta de Marketing → Certificaciones:
    total, por marca, próximas a vencer (≤60 días) y vencidas."""
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    qs = Certificacion.objects.select_related('usuario').only(
        'id', 'marca', 'fecha_vencimiento', 'fecha_obtencion', 'usuario_id',
    )
    total = 0
    por_marca = {}
    por_vencer = 0
    vencidas = 0
    personas = set()
    hoy = date.today()
    for c in qs:
        total += 1
        personas.add(c.usuario_id)
        m = (c.marca or '').upper() or 'OTROS'
        por_marca[m] = por_marca.get(m, 0) + 1
        if c.fecha_vencimiento:
            if c.fecha_vencimiento < hoy:
                vencidas += 1
            elif (c.fecha_vencimiento - hoy).days <= 60:
                por_vencer += 1
    # Top marcas ordenadas
    marcas_top = sorted(por_marca.items(), key=lambda kv: kv[1], reverse=True)
    return JsonResponse({
        'total': total,
        'personas': len(personas),
        'por_vencer': por_vencer,
        'vencidas': vencidas,
        'marcas': [{'marca': k, 'count': v} for k, v in marcas_top],
    })
