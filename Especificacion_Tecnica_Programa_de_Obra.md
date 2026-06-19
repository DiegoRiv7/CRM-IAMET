# Especificación Técnica — Módulo: Programa de Obra
**Versión:** 2.0 | **Fecha:** Abril 2026 | **Plataforma:** ERP Infraestructura Tecnológica

---

## Índice de Procesos

| # | Proceso | Código |
|---|---------|--------|
| 1 | Agregar Actividad al Cronograma | PRO-001 |
| 2 | Eliminar Actividad del Cronograma | PRO-002 |
| 3 | Mover Actividad (Drag and Drop Temporal) | PRO-003 |
| 4 | Redimensionar Duración de Actividad | PRO-004 |
| 5 | Cascada Automática de Dependencias | PRO-005 |
| 6 | Asignación de Recursos Humanos | PRO-006 |
| 7 | Colapsar / Expandir Fases | PRO-007 |
| 8 | Visualización de Erogaciones e Ingresos | PRO-008 |
| 9 | Dashboard de Valor Ganado (EVM) | PRO-009 |

---

## PRO-001: Agregar Actividad al Cronograma

### Objetivo
Permitir al usuario registrar una nueva actividad o fase dentro del cronograma del proyecto activo, definiendo sus parámetros de tiempo, costo e ingreso.

### Flujo Paso a Paso

| Paso | Acción del Usuario | Respuesta del Sistema |
|------|--------------------|-----------------------|
| 1 | Clic en botón "+ Agregar Actividad" en la barra de herramientas. | El sistema despliega el modal "Nueva Actividad" con los campos vacíos. El campo "Fase/Grupo" se carga dinámicamente con las fases existentes. El campo "Fecha Inicio" se pre-llena con la fecha de inicio del proyecto. |
| 2 | El usuario ingresa el Nombre de la Actividad. | El sistema valida en tiempo real que el campo no esté vacío. |
| 3 | El usuario selecciona la Fase/Grupo padre (o deja "Sin fase" para crear una nueva fase). | Si selecciona una fase existente, la actividad se insertará como subtarea. Si deja "Sin fase", el sistema creará automáticamente una nueva fase con una subtarea. |
| 4 | El usuario define Fecha de Inicio y Duración en días. | El sistema calcula automáticamente el día relativo (startDay) restando la fecha ingresada menos la fecha de inicio del proyecto. |
| 5 | El usuario ingresa Costo Estimado e Ingreso Estimado (opcionales). | Los campos aceptan valores numéricos >= 0. Valores vacíos se interpretan como $0. |
| 6 | Clic en "Agregar al Cronograma". | El sistema: (a) Asigna un ID auto-incremental, (b) Inserta la tarea en la posición correcta del array, (c) Actualiza el array children de la fase padre, (d) Re-renderiza tabla y canvas del Gantt, (e) Cierra el modal. |

### Reglas del Sistema
- Campo obligatorio: Nombre de la Actividad (string, no vacío).
- Duración mínima: 1 día. Valores menores se fuerzan a 1.
- Fecha de inicio: No puede ser anterior a la fecha de inicio del proyecto (projectStart).
- Costo e Ingreso: Numéricos >= 0. Default: 0.
- ID: Auto-generado, incremental, único. Variable nextId.
- Progreso inicial: Siempre 0% para nuevas actividades.
- Dependencias iniciales: Array vacío [].
- Recursos iniciales: Array vacío [].

### Excepciones
- Nombre vacío: El sistema muestra alerta y no cierra el modal.
- Duración = 0 o negativa: Se fuerza a 1 día mediante Math.max(1, valor).
- Fecha fuera de rango: Si startDay resulta negativo, se fuerza a 0.
- Fase padre eliminada entre apertura y confirmación: La tarea se crea como fase independiente.

### Datos Involucrados
| Campo | Tipo | Obligatorio | Fuente |
|-------|------|-------------|--------|
| id | Integer | Auto | Sistema |
| name | String | Sí | Input "Nombre de la Actividad" |
| parent | Integer | No | Select "Fase/Grupo" |
| start | Integer (días) | Sí | Calculado desde Input "Fecha Inicio" |
| dur | Integer (días) | Sí | Input "Duración" |
| progress | Integer (0-100) | Auto | Sistema (default: 0) |
| cost | Float | No | Input "Costo Estimado" |
| income | Float | No | Input "Ingreso Estimado" |
| deps | Array[Integer] | Auto | Sistema (default: []) |
| res | Array[String] | Auto | Sistema (default: []) |

### Comportamiento del Sistema
- Al confirmar, se ejecuta renderGantt() y renderFinancial() para reflejar los cambios en ambas vistas simultáneamente.
- La nueva barra aparece en el canvas con color gris (#94a3b8) indicando 0% de progreso.
- Si se creó una nueva fase, aparece con su barra de resumen (summary bar) negra con corchetes.

### Resultado Esperado
- Nueva fila visible en la tabla izquierda del Gantt con ID, nombre, duración y porcentaje.
- Nueva barra renderizada en el canvas en la posición temporal correcta.
- Modal cerrado. Campos del formulario reseteados.

### Validaciones Críticas
- El nextId debe ser siempre mayor al máximo ID existente en el array tasks.
- Al insertar en una fase, el children array de la fase padre debe actualizarse antes del re-render.
- La posición de inserción en el array tasks debe ser inmediatamente después del último hijo de la fase (lastChildIdx + 1).

---

## PRO-002: Eliminar Actividad del Cronograma

### Objetivo
Permitir al usuario eliminar una actividad o fase completa del cronograma, limpiando todas las referencias y dependencias asociadas.

### Flujo Paso a Paso

| Paso | Acción del Usuario | Respuesta del Sistema |
|------|--------------------|-----------------------|
| 1 | El usuario hace clic en una fila de la tabla para seleccionarla (se resalta en azul). | La fila se marca con clase selected y se almacena selectedTaskId. |
| 2 | Clic en botón "Eliminar" en la barra de herramientas. | El sistema evalúa si es fase o tarea individual. |
| 3a | Si es tarea individual: | El sistema: (a) Remueve la tarea del array tasks, (b) Remueve el ID del array children de su fase padre, (c) Remueve el ID de los arrays deps de todas las demás tareas, (d) Re-renderiza. |
| 3b | Si es fase: | El sistema elimina la fase y todas sus subtareas del array. Se limpian dependencias huérfanas. |

### Reglas del Sistema
- Se requiere una actividad seleccionada (selectedTaskId !== null).
- La eliminación es en cascada para fases (elimina hijos).
- Las dependencias (deps) de otras tareas que referencien al ID eliminado se limpian automáticamente.

### Excepciones
- Sin selección: Se muestra alerta. No se ejecuta ninguna acción.
- Fase con hijos activos (progreso > 0): Se elimina sin advertencia. Recomendación para producción: Agregar confirmación.

### Datos Involucrados
| Campo | Operación |
|-------|-----------|
| tasks[] | filter() para remover por ID |
| parent.children[] | filter() para remover referencia |
| *.deps[] | filter() en todas las tareas para limpiar dependencias |
| selectedTaskId | Se resetea a null |

### Validaciones Críticas
- Después de eliminar, ninguna tarea debe contener en su deps el ID eliminado.
- El selectedTaskId debe resetearse a null inmediatamente.
- Si se elimina una fase, el filtro debe ser: x.id !== phaseId AND x.parent !== phaseId.

---

## PRO-003: Mover Actividad (Drag and Drop Temporal)

### Objetivo
Permitir al usuario arrastrar una barra del Gantt horizontalmente para cambiar la fecha de inicio de una actividad, manteniendo su duración constante.

### Flujo Paso a Paso

| Paso | Acción del Usuario | Respuesta del Sistema |
|------|--------------------|-----------------------|
| 1 | El usuario posiciona el cursor sobre el centro de una barra (no en los bordes). | El cursor cambia a grab. |
| 2 | El usuario presiona el botón del mouse (mousedown). | El sistema crea un objeto dragState con: taskId, type:'move', startX, origStart, origDur. |
| 3 | El usuario arrastra horizontalmente (mousemove). | El sistema calcula delta = round((mouseX - startX) / COL_W) y aplica task.start = max(0, origStart + delta). Re-renderiza en cada frame. Ejecuta cascadeDeps(taskId). |
| 4 | El usuario suelta el botón (mouseup). | El dragState se resetea a null. El cursor vuelve a la normalidad. |

### Reglas del Sistema
- Solo se pueden mover tareas individuales, no fases.
- La fecha de inicio no puede ser menor a día 0.
- El movimiento se cuantiza en unidades de 1 día (COL_W = 36px).
- Durante el drag, se ejecuta cascadeDeps() en cada frame.

### Excepciones
- Clic en fase: Se ignora el drag.
- Clic fuera de barra: No se inicia drag.
- Arrastre más allá del día 0: Se limita a start = 0.

### Datos Involucrados
| Campo | Operación |
|-------|-----------|
| task.start | Se modifica directamente |
| task.dur | No se modifica |
| dragState | Objeto temporal: {taskId, type, startX, origStart, origDur} |

### Comportamiento del Sistema
- El Gantt completo se re-renderiza en cada movimiento del mouse (canvas redraw).
- Las flechas de dependencia se redibujan dinámicamente.
- Las barras de resumen de fase se recalculan (min start / max end de hijos).

### Validaciones Críticas
- cascadeDeps() es recursiva: si tarea A empuja a B, y B tiene dependientes C, se empuja también C.
- La regla de cascada: si tarea_dependiente.start < tarea_movida.start + tarea_movida.dur, entonces tarea_dependiente.start = tarea_movida.start + tarea_movida.dur.

---

## PRO-004: Redimensionar Duración de Actividad

### Objetivo
Permitir al usuario cambiar la duración de una actividad arrastrando el borde izquierdo o derecho de la barra.

### Flujo Paso a Paso

| Paso | Acción del Usuario | Respuesta del Sistema |
|------|--------------------|-----------------------|
| 1 | Cursor sobre los primeros 8px (borde izquierdo) o últimos 8px (borde derecho) de una barra. | El cursor cambia a ew-resize. |
| 2a | mousedown en borde derecho. | dragState.type = 'resizeR'. |
| 2b | mousedown en borde izquierdo. | dragState.type = 'resizeL'. |
| 3 | Arrastre horizontal. | Borde derecho: task.dur = max(1, origDur + delta). La fecha de inicio no cambia. Borde izquierdo: task.start = max(0, origStart + delta) y task.dur = max(1, origDur - delta). |
| 4 | mouseup. | Se persiste la nueva duración. Se ejecuta cascada de dependencias. |

### Reglas del Sistema
- Duración mínima: 1 día. No se permite reducir a 0.
- Al redimensionar por la izquierda, la fecha de fin permanece fija.
- Al redimensionar por la derecha, la fecha de inicio permanece fija.

### Validaciones Críticas
- Al usar resizeR, se debe llamar cascadeDeps() porque la fecha de fin cambia y puede afectar dependientes.

---

## PRO-005: Cascada Automática de Dependencias

### Objetivo
Cuando una actividad se mueve o redimensiona, todas las actividades que dependan de ella se reajustan automáticamente para respetar la secuencia lógica (Finish-to-Start).

### Flujo Paso a Paso

| Paso | Acción del Usuario | Respuesta del Sistema |
|------|--------------------|-----------------------|
| 1 | El usuario mueve o redimensiona una actividad. | El sistema llama cascadeDeps(movedId). |
| 2 | Automático | Busca todas las tareas cuyo array deps contenga movedId. |
| 3 | Automático | Para cada dependiente: si start < moved.start + moved.dur, se fuerza start = moved.start + moved.dur. |
| 4 | Automático | Se llama recursivamente cascadeDeps(dependiente.id) para propagar en cadena. |

### Reglas del Sistema
- Tipo de dependencia: Finish-to-Start (FS) exclusivamente.
- La cascada es recursiva y sin límite de profundidad.
- Solo se empujan tareas hacia adelante, nunca hacia atrás.

### Excepciones
- Dependencia circular: No se valida actualmente. Recomendación: Implementar detección de ciclos.
- Tarea dependiente ya está más adelante: No se mueve.

### Validaciones Críticas
- La función debe recorrer todo el array tasks en cada nivel de recursión.
- En producción: Agregar un contador de recursión máx. 100 iteraciones.

---

## PRO-006: Asignación de Recursos Humanos

### Objetivo
Permitir al usuario asignar o desasignar personal a una actividad específica del cronograma.

### Flujo Paso a Paso

| Paso | Acción del Usuario | Respuesta del Sistema |
|------|--------------------|-----------------------|
| 1 | Doble clic en una barra del Gantt, o clic en el icono de persona en la tabla. | Abre el modal "Asignar Recursos" con la lista completa de recursos disponibles. |
| 2 | El modal muestra checkboxes por cada recurso. Los ya asignados aparecen marcados. | Se lee task.res[] y se marca checked en los correspondientes. |
| 3 | El usuario marca/desmarca recursos. | Interacción local en el modal. |
| 4 | Clic en "Guardar Asignación". | El sistema actualiza task.res con los IDs seleccionados, cierra el modal y re-renderiza. |

### Datos Involucrados
| Campo | Tipo | Descripción |
|-------|------|-------------|
| resource.id | String | Identificador único (ej: "R1") |
| resource.name | String | Nombre completo |
| resource.role | String | Cargo o especialidad |
| resource.costDay | Float | Costo diario en MXN |
| task.res[] | Array[String] | IDs de recursos asignados |

### Comportamiento del Sistema
- El icono en la tabla muestra el conteo de recursos asignados.
- Si no hay recursos: muestra círculo gris con "+".
- El tooltip de la barra muestra los nombres de los recursos.
- En la vista de Recursos Humanos, la tabla refleja las actividades asignadas y la carga total en días.

### Validaciones Críticas
- Al guardar, task.res se reemplaza completamente (no se hace merge).
- Costo total de recursos por actividad: sum(recurso.costDay) x task.dur.
- En producción: Validar conflictos de sobre-asignación.

---

## PRO-007: Colapsar / Expandir Fases

### Objetivo
Permitir al usuario ocultar o mostrar las subtareas de una fase para simplificar la visualización.

### Flujo Paso a Paso

| Paso | Acción del Usuario | Respuesta del Sistema |
|------|--------------------|-----------------------|
| 1 | Clic en el icono de flecha de una fila de fase. | El sistema conmuta task.collapsed (true/false). |
| 2 | Automático | Se re-renderiza tabla y canvas. Las subtareas de la fase colapsada desaparecen de la vista. |

### Reglas del Sistema
- Solo las filas de tipo isPhase: true tienen el icono de colapsar.
- Al colapsar, la barra de resumen (summary bar) permanece visible.
- Los botones "Expandir Todo" y "Colapsar Todo" afectan todas las fases simultáneamente.

---

## PRO-008: Visualización de Erogaciones e Ingresos

### Objetivo
Proporcionar una vista financiera duplicada del cronograma donde las barras representan costos e ingresos en lugar de progreso.

### Flujo Paso a Paso

| Paso | Acción del Usuario | Respuesta del Sistema |
|------|--------------------|-----------------------|
| 1 | Clic en "Erogaciones e Ingresos" en el sidebar. | Renderiza vista idéntica al cronograma pero con contexto financiero. |
| 2 | El usuario visualiza las barras. | Las barras muestran el monto en miles (ej: "$45k") en lugar del porcentaje. |
| 3 | Hover sobre una barra. | El tooltip muestra: Costo estimado, Ingreso estimado y margen. |
| 4 | Drag and Drop funciona igual que en el cronograma. | Al mover barras, los montos se redistribuyen temporalmente. |

### Reglas del Sistema
- La vista financiera comparte el mismo modelo de datos que el cronograma.
- Cualquier cambio en una vista se refleja automáticamente en la otra.

### Datos Involucrados
| Campo | Uso en Vista Financiera |
|-------|------------------------|
| task.cost | Monto de erogación (gasto) |
| task.income | Monto de ingreso esperado |
| task.start | Posición temporal del gasto |
| task.dur | Período de distribución del gasto |

### Validaciones Críticas
- Costo e ingreso son por actividad completa, no por día.
- Para calcular erogación diaria: task.cost / task.dur.

---

## PRO-009: Dashboard de Valor Ganado (EVM)

### Objetivo
Mostrar indicadores clave de desempeño del proyecto basados en la metodología de Valor Ganado.

### Fórmulas del Sistema
| KPI | Fórmula | Interpretación |
|-----|---------|---------------|
| SPI | EV / PV | > 1.0 = adelantado, < 1.0 = retrasado |
| CPI | EV / AC | > 1.0 = bajo presupuesto, < 1.0 = sobre presupuesto |
| Avance Global | avg(task.progress) | Porcentaje promedio de completitud |

---

## Anexo A: Modelo de Datos

### Tabla: tasks[]
| Campo | Tipo | Nullable | Descripción |
|-------|------|----------|-------------|
| id | Integer | No | PK, auto-incremental |
| name | String | No | Nombre de la actividad |
| isPhase | Boolean | Sí | true si es fase/grupo |
| collapsed | Boolean | Sí | Estado visual de la fase |
| children | Array[Int] | Sí | IDs de subtareas (solo fases) |
| start | Integer | No* | Día relativo de inicio (base 0) |
| dur | Integer | No* | Duración en días |
| progress | Integer | No* | 0-100 |
| deps | Array[Int] | No* | IDs de tareas predecesoras |
| res | Array[String] | No* | IDs de recursos asignados |
| cost | Float | No* | Costo estimado en MXN |
| income | Float | No* | Ingreso estimado en MXN |
| parent | Integer | Sí | ID de la fase padre |

*No aplica para filas de tipo fase.

### Tabla: resources[]
| Campo | Tipo | Nullable | Descripción |
|-------|------|----------|-------------|
| id | String | No | PK (ej: "R1") |
| name | String | No | Nombre completo |
| role | String | No | Cargo/especialidad |
| costDay | Float | No | Costo diario en MXN |

## Anexo B: Constantes del Sistema
| Constante | Valor | Descripción |
|-----------|-------|-------------|
| COL_W | 36px | Ancho de columna por día en el canvas |
| ROW_H | 36px | Altura de cada fila |
| BAR_H | 20px | Altura de las barras de actividad |
| BAR_Y | 8px | Offset vertical de la barra dentro de la fila |
| projectStart | 20/Abr/2026 | Fecha de inicio del proyecto activo |
| totalDays | 60 | Ventana de visualización en días |

## Anexo C: Eventos del Sistema
| Evento | Trigger | Función |
|--------|---------|---------|
| mousedown en canvas | Inicio de drag | Crea dragState |
| mousemove en canvas | Durante drag | Actualiza posición/duración + cascada |
| mouseup (document) | Fin de drag | Limpia dragState |
| mousemove sin drag | Hover | Muestra/oculta tooltip |
| mouseleave en canvas | Salida del área | Oculta tooltip |
| dblclick en canvas | Doble clic en barra | Abre modal de recursos |
| click en fila tabla | Selección | Marca selectedTaskId |
| click en toggle fase | Colapsar/expandir | Toggle collapsed |

## Anexo D: Recomendaciones para Producción
1. Persistencia: Conectar el modelo de datos a API REST con base de datos relacional.
2. Undo/Redo: Implementar stack de estados para deshacer movimientos.
3. Dependencias circulares: Agregar validación de grafos (BFS/DFS) antes de crear dependencias.
4. Sobre-asignación: Alertar cuando un recurso está asignado a tareas con fechas superpuestas.
5. Permisos: Roles diferenciados (Controller puede editar, Operativo solo lectura).
6. Línea Base (Baseline): Guardar snapshot del cronograma original para comparar vs. real.
7. Exportación: PDF del cronograma y CSV de la tabla de erogaciones.
8. Zoom real: Implementar escalado de COL_W para vistas de Día (50px), Semana (36px), Mes (12px).
