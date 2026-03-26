from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('app', '0105_campanas'),
    ]
    operations = [
        migrations.AddField(
            model_name='campanatemplate',
            name='marca',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='campanatemplate',
            name='html_content',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='campanatemplate',
            name='activa',
            field=models.BooleanField(default=True),
        ),
    ]
