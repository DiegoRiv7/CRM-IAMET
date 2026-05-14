"""Notificacion: agrega FK a Certificacion + nuevos choices para alertas
de vencimiento. El management command notificar_certificaciones_por_vencer
genera estas notificaciones a 60/30/7/0 días del vencimiento.
"""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0147_certificacion_orden'),
    ]

    operations = [
        migrations.AddField(
            model_name='notificacion',
            name='certificacion',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='notificaciones',
                to='app.certificacion',
                verbose_name='Certificación relacionada',
            ),
        ),
        migrations.AlterField(
            model_name='notificacion',
            name='tipo',
            field=models.CharField(
                choices=[
                    ('tarea_vencida', 'Tarea vencida'),
                    ('tarea_por_vencer', 'Tarea por vencer'),
                    ('actividad_vencida', 'Actividad vencida'),
                    ('actividad_por_vencer', 'Actividad por vencer'),
                    ('rendimiento_bajo', 'Bajo rendimiento de usuario'),
                    ('tarea_reprogramada', 'Tarea reprogramada'),
                    ('tarea_asignada', 'Tarea asignada'),
                    ('tarea_opp_asignada', 'Tarea de oportunidad asignada'),
                    ('mencion', 'Mención en comentario'),
                    ('muro_mencion', 'Mención en el muro'),
                    ('tarea_mencion', 'Mención en tarea'),
                    ('solicitud_cambio_perfil', 'Solicitud de cambio de perfil'),
                    ('tarea_participante', 'Agregado como participante a tarea'),
                    ('tarea_observador', 'Agregado como observador a tarea'),
                    ('comentario_oportunidad', 'Nuevo comentario en oportunidad'),
                    ('tarea_comentario', 'Comentario en tarea'),
                    ('tarea_opp_comentario', 'Comentario en tarea de oportunidad'),
                    ('oportunidad_mensaje', 'Nuevo mensaje en oportunidad'),
                    ('muro_post', 'Nuevo anuncio en el muro'),
                    ('respuesta', 'Respuesta a comentario'),
                    ('sistema', 'Notificación del sistema'),
                    ('proyecto_agregado', 'Agregado a proyecto'),
                    ('programacion_proyecto', 'Asignado a actividad de proyecto'),
                    ('mensaje_grupo', 'Mensaje en grupo de trabajo'),
                    ('prospecto_asignado', 'Prospecto asignado por supervisor'),
                    ('certificacion_por_vencer', 'Certificación por vencer'),
                    ('certificacion_vencida', 'Certificación vencida'),
                ],
                max_length=30,
                verbose_name='Tipo de Notificación',
            ),
        ),
    ]
