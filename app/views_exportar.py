from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from .models import TodoItem, Cliente
from django.contrib import messages
import unicodedata

# --- Helpers ---
def normaliza(texto):
    return ''.join(c for c in unicodedata.normalize('NFD', texto)
                   if unicodedata.category(c) != 'Mn').upper().strip()

def split_flexible(linea):
    if '\t' in linea:
        return [col.strip() for col in linea.split('\t')]
    return [col.strip() for col in linea.split()]

@login_required
def importar_oportunidades(request):
    from django.contrib import messages
    clientes = Cliente.objects.all()
    exitos = []
    errores = []
    if request.method == 'POST':
        cliente_id = request.POST.get('cliente')
        tabla_json = request.POST.get('tabla_json')
        if not cliente_id or not tabla_json:
            errores.append('Selecciona un cliente y asegúrate de que la tabla no esté vacía.')
        else:
            try:
                cliente_obj = Cliente.objects.get(id=cliente_id)
            except Cliente.DoesNotExist:
                errores.append('Cliente no encontrado.')
                cliente_obj = None
            import json
            try:
                filas = json.loads(tabla_json)
            except Exception as e:
                errores.append('Error al leer los datos de la tabla.')
                filas = []
            # Encabezados fijos de la tabla
            encabezados = [
                'OPORTUNIDAD','AREA','CONTACTO','ZEBRA','PANDUIT','APC','AVIGILON','GENETEC','AXIS','Desarrollo APP','RUNRATE','POLIZA','CISCO','ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'
            ]
            from .models import TodoItem
            from django.contrib.auth.models import User
            user = request.user
            for idx, fila in enumerate(filas, start=1):
                try:
                    data = dict(zip(encabezados, fila))
                    oportunidad = data.get('OPORTUNIDAD','').strip()
                    area = data.get('AREA','').strip()
                    contacto = data.get('CONTACTO','').strip()
                    producto = ''
                    monto = 0
                    mes_cierre = ''
                    probabilidad = 0
                    # Buscar monto (columna producto) y mes/probabilidad
                    # Productos
                    productos_cols = ['ZEBRA','PANDUIT','APC','AVIGILON','GENETEC','AXIS','Desarrollo APP','RUNRATE','POLIZA','CISCO']
                    meses_cols = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
                    # Detectar producto y monto
                    for prod in productos_cols:
                        val = data.get(prod,'').replace('$','').replace(',','').strip()
                        if val:
                            try:
                                monto = float(val)
                                producto = prod.upper().replace(' ','_')
                                break
                            except:
                                pass
                    # Detectar mes y probabilidad
                    for i, mes in enumerate(meses_cols, start=1):
                        val = data.get(mes,'').strip()
                        if val:
                            if '%' in val:
                                try:
                                    probabilidad = int(val.replace('%','').strip())
                                except:
                                    probabilidad = 0
                            mes_cierre = str(i).zfill(2)
                            break
                    # Validaciones mínimas
                    if not oportunidad or not producto or not monto or not mes_cierre:
                        errores.append(f"Fila {idx}: Faltan datos obligatorios (oportunidad, producto, monto o mes de cierre)")
                        continue
                    item = TodoItem(
                        oportunidad=oportunidad,
                        area=area,
                        contacto=contacto,
                        producto=producto,
                        monto=monto,
                        mes_cierre=mes_cierre,
                        probabilidad_cierre=probabilidad,
                        cliente=cliente_obj,
                        usuario=user
                    )
                    item.save()
                    exitos.append(f"Fila {idx}: Oportunidad '{oportunidad}' importada")
                except Exception as e:
                    errores.append(f"Fila {idx}: Error inesperado - {str(e)}")
        if exitos and not errores:
            messages.success(request, f"Se importaron {len(exitos)} oportunidades correctamente.")
        if errores:
            messages.error(request, f"Errores en la importación: {'; '.join(errores)}")
    return render(request, 'importar_oportunidades.html', {'clientes': clientes})

@login_required
def exportar_oportunidades(request):
    clientes = Cliente.objects.all()
    errores = []
    exitos = []
    if request.method == 'POST':
        cliente_id = request.POST.get('cliente')
        datos = request.POST.get('datos')
        if not cliente_id or not datos:
            errores.append('Selecciona un cliente y pega los datos.')
        else:
            try:
                cliente_obj = Cliente.objects.get(id=cliente_id)
            except Cliente.DoesNotExist:
                errores.append('Cliente no encontrado.')
                cliente_obj = None
            if cliente_obj:
                filas = [f for f in datos.strip().split('\n') if f.strip()]
                if not filas:
                    errores.append('No hay datos para importar.')
                else:
                    encabezados = split_flexible(filas[0])
                    for i, fila in enumerate(filas[1:], start=2):
                        fila_datos = split_flexible(fila)
                        try:
                            nombre = fila_datos[0] if len(fila_datos) > 0 else ''
                            area = fila_datos[1] if len(fila_datos) > 1 else ''
                            contacto = fila_datos[2] if len(fila_datos) > 2 else ''
                            producto = ''
                            monto = 0
                            mes = ''
                            probabilidad = 0
                            # Detección flexible de campos
                            for idx, val in enumerate(fila_datos):
                                vnorm = normaliza(val)
                                if 'MXN' in vnorm or '$' in vnorm or vnorm.replace('.','',1).isdigit():
                                    try:
                                        monto = float(val.replace('$','').replace(',',''))
                                    except:
                                        pass
                                elif '%' in vnorm:
                                    try:
                                        probabilidad = int(val.replace('%','').strip())
                                    except:
                                        pass
                                elif any(m in vnorm for m in ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']):
                                    mes = val
                                elif not producto and idx >= 3:
                                    producto = val
                            nombre_corto = nombre[:255] if nombre else ''
                            TodoItem.objects.create(
                                oportunidad=nombre_corto,
                                area=area,
                                contacto=contacto,
                                producto=producto,
                                monto=monto,
                                mes_cierre=mes,
                                probabilidad_cierre=probabilidad,
                                usuario=request.user,
                                cliente=cliente_obj
                            )
                            exitos.append(f'Fila {i}: Oportunidad "{nombre_corto}" importada')
                        except Exception as e:
                            errores.append(f'Error en fila {i}: {str(e)} | Valores: {fila_datos}')
    return render(request, 'exportar.html', {'clientes': clientes, 'errores': errores, 'exitos': exitos})
