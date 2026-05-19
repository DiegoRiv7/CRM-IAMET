# ----------------------------------------------------------------------
# 0160_asistente_ai — modelos del asistente AI: AsistenteConfig (singleton),
# ConversacionAsistente (1 por user) y MensajeAsistente (mensajes).
# ----------------------------------------------------------------------
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0159_idea_cliente_fk'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AsistenteConfig',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(
                    default='IAMET AI', max_length=80,
                    help_text='Nombre que aparece en el chat (ej. "Aria", "IAMET AI").',
                )),
                ('logo', models.ImageField(blank=True, null=True, upload_to='asistente/')),
                ('system_prompt', models.TextField(
                    blank=True, default='',
                    help_text='Instrucciones base del asistente (tono, personalidad, lo que puede y no puede hacer).',
                )),
                ('modelo', models.CharField(
                    default='openrouter/openai/gpt-4o-mini', max_length=120,
                    help_text='Modelo LiteLLM activo (ver docs.litellm.ai/docs/providers).',
                )),
                ('contexto_max_mensajes', models.PositiveIntegerField(
                    default=20,
                    help_text='Cuántos mensajes recientes incluir como contexto. Más = más caro pero más memoria.',
                )),
                ('activo', models.BooleanField(default=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Configuración Asistente AI',
                'verbose_name_plural': 'Configuración Asistente AI',
            },
        ),
        migrations.CreateModel(
            name='ConversacionAsistente',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('usuario', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='conversacion_asistente',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-fecha_actualizacion']},
        ),
        migrations.CreateModel(
            name='MensajeAsistente',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(
                    choices=[
                        ('user', 'Usuario'),
                        ('assistant', 'Asistente'),
                        ('tool', 'Tool (resultado de función)'),
                        ('system', 'System'),
                    ],
                    db_index=True, max_length=10,
                )),
                ('contenido', models.TextField(blank=True, default='')),
                ('tool_name', models.CharField(blank=True, default='', max_length=120)),
                ('tool_args_json', models.TextField(blank=True, default='')),
                ('tool_call_id', models.CharField(blank=True, default='', max_length=80)),
                ('fecha', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('conversacion', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='mensajes',
                    to='app.conversacionasistente',
                )),
            ],
            options={'ordering': ['fecha']},
        ),
    ]
