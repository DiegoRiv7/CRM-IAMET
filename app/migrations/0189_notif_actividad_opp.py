# Notificaciones de actividades PROGRAMADAS de oportunidad (modelo Actividad)
# vencidas / por vencer. Solo agrega 2 choices al campo 'tipo' — a nivel BD es
# un no-op (los choices no son constraint). Ver procesar_vencimientos.py.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0188_perfevent_telemetria'),
    ]

    operations = [
        migrations.AlterField(
            model_name='notificacion',
            name='tipo',
            field=models.CharField(
                max_length=30,
                verbose_name='Tipo de Notificación',
                choices=[
                    ('tarea_vencida', 'Tarea vencida'),
                    ('tarea_por_vencer', 'Tarea por vencer'),
                    ('actividad_vencida', 'Actividad vencida'),
                    ('actividad_por_vencer', 'Actividad por vencer'),
                    ('actividad_opp_vencida', 'Actividad de oportunidad vencida'),
                    ('actividad_opp_por_vencer', 'Actividad de oportunidad por vencer'),
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
            ),
        ),
    ]
