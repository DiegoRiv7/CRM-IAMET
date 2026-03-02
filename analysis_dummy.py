
import re
import os

filepath = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/views.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update crm_home to calculate metric_value and label
# We need to find the block after total_facturado calculation (around line 470) and before context.

# Current code calculates total_facturado, then progreso using total_facturado.
# We want to change that.

# Search for the block calculating total_facturado
start_marker = "    # ── Total facturado desde XLS ──"
end_marker = "    context = {"

if start_marker in content and end_marker in content:
    # We will rewrite the logic after total_facturado calculation
    
    # Identify the section where progreso is calculated
    progreso_calc = "    progreso = min(int((total_facturado / meta * 100)) if meta > 0 else 0, 100)"
    
    new_logic = """    # ── Total facturado desde XLS ──
    total_facturado_real = Decimal('0')
    try:
        if mes_filter == 'todos':
            archivos_fact = ArchivoFacturacion.objects.filter(anio=anio_int)
            for af in archivos_fact:
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
        total_facturado_real = Decimal('0')

    # Recalculate context variables for the widget based on tab
    # Note: total_general, total_cotizado, total_cobrado are calculated nearby in the original code, but we need to ensure they are available here.
    # In original code:
    # total_general (CRM sum) is at line 441.
    # total_cobrado is at line 475.
    # total_cotizado is at line 482.
    
    # We need to ensure we use the correct values.
    widget_metric_label = 'Total Facturado'
    widget_metric_value = total_facturado_real
    
    if tab_activo == 'crm':
        widget_metric_label = 'Total Oportunidades'
        widget_metric_value = base_qs.aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t']
    elif tab_activo == 'cotizado':
        widget_metric_label = 'Total Cotizado'
        widget_metric_value = cotizaciones_qs.aggregate(t=Coalesce(Sum('total'), Value(Decimal('0'))))['t'] if 'cotizaciones_qs' in locals() else Decimal('0')
    elif tab_activo == 'cobrado':
        widget_metric_label = 'Total Cobrado'
        widget_metric_value = base_qs.filter(probabilidad_cierre=100).aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t']

    progreso = min(int((widget_metric_value / meta * 100)) if meta > 0 else 0, 100)
    
    # Total facturado variable for context (backward compatibility if needed, or specifically for facturado display if used elsewhere)
    total_facturado = total_facturado_real
"""
    # Replace the block from start_marker to where 'progreso =' was originally
    pattern = r"(    # ── Total facturado desde XLS ──)(.*?)(    progreso = min\(int\(\(total_facturado / meta \* 100\)\) if meta > 0 else 0, 100\))"
    
    # Note: Regex might be tricky with multiple lines.
    # Plan B: Just search and replace the specific variable usage in context and the calculation logic.
    
    pass 

# Actually, let's just make `total_facturado` (variable passed to template) be the DYNAMIC value!
# The template uses `total_facturado` at line 3604. 
# `<div class="facturado-amount" id="facturadoAmount">${{ total_facturado|floatformat:0 }}</div>`
# If I simply assign the correct value to `total_facturado` variable in views.py, the template will show it.
# And I should pass `facturado_label` to template.

# Let's perform a simple replacement of the logic section.

replacement_logic = """    # ── Total facturado desde XLS ──
    total_facturado_real = Decimal('0')
    try:
        if mes_filter == 'todos':
            archivos_fact = ArchivoFacturacion.objects.filter(anio=anio_int)
            for af in archivos_fact:
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
        total_facturado_real = Decimal('0')

    # Widget Logic
    widget_label = 'Total Facturado'
    widget_value = total_facturado_real

    if tab_activo == 'crm':
        widget_label = 'Total Oportunidades'
        widget_value = total_general # Calculated above
    elif tab_activo == 'cotizado':
        widget_label = 'Total Cotizado'
        widget_value = total_cotizado # Calculated below? No, need to check order. 
        # In original code, total_cotizado is calculated AFTER this block (lines 480+).
        # We need to ensure we have the value.
    elif tab_activo == 'cobrado':
        widget_label = 'Total Cobrado'
        widget_value = total_cobrado # Calculated at line 475
    
    # We need to re-order calculations or lazy access.
    # total_general is calculated at line 441.
    # total_cobrado is at line 477.
    # total_cotizado is at line 486.
    
    # This block is at 445.
    
    # So total_general is available. 
    # total_cobrado and cotizado are NOT available yet in the flow.
    
    # I will move this logic block to just before context creation!
"""

# This is getting too complex for string replacement without structure awareness.
# I will use `replace_file_content` targeting the specific problematic block to prepare variables.

pass
