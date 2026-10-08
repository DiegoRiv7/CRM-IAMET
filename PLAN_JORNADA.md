# PLAN — TimeSure: Registro Electrónico de Jornada ("checadas")

**Fecha:** 2026-10-08 · **Estado:** Fase 1 HECHA y desplegada (https://timesure.82-223-44-29.nip.io); sigue Fase 2 (núcleo RH)
**Para:** IAMET (su CRM) y el cliente nuevo (instancia multiempresa) · **Trabajo en `pruebas`, nunca prod sin orden**
**Documento del cliente:** `~/Downloads/Registro_Electronico_Jornada_2027.pdf` (spec funcional genérica, v1.0 28/09/2026)

> Esto ya no es "que le funcione al cliente": si el registro falla o se puede manipular, el patrón
> incumple la ley. El núcleo de evidencia se construye primero, se prueba con sabotaje deliberado y
> solo después se le ponen pantallas.

---

## 1. Base legal (verificada 2026-10-07)

- Reforma a la LFT publicada en el DOF el **1 de mayo de 2026**. Art. 132 fracc. XXXIV: el patrón
  debe llevar un **registro electrónico de inicio y término de la jornada de cada trabajador**,
  conservarlo y exhibirlo a la autoridad. El registro **pactado con el trabajador hace prueba plena**.
- Exigible desde el **1 de enero de 2027**. Multa 250–5,000 UMA (art. 994 fracc. IV Bis).
- Jornada ordinaria semanal: **46 h (2027), 44 (2028), 42 (2029), 40 (2030)**. Horas extra: máx.
  9/10/11/12 por semana según año, 4 h/día y 4 días/semana, pago 100 %, excedente 200 %.
- La STPS debe emitir disposiciones técnicas antes de 2027; **no publicadas a la fecha** → toda regla
  regulatoria es parámetro con vigencia, nunca constante en código.
- Biometría = dato sensible (LFPDPPP 2025): consentimiento expreso por escrito, aviso de privacidad
  específico, alternativa no biométrica obligatoria.
- Conservación: controles de asistencia durante la relación y después de terminada (art. 804 LFT);
  retención configurable, mínimo 2 años, bloqueo de borrado dentro del plazo.
- Integridad de mensajes de datos / fecha cierta: NOM-151-SCFI-2016 (constancia de conservación por
  PSC acreditado, ~23 MXN por constancia) como complemento opcional.

## 2. Enfoque: híbrido

**Ley** (mínimo innegociable) + **lo valioso del documento del cliente** (marca capturada ≠ válida,
intentos rechazados conservados, corrección por capas con motivo, vigencias en configuración,
cierres de periodo, horas extra detectadas vs autorizadas, expediente de inspección) + **lo nuestro**
(integración con "Mi día", calendario como contexto de campo, PWA offline de levantamientos, avisos
del asistente al supervisor, copia verificable al trabajador, marca de la empresa en el expediente).

**Fuera por ahora** (extensiones bajo demanda): reloj físico, biometría con plantillas, geocercas
poligonales, multi zona horaria fina, SaaS/planes (ya lo resuelve el multiempresa), conectores
específicos de nómina (CONTPAQi, NOMIPAQ, Aspel NOI) sobre un formato neutro de incidencias.

## 3. Núcleo de evidencia (Punto 1) — DISEÑO CERRADO

### 3.1 El libro de evidencia
Una sola bitácora de **solo inserción por empresa** (`rh_libro`), donde entra TODO lo que afecta una
jornada: marcas, correcciones, solicitudes de incidencia, aprobaciones/rechazos, cambios de horario,
tolerancia o geocerca, consentimientos, accesos/exportaciones de evidencia, cierres y reaperturas.
Lo que no está en el libro no existe; lo que está no cambia.

Cada entrada: `seq` (consecutivo por empresa, sin huecos), `uuid`, `tipo`, `trabajador_id`
(inmutable), `ts_captura` (reloj del dispositivo, cuando aplica), `ts_servidor` (NTP), `actor`
(usuario o dispositivo), `origen` (web/pwa/quiosco/api), `contexto` (ip, user agent, dispositivo
registrado, lat/lon/precisión si hay), `datos` (JSON canónico del evento), `ref_seq` (entrada a la
que corrige o resuelve), `estado` (válida/rechazada/pendiente/excepción/anulada), `hash_prev`,
`hash`, `version_hash`.

### 3.2 Inmutabilidad impuesta por la base, no por el código
- El usuario MySQL de la instancia recibe **INSERT y SELECT** sobre `rh_libro` (y las tablas de
  evidencia), **sin UPDATE ni DELETE**. Aunque exista un bug o un botón, MySQL lo rechaza.
- En Django: modelo sin `save()` para actualizar (solo `create`), `delete()` deshabilitado, y los
  `Meta.default_permissions` reducidos. Las correcciones son entradas nuevas con `ref_seq` y motivo
  obligatorio; la original permanece consultable.
- Trabajadores, centros y horarios **nunca se borran**: se dan de baja con vigencia.

### 3.3 Cadena de huellas
- `hash = SHA-256(version_hash | seq | uuid | tipo | trabajador_id | ts_captura | ts_servidor |
  actor | origen | contexto_canónico | datos_canónico | ref_seq | estado | hash_prev)`.
- **Serialización canónica** (JSON con claves ordenadas, sin espacios, UTF-8, fechas ISO-8601 en UTC
  con milisegundos, decimales como texto) documentada y **versionada** (`version_hash`), para que un
  verificador externo reproduzca la huella años después aunque el código cambie.
- **Serialización de la cadena (obligatoria):** la inserción toma un bloqueo en la cabeza del libro
  (`SELECT ... FOR UPDATE` sobre `rh_libro_cabeza` por empresa, dentro de la transacción) y asigna
  `seq` y `hash_prev` de forma estrictamente secuencial. Dos marcas en el mismo segundo (cambio de
  turno) no pueden bifurcar la cadena. Prueba de carga concurrente incluida en la Fase 2.
- Cualquier alteración de una fila rompe todas las huellas posteriores; cualquier borrado deja hueco
  en `seq`. El verificador señala ambas cosas.

### 3.4 Dos sellos de tiempo
`ts_captura` (lo que dijo el dispositivo, incluso offline) y `ts_servidor` (hora NTP del servidor al
recibir). Diferencia mayor a un umbral configurable → la marca queda en excepción, nunca se "corrige"
la hora. **El servidor debe sincronizar por NTP y quedar vigilado** (verificación en la instalación).

### 3.5 Configuración como evidencia
Horarios, turnos, tolerancias, geocercas, parámetros regulatorios (tabla 2027–2030) y políticas se
**versionan con fecha de vigencia** y cada cambio entra al libro. Todo cálculo usa la regla vigente
en la fecha del evento. Cambiar hoy una tolerancia no mueve ni un retardo de ayer.

### 3.6 Consentimiento como evidencia
El acuerdo con el trabajador (lo que hace que el registro sea prueba plena) y el aviso de privacidad
se aceptan dentro del sistema y entran al libro con la **versión exacta del texto**, fecha, hora,
dispositivo e IP. Sin consentimiento vigente el sistema avisa y lo pide. El texto final lo revisa un
abogado laboral antes de enero (pendiente del usuario).

### 3.7 Segregación y accesos
Quien solicita no aprueba (política configurable de doble control). Ver, exportar o imprimir
evidencia ajena entra al libro con actor y hora.

### 3.8 Cierres y anclas externas
- **Cierre de periodo** (semanal o quincenal por empresa): entra al libro con la huella raíz del
  periodo (hash de la última entrada incluida). Reapertura solo con permiso especial, y también entra
  al libro.
- **Copia al trabajador:** al cierre, cada trabajador recibe (y puede descargar cuando quiera) su
  reporte con su huella y un QR para verificarlo. Si el patrón alterara algo, la copia no coincide.
- **Depósito externo inmutable:** el expediente del cierre (PDF + JSON) y su huella se copian a un
  almacenamiento en la nube con bloqueo de escritura (WORM) fuera del servidor, con retención
  configurable; nadie, ni nosotros, puede modificar ni borrar antes del plazo. Es también el respaldo
  externo que faltaba. Para los clientes, nuestro VPS ya es custodia independiente (el patrón no tiene
  acceso al servidor); el depósito protege contra desastre y contra nosotros.
- **NOM-151 opcional:** conector configurable por empresa para pedir constancia de conservación sobre
  la huella de cada cierre (sello oficial de fecha cierta). IAMET como patrón y cualquier cliente lo
  encienden si lo quieren.
- Detección de retroceso: si la base se restaura a un respaldo viejo, el consecutivo y el depósito
  externo (cierres que ya no existen) lo delatan.

### 3.9 Expediente y verificación
- **Formato propio, abierto:** PDF con la marca de la empresa + JSON/CSV con cada entrada del libro
  del periodo (seq, uuid, sellos, origen, contexto, estado, hash, hash_prev), correcciones como
  eventos aparte, cierre con huella raíz y, si existe, folio de constancia. Identificadores y fechas
  intactos (trazabilidad).
- **Verificador** en el CRM (accesible a inspector/juzgado con el archivo en mano): recorre la cadena,
  compara con la huella del cierre y con el depósito externo, y dice íntegro / alterado / incompleto.
- **Prueba de sabotaje incluida en la entrega:** alterar una fila a propósito y mostrar que el
  verificador la señala. Se repite en cada despliegue.
- Nómina: formato neutro de incidencias del periodo + exportación genérica CSV; adaptadores
  específicos (CONTPAQi, NOMIPAQ, NOI) bajo demanda. El registro no depende de ninguno.

### 3.10 Lo que el software no resuelve
- Que un compañero cheque por otro (buddy punching): se mitiga con identidad reforzada (3.11) y se
  vuelve visible con detección de anomalías; la sanción es del reglamento interior, no del sistema.
- Que el patrón simplemente no use el sistema: el tablero muestra jornadas esperadas sin marcas.
- La validez jurídica final del consentimiento y del expediente la firma un abogado laboral.

### 3.11 Identidad del que marca (propuesta, por confirmar con el usuario)
Niveles configurables por empresa, de menor a mayor:
1. **Básico:** usuario y contraseña del CRM. Solo evidencia de IP/dispositivo.
2. **Reforzado (default recomendado):** dispositivo registrado. El teléfono o navegador del trabajador
   se registra una vez con una llave propia (WebAuthn/passkey: la huella o la cara se verifican en el
   propio teléfono, nosotros NO guardamos biométricos) y cada marca va firmada por ese dispositivo.
   Máx. 2 dispositivos por persona; alta y reposición de dispositivo aprobadas por RH y anotadas en
   el libro. Geolocalización en campo.
3. **Estricto:** reforzado + foto al marcar en quiosco (evidencia, no reconocimiento) o lector
   biométrico con consentimiento LFPDPPP completo.
- **IP:** nunca como candado (cambia, NAT, celulares); sí como evidencia y como señal de "centro
  autorizado" (red de la oficina).
- **Detección de anomalías** en todos los niveles: mismo dispositivo marcando por varias personas,
  marcas de distintas personas con segundos de diferencia desde el mismo origen, viajes imposibles,
  patrones de retardo justo en la tolerancia. Van a revisión del supervisor, nunca se descartan solas.

## 3.12 Ubicación y personal en campo
- Lugares válidos para una persona en un momento: centros de trabajo con geocerca circular; sitios de
  clientes (coordenada + radio sobre la dirección que ya tiene el CRM); **la agenda** (visita,
  levantamiento o instalación en el calendario autoriza ese sitio en esa ventana sin configurar
  nada); sitios temporales autorizados por el supervisor por fecha/proyecto; domicilio para
  modalidad remota.
- Marca fuera de lugar autorizado → se guarda con causa, estado **excepción**, aviso inmediato al
  trabajador y tarjeta al supervisor en Mi día; no abre ni cierra jornada hasta resolverse.
  Evento opcional "inicio de ruta": evidencia sin abrir jornada (si la empresa paga traslado, lo
  configura).
- GPS falso: rechazar/excepcionar ubicaciones de simulador (flag del dispositivo), coherencia
  precisión/red, viajes imposibles entre marcas, cruce con la última visita del calendario.
  **Prueba fuerte para campo: QR o NFC fijo en el sitio del cliente** (marcar = escanear; opción de
  Fase 2). Fotos de evidencia de levantamientos respaldan la visita.
- El trabajador ve ANTES de marcar si está en sitio válido y qué pasará con su marca.

## 3.13 Matriz de escenarios (todos entran al mismo libro y al mismo motor)

| # | Escenario | Canal | Trato |
|---|---|---|---|
| 1 | Oficina, desde el CRM en la computadora | Web ("Iniciar mi día") | Válida si la IP/red o la geocerca de la oficina coincide; si no, excepción |
| 2 | Teléfono en oficina, planta o cliente autorizado | PWA | Válida por geocerca/agenda; con dispositivo registrado |
| 3 | Teléfono fuera de sitio autorizado (casa, tránsito, cine) | PWA | Excepción con causa; supervisor resuelve |
| 4 | Teléfono sin señal (planta, campo) | PWA offline | Hora original conservada, sincroniza después, hora de sincronización aparte; anomalías de reloj a revisión |
| 5 | Sitio de cliente con QR/NFC fijo | PWA + escaneo | Válida con prueba de presencia física |
| 6 | Checador físico (huella, tarjeta, rostro) | Reloj → API o archivo | Marcas entran con dispositivo y centro; lotes tardíos marcados; biometría bajo LFPDPPP |
| 7 | Quiosco compartido en planta (tablet/PC) | Quiosco + PIN + foto | Para quien no tiene teléfono o cuenta; dispositivo registrado al centro |
| 8 | Personal sin cuenta en el CRM ni teléfono | Quiosco o reloj físico | Trabajador existe en RH sin usuario; PIN |
| 9 | Home office / remoto (NOM-037) | Web o PWA | Domicilio como sitio autorizado para esa modalidad |
| 10 | Comisión o viaje fuera de la ciudad | PWA | Autorización temporal de ubicación o "sin validación de ubicación" por periodo, aprobada y anotada |
| 11 | Dos o más centros en un día | PWA / quiosco | Secuencia válida entre sitios; jornada continua |
| 12 | Descansos / comida | Cualquiera | Eventos inicio/fin de descanso; política decide si computa |
| 13 | Turno nocturno que cruza medianoche, rotaciones, guardias | Cualquiera | Jornada asignada al turno vigente, no partida por fecha |
| 14 | Entrada sin salida / salida sin entrada / doble entrada | Cualquiera | Incidencia de omisión o secuencia; jornada incompleta hasta corrección aprobada |
| 15 | Día sin marcas | — | Falta detectada salvo incidencia aprobada (vacaciones, incapacidad, permiso, festivo, comisión) |
| 16 | Marca muy temprana o salida muy tarde | Cualquiera | Tolerancias; tiempo extra detectado, no truncado; alerta preventiva |
| 17 | Supervisor o RH marca a nombre de alguien (teléfono muerto, olvido) | Web | NUNCA como marca normal: solicitud/corrección con motivo, aprobación segregada, entra al libro |
| 18 | Otro sistema envía marcas (integración) | API con token | Fase 5; mismo evento, mismo motor |

Pendiente del usuario: qué escenarios aplican a IAMET y cuáles al cliente nuevo; con eso se decide
qué canales entran en la Fase 2 (web + PWA + quiosco) y cuáles van a la 5 (reloj físico, API).

## 3.14 Perfiles de marcación (configuración, no código por cliente)
El motor cubre los 18 escenarios; cada empresa activa lo que usa mediante **perfiles** asignados a
cada trabajador (con vigencia). Se entregan 4 perfiles universales listos; la empresa los ajusta o
crea otros desde Administración → RH, sin desarrollo:

| Perfil | Canales | Ubicación | Offline | Identidad |
|---|---|---|---|---|
| **Oficina** | Web (Iniciar mi día) y PWA | Geocerca del centro o red de la oficina | No necesario | Reforzado |
| **Campo** | PWA (+ QR/NFC en sitio opcional) | Centros + clientes + agenda + sitios temporales | **Sí, obligatorio** | Reforzado + geolocalización |
| **Planta / sin teléfono** | Quiosco con PIN y foto (o reloj físico cuando exista) | Dispositivo fijo = centro | Sí (cola local en el quiosco) | PIN + foto |
| **Remoto** | Web y PWA | Domicilio autorizado (NOM-037) | No necesario | Reforzado |

Cada perfil define: canales permitidos, si exige ubicación y qué pasa sin ella (rechazo o excepción),
tolerancias de retardo, si computan descansos, nivel de identidad, y si permite inicio de ruta.
Un trabajador puede cambiar de perfil con fecha de vigencia (el cálculo usa el vigente ese día).

## 3.15 Offline (fundamental, Fase 2)
- La PWA guarda la marca localmente con `uuid`, `ts_captura`, ubicación si la obtuvo y el canal, la
  muestra como "pendiente de sincronizar" y la envía al recuperar red. El servidor pone
  `ts_servidor`, valida geocerca/secuencia al recibirla y marca anomalías de reloj (diferencia
  captura/sincronización mayor al umbral) o lotes tardíos. El `uuid` evita duplicados al reintentar.
- Base: `lev_offline.js` de levantamientos (cola local + sincronización) ya probado en campo.
- Requisitos: PWA instalada en el teléfono (HTTPS, service worker), dispositivo registrado antes de
  salir a campo. El quiosco también tiene cola local por si se cae la red de la planta.
- La marca offline nunca se "corrige" al sincronizar: ambas horas quedan en el libro.

## 4. Base existente en el CRM (se reutiliza)
`AsistenciaJornada` (Iniciar mi día / pausar / terminar, `api/jornada/*`, widget
`_widget_recordatorio_entrada.html`; 170 jornadas de 10 usuarios al mes en prod) → se convierte en
la marca legal. `EficienciaMensual` / empleado del mes se alimentan de jornadas válidas. PWA offline
de levantamientos (`lev_offline.js`) → base de la marcación móvil sin datos. `EmpresaConfig`,
módulos por bandera y multiempresa → el módulo nace multiempresa sin trabajo extra.

## 5. Fases

| Fase | Entregable | Días |
|---|---|---|
| 1 Núcleo | Centros de trabajo, horarios/turnos con vigencia, tipos de incidencia, parámetros regulatorios 2027–2030 con vigencia, dispositivos/quioscos, consentimiento y aviso, sección RH en Administración, módulo `rh` por bandera | 3 |
| 2 Evidencia y marcación | **Libro de evidencia primero** (permisos MySQL, cadena serializada, huellas canónicas versionadas, dos sellos, prueba de concurrencia y de sabotaje); luego captura web (Iniciar mi día), **PWA móvil con offline obligatorio**, quiosco con PIN y foto, QR/NFC en sitio; 4 perfiles universales; motor de validación (secuencia, duplicados, horario, dispositivo, geocerca circular) con intentos rechazados conservados; identidad reforzada | 5 |
| 3 Jornada e incidencias | Cálculo diario/semanal con la tabla por año, retardos, faltas, omisiones, descansos, horas extra detectadas vs autorizadas (sin truncar salidas), solicitudes con adjuntos, aprobación con segregación, correcciones por capas con motivo, avisos en Mi día | 4 |
| 4 Control, expediente y custodia | Cierres y reaperturas, reportes por trabajador/centro/excepciones/auditoría, expediente PDF+JSON con marca de la empresa, verificador, copia al trabajador con QR, depósito externo inmutable, tablero de cumplimiento, exportación neutra de incidencias, bitácora de accesos | 4 |
| 5 Bajo demanda | Conectores de nómina, constancia NOM-151, reloj físico, biometría, geocercas polígono, multi zona horaria | según cliente |

Total fases 1–4: **16 días hábiles**, con margen antes del 1 de enero de 2027.

## 6. Decisiones del usuario (2026-10-08)

1. **Nómina / integridad:** no depender de ningún sistema de nómina ni entregar un Excel manipulable.
   Capas 1 y 3 completas; capa 2 = copia al trabajador + depósito externo inmutable; NOM-151 opcional.
   Nómina = formato neutro + adaptadores bajo demanda.
2. **Quién checa: TODOS.** Sin excepciones por puesto; directivos y jefes también. Consecuencia: el
   catálogo de trabajadores de RH es independiente de las cuentas del CRM (un trabajador puede
   existir sin usuario; para quiosco usa PIN; si tiene cuenta, se liga). El quiosco con PIN + foto
   entra en la Fase 2.
3. **Canales: 100 % digital y en la nube**, solo computadora, tablet y teléfono (web, PWA, quiosco en
   tablet). Sin relojes físicos ahora; el sistema queda **abierto a integraciones con terceros y
   dispositivos físicos** mediante el canal de integración (API con token, mismo evento, mismo
   motor; el contrato del evento se publica desde la Fase 2 aunque el conector se construya en la 5).
   No hay datos históricos que importar.
4. **Roles: libertad para que cada empresa (IAMET incluida) cree sus roles** de RH/aprobación desde
   Administración (ver equipo, aprobar incidencias, aprobar horas extra, cerrar periodo, exportar
   expediente, configurar horarios/perfiles, auditar). **Límites duros que ningún rol puede saltar:**
   todos checan, nadie modifica ni borra el libro (ni el jefe, ni el dueño, ni nosotros desde la
   app), toda corrección es solicitud + aprobación de otra persona (doble control siempre activo;
   cada empresa necesita al menos dos aprobadores), y toda acción de un rol entra al libro.
5. Pendiente: abogado laboral para el consentimiento y el expediente; proveedor del depósito externo;
   registrar dominios timesure.mx / .com.mx; registro de marca mixta en el IMPI; logotipo y lema.

## 6b. Arquitectura: PRODUCTO INDEPENDIENTE (decisión 2026-10-08)

El checador es el **primer módulo separado del CRM**: repositorio propio, base propia, despliegue
propio, dirección propia. Vendible solo; conectable al CRM; quitable sin dejar rastro. Objetivo
declarado por el usuario: trabajar por módulos independientes que se conectan al CRM, para poder
quitarlos (cliente que solo quiere CRM) o ponerlos después, y vender el checador por separado.
Quien no tiene cuenta en el CRM no la necesita: cuenta o PIN del checador.

- **Multitenant desde la primera línea:** una sola aplicación y una sola base para todas las empresas,
  con `empresa` como columna obligatoria en toda tabla (modelo base `TenantModel` + manager que filtra
  siempre + middleware que resuelve la empresa por sesión/subdominio + pruebas automáticas de
  aislamiento). Alta de empresa en segundos, demos gratis, un solo despliegue. Lo que protege la
  evidencia no cambia: libro de solo inserción con permisos MySQL (INSERT/SELECT sin UPDATE/DELETE),
  **una cadena de huellas por empresa**, exportación completa por empresa en formato abierto. Si un
  cliente grande exige instancia propia, el mismo código corre solo con una variable.
- **Stack:** Django 5 + MySQL 8 (base `checador` en el motor compartido `crm-mysql`, usuario propio con
  grants por tabla), Gunicorn, Docker Compose, nginx del host + Let's Encrypt, PWA con service worker
  (offline), WebAuthn/passkeys para dispositivo registrado. Mismo lenguaje y estilo visual del CRM.
- **Integración con el CRM (opcional, ambas direcciones, por API con token por empresa):**
  CRM → checador: entrada única (SSO por token, mismo esquema del portal), sitios de clientes y
  visitas del calendario para geocercas, alta automática de trabajadores desde usuarios.
  Checador → CRM: "Iniciar mi día" llama al checador; jornadas válidas alimentan eficiencia y empleado
  del mes; tarjetas en Mi día (solicitudes, horas extra, excepciones). El contrato del evento de marca
  se publica desde la Fase 2 (también sirve para dispositivos físicos y terceros en la Fase 5).
- **Infraestructura (VPS 82, verificado 2026-10-08):** 2.5 GB de RAM libres, 172 GB de disco, carga
  baja, NTP sincronizado, docker 29 / compose 5. El checador necesita ~400 MB (web + worker de
  cierres/notificaciones). Puertos locales libres a partir de 8020. Reusar el portal para el alta.
- **Nombre: TimeSure** (decisión del usuario 2026-10-08). Una sola palabra, dos mayúsculas; sin
  sufijos ("MX", "Pro") ni deformar la escritura. Repo `timesure`; base `timesure`; dirección de
  pruebas `timesure.82-223-44-29.nip.io` hasta tener dominio.
  Verificado: no existe producto de software con ese nombre; `timesure.mx`, `timesure.com.mx`,
  `.app` e `.io` LIBRES (registrar .mx y .com.mx esta semana); `timesure.com` registrado en 2002,
  sin sitio y con vencimiento pasado (2026-08-05): vigilar por si cae.
  **Marca:** registrar en el IMPI como marca MIXTA (nombre + logotipo con elemento propio) antes del
  lanzamiento; búsqueda previa en MARCANET; nombre descriptivo = protección "débil" en texto puro,
  por eso el logo y la marca mixta. Lema en español bajo el logo: "Registro de jornada con prueba"
  (o "Tu jornada, con evidencia"). "by IAMET" opcional como respaldo en portada y contratos, nunca
  en el nombre.

## 5b. Fases reordenadas (producto independiente)

| Fase | Entregable | Días |
|---|---|---|
| 1 Infraestructura y andamiaje | Repo `timesure`, proyecto Django multitenant (TenantModel, manager, middleware, pruebas de aislamiento), base en crm-mysql con grants, Docker/compose, vhost + HTTPS, CI de deploy, estilo visual portado, acceso (cuenta/PIN, passkeys, SSO desde el CRM), alta de empresa desde el portal, contrato de integración | 2–3 |
| 2 Núcleo RH | Empresas, centros, horarios/turnos con vigencia, trabajadores (sin cuenta CRM), perfiles de marcación, tipos de incidencia, parámetros regulatorios 2027–2030, roles configurables con límites duros, consentimiento | 3 |
| 3 Evidencia y marcación | Libro primero (cadena serializada, huellas canónicas versionadas, dos sellos, pruebas de concurrencia y sabotaje); web, PWA offline obligatorio, quiosco PIN+foto, QR/NFC; motor de validación; dispositivo registrado | 5 |
| 4 Jornada e incidencias | Cálculo por año, retardos, faltas, omisiones, descansos, horas extra detectadas vs autorizadas, solicitudes, aprobación segregada, correcciones por capas | 4 |
| 5 Control, expediente y custodia | Cierres, reportes, expediente PDF+JSON, verificador, copia al trabajador con QR, depósito externo inmutable, tablero, exportación neutra | 4 |
| 6 Integración con el CRM | Iniciar mi día, calendario/clientes, eficiencia, tarjetas en Mi día | 1–2 |
| 7 Bajo demanda | Conectores de nómina, NOM-151, relojes físicos vía API, biometría, geocercas polígono | según cliente |

Total fases 1–6: **19 a 21 días hábiles**.

## 5c. Fase 1 — HECHA 2026-10-08

Repo privado `github.com/DiegoRiv7/timesure` (rama `main`; el VPS lo lee con deploy key de solo
lectura). Django 5.2 multitenant por columna, seguro por defecto: `TenantManager` exige empresa
(consulta sin empresa = error), `objects.todas()` explícito, `TenantModel` asigna/valida empresa,
middleware fija la empresa del usuario. 14 pruebas automáticas (aislamiento, acceso con límite de
intentos, SSO de un solo uso) corren en la imagen antes de cada despliegue. Usuario propio por
correo; empresa nula = staff global; roles base por empresa. SSO desde el CRM por token firmado
(secreto por empresa, 90 s, un solo uso). Contrato del evento de marca en
`docs/CONTRATO_EVENTO.md`. Identidad TimeSure (acceso de dos paneles, barra lateral, isotipo).
Despliegue: imagen `timesure:<sha>` sin root, contenedor `timesure-web` en 127.0.0.1:8020 sobre
`crm-mysql` (base `timesure`; `u_timesure_migra` con DDL, `u_timesure` sin DDL y con permisos por
tabla vía `deploy/grants.sh`, listo para dejar el libro en solo inserción), nginx con HSTS,
nosniff, X-Frame DENY y límite de intentos en /entrar/, Let's Encrypt. `deploy/instalar.sh`,
`deploy/deploy.sh` (pull → build → pruebas → up → grants → salud; no despliega si fallan las
pruebas). Consumo: ~90 MB. Verificado en vivo: salud, cabeceras, login/logout en navegador,
u_timesure no puede crear tablas. Empresa `iamet` creada con admin jafet.rivera@iamet.mx; staff
global staff@timesure.mx. Credenciales en la Mac: `~/.iamet-deploy/timesure_creds.txt`.
Pendiente de Fase 1: passkeys (dispositivo registrado) se construyen en la Fase 3 con la marcación.

## 8. Fase final — Endurecimiento del servidor (ANTES de salir a producción con TimeSure)
Plan de la auditoría del 2026-09-29, pospuesto por decisión del usuario hasta terminar el producto:
SSH solo con llave (apagar contraseña y root por contraseña; confirmar primero quién entra con
contraseña), reinicio para aplicar kernel y parches de seguridad, TLS 1.2+ en nginx.conf, HSTS y
cabeceras en todos los vhosts, nginx sin versión, `/admin` y `/_admin/` restringidos por IP, límite
de peticiones en login y API de todos los sitios, respaldos fuera del servidor (bucket WORM, el
mismo de la custodia de TimeSure), retirar vhosts/certificados de dominios muertos (nethive),
monitoreo y avisos de caída. Ninguno cambia la arquitectura; son horas de mantenimiento.

## 7. Principios de trabajo
Primero el libro y su verificador, con pruebas de sabotaje y de concurrencia; nada de pantallas
hasta que eso pase. Reglas regulatorias como parámetros con vigencia. Todo en `pruebas`; merge a
producción solo con orden explícita. El otro agente puede estar en `pruebas`: commits solo de
archivos propios.
