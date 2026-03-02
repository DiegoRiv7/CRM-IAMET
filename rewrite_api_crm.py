
import re
import os

filepath = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/views.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Define the start of the function and the end (before next function)
start_def = "def api_crm_table_data(request):"
end_def = "return JsonResponse({'tab': tab_activo, 'rows': [], 'footer': {'left': '', 'right': ''}})"

# We'll replace the entire function body.
# Note: Indentation is 4 spaces for function body.

new_function_body = """def api_crm_table_data(request):
    \"\"\"
    API endpoint que devuelve los datos de la tabla CRM en JSON
    para actualizar sin recargar la página.
    \"\"\"
    from datetime import datetime
    user = request.user
    profile, _ = UserProfile.objects.get_or_create(user=user)

    now = datetime.now()
    mes_filter = request.GET.get('mes', str(now.month).zfill(2))
    anio_filter = request.GET.get('anio', str(now.year))
    tab_activo = request.GET.get('tab', 'crm')

    MES_CODE_TO_NAME = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
        '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
        '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
    }

    try:
        anio_int = int(anio_filter)
    except ValueError:
        anio_int = now.year

    mes_nombre_db = MES_CODE_TO_NAME.get(mes_filter, mes_filter)

    # Supervisor / Vendedor logic
    es_supervisor = is_supervisor(user)
    vendedores_filter = request.GET.get('vendedores', '')
    vendedores_ids = [int(x) for x in vendedores_filter.split(',') if x.strip().isdigit()] if vendedores_filter else []

    base_qs = TodoItem.objects.select_related('cliente', 'usuario', 'contacto', 'usuario__userprofile').filter(
        fecha_creacion__year=anio_int
    )
    if mes_filter != 'todos':
        try:
            mes_int = int(mes_filter)
            base_qs = base_qs.filter(fecha_creacion__month=mes_int)
        except (ValueError, TypeError):
            pass

    if not es_supervisor:
        base_qs = base_qs.filter(usuario=user)
    elif vendedores_ids:
        base_qs = base_qs.filter(usuario_id__in=vendedores_ids)

    def format_money(val):
        if val is None:
            return '0'
        try:
            return '{:,.0f}'.format(val)
        except (ValueError, TypeError):
            return '0'

    # ── 1. Calculate Meta (Dynamic based on tab) ──
    meta_field_api = 'meta_mensual'
    if tab_activo == 'crm': meta_field_api = 'meta_oportunidades'
    elif tab_activo == 'cotizado': meta_field_api = 'meta_cotizado'
    elif tab_activo == 'cobrado': meta_field_api = 'meta_cobrado'
    
    if es_supervisor:
        if vendedores_ids:
            api_meta = UserProfile.objects.filter(user_id__in=vendedores_ids).aggregate(
                t=Coalesce(Sum(meta_field_api), Value(Decimal('0')))
            )['t'] or Decimal('0')
            if api_meta == 0: api_meta = Decimal('4500000')
        else:
             # Sum dynamic metrics for all sellers
            all_sellers_profiles = UserProfile.objects.filter(user__is_active=True).exclude(user__groups__name='Supervisores')
            api_meta = all_sellers_profiles.aggregate(t=Coalesce(Sum(meta_field_api), Value(Decimal('0'))))['t'] or Decimal('0')
            if api_meta == 0: api_meta = Decimal('4500000')
    else:
        api_meta = getattr(profile, meta_field_api, Decimal('0')) or Decimal('0')
        if api_meta == 0 and meta_field_api == 'meta_mensual':
            api_meta = Decimal('1500000')

    # Si "Todos" los meses, meta anual
    if mes_filter == 'todos':
        api_meta = api_meta * 12

    # ── 2. Calculate Total Facturado (Common) ──
    total_facturado_real = Decimal('0')
    try:
        if mes_filter == 'todos':
            for af in ArchivoFacturacion.objects.filter(anio=anio_int):
                if es_supervisor and not vendedores_ids:
                    total_facturado_real += af.total_facturado
                elif es_supervisor and vendedores_ids:
                    fm = calcular_facturado_por_vendedor(af.datos_json)
                    total_facturado_real += sum(Decimal(str(v)) for uid, v in fm.items() if uid in vendedores_ids)
                else:
                    fm = calcular_facturado_por_vendedor(af.datos_json)
                    total_facturado_real += Decimal(str(fm.get(user.id, 0)))
        else:
            archivo_fact = ArchivoFacturacion.objects.get(mes=mes_filter, anio=anio_int)
            if es_supervisor and not vendedores_ids:
                total_facturado_real = archivo_fact.total_facturado
            elif es_supervisor and vendedores_ids:
                facturado_map = calcular_facturado_por_vendedor(archivo_fact.datos_json)
                total_facturado_real = sum(Decimal(str(v)) for uid, v in facturado_map.items() if uid in vendedores_ids)
            else:
                facturado_map = calcular_facturado_por_vendedor(archivo_fact.datos_json)
                total_facturado_real = Decimal(str(facturado_map.get(user.id, 0)))
    except ArchivoFacturacion.DoesNotExist:
        pass

    # ── 3. Logic per Tab ──
    widget_metric = total_facturado_real
    widget_label = 'Total Facturado'

    if tab_activo == 'crm':
        items = base_qs.select_related('cliente', 'contacto', 'usuario').order_by('-fecha_actualizacion')
        rows = []
        for item in items:
            rows.append({
                'id': item.id,
                'oportunidad': (item.oportunidad or '')[:35],
                'cliente': (item.cliente.nombre_empresa if item.cliente else '- Sin Cliente -')[:35],
                'cliente_id': item.cliente.id if item.cliente else None,
                'contacto': (item.contacto.nombre[:18] if item.contacto else '-'),
                'area': item.area or '-',
                'producto': item.producto or '',
                'monto': format_money(item.monto),
            })
        
        total_general = base_qs.aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t']
        num_clientes = base_qs.values('cliente').distinct().count()
        num_deals = base_qs.count()
        
        widget_metric = total_general
        widget_label = 'Total Oportunidades'

        api_progreso = min(int((widget_metric / api_meta * 100)) if api_meta > 0 else 0, 100)

        return JsonResponse({
            'tab': 'crm',
            'rows': rows,
            'footer': {
                'left': f'{num_clientes} clientes / {num_deals} Deals',
                'right': f'Total: ${format_money(total_general)}',
            },
            'total_facturado': format_money(widget_metric), # Reusing key logic for chart/widget
            'widget_label': widget_label,
            'meta': format_money(api_meta),
            'progreso': api_progreso,
        })

    elif tab_activo == 'cotizado':
        opp_ids = base_qs.values_list('id', flat=True)
        cotizaciones_qs = (
            Cotizacion.objects
            .select_related('oportunidad', 'created_by', 'cliente')
            .filter(
                Q(oportunidad_id__in=opp_ids) |
                Q(oportunidad__isnull=True, fecha_creacion__year=anio_int)
            )
            .order_by('-fecha_creacion')
        )
        rows = []
        for cot in cotizaciones_qs:
            rows.append({
                'id': cot.id,
                'oportunidad': (cot.oportunidad.oportunidad if cot.oportunidad else '—')[:35],
                'oportunidad_id': cot.oportunidad.id if cot.oportunidad else None,
                'cliente': (cot.cliente.nombre_empresa if cot.cliente else '- Sin Cliente -')[:35],
                'cliente_id': cot.cliente.id if cot.cliente else None,
                'usuario': (cot.created_by.get_full_name() or cot.created_by.username) if cot.created_by else '—',
                'subtotal': format_money(cot.subtotal),
                'total': format_money(cot.total),
                'pdf_url': f'/app/cotizacion/view/{cot.id}/',
            })
        num_cotizaciones = cotizaciones_qs.count()
        num_oportunidades_cotizadas = cotizaciones_qs.exclude(oportunidad__isnull=True).values('oportunidad').distinct().count()
        total_cotizado = cotizaciones_qs.aggregate(t=Coalesce(Sum('total'), Value(Decimal('0'))))['t']
        
        widget_metric = total_cotizado
        widget_label = 'Total Cotizado'
        api_progreso = min(int((widget_metric / api_meta * 100)) if api_meta > 0 else 0, 100)
        
        return JsonResponse({
            'tab': 'cotizado',
            'rows': rows,
            'footer': {
                'left': f'{num_oportunidades_cotizadas} oportunidades / {num_cotizaciones} cotizaciones',
                'right': f'Total cotizado: ${format_money(total_cotizado)}',
            },
            'total_facturado': format_money(widget_metric),
            'widget_label': widget_label,
            'meta': format_money(api_meta),
            'progreso': api_progreso,
        })

    elif tab_activo == 'cobrado':
        items = base_qs.filter(probabilidad_cierre=100).order_by('-monto')
        rows = []
        for op in items:
            rows.append({
                'id': op.id,
                'oportunidad': (op.oportunidad or '')[:35],
                'cliente': (op.cliente.nombre_empresa if op.cliente else '- Sin Cliente -')[:35],
                'cliente_id': op.cliente.id if op.cliente else None,
                'producto_display': op.get_producto_display(),
                'usuario': (op.usuario.get_full_name() or op.usuario.username) if op.usuario else '—',
                'fecha': op.fecha_creacion.strftime('%d %b %Y'),
                'monto': format_money(op.monto),
            })
        total_cobrado = items.aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t']
        num_deals = items.count()
        
        widget_metric = total_cobrado
        widget_label = 'Total Cobrado'
        api_progreso = min(int((widget_metric / api_meta * 100)) if api_meta > 0 else 0, 100)

        return JsonResponse({
            'tab': 'cobrado',
            'rows': rows,
            'footer': {
                'left': f'{num_deals} Deals Cobrados',
                'right': f'Total cobrado: ${format_money(total_cobrado)}',
            },
            'total_facturado': format_money(widget_metric),
            'widget_label': widget_label,
            'meta': format_money(api_meta),
            'progreso': api_progreso,
        })

    elif tab_activo == 'facturado':
        # Reutilizamos la lógica del view principal para facturación
        facturado_por_cliente_obj = {}
        try:
            if mes_filter == 'todos':
                for af in ArchivoFacturacion.objects.filter(anio=anio_int):
                    data_af = af.datos_json.get('datos', {})
                    for c_name, val in data_af.items():
                        facturado_por_cliente_obj[c_name] = facturado_por_cliente_obj.get(c_name, Decimal('0')) + Decimal(str(val))
            else:
                af = ArchivoFacturacion.objects.get(mes=mes_filter, anio=anio_int)
                data_af = af.datos_json.get('datos', {})
                for c_name, val in data_af.items():
                    facturado_por_cliente_obj[c_name] = Decimal(str(val))
        except ArchivoFacturacion.DoesNotExist:
            pass

        # Mapear nombres a IDs de clientes
        fact_by_id = {}
        for name, monto in facturado_por_cliente_obj.items():
            cliente = Cliente.objects.filter(nombre_empresa__icontains=name).first()
            if cliente:
                fact_by_id[cliente.id] = fact_by_id.get(cliente.id, Decimal('0')) + monto

        # Desglose prod
        prod_data = base_qs.filter(monto_facturacion__gt=0).values('cliente').annotate(
            zebra=Coalesce(Sum('monto_facturacion', filter=Q(producto='ZEBRA')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            panduit=Coalesce(Sum('monto_facturacion', filter=Q(producto='PANDUIT')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            apc=Coalesce(Sum('monto_facturacion', filter=Q(producto='APC')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            avigilon=Coalesce(Sum('monto_facturacion', filter=Q(producto='AVIGILON') | Q(producto='AVIGILION')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            genetec=Coalesce(Sum('monto_facturacion', filter=Q(producto='GENETEC')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            axis=Coalesce(Sum('monto_facturacion', filter=Q(producto='AXIS')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            software=Coalesce(Sum('monto_facturacion', filter=Q(producto='SOFTWARE') | Q(producto='Desarrollo')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            runrate=Coalesce(Sum('monto_facturacion', filter=Q(producto='RUNRATE')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            poliza=Coalesce(Sum('monto_facturacion', filter=Q(producto='PÓLIZA') | Q(producto='POLIZA')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            total_prod=Coalesce(Sum('monto_facturacion'), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
        )
        prod_dict = {item['cliente']: item for item in prod_data}

        if es_supervisor:
            clientes_qs = Cliente.objects.filter(asignado_a_id__in=vendedores_ids) if vendedores_ids else Cliente.objects.all()
        else:
            clientes_qs = Cliente.objects.filter(asignado_a=user)

        rows = []
        total_facturado_acum = Decimal('0')
        for c in clientes_qs.order_by('nombre_empresa'):
            p = prod_dict.get(c.id, {})
            fact = fact_by_id.get(c.id, Decimal('0'))
            meta_c = c.meta_mensual or Decimal('0')
            rows.append({
                'cliente_id': c.id,
                'cliente': c.nombre_empresa[:35],
                'zebra': format_money(p.get('zebra')),
                'panduit': format_money(p.get('panduit')),
                'apc': format_money(p.get('apc')),
                'avigilon': format_money(p.get('avigilon')),
                'genetec': format_money(p.get('genetec')),
                'axis': format_money(p.get('axis')),
                'software': format_money(p.get('software')),
                'runrate': format_money(p.get('runrate')),
                'poliza': format_money(p.get('poliza')),
                'otros': format_money(p.get('total_prod', Decimal('0')) - sum(p.get(k, 0) for k in ['zebra','panduit','apc','avigilon','genetec','axis','software','runrate','poliza'] if k in p)),
                'total': format_money(fact),
                'meta_cliente': format_money(meta_c),
                'meta_restante': format_money(meta_c - fact),
            })
            total_facturado_acum += fact

        widget_metric = total_facturado_acum
        widget_label = 'Total Facturado'
        api_progreso = min(int((widget_metric / api_meta * 100)) if api_meta > 0 else 0, 100)

        return JsonResponse({
            'tab': 'facturado',
            'rows': rows,
            'footer': {
                'left': f'{clientes_qs.count()} clientes',
                'right': f'Total facturado: ${format_money(total_facturado_acum)}',
            },
            'total_facturado': format_money(widget_metric),
            'widget_label': widget_label,
            'meta': format_money(api_meta),
            'progreso': api_progreso,
        })

    return JsonResponse({'tab': tab_activo, 'rows': [], 'footer': {'left': '', 'right': ''}})"""

# We'll use regex to replace the function.
# But regex matching a whole function body including nested loops is impossible with .*.
# I will use Python's readliness and index matching.

# Locate start line and end line.
lines = content.splitlines()
start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.strip() == "def api_crm_table_data(request):":
        start_idx = i
    if start_idx != -1 and "def api_subir_facturacion(request):" in line:
        end_idx = i # The previous line is the end (minus annotations possibly)
        # Look back for @login_required or similar?
        # api_subir_facturacion has decorators.
        break

if start_idx != -1 and end_idx != -1:
    # Adjust end_idx to exclude the decorators of next function
    for j in range(end_idx, start_idx, -1):
        if lines[j].strip().startswith('@'):
            end_idx = j
        elif lines[j].strip() != '':
             pass
        else:
            # Empty line
             pass

    # Now replace lines[start_idx:end_idx] with new_function_body
    # We must ensure new_function_body is just the code, no decorators (assume decorator is there).
    # Actually, let's keep the decorator in the file and only replace the def ...
    
    # Wait, the tool 'replace_file_content' is better if I can target start and end.
    pass

# I'll output the script to do this precise replacement.
# I will search for "def api_crm_table_data" and "def api_subir_facturacion" using the tool, then replace whatever is between.

