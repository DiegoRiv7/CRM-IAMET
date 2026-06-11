

Diseña un módulo completo de "Levantamiento y Volumetría" para un CRM/ERP de una empresa de servicios técnicos (CCTV, control de acceso, cableado estructurado, alarmas, voceo, telefonía). Este módulo es el núcleo comercial del negocio: los ingenieros van a campo, levantan necesidades del cliente, arman la propuesta técnica y calculan costos/precios/utilidad.

## Estilo visual (sistema de diseño del CRM IAMET — Apple + composer-canvas)

Nuestro CRM sigue una estética **Apple moderna con toques de Linear/Notion**. NO uses Inter Tight ni estética plana genérica; apégate a estos tokens exactos:

**Tipografía:**
- Font stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif`
- Títulos H1 grandes (28–36px), font-weight 700–900, letter-spacing tight −0.015 a −0.02em
- Cuerpo 13–15px, line-height 1.55–1.7, color `#1E293B` (slate-800)
- Labels de sección: 10–11px uppercase, font-weight 700, letter-spacing 0.06–0.08em, color `#94A3B8`
- Monospace: `'SF Mono', ui-monospace, Menlo, monospace` para IDs (T-9012)

**Paleta (slate + acentos semánticos, no grises genéricos):**
- Neutros slate: #F8FAFC / #F1F5F9 / #E2E8F0 / #CBD5E1 / #94A3B8 / #64748B / #475569 / #334155 / #1E293B / #0F172A
- Primario azul: `#2563EB` (principal), `#3B82F6` (hover), gradient `linear-gradient(180deg,#3B82F6,#2563EB)` para botones
- Success emerald: `#10B981` / `#059669` / fondos `#ECFDF5` / `#DCFCE7`
- Warning ámbar: `#F59E0B` / `#B45309` / fondos `#FFFBEB` / `#FEF3C7`
- Danger/critical: `#EF4444` / `#DC2626` / `#E11D48` / fondos `#FEE2E2` / `#FFF1F2`
- Azul suave: `#EFF6FF` para estados seleccionados / hover activos
- Fondo principal: `#fff`; fondo sidebar/toolbars: `#fbfbfc` o `#F8FAFC`

**Pills de estado con dot (estilo Linear):**
- Padding 3x10, border-radius 999px, font-size 10.5–11px, font-weight 700, uppercase, letter-spacing 0.04em
- Dot 6px circular a la izquierda con `background: currentColor`
- Variantes: pendiente (ámbar #FFF1D6/#9A6700), en_progreso (azul #DBEAFE/#1D4ED8), completada (verde #DCFCE7/#166534), cancelada (rojo #FEE2E2/#991B1B)

**Composer-canvas pattern (OBLIGATORIO para todos los formularios):**
Esta es la firma visual del CRM — todos los modales de creación/edición siguen este patrón:
- Modal 1200–1440px centrado, border-radius 16px, shadow `0 30px 60px -15px rgba(15,23,42,0.30), 0 0 0 1px rgba(15,23,42,0.04)`
- Header ligero 52–56px con breadcrumb (pill + chev + título actual) a la izq, botones ícono 30x30 a la der
- Canvas con **título gigante sin borde** (texto directo, 28–36px, no input-box)
- **"Para [pill dashed]"** en lenguaje natural para relaciones obligatorias (cliente, proyecto, etc.)
- Textarea de descripción sin borde (solo al foco aparece padding + focus-ring)
- Toolbar inferior slate-50 con pills para metadatos secundarios que abren popovers: ghost button (dashed cuando vacío, solid filled slate-100 cuando lleno)
- Validación reactiva: botón submit inicia **gris** (`#E2E8F0/#94A3B8`) y se vuelve **azul gradient** solo cuando todos los required están llenos. Click en gris → soft-error rose + shake en faltantes (nunca tooltip nativo del browser)

**Bordes, sombras, spacing:**
- Border-radius: 6–8px pills pequeños, 10–12px inputs, 14–16px cards/modales, 999px chips
- Borders muy sutiles: `1px solid rgba(226, 232, 240, 0.8)` o `#E2E8F0`
- Shadows extremadamente suaves: `0 1px 3px rgba(15,23,42,0.04)` en cards; `0 12px 32px -8px rgba(15,23,42,0.18)` en popovers
- Focus ring **siempre azul**: `border-color:#93C5FD; box-shadow:0 0 0 3–4px rgba(147,197,253,0.22–0.35)`
- Gap compacto 8–12px entre elementos; 16–24px entre secciones; 28–40px en canvas lateral

**Micro-interacciones:**
- Transitions 0.15–0.18s ease (nunca más lento)
- Hover: translateY(-1px) + shadow ampliada en botones primarios; bg slate-100 en ghost items
- Popovers: `animation: fadeIn 150ms cubic-bezier(.16,1,.3,1)` con scale 0.98 → 1 + translateY(-4px → 0)
- Shake 320ms `cubic-bezier(.2,.85,.3,1.1)` en validación (±4px)

**Estados vacíos (world-class, no texto gris plano):**
- Card con `border: 1.5px dashed #E2E8F0`, `background: linear-gradient(180deg,#FAFBFC,#F8FAFC)`, ícono circular + título + CTA
- Hover cambia border y color a azul

**Densidad:**
- Comfortable (no compacta tipo Linear). Los ingenieros ven mucha información PERO con respiración visual — las tablas de volumetría pueden ser densas (32px altura de fila), pero los modales de captura deben respirar

**Dark mode:** no implementado en el CRM todavía — NO lo incluyas en este módulo (mantén solo light mode por ahora para consistencia)

## Estructura: Wizard de 5 fases con tabs horizontales

### Fase 1: Levantamiento de Campo
Header con datos generales en grid compacto:
- Cliente (autocomplete desde base de datos)
- Contacto
- Fecha (datepicker)
- Área / Ubicación
- Email
- Teléfono

Debajo: textarea "Descripción de la Necesidad Reportada"

Dos grupos de chips seleccionables:
- "Tipo de Servicio": CCTV, Alarma Intrusión, Control de Acceso, Cableado Estructural, Voceo, Telefonía, Otros
- "Componentes de la Solución": Cámara IP, Cámara Analógica, NVR, Cableado, Gabinete/Rack, Switches

Tabla de productos con buscador integrado:
- Columnas: Partida, Cantidad, Unidad, Descripción, Marca, Modelo
- Buscador que filtra desde catálogo maestro
- Botón + para agregar productos
- Filas arrastrables para reordenar

### Fase 2: Propuesta Técnica
- Hereda los productos de Fase 1
- Cada producto tiene un campo expandible de "Comentarios de Instalación"
- Zona de "Evidencia Fotográfica": grid de thumbnails con drag & drop, paste desde clipboard, y botón de cámara
- Preview de imagen en modal al hacer click

### Fase 3: Volumetría (Análisis Financiero)
Esta es la fase más compleja y más importante. Es una hoja de cálculo interactiva dividida en 3 secciones:

**Tabla 1 — Equipamiento (Materiales):**
Columnas: Partida | Cant | Unid | Descripción | Marca | Modelo | Costo Unit | Precio Lista | Desc Compra % | Desc Venta % | Costo Total | Precio Venta | Proveedor | Entrega
- Los campos numéricos calculan automáticamente totales
- Descripciones en textarea auto-expandible

**Tabla 2 — Mano de Obra (Servicios):**
Columnas: Partida | Cant | Unid | Descripción | Precio Unit | Total

**Tabla 3 — Gastos (Viáticos/Operativos):**
Columnas: Partida | Cant | Unid | Descripción | Costo Unit | Total

**Cuadro Resumen (siempre visible, sticky en la parte inferior o lateral):**
- Sub-total Materiales (venta)
- Sub-total Mano de Obra
- Sub-total Gastos
- TOTAL VENTA
- TOTAL COSTOS
- UTILIDAD BRUTA (con % de margen)
- Indicador visual: verde si margen > 30%, amarillo 15-30%, rojo < 15%

### Fase 4: Programa de Obra
- Timeline/Gantt simplificado
- Actividades principales con fechas de inicio/fin
- Asignación de responsables
- Vista de semanas con barras de progreso

### Fase 5: Reportes
- Preview del documento final en formato A4
- Secciones: Portada corporativa, Datos Generales, Propuesta Técnica, Volumetría, Evidencias, Programa de Obra
- Botones: Exportar PDF, Imprimir, Enviar por Email

## Navegación global
- Tab bar superior: Proyectos | Dashboard | Financiero
- En la vista de "Proyectos": lista/tabla de todos los levantamientos con estado (Borrador, En revisión, Aprobado, Rechazado, Ejecutando, Completado)
- Sidebar izquierda con: Buscar, CRM, Notificaciones, Tareas, Proyectos, Calendario, Correo (consistente con el diseño de mi vista de Tareas existente)

## Acciones principales (siempre visibles en header)
- Volver (a lista de proyectos)
- Guardar (verde)
- Exportar PDF (azul)

## Datos de ejemplo
Usa datos realistas de una empresa de seguridad electrónica en Tijuana, México:
- Cliente: "Luxshare Precision"
- Contacto: "Ing. Miguel Chen"
- Proyecto: "Instalación Sistema CCTV Nave 3"
- Productos ejemplo: Cámaras Hikvision DS-2CD2347, NVR Hikvision DS-7732NI, Cable UTP Cat6, Gabinete 12U, PoE Switch 24 puertos
- Precios en MXN (pesos mexicanos)

## Incluye Tweaks
Agrega controles de variación como en mi proyecto de Tareas:
- Densidad: Compacto / Normal / Amplio
- Tema: Claro / Oscuro
