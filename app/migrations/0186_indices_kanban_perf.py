# (2026-06-10, perf) Índices compuestos para los lookups calientes del
# kanban CRM: vencidas/próximas por oportunidad. Acompaña a la
# eliminación del N+1 en crm_home (views_crm.py, tab=crm).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0185_crmcambio_sync'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='tareaoportunidad',
            index=models.Index(fields=['oportunidad', 'estado', 'fecha_limite'],
                               name='idx_tareaopp_opp_est_lim'),
        ),
        migrations.AddIndex(
            model_name='actividad',
            index=models.Index(fields=['oportunidad', 'completada', 'fecha_inicio'],
                               name='idx_act_opp_comp_ini'),
        ),
        migrations.AddIndex(
            model_name='actividad',
            index=models.Index(fields=['oportunidad', 'completada', 'fecha_fin'],
                               name='idx_act_opp_comp_fin'),
        ),
        migrations.AddIndex(
            model_name='tarea',
            index=models.Index(fields=['oportunidad', 'estado', 'fecha_limite'],
                               name='idx_tarea_opp_est_lim'),
        ),
    ]
