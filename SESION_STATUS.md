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

### Campo PO importado desde Bitrix ✓
- Comando listo: `python manage.py importar_po_bitrix`
- Dry-run corrido — encontró 1,197 oportunidades con bitrix_deal_id, mostrando POs correctamente
- **PENDIENTE: correr el comando real** (sin --dry-run) en pruebas para poblar los datos
- Campo Bitrix: `UF_CRM_1753472612145`

### Dynamic Island — cambios de UI ✓ (pendiente verificar en pruebas)
- **Lupa de búsqueda global** agregada junto a los filtros (izquierda)
  - Al hacer clic abre el spotlight search
  - Busca por nombre de oportunidad, número de cotización, **y ahora también por campo PO**
  - Es el mismo spotlight que doble-espacio pero ahora visible para todos
- Filtros (mes/año/vendedores) movidos a la izquierda, antes del nav
- Notificaciones: ahora muestra ícono campana (sin texto)
- Correo: sin ícono ✉️, solo texto "CORREO"
- Botón AYUDA eliminado

### Drive de oportunidades — subida de archivos ✓
- Límite subido de 2.5MB a 100MB
- Ahora acepta DWG, videos y archivos pesados de ingeniería

---

## Pendiente próxima sesión

### 1. Correr comando PO en pruebas (5 min)
```bash
sudo docker compose -f docker-compose.pruebas.yml exec web python manage.py importar_po_bitrix
```

### 2. Verificar dynamic island en pruebas
- [ ] Lupa abre spotlight y busca correctamente
- [ ] Campana de notificaciones funciona
- [ ] Filtros en nueva posición responden bien

### 3. Comentarios de tareas Bitrix (pendiente técnico)
- Crear management command `importar_comentarios_bitrix`
- Los comentarios deben ir a `TareaComentario` (NO a la descripción de tarea)
- Solo los últimos 5 meses
- Similar al patrón de `importar_po_bitrix`

### 4. Merge a producción — cuando pruebas esté verificado
```bash
# En Mac:
git checkout principal
git merge pruebas
git push crm-iamet principal
git checkout pruebas

# En servidor producción:
cd ~/crm-iamet
git pull origin principal
sudo docker compose exec web python manage.py collectstatic --noinput
sudo docker compose exec web python manage.py importar_po_bitrix
sudo docker compose restart web
```

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`
