# Guion de la demostración — CRM multiempresa

Instancia de ensayo (pruebas): **https://demo.82-223-44-29.nip.io/app/login/**
Empresa ficticia: **Aceros del Norte** (slug `demo`). Datos sembrados con `manage.py seed_demo`.

| Usuario | Contraseña | Rol | Úsalo para |
|---|---|---|---|
| `laura.mendoza` | `Demo2026*` | Vendedora | Todo el recorrido del vendedor (Mi día, correo, pipeline, cotización) |
| `gerardo.ruiz` | `Demo2026*` | Supervisor | Panel de Administración → Empresa, Catálogos, Usuarios, Metas |
| `admin@acerosdelnorte.com` | (en `.env.demo`) | Superusuario | Solo respaldo |

> Al entrar aparece el recordatorio de jornada ("Iniciar mi día"). Pulsa **Iniciar mi día**
> o **Recordarme más tarde**.

## 0. El cliente crea su propia empresa (3 min)
Portal: **https://portal.82-223-44-29.nip.io/** (panel interno en `/panel`, usuario `iamet`,
contraseña en `/home/iamet2026/crm-empresas/portal.env`).
- El cliente abre **Crear mi empresa**, llena nombre, responsable, correo y contraseña. La
  página de su solicitud muestra los 4 pasos.
- Tú, en `/panel`, ves la solicitud **pendiente** y pulsas **Aprobar** (o dejas encendida la
  *aprobación automática* para que se cree sola). En ~80 s la página del cliente cambia a
  **¡Tu CRM está listo!** con el botón **Entrar a mi CRM**.
- Entra con su correo y contraseña: su CRM vacío, con su nombre. En Administración → Empresa
  sube su logo. Después, **Entrar a mi CRM** en el portal lo lleva a su instancia escribiendo
  su nombre o su correo.
- Al terminar la reunión: panel → **Baja + borrar** (se respalda antes).

## 1. Entrar como Laura (2 min)
- Pantalla de acceso con la marca de la empresa: "IAMET · Aceros del Norte", correo de ejemplo `@acerosdelnorte.com`.
- Al entrar salta el aviso de **Mi día**: "Jorge Salas te escribió sobre Suministro de perfiles IPR Q4" con resumen de la IA y botones Abrir correo / Agendar.

## 2. Mi día: el asistente (4 min)
- Botón **Mi día** (abajo a la izquierda). Muestra "Buenos días, Laura", las 6 oportunidades prioritarias con la *jugada de hoy* y, a la derecha, el feed: 5 correos importantes y 2 oportunidades sin avance.
- Tarjeta **"Factura / orden recibida"** (Ana Torres, OC-7731): pulsa **Actualizar oportunidad** → la IA propone etapa, probabilidad y seguimiento; se aplica solo si Laura aprueba.
- Tarjeta de Patricia Núñez (solicitud de cotización de racks): **Crear oportunidad** desde el correo.
- Abajo: "Pídele algo al asistente…" → pedir, por ejemplo, "mis oportunidades vencidas en Excel".

## 3. CRM: pipeline y oportunidades (4 min)
- Pestaña **Oportunidades**: 7 del mes con valor, producto, etapa y próxima actividad. Cambiar el mes arriba a la derecha para ver octubre.
- Menú ☰ → vista **Tabla**: una columna por producto (Producto, Servicio, Software, Proyecto), "Otros" y Total.
- Abrir **Suministro de perfiles IPR Q4**: expediente, conversación interna, correos ligados (Jorge Salas), cotización COT-2026-101, botón **PDF** con los datos de Aceros del Norte y su logo.
- Pestaña **Prospección**: kanban de prospectos por etapa.

## 4. Correo, calendario y tareas (3 min)
- **Correo**: bandeja con los 6 correos; los ligados a una oportunidad llevan su chip azul. Responder a Jorge Salas desde aquí dispara "Respondiste — ¿actualizo la oportunidad?".
- **Calendario**: reuniones y llamadas de la semana ligadas a oportunidades; filtro por vendedor.
- **Tareas / Proyectos**: 6 tareas y 2 proyectos con oportunidades ligadas.

## 5. Entrar como Gerardo: la empresa se administra sola (3 min)
- Ícono **Administración** → **Empresa · Datos y módulos**: nombre, razón social, correos, colores, logo (botón *Elegir logo…*) y los interruptores de módulos. Apagar "Muro" y mostrar que desaparece del menú.
- **Catálogos**: agregar un producto (por ejemplo `INSTALACION` / "Instalación", marcar Columna) y volver a la tabla del CRM: aparece la columna nueva.
- **Usuarios** y **Metas**: alta de vendedores y metas mensuales.

## 6. Alta en vivo desde la terminal (alternativa al portal)
En el servidor, con el nombre del cliente:
```bash
ssh root@82.223.44.29
cd /home/iamet2026/crm-producto
scripts/nueva_empresa.sh <slug> --nombre "<Nombre de la empresa>" --correo ventas@<dominio> \
    --admin-email <correo del administrador> --https
```
Tiempo medido: **66 s** desde cero (incluye las 237 migraciones). Al terminar imprime la
URL (`https://<slug>.82-223-44-29.nip.io/app/login/` mientras no haya dominio propio),
el administrador y la contraseña. Entrar, ir a Administración → Empresa, subir el logo:
el CRM del cliente está listo. Para retirarla después de la reunión:
```bash
scripts/baja_empresa.sh <slug> --purge --si
```

## Reiniciar la demo entre presentaciones
```bash
docker exec crm-demo-web python manage.py seed_demo --reset
```
Vuelve a sembrar todo (borra lo que se haya tocado durante la demo). El logo y los datos de
la empresa (Administración → Empresa) se conservan.

## Checklist "cero IAMET" (verificado 2026-09-14)
- Login, home, todas las pestañas, Mi día, correo, calendario, prospección, reportes, PDF de
  cotización y expediente: sin logo, nombre ni correos de IAMET (solo el prefijo de producto "IAMET ·").
- Módulos de IAMET apagados: Chat Web, Leads Web, Tienda, Marketing Hub, Ideas, navidad, fondo
  mundial, modo Instalaciones del calendario. Sus rutas devuelven 404.
- Presets de correo (mail.iamet.mx / Baja-Net) y nombre "IAMET AI" solo en la instancia de IAMET.
- Consola del navegador limpia (solo falta `/favicon.ico` en la raíz, sin efecto).
