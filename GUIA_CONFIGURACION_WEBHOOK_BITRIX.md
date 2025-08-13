# 🔧 Guía para Configurar Webhook de Bitrix24 para Subida de Archivos

## 🎯 Problema Identificado

El webhook actual tiene permisos para crear proyectos (`sonet_group.create`) pero necesita permisos adicionales para subir archivos al drive de los proyectos.

## ✅ Solución: Configurar Webhook con Permisos de Disk

### Paso 1: Crear Nuevo Webhook en Bitrix24

1. **Accede a Bitrix24** → Aplicaciones → Webhooks entrantes
2. **Crea un nuevo webhook** con los siguientes permisos:

### 📋 Permisos Requeridos:

**Permisos de Grupos/Proyectos:**
- ✅ `sonet_group.create` (ya lo tienes)
- ✅ `sonet_group.get`
- ✅ `sonet_group.update`

**Permisos de Disk (NUEVOS - CRÍTICOS):**
- ✅ `disk.storage.get`
- ✅ `disk.storage.getlist` 
- ✅ `disk.folder.get`
- ✅ `disk.folder.getchildren`
- ✅ `disk.folder.uploadfile` ⭐ **CLAVE**
- ✅ `disk.storage.uploadfile` ⭐ **CLAVE**
- ✅ `disk.file.get`
- ✅ `disk.file.upload` ⭐ **CLAVE**

### Paso 2: URLs de Configuración

Una vez creado el webhook, tendrás una URL como:
```
https://bajanet.bitrix24.mx/rest/86/[NUEVO_TOKEN]/[METODO].json
```

### Paso 3: Configurar Variables de Entorno

Configura estas variables en tu sistema:

```bash
# Webhook principal (actual - para proyectos)
BITRIX_PROJECTS_WEBHOOK_URL=https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json

# Webhook para archivos (NUEVO - con permisos de disk)
BITRIX_DISK_UPLOAD_WEBHOOK_URL=https://bajanet.bitrix24.mx/rest/86/[NUEVO_TOKEN]/disk.folder.uploadfile.json
```

## 🔄 Alternativa: Usar el Mismo Webhook

Si prefieres usar el mismo webhook, ve a:

1. **Bitrix24** → Aplicaciones → Webhooks entrantes
2. **Edita el webhook existente** (`hwpxu5dr31b6wve3`)
3. **Agrega los permisos de disk** mencionados arriba

## 🧪 Testing de la Configuración

Una vez configurado, el sistema probará automáticamente estos métodos:

1. ✅ **disk.folder.uploadfile** (multipart) - Método preferido
2. ✅ **disk.storage.uploadfile** (multipart) - Backup 1  
3. ✅ **disk.folder.uploadfile** (JSON) - Backup 2

## 📊 Logs de Debugging

Cuando pruebes la volumetría, verás logs como:

```
DEBUG Bitrix: Probando método: disk.folder.uploadfile
DEBUG Bitrix: URL: https://bajanet.bitrix24.mx/rest/86/TOKEN/disk.folder.uploadfile.json
DEBUG Bitrix: Status: 200
SUCCESS Bitrix: Archivo subido con método disk.folder.uploadfile
```

## ⚠️ Problemas Comunes

### Error: "INSUFFICIENT_SCOPE"
- **Causa**: Faltan permisos de disk en el webhook
- **Solución**: Agregar permisos de disk al webhook

### Error: "STORAGE_NOT_FOUND"  
- **Causa**: El proyecto fue creado pero el storage no está disponible aún
- **Solución**: El sistema ya tiene un delay de 5 segundos

### Error: "FILE_UPLOAD_ERROR"
- **Causa**: Formato incorrecto del archivo o tamaño muy grande
- **Solución**: Verificar que el PDF se genere correctamente

## 🎯 URL del Webhook Recomendada

Si creas un webhook dedicado para archivos, usa esta estructura:

```
https://bajanet.bitrix24.mx/rest/86/[NUEVO_TOKEN]/disk.folder.uploadfile.json
```

Y configúrala como:
```bash
export BITRIX_DISK_UPLOAD_WEBHOOK_URL="https://bajanet.bitrix24.mx/rest/86/[NUEVO_TOKEN]/disk.folder.uploadfile.json"
```

## ✅ Verificación Final

Una vez configurado, crea una volumetría de prueba y revisa los logs para confirmar:

```
SUCCESS Bitrix: Archivo subido con método [MÉTODO_QUE_FUNCIONÓ]
```

¡Eso indicará que la subida de archivos está funcionando correctamente! 🎉