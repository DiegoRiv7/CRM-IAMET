# Optimización de Performance — Plan Pendiente

**Fecha del diagnóstico:** 2026-05-27
**Contexto:** Usuarios reportan lentitud intermitente en el CRM y, más grave,
que **la laptop del cliente se pone lenta y han tenido que reiniciarla 2 veces**
después de usar el sistema. El segundo síntoma apunta directamente a un memory
leak en el frontend (timers/listeners acumulados, polling agresivo).

---

## Diagnóstico (resumen)

Investigación realizada el 2026-05-27 sobre `crm_main.js`, `settings.py`,
`Dockerfile`, views_*.py y logs de producción.

### TOP 5 hallazgos

| # | Problema | Archivo | Severidad |
|---|----------|---------|-----------|
| 1 | `DEBUG=True` por default — Django guarda en memoria todas las queries SQL | `cartera_clientes/settings.py:39` | 🔴 Crítico — leak servidor |
| 2 | 2 `setInterval` sin pausar cuando el tab está oculto (15s y 60s) | `app/static/js/crm_main.js:6556, 6569` | 🔴 Crítico — leak cliente |
| 3 | 229 `addEventListener` vs 19 `removeEventListener` en `crm_main.js` | `app/static/js/crm_main.js` | 🔴 Crítico — leak cliente |
| 4 | 280 `print()` en views (71 + 95 + 114) | `views_crm.py`, `views_cotizaciones.py`, `bitrix_integration.py` | 🟡 Medio — I/O bloqueante |
| 5 | Solo 3 workers gunicorn para todo el tráfico | `Dockerfile` | 🟡 Medio — saturación |
| Extra | N+1 en `/app/api/tareas/` (llamada cada 15s) | `app/views_api.py:1245+` | 🟡 Medio — DB |
| Extra | Logger root en `INFO` → spam de `Glyph IDs` de fontTools | `cartera_clientes/settings.py:298` | 🟢 Bajo — ruido |

---

## Lo que YA quedó hecho (en `pruebas` — commit `498a52d`)

Tres cambios bajos-de-riesgo / altos-de-impacto se subieron a la rama `pruebas`
el 2026-05-27 antes de pausar este frente:

### 1. `crm_main.js` — visibilitychange + AbortController
- Los 2 `setInterval` (60s gradient, 15s polling de tareas) ahora respetan
  `document.hidden`. Cuando el tab no está visible NO se ejecutan.
- El poll de 15s ahora usa `AbortController` para cancelar el fetch anterior
  si el siguiente arranca antes (evita stacking de fetches lentos).
- Listener `visibilitychange` para forzar repintado al volver al tab.
- **Impacto esperado:** ~90% menos tráfico fantasma del lado del cliente cuando
  deja la pestaña abierta toda la jornada.

### 2. `Dockerfile` — gunicorn más robusto
- `--workers 3` → `--workers 5` (la VM tiene 7.7 GiB libres).
- `--max-requests 1000 --max-requests-jitter 100`: cada worker se recicla
  cada ~1000 requests, mitigando memory leaks de larga vida incluso si
  `DEBUG` llegara a estar prendido.
- `--timeout 120`: requests colgados se matan en 2 minutos en lugar de
  bloquear un worker indefinidamente.

### 3. `settings.py` — logger silencioso
- `root` y `django` level: `INFO` → `WARNING`.
- `fontTools` y `fontTools.subset` a `ERROR` (mata el spam de `Glyph IDs`).
- `weasyprint` a `WARNING`.
- **Impacto:** menos I/O por request, logs legibles para encontrar errores reales.

### Pendiente del usuario en el server (no hace falta deploy, sólo verificar)

```bash
grep DJANGO_DEBUG ~/crm-iamet/.env
```

- Si **dice `DJANGO_DEBUG=False`** → todo bien.
- Si **dice `True` o no aparece** → editar `~/crm-iamet/.env`, agregar
  `DJANGO_DEBUG=False`, y reiniciar:
  ```bash
  sudo docker compose -p gesti-n-de-ventas restart web
  ```

---

## Pendiente — Plan para retomar (en orden de impacto)

### Fase 1 — Backend cleanup (~2 horas)

#### 1.1 Eliminar / silenciar los `print()` en views
- `app/views_crm.py`: 71 prints
- `app/views_cotizaciones.py`: 95 prints
- `app/bitrix_integration.py`: 114 prints
- **Acción:** convertirlos a `logger.debug(...)` (el logger ya no es INFO,
  entonces los debug no se imprimen). Los que son útiles para troubleshooting
  quedan como debug; los obvios de development se borran.
- **Estimado:** 45 min con un agente Explore + un agente que aplique
  search-replace en paralelo.

#### 1.2 Arreglar N+1 en `/app/api/tareas/`
- `app/views_api.py:1245-1370` aprox.
- Este endpoint se llama cada 15s desde el frontend. Cada llamada hace
  100+ queries cuando hay 100 tareas con `oportunidad__cliente`.
- **Acción:** agregar `select_related('oportunidad__cliente', 'responsable')`
  y `prefetch_related('participantes', 'observadores')` a la queryset base.
- **Estimado:** 30 min — incluyendo profiling con `django-debug-toolbar`
  o `connection.queries` en local.

#### 1.3 Decidir qué hacer con el endpoint `/app/api/tareas/`
- **Idea:** considerar bajar el polling de 15s a 30s o 60s. 15s era
  agresivo. La mayoría de CRMs polean cada 30-60s.
- Alternativa más limpia: WebSocket / Server-Sent Events para push real-time
  (requiere ajustes de infra, no es prioridad).

### Fase 2 — Frontend cleanup (~3 horas)

#### 2.1 Auditar listeners en `renderTareasCRM`
- `app/static/js/crm_main.js` — la función se llama cada vez que cambia el
  hash de polling (puede ser muchas veces al día).
- Cada llamada hace `grid.innerHTML = tareas.map(...)` lo que limpia DOM
  pero NO los listeners que estén en `document` / `window` registrados
  por las tarjetas.
- **Acción:** rastrear los `addEventListener` que se llaman desde la cadena
  de render (createTaskCardCRM, etc.) y:
  - Pasar a delegación de eventos (un solo listener en `grid` que despacha
    según `event.target`).
  - O explícitamente `removeEventListener` antes de cada render.
- **Estimado:** 1.5 h — incluyendo testing del comportamiento de los menus
  contextuales y drag-and-drop si los hay.

#### 2.2 Auditar otros `setInterval` / `setTimeout` recursivos
- Hacer el mismo barrido (`visibilitychange` + `AbortController`) en:
  - `calendario*.js` — probablemente tiene polls similares
  - `widgets/*.js` si existen
  - Templates HTML con `<script>` inline

#### 2.3 Considerar lazy-load de `crm_main.js`
- El archivo es enorme (~10000 líneas). Cada usuario lo descarga al entrar.
- **Idea:** dividirlo por módulos (tareas, clientes, cotizaciones, calendario)
  y cargar bajo demanda con `<script type="module">` o webpack.
- **Estimado:** medio día. Solo vale la pena si la primera carga es lenta.

### Fase 3 — Monitoreo (opcional, ~1 h)

#### 3.1 Agregar Sentry o similar
- Para capturar errores JS del lado del cliente y errores 500 del servidor.
- Free tier de Sentry alcanza para CRM de este tamaño.

#### 3.2 Métricas de gunicorn
- Exportar `gunicorn --statsd-host` a un Grafana sencillo, o como mínimo
  loggear los slowest endpoints diariamente.

---

## Cómo medir si funcionó (después de deployear a producción)

### Lado servidor
```bash
# CPU/RAM del contenedor web — debería bajar 30-50% el uso de RAM
docker stats gesti-n-de-ventas-web-1

# Verificar que ya no hay spam de fontTools
sudo docker logs gesti-n-de-ventas-web-1 --tail 200 | grep -c "Glyph"
# Esperado: 0
```

### Lado cliente
1. Abrir el CRM y dejar el tab abierto en background 30 min.
2. DevTools → Network → debe mostrar fetches CADA 15s solo cuando el tab
   está visible. En background: 0 requests.
3. DevTools → Memory → tomar snapshot, esperar 1 hora, tomar snapshot.
   El delta de memoria debería ser <30 MB (antes podía ser 200+ MB).

---

## Comandos útiles para retomar

```bash
# Re-confirmar el conteo de prints (debería bajar tras la limpieza)
grep -c "^\s*print(" app/views_crm.py app/views_cotizaciones.py app/bitrix_integration.py

# Re-confirmar listeners (debería estabilizarse el ratio)
grep -c "addEventListener" app/static/js/crm_main.js
grep -c "removeEventListener" app/static/js/crm_main.js

# Profile N+1 en local (después de poblar la BD):
python manage.py shell -c "from django.db import connection; from app.views_api import api_tareas; ..."
```

---

## Notas para futuro yo (o futura sesión)

- **Lo del cliente cuya laptop se reinició:** preguntar qué browser usa
  (Chrome / Edge / Safari) y si tiene muchas pestañas abiertas. El leak
  se nota más en Chrome con muchos tabs porque cada tab tiene su propio
  proceso pero comparten el background.
- **Si volvieran a reportar lentitud después de Fase 1-2:** revisar antes
  de tocar código si MySQL tiene índices en `tarea.fecha_vencimiento`,
  `tarea.responsable_id`, `oportunidad.etapa_id`. Esos son los campos
  más filtrados por el polling y los reportes.
- El módulo de **Reportes** que se construyó el 26 de mayo no participa
  de este problema — sus endpoints solo se llaman cuando el usuario entra
  a Reportes manualmente. No es un candidato para polling.

---

## Estado al pausar

- ✅ Diagnóstico completo
- ✅ Fase 0 (quick wins) implementada y pusheada a `pruebas` (commit `498a52d`)
- ⏳ Verificación de `DJANGO_DEBUG` en `.env` de producción (pendiente del usuario)
- ⏳ Validar pruebas durante unos días antes de merge a `principal`
- ⏳ Fase 1, 2, 3 — futuras sesiones

**Razón de la pausa:** prioridad cambia a terminar el módulo de Reportes
(Reporte 2: Cerradas, Reporte 3: Por Cliente, Export Excel) que es
compromiso de entrega más cercano.
