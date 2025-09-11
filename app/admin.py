# app/admin.py

from django.contrib import admin
from .models import Cliente, TodoItem, OportunidadProyecto, Volumetria, DetalleVolumetria # Importa TodoItem en lugar de Cotizacion/ItemCotizacion
from django.contrib.auth.models import User # Necesario si usas el modelo User en el admin

# Registra el modelo Cliente en el panel de administración
@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    """
    Configuración para el modelo Cliente en el panel de administración de Django.
    """
    # Campos que se mostrarán en la lista de clientes
    list_display = ('nombre_empresa', 'email', 'telefono', 'categoria', 'get_porcentaje_utilidad', 'asignado_a')
    # Campos por los cuales se puede buscar
    search_fields = ('nombre_empresa', 'email', 'telefono')
    # Campos por los cuales se puede filtrar la lista
    list_filter = ('asignado_a', 'categoria')
    # No hay date_hierarchy para Cliente ya que no tiene campo de fecha_creacion directo
    
    def get_porcentaje_utilidad(self, obj):
        """Muestra el porcentaje de utilidad basado en la categoría"""
        porcentajes = {'A': '15%', 'B': '20%', 'C': '25%'}
        return porcentajes.get(obj.categoria, '25%')
    get_porcentaje_utilidad.short_description = 'Utilidad'

# Registra el modelo TodoItem (Oportunidad de Venta) en el panel de administración
@admin.register(TodoItem)
class TodoItemAdmin(admin.ModelAdmin):
    """
    Configuración para el modelo TodoItem (Oportunidad de Venta) en el panel de administración de Django.
    """
    # Campos que se mostrarán en la lista de oportunidades de venta
    list_display = (
        'oportunidad', 'cliente', 'monto', 'probabilidad_cierre', 
        'mes_cierre', 'get_area_display', 'get_producto_display', 
        'usuario', 'fecha_creacion', 'fecha_actualizacion'
    )
    # Campos por los cuales se puede buscar
    search_fields = (
        'oportunidad', 'contacto', 'cliente__nombre_empresa', 
        'area', 'producto'
    )
    # Campos por los cuales se puede filtrar la lista
    list_filter = (
        'area', 'producto', 'mes_cierre', 'probabilidad_cierre', 
        'cliente', 'usuario'
    )
    # Permite navegar por fechas de creación
    date_hierarchy = 'fecha_creacion'
    
    # Campos de solo lectura (no se pueden editar directamente en el admin)
    readonly_fields = ('fecha_creacion', 'fecha_actualizacion')

    # Sobreescribe el método save_model para asignar automáticamente el usuario creador
    def save_model(self, request, obj, form, change):
        """
        Asigna el usuario que está logueado como 'usuario' (creador)
        al crear una nueva oportunidad de venta.
        """
        if not obj.pk: # Si es una nueva oportunidad (no tiene PK aún)
            obj.usuario = request.user # Asigna el usuario actual
        super().save_model(request, obj, form, change)

    # Puedes añadir un método para mostrar el monto con formato si lo deseas,
    # aunque el filtro 'format_currency_es' se usa en los templates.
    # Para el admin, el list_display ya muestra el campo 'monto' directamente.
    # Si necesitas un formato específico en el admin, podrías hacer algo como:
    # def formatted_monto(self, obj):
    #     return f"${obj.monto:,.2f}" # Formato simple de Python
    # formatted_monto.short_description = "Monto"
    # Y luego usar 'formatted_monto' en list_display en lugar de 'monto'.

# Registra el modelo OportunidadProyecto en el panel de administración
@admin.register(OportunidadProyecto)
class OportunidadProyectoAdmin(admin.ModelAdmin):
    """
    Configuración para el modelo OportunidadProyecto en el panel de administración de Django.
    """
    # Campos que se mostrarán en la lista
    list_display = (
        'oportunidad', 'bitrix_project_id', 'proyecto_nombre', 
        'volumetrias_generadas', 'created_by', 'fecha_creacion'
    )
    # Campos por los cuales se puede buscar
    search_fields = (
        'oportunidad__oportunidad', 'bitrix_project_id', 'proyecto_nombre',
        'oportunidad__cliente__nombre_empresa'
    )
    # Campos por los cuales se puede filtrar la lista
    list_filter = (
        'created_by', 'fecha_creacion', 'volumetrias_generadas'
    )
    # Permite navegar por fechas de creación
    date_hierarchy = 'fecha_creacion'
    
    # Campos de solo lectura
    readonly_fields = ('fecha_creacion', 'fecha_actualizacion')
    
    # Organizacion de campos en el formulario
    fieldsets = (
        ('Información Principal', {
            'fields': ('oportunidad', 'bitrix_project_id', 'proyecto_nombre')
        }),
        ('Detalles del Proyecto', {
            'fields': ('bitrix_deal_id', 'carpeta_volumetrias_id', 'volumetrias_generadas')
        }),
        ('Metadatos', {
            'fields': ('created_by', 'fecha_creacion', 'fecha_actualizacion'),
            'classes': ('collapse',)
        })
    )
    
    def save_model(self, request, obj, form, change):
        """
        Asigna el usuario actual como creador si es un nuevo objeto
        """
        if not obj.pk:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

# Inline para DetalleVolumetria
class DetalleVolumetriaInline(admin.TabularInline):
    model = DetalleVolumetria
    extra = 1
    fields = ('nombre_producto', 'descripcion', 'cantidad', 'precio_unitario', 'precio_proveedor', 'total', 'total_proveedor')

# Registra el modelo Volumetria en el panel de administración
@admin.register(Volumetria)
class VolumetriaAdmin(admin.ModelAdmin):
    """
    Configuración para el modelo Volumetria en el panel de administración de Django.
    """
    inlines = [DetalleVolumetriaInline]
    
    list_display = (
        'titulo', 'cliente', 'oportunidad', 'cantidad_nodos', 
        'total', 'moneda', 'bitrix_project_id', 'created_by', 'fecha_creacion'
    )
    
    search_fields = (
        'titulo', 'cliente__nombre_empresa', 'oportunidad__oportunidad', 
        'elaborado_por', 'bitrix_project_id'
    )
    
    list_filter = (
        'categoria', 'color', 'moneda', 'created_by', 'fecha_creacion'
    )
    
    date_hierarchy = 'fecha_creacion'
    readonly_fields = ('fecha_creacion', 'fecha_actualizacion')
    
    fieldsets = (
        ('Información Principal', {
            'fields': ('titulo', 'cliente', 'usuario_final', 'oportunidad', 'elaborado_por')
        }),
        ('Datos Técnicos', {
            'fields': ('categoria', 'color', 'cantidad_nodos', 'distancia')
        }),
        ('Datos Financieros', {
            'fields': ('subtotal', 'iva_rate', 'iva_amount', 'total', 'moneda')
        }),
        ('Métricas de Rentabilidad', {
            'fields': ('total_costo_proveedor', 'ganancia_total', 'margen_utilidad', 'precio_por_nodo', 'costo_por_nodo'),
            'classes': ('collapse',)
        }),
        ('Integración Bitrix24', {
            'fields': ('bitrix_project_id',),
            'classes': ('collapse',)
        }),
        ('Metadatos', {
            'fields': ('created_by', 'fecha_creacion', 'fecha_actualizacion'),
            'classes': ('collapse',)
        })
    )
    
    def save_model(self, request, obj, form, change):
        """
        Asigna el usuario actual como creador si es un nuevo objeto
        """
        if not obj.pk:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
