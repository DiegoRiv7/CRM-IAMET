# Estado de Sesión — CRM IAMET

## LEER PRIMERO
Lee WORKFLOW.md para flujo de trabajo, ramas y comandos de deploy.
Lee ESTRUCTURA.md para entender la arquitectura completa del proyecto.

---

## Rama actual: `pruebas` — en desarrollo activo, pendiente merge a `principal`

---

## Lo que se completó esta sesión

### Base de código limpia y profesional ✓
- `base.html` 1,420 líneas → 197 líneas (CSS/JS a archivos estáticos)
- Todo el CSS/JS separado en `app/static/` — ver ESTRUCTURA.md

### Campo PO + Factura en oportunidades ✓
- Comando: `python manage.py importar_po_bitrix` — importa ambos campos desde Bitrix
  - PO: campo Bitrix `UF_CRM_1753472612145`
  - Factura: campo Bitrix `UF_CRM_1753897001662`
  - Soporta `--dry-run` y `--limit N`
- Widget de oportunidad: zona PO dividida en dos mitades (PO izquierda | Factura derecha)
- Búsqueda spotlight también busca por PO
- Migraciones: `0086_todoitem_po_number`, `0086_todoitem_factura_numero`, `0087_merge_...`

### Dynamic Island — cambios de UI ✓
- Lupa de búsqueda global visible junto a los filtros
- Filtros (mes/año/vendedores) movidos a la izquierda
- Notificaciones: ícono campana
- Correo: solo texto "CORREO", sin ícono
- Botón AYUDA eliminado

### Drive de oportunidades ✓
- Límite subido de 2.5MB a 100MB
- Acepta DWG, videos y archivos pesados de ingeniería

---

## Pendiente próxima sesión

### 1. Comentarios de tareas Bitrix
- Crear management command `importar_comentarios_bitrix`
- Los comentarios deben ir a `TareaComentario` (NO a la descripción de tarea)
- Solo los últimos 5 meses
- Similar al patrón de `importar_po_bitrix`

---

## Pasos para pasar a producción (cuando pruebas esté verificado)

### Paso 1 — Merge en Mac
```bash
git checkout principal
git merge pruebas
git push crm-iamet principal
git checkout pruebas
```

### Paso 2 — En servidor de producción
```bash
cd ~/crm-iamet
git pull origin principal
```

### Paso 3 — Migraciones (HAY campos nuevos: po_number y factura_numero)
```bash
sudo docker compose exec web python manage.py migrate
```
> Esto agrega `po_number` y `factura_numero` a la tabla de oportunidades.
> Las migraciones que va a aplicar: `0086_todoitem_po_number`, `0086_todoitem_factura_numero`, `0087_merge_...`

### Paso 4 — Estáticos (HAY archivos JS/CSS nuevos desde la última vez)
```bash
sudo docker compose exec web bash -c "rm -rf /app/staticfiles/* && python manage.py collectstatic --noinput"
```
> Se usa `rm -rf` primero para evitar que queden versiones viejas cacheadas.

### Paso 5 — Reiniciar
```bash
sudo docker compose restart web
```

### Paso 6 — Importar PO y Factura desde Bitrix (comando de una sola vez)
```bash
sudo docker compose exec web python manage.py importar_po_bitrix
```
> Son ~1,197 oportunidades con bitrix_deal_id. Tarda ~4 minutos (0.2s por oportunidad).
> Puedes dejarlo correr con `screen` si quieres:
> ```bash
> screen -S importar
> sudo docker compose exec web python manage.py importar_po_bitrix
> # Ctrl+A, D para dejar en background
> ```

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`
