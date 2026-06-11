from django.db import migrations, models


def perla_to_mundial(apps, schema_editor):
    UserProfile = apps.get_model('app', 'UserProfile')
    UserProfile.objects.filter(theme='perla').update(theme='mundial')


def mundial_to_perla(apps, schema_editor):
    UserProfile = apps.get_model('app', 'UserProfile')
    UserProfile.objects.filter(theme='mundial').update(theme='perla')


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0186_indices_kanban_perf'),
    ]

    operations = [
        migrations.RunPython(perla_to_mundial, mundial_to_perla),
        migrations.AlterField(
            model_name='userprofile',
            name='theme',
            field=models.CharField(
                choices=[
                    ('mundial', 'Mundial'),
                    ('perla', 'Perla'),
                    ('sakura', 'Sakura'),
                    ('duna', 'Duna'),
                    ('espacial', 'Espacial'),
                ],
                default='mundial',
                max_length=20,
                verbose_name='Tema de color',
            ),
        ),
    ]
