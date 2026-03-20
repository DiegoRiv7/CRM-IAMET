# Diseño del Nuevo Sistema de Notificaciones

## 1. Concepto General

El nuevo sistema de notificaciones transforma el widget actual en un centro de comando rápido, siguiendo principios de herramientas como Slack y Notion. Se divide en dos componentes principales:
1. **Sidebar de Filtros (Izquierda):** Para navegación rápida entre categorías.
2. **Lista Principal (Derecha):** Notificaciones agrupadas, con acciones rápidas inline y diferenciación visual por nivel de urgencia.

## 2. Tipos de Notificaciones y Prioridades

Las notificaciones se clasificarán en tres niveles de prioridad, que determinarán su color, ícono y orden en la lista.

### 🔴 Críticas (Alta Prioridad - Arriba)
- **`tarea_vencida` / `actividad_vencida`**: Tareas o actividades cuya fecha límite ya pasó.
- **`tarea_por_vencer` / `actividad_por_vencer`**: Tareas o actividades que vencen en los próximos 10 minutos o menos.
- **`rendimiento_bajo`**: Alertas de rendimiento para el administrador.

### 🟠 Importantes (Media Prioridad)
- **`tarea_reprogramada`**: Cambio de fecha límite en una tarea (notifica al admin con el motivo).
- **`tarea_asignada` / `tarea_opp_asignada`**: Asignación como responsable de una tarea.
- **`mencion` / `muro_mencion` / `tarea_mencion`**: Cuando un usuario te etiqueta (@nombre) en un comentario o chat.
- **`solicitud_cambio_perfil`**: Solicitud para editar información de la cuenta (admin).

### 🔵 Informativas (Baja Prioridad)
- **`tarea_participante` / `tarea_observador`**: Te agregan como participante u observador.
- **`comentario_oportunidad` / `tarea_comentario` / `tarea_opp_comentario`**: Nuevos comentarios en elementos donde participas.
- **`muro_post`**: Nuevo anuncio general en el muro.
- **`sistema`**: Notificaciones generales (ej. perfil actualizado).

## 3. Lógica de Disparo (Backend)

Para soportar los nuevos requerimientos, el backend (`views_api.py` y `views_proyectos.py`) necesita las siguientes adaptaciones:

1. **Aviso de 10 minutos (`tarea_por_vencer`)**: 
   - Actualmente el umbral es de 1 día (`timedelta(days=1)`). Se modificará el cron job o la vista `obtener_notificaciones_api` para disparar la notificación de "por vencer" cuando falten exactamente 10 minutos o menos (`now + timedelta(minutes=10)`).

2. **Reprogramación de Tareas (`tarea_reprogramada`)**:
   - Ya existe la lógica en `views_proyectos.py` (`api_actualizar_tarea_real`), pero se asegurará que el mensaje incluya el motivo del cambio y llegue a todos los admins.

3. **Etiquetas (@mencion)**:
   - Ya existe en `views_api.py` (chat, muro) y `views_proyectos.py` (tareas). Se unificará bajo el paraguas de "Importantes".

4. **Roles en Tareas (`tarea_participante`, `tarea_observador`)**:
   - Ya se dispara al asignar. Se clasificarán como informativas.

5. **Reporte de Efectividad (`rendimiento_bajo`)**:
   - Ya existe, se mantendrá como Crítica para los admins.

## 4. Diseño de la Interfaz (Frontend)

El template `_widget_notificaciones.html` se reescribirá completamente.

### Estructura Layout
```html
<div class="notif-container">
    <!-- Sidebar Izquierdo (Filtros) -->
    <div class="notif-sidebar">
        <div class="sidebar-title">Filtros</div>
        <button class="filter-btn active" data-filter="all">Todas <span class="badge"></span></button>
        <button class="filter-btn" data-filter="unread">No Leídas</button>
        <hr>
        <button class="filter-btn" data-filter="tareas">Tareas & Actividades</button>
        <button class="filter-btn" data-filter="oportunidades">Oportunidades</button>
        <button class="filter-btn" data-filter="equipo">Equipo & Muro</button>
        <!-- Solo Admin -->
        <button class="filter-btn" data-filter="sistema">Sistema & Permisos</button>
    </div>

    <!-- Lista Principal -->
    <div class="notif-main">
        <div class="main-header">
            <h3>Notificaciones</h3>
            <button class="mark-all-read">Marcar todas como leídas</button>
        </div>
        
        <div class="notif-list">
            <!-- Agrupación por fecha -->
            <div class="date-group">Hoy</div>
            
            <!-- Item Crítico -->
            <div class="notif-item critical unread">
                <div class="icon-wrapper">🔴</div>
                <div class="content">
                    <div class="title">Tarea Vencida: Instalación Servidor</div>
                    <div class="desc">Debió completarse hace 2 horas.</div>
                    <div class="meta">hace 2h • Proyecto X</div>
                </div>
                <div class="actions-hover">
                    <button class="btn-action" onclick="completarTarea()">Completar</button>
                    <button class="btn-action" onclick="abrirTarea()">Ver</button>
                </div>
            </div>

            <!-- Item Importante -->
            <div class="notif-item warning">
                <div class="icon-wrapper">🟠</div>
                <div class="content">
                    <div class="title">@diego te mencionó en Tarea</div>
                    <div class="desc">"¿Puedes revisar el cableado de esta zona?"</div>
                    <div class="meta">hace 30m • Tarea Y</div>
                </div>
                <div class="actions-hover">
                    <button class="btn-action" onclick="abrirTarea()">Responder</button>
                </div>
            </div>
        </div>
    </div>
</div>
```

### Estilo Visual (CSS)
- **Fondo General:** `#F9FAFB` (gris muy claro).
- **Tarjetas (Items):** Fondo `#FFFFFF`, borde suave `#E5E7EB`, radio `12px`.
- **Hover en Items:** Sombra sutil `box-shadow: 0 4px 12px rgba(0,0,0,0.05)`, el borde cambia ligeramente y aparecen los botones de acción rápida.
- **Tipografía:** Títulos en `#111827` (peso 600), descripciones en `#4B5563` (peso 400), timestamps en `#9CA3AF` (tamaño 0.75rem).
- **Indicador No Leído:** Un punto azul (`#3B82F6`) a la izquierda o fondo ligeramente tintado.
- **Botones de Acción:** Estilo "ghost" (fondo transparente, texto oscuro) que se vuelven sólidos al hover.

### Acciones Rápidas Implementadas
Dependiendo del tipo de notificación, el hover mostrará diferentes botones:
- **Tareas Vencidas/Por Vencer:** `[Ver Tarea]` `[Completar]`
- **Menciones:** `[Responder]` (Abre el modal correspondiente)
- **Solicitud Perfil (Admin):** `[Aprobar]` `[Rechazar]`
- **General:** `[Marcar Leída]` (ícono de check)

## 5. Agrupación y Ordenamiento

El JS del frontend (`notifORender`) se modificará para:
1. Ordenar primero por `leida` (no leídas arriba).
2. Luego por prioridad (Críticas > Importantes > Informativas).
3. Luego por fecha (Más recientes arriba).
4. Agrupar visualmente bajo cabeceras como "Hoy", "Ayer", "Esta semana".

## 6. Siguientes Pasos para Implementación
1. Actualizar `_widget_notificaciones.html` con el nuevo HTML/CSS.
2. Modificar la función `notifLoad()` y `notifORender()` en el JS para manejar las nuevas categorías, ordenamiento y renderizado de acciones rápidas.
3. Ajustar `views_api.py` (`obtener_notificaciones_api`) para que la alerta de "por vencer" sea de 10 minutos.
