"""
MULTITENANT (modelo "bridge"): una sola app atiende a muchas empresas, cada
una con SU PROPIA base de datos, resuelta por el hostname en cada request.

Solo se activa con TENANT_MODE=1 (línea `producto`). Con TENANT_MODE apagado
—IAMET producción y pruebas— esta app ni siquiera se instala y el sistema se
comporta exactamente como siempre (una BD `default`).

Piezas:
  context.py      contextvar con el tenant actual (+ helpers para hilos/comandos)
  models.py       Tenant / TenantHost — viven en la BD de control (alias `control`)
  resolver.py     hostname → Tenant (caché corta por proceso)
  connections.py  registra el alias de BD `t_<slug>` del tenant en caliente
  router.py       tenants → control; lo demás → BD del tenant actual; sin tenant → rechaza
  middleware.py   resuelve la empresa ANTES de sesiones/auth; host desconocido → 404
  management/commands/tenant_run.py   manage.py tenant_run <slug> <comando> [args]
Ver PLAN_MULTIEMPRESA.md §Fase 6.
"""
