import sys

with open('app/views_mail.py', 'r') as f:
    text = f.read()

# 1. Update api_mail_conexion GET
old_get = '''    if request.method == 'GET':
        try:
            c = MailConexion.objects.get(usuario=request.user)
            return JsonResponse({
                'ok': True,
                'correo_electronico': c.correo_electronico,
                'imap_servidor': c.imap_servidor,
                'imap_puerto': c.imap_puerto,
                'imap_usar_ssl': c.imap_usar_ssl,
                'smtp_servidor': c.smtp_servidor,
                'smtp_puerto': c.smtp_puerto,
                'smtp_usar_ssl': c.smtp_usar_ssl,
                'activo': c.activo,
                'ultima_sincronizacion': c.ultima_sincronizacion.isoformat() if c.ultima_sincronizacion else None,
            })
        except MailConexion.DoesNotExist:
            return JsonResponse({'ok': False, 'tiene_conexion': False})'''

new_get = '''    if request.method == 'GET':
        conexiones = MailConexion.objects.filter(usuario=request.user)
        if not conexiones.exists():
            return JsonResponse({'ok': False, 'tiene_conexion': False})
        
        lista = []
        for c in conexiones:
            lista.append({
                'id': c.id,
                'correo_electronico': c.correo_electronico,
                'imap_servidor': c.imap_servidor,
                'imap_puerto': c.imap_puerto,
                'imap_usar_ssl': c.imap_usar_ssl,
                'smtp_servidor': c.smtp_servidor,
                'smtp_puerto': c.smtp_puerto,
                'smtp_usar_ssl': c.smtp_usar_ssl,
                'activo': c.activo,
                'ultima_sincronizacion': c.ultima_sincronizacion.isoformat() if c.ultima_sincronizacion else None,
            })
        return JsonResponse({'ok': True, 'tiene_conexion': True, 'conexiones': lista})'''

text = text.replace(old_get, new_get)

# 2. Update api_mail_conexion POST
old_post_save = '''    # Save with encrypted password
    conexion, _ = MailConexion.objects.get_or_create(usuario=request.user)
    conexion.correo_electronico = correo'''

new_post_save = '''    # Save with encrypted password
    conexion, _ = MailConexion.objects.get_or_create(usuario=request.user, correo_electronico=correo)
    conexion.correo_electronico = correo'''

text = text.replace(old_post_save, new_post_save)

# 3. Update api_mail_sincronizar
old_sync_get = '''def api_mail_sincronizar(request):
    try:
        conexion = MailConexion.objects.get(usuario=request.user, activo=True)
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'No hay conexión de correo configurada'}, status=400)'''

new_sync_get = '''def api_mail_sincronizar(request):
    conexion_id = request.GET.get('conexion_id')
    if not conexion_id:
        try:
            import json
            data = json.loads(request.body)
            conexion_id = data.get('conexion_id')
        except:
            pass
    try:
        if conexion_id:
            conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user, activo=True)
        else:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Conexión no encontrada'}, status=400)'''

text = text.replace(old_sync_get, new_sync_get)

old_sync_create_inbox = '''                MailCorreo.objects.create(
                    usuario=request.user,
                    uid_imap=uid,
                    carpeta_imap='INBOX','''

new_sync_create_inbox = '''                MailCorreo.objects.create(
                    usuario=request.user,
                    conexion=conexion,
                    uid_imap=uid,
                    carpeta_imap='INBOX','''

text = text.replace(old_sync_create_inbox, new_sync_create_inbox)

old_sync_create_sent = '''                MailCorreo.objects.create(
                    usuario=request.user,
                    uid_imap=uid,
                    carpeta_imap=sent_folder,'''

new_sync_create_sent = '''                MailCorreo.objects.create(
                    usuario=request.user,
                    conexion=conexion,
                    uid_imap=uid,
                    carpeta_imap=sent_folder,'''

text = text.replace(old_sync_create_sent, new_sync_create_sent)

old_sync_count = '''    total = MailCorreo.objects.filter(usuario=request.user).count()'''
new_sync_count = '''    total = MailCorreo.objects.filter(usuario=request.user, conexion=conexion).count()'''
text = text.replace(old_sync_count, new_sync_count)

# 4. Update api_mail_lista
old_lista = '''def api_mail_lista(request):
    carpeta = request.GET.get('carpeta', 'INBOX')
    pagina = max(1, int(request.GET.get('pagina', 1)))
    por_pagina = 25

    qs = MailCorreo.objects.filter(usuario=request.user)'''

new_lista = '''def api_mail_lista(request):
    carpeta = request.GET.get('carpeta', 'INBOX')
    conexion_id = request.GET.get('conexion_id')
    pagina = max(1, int(request.GET.get('pagina', 1)))
    por_pagina = 25

    qs = MailCorreo.objects.filter(usuario=request.user)
    if conexion_id:
        qs = qs.filter(conexion_id=conexion_id)'''

text = text.replace(old_lista, new_lista)

# 5. Update api_mail_detalle
old_det_con = '''        try:
            conexion = MailConexion.objects.get(usuario=request.user, activo=True)'''

new_det_con = '''        try:
            conexion = correo.conexion
            if not conexion:
                conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()'''

text = text.replace(old_det_con, new_det_con)

# 6. Update api_mail_enviar
old_env_get = '''    try:
        conexion = MailConexion.objects.get(usuario=request.user, activo=True)
    except MailConexion.DoesNotExist:'''

new_env_get = '''    try:
        conexion_id = data.get('conexion_id')
        if conexion_id:
            conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user, activo=True)
        else:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:'''

text = text.replace(old_env_get, new_env_get)

old_env_create = '''    MailCorreo.objects.create(
        usuario=request.user,
        uid_imap=f'sent_{django_tz.now().timestamp()}',
        carpeta_imap='SENT','''

new_env_create = '''    MailCorreo.objects.create(
        usuario=request.user,
        conexion=conexion,
        uid_imap=f'sent_{django_tz.now().timestamp()}',
        carpeta_imap='SENT','''

text = text.replace(old_env_create, new_env_create)

# 7. Update api_mail_responder
old_resp_con = '''    try:
        conexion = MailConexion.objects.get(usuario=request.user, activo=True)
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Sin conexión de correo'}, status=400)'''

new_resp_con = '''    try:
        conexion = original.conexion
        if not conexion:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Sin conexión de correo'}, status=400)'''

text = text.replace(old_resp_con, new_resp_con)

old_resp_create = '''    reply = MailCorreo.objects.create(
        usuario=request.user,
        uid_imap=f'reply_{django_tz.now().timestamp()}',
        carpeta_imap='SENT','''

new_resp_create = '''    reply = MailCorreo.objects.create(
        usuario=request.user,
        conexion=conexion,
        uid_imap=f'reply_{django_tz.now().timestamp()}',
        carpeta_imap='SENT','''

text = text.replace(old_resp_create, new_resp_create)

with open('app/views_mail.py', 'w') as f:
    f.write(text)

print("done")
