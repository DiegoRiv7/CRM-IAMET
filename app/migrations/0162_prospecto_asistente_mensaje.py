from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0161_idea_asistente_mensaje'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProspectoAsistenteMensaje',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('user', 'Usuario'), ('assistant', 'Asistente')], max_length=12)),
                ('contenido', models.TextField(blank=True, default='')),
                ('fecha', models.DateTimeField(auto_now_add=True)),
                ('prospecto', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='asistente_mensajes', to='app.prospecto')),
            ],
            options={
                'ordering': ['fecha'],
            },
        ),
    ]
