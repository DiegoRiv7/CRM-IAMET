# Correo Fase 1: hilos/conversaciones. hilo_key = asunto normalizado
# (sin Re:/RV:/Fwd: encadenados, minúsculas). Backfill de los correos
# existentes con la misma normalización que models.mail_hilo_key.

import re

from django.db import migrations, models


def backfill_hilo_key(apps, schema_editor):
    MailCorreo = apps.get_model('app', 'MailCorreo')
    prefijos = re.compile(r'^\s*((re|rv|fw|fwd|rte|res)\s*(\[\d+\])?\s*:\s*)+', re.IGNORECASE)
    lote = []
    for c in MailCorreo.objects.all().only('id', 'asunto', 'uid_imap', 'carpeta_imap').iterator():
        s = (c.asunto or '').strip()
        s = prefijos.sub('', s)
        key = ' '.join(s.split()).lower()[:180]
        c.hilo_key = key or f'solo-{c.uid_imap}-{c.carpeta_imap}'[:180]
        lote.append(c)
        if len(lote) >= 500:
            MailCorreo.objects.bulk_update(lote, ['hilo_key'])
            lote = []
    if lote:
        MailCorreo.objects.bulk_update(lote, ['hilo_key'])


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0203_mail_archivado'),
    ]

    operations = [
        migrations.AddField(
            model_name='mailcorreo',
            name='hilo_key',
            field=models.CharField(blank=True, db_index=True, default='', max_length=200),
        ),
        migrations.RunPython(backfill_hilo_key, migrations.RunPython.noop),
    ]
