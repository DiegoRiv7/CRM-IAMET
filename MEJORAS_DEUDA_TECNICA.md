# Mejoras de Deuda Técnica para CRM IAMET

Este documento detalla las áreas de mejora en el código base del CRM IAMET. Estas mejoras no agregan funcionalidades nuevas, pero son críticas para asegurar la escalabilidad, estabilidad y mantenibilidad del sistema a largo plazo.

## 1. Modularización del Frontend (JavaScript y CSS)

Actualmente, el sistema depende de archivos monolíticos muy grandes que concentran demasiada lógica.

**Problema:**
- `crm_main.js` tiene cerca de 5,000 líneas.
- `crm.css` tiene más de 4,200 líneas.
- Templates como `_widget_calendario.html` tienen más de 2,000 líneas mezclando HTML, CSS y JS.

**Solución propuesta:**
- **Separación por dominio:** Dividir `crm_main.js` en módulos más pequeños (ej. `crm_oportunidades.js`, `crm_cotizaciones.js`, `crm_ui.js`).
- **Extraer JS de los templates:** Mover todo el código `<script>` dentro de los widgets HTML a sus respectivos archivos `.js` (como ya se hizo correctamente con `crm_mail.js`).
- **Uso de módulos ES6:** Si es posible, implementar importaciones nativas de JS para manejar dependencias entre scripts.

## 2. Implementación de Pruebas Automatizadas (Testing)

El sistema maneja datos críticos de ventas, facturación y cotizaciones, pero carece de una suite de pruebas automatizadas.

**Problema:**
- No hay archivos `tests.py` implementados.
- Cualquier refactorización o cambio en los modelos/vistas tiene un alto riesgo de romper funcionalidades existentes (regresiones).

**Solución propuesta:**
- **Tests de Modelos:** Verificar que los cálculos de totales en cotizaciones y volumetrías sean siempre correctos.
- **Tests de Vistas/APIs:** Asegurar que los endpoints devuelvan los códigos de estado correctos (200, 400, 403, 404) según los permisos del usuario.
- **Tests de Integración:** Simular flujos completos como "Crear oportunidad -> Generar cotización -> Marcar como ganada".

## 3. Limpieza de Modelos y Helpers

Existen métodos en los modelos que contienen lógica temporal o duplicada.

**Problema:**
- El método `get_avance_porcentaje()` en el modelo `Proyecto` devuelve un número aleatorio (`random.randint(20, 95)`).
- El método o propiedad `tamaño_formateado` / `tamaño_legible` está duplicado en los modelos `ArchivoProyecto`, `ArchivoOportunidad` y `MailAdjunto`.

**Solución propuesta:**
- **Centralizar lógica:** Crear un archivo `utils.py` genérico o usar un Mixin para funciones compartidas como el formateo de bytes.
- **Implementar lógica real:** Reemplazar los valores aleatorios con cálculos reales basados en el estado de las tareas del proyecto.

## 4. Auditoría de Seguridad y Permisos en APIs

La división de vistas es buena, pero la validación de permisos puede ser inconsistente.

**Problema:**
- Algunas vistas API podrían no estar validando correctamente si el usuario que hace la petición tiene permisos para ver o modificar ese recurso específico (ej. verificar que un usuario no pueda editar una tarea de un proyecto al que no pertenece).

**Solución propuesta:**
- Revisar todos los endpoints en `views_api.py`, `views_proyectos.py` y `views_crm.py`.
- Asegurar el uso consistente de decoradores como `@login_required` y la validación a nivel de objeto (`get_object_or_404(Modelo, id=id, usuario=request.user)` o validaciones de pertenencia a grupos/proyectos).

## 5. Optimización de Consultas a la Base de Datos

Conforme crezca la base de datos, algunas vistas podrían volverse lentas.

**Problema:**
- Problemas potenciales de consultas "N+1" al cargar listas de oportunidades con sus clientes, contactos y tareas asociadas.

**Solución propuesta:**
- Revisar las consultas principales (especialmente `api_crm_table_data` y las vistas de reportes) y asegurar el uso adecuado de `select_related()` y `prefetch_related()` en Django ORM.

---

**Nota para el desarrollador (Claude):**
Te sugiero abordar estas mejoras una por una en ramas separadas, comenzando por la extracción de JS de los templates y la creación de tests básicos para los modelos financieros.
