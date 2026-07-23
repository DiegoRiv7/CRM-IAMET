# Plan — Volumetría asistida por AI (Fase 3 del Levantamiento)

> Documento vivo. Se actualiza al cerrar cada fase. Si se pierde el contexto de la
> conversación, **este archivo es la fuente de verdad** para retomar.

## Objetivo del proyecto

Que al llegar a la **Fase 3 (Volumetría)** del wizard de levantamiento, el ingeniero
pueda presionar un botón **"Generar volumetría con AI"** y obtener un **borrador del
80-90%** de la volumetría, construido a partir de:

- La información capturada en **Fase 1** (servicios, componentes, descripción).
- Las **notas y comentarios** de la Fase 2 (incl. comentarios por foto: distancias,
  alturas, accesos, voltajes…).
- Las **imágenes de evidencia** de la Fase 2 (modelo con visión).
- El **catálogo real** de productos para los precios (fuente de verdad de precios).
- El **conocimiento de volumetrías pasadas** (few-shot, no fine-tuning).

El usuario final **solo revisa**: ajusta 2-3 partidas, algunas cantidades, mano de obra.
**Nunca se guarda/cotiza sin revisión humana (no auto-commit).**

## Principios / líneas rojas (aplican en todas las fases)

1. **Los precios autoritativos SIEMPRE salen del catálogo, nunca del modelo.** Lo que
   la AI proponga sin SKU va marcado **"sin precio — verificar"**.
2. **La AI no escribe sola en el catálogo maestro.** Propone en el borrador; un humano
   promueve el producto al catálogo si se repite.
3. **El borrador siempre pasa por revisión humana** antes de guardar/cotizar.
4. **No salirse de la fase en curso.** Si surge una mejora de otra área, se anota en
   "Ideas / backlog" y se sigue.

## Decisiones ya tomadas

- **Infraestructura:** se reutiliza el asistente actual (LiteLLM + registro de tools con
  function-calling en `app/asistente_tools.py`). NO se monta un sistema nuevo.
- **Modelo:** el chat normal sigue en `gpt-4o-mini`. La generación de volumetría usará un
  modelo con buena visión y razonamiento (Sonnet 4.6 / Opus 4.8). **El cambio de modelo es
  lo ÚLTIMO** — una sola línea/env en el servidor (`LITELLM_MODEL` o un setting dedicado) +
  su API key + subir versión de `litellm` (hoy 1.55.0). Durante el desarrollo se trabaja
  con el modelo que esté disponible.
- **Aprendizaje:** few-shot con volumetrías reales de ejemplo (NO fine-tuning).

## Referencias técnicas (para retomar rápido)

- Volumetría: modelo `ProyectoVolumetria.data` (JSON) — `app/models.py:5116`. Autosave:
  `api_volumetria_data` → `app/views_iamet.py:3797`. Shape: `data.secciones[].items[]`.
- Catálogo/precios: `api_catalogo_productos` → `app/views_iamet.py:6351`. Fuentes:
  `CatalogoCableado` (`app/models.py:758`) y `Producto` (Compras).
- Asistente: endpoint `api/asistente/mensaje/` → `app/views_asistente.py:672`. Wrapper de
  modelo `chat()` → `app/asistente_provider.py` (ya soporta override de modelo por llamada).
  Registro de tools: `TOOL_SCHEMAS` / `TOOL_HANDLERS` / `execute_tool()` en
  `app/asistente_tools.py`.
- Wizard Fase 2/3: `app/static/js/crm_levantamiento.js`,
  `app/templates/crm/_widget_levantamiento_wizard.html`.

---

## Estado actual

- **EN PAUSA (2026-07-22, decisión del usuario).** El motor completo quedó
  construido, deployado en pruebas y FUNCIONANDO (una generación real exitosa:
  "Borrador AI 1" del levantamiento AP AST2 — 13 partidas, formato correcto).
  Solo se retiró el botón de la UI (`crm_levantamiento.js`, buscar
  `lwP3GenerarAI` — el handler y el backend siguen vivos; reactivar = restaurar
  el botón). Modelo: VOLUMETRIA_AI_MODEL=openrouter/anthropic/claude-sonnet-4.6
  en `.env.pruebas` (solo volumetrías; el resto del sistema sigue en 4o-mini).
- Pendientes al retomar: 1) comparar borrador AI vs volumetría real del AP
  (el usuario la tiene en Excel) y la de Carl Zeiss → % de acierto; 2) revisar
  `ai_volumetria_ejemplos/catalogo_candidato.csv` e importar catálogo a
  PRODUCCIÓN; 3) afinar prompt/ejemplos con los errores; 4) restaurar botón.
- En pruebas quedaron: catálogo semilla importado (114 SKUs), 3 levantamientos
  de prueba "[AI TEST] …" (levs 56-58, proyecto 27) con fotos, y la key de
  OpenRouter de prod copiada a `.env.pruebas`.

### Avance previo (2026-07-21) — Fases 1-3 completas, Fase 4 construida
- Hecho:
  - Dataset de 5 pares reales entrada→salida extraído de producción a
    `ai_volumetria_ejemplos/` (gitignored — fotos de clientes). Mejor ejemplo:
    lev 36 "Reubicación IDF2" (22 fotos comentadas, 39 partidas).
  - Verificado: Fase 2 del wizard SÍ captura comentario por foto
    (`LevantamientoEvidencia.comentario`); notas del sitio en texto libre
    (suficiente para el LLM, no se requieren campos estructurados).
  - Shape real confirmado de `ProyectoVolumetria.data` (v4):
    `{meta, version: 4, secciones: [{id, tipo: equipamiento|mano_obra|costo_mo,
    titulo, expanded, items[]}]}`. Equipamiento lleva filas `row_type: header`
    para agrupar zonas. (El shape `secciones[].items[]` que decía este doc era
    correcto; el legado `materiales/manoObra/gastos` solo vive en vols 1-3.)
  - **Catálogo en producción está VACÍO (0 filas ambas tablas).** Semilla
    generada desde volumetrías reales + 2 Excels: 114 SKUs (101 con precio) en
    `ai_volumetria_ejemplos/catalogo_candidato.csv` → revisar y correr
    `manage.py importar_catalogo_csv <csv> --aplicar`.
  - Código nuevo: `app/volumetria_ai.py` (tools buscar_catalogo/escribir
    borrador + contexto multimodal con fotos + loop de generación),
    `app/volumetria_ai_fewshot.json` (2 ejemplos reales destilados),
    comandos `generar_volumetria_ai` (con --dry-run) e `importar_catalogo_csv`,
    migración 0199 (tipos de producto ampliados en CatalogoCableado).
- **Siguiente:** deploy a pruebas → revisar CSV del catálogo e importarlo →
  `manage.py generar_volumetria_ai --vol <id> --dry-run` contra un ejemplo real
  → medir % de acierto → Fase 4 (botón + vista de revisión en el wizard).

---

## Fase 1 — Cimientos: datos de entrada y catálogo (SIN AI todavía)

**Objetivo:** garantizar que la AI tendrá buenos insumos y un catálogo utilizable, antes
de escribir una sola línea de AI.

**Entregables:**
1. Verificar/asegurar que la Fase 2 captura lo que la AI necesita: **comentario por foto**
   y notas estructuradas (distancias, alturas, accesos, voltajes). Ajustar la UI si falta.
2. Reunir **2-3 volumetrías reales** de ejemplo, cada una con sus Fases 1-2 y fotos
   (sirven como few-shot y como "verdad" para medir aciertos).
3. Sembrar el catálogo con los **30-50 equipos más cotizados** que hoy no están
   (cámaras, NVRs, controladoras…), con su precio real.

**Qué NO hacer:** nada de AI, prompts ni tools todavía.

**Criterio para avanzar:** una volumetría de ejemplo se puede "leer" completa solo con lo
capturado en sus Fases 1-2 + fotos + comentarios, y los equipos clave existen en catálogo.

---

## Fase 2 — Las tools (function-calling), SIN generación todavía

**Objetivo:** construir y probar de forma aislada las herramientas que la AI usará.

**Entregables:**
1. **Tool de búsqueda en catálogo:** exponer la lógica de `api_catalogo_productos` como
   tool del registro (devuelve SKU, marca, modelo, precio, costo).
2. **Tool de escritura del borrador:** crea/actualiza `ProyectoVolumetria.data`
   (`secciones[].items[]`) vía el flujo de autosave, marcando "verificar" lo sin precio.
3. Registrar ambas en `TOOL_SCHEMAS`/`TOOL_HANDLERS` respetando permisos del usuario.

**Qué NO hacer:** no tocar el prompt de generación ni la UI todavía.

**Criterio para avanzar:** cada tool se puede invocar directo (sin LLM) y devuelve/escribe
correctamente.

---

## Fase 3 — El cerebro: prompt + few-shot + generación del borrador

**Objetivo:** conectar el LLM para que lea Fases 1-2 + comentarios + imágenes, llame las
tools y produzca un borrador.

**Entregables:**
1. Prompt de generación con los ejemplos **few-shot** de la Fase 1.
2. Inyección de contexto **multimodal**: texto Fase 1, notas Fase 2, comentarios por foto,
   e imágenes.
3. Loop de tool-calling que genera el borrador en la volumetría, marcando "sin precio —
   verificar" lo que no esté en catálogo.

**Qué NO hacer:** no auto-guardar/cotizar; no pulir la UI todavía. (El cambio a Sonnet/Opus
sigue siendo la línea final en el servidor.)

**Criterio para avanzar:** dado un levantamiento de ejemplo, genera un borrador y se compara
contra la volumetría real → se mide el **% de acierto** (meta orientativa: 80%+ de partidas).

---

## Fase 4 — UX, revisión humana y afinación

**Objetivo:** el botón, el flujo de revisión, las barreras de seguridad y la afinación final.

**Entregables:**
1. Botón **"Generar volumetría con AI"** en Fase 3, con estado de carga.
2. Vista de **revisión**: borrador editable, partidas "verificar" resaltadas; el usuario
   ajusta y guarda.
3. Barreras: nunca auto-commit; precios fuera de catálogo marcados; opción de **promover
   producto al catálogo** (con precio verificado por humano).
4. Afinación con feedback real. **Al final:** cambiar el modelo a Sonnet/Opus (la línea en
   el servidor) y volver a medir.

**Qué NO hacer:** no agregar features nuevas fuera del flujo de volumetría.

**Criterio de cierre:** un ingeniero real genera y revisa una volumetría de punta a punta en
`crm.pruebas.nethive.mx`, ajustando solo detalles menores.

---

## Ideas / backlog (no tocar hasta terminar las 4 fases)

- (vacío)
