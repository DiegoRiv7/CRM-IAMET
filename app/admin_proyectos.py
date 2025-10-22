# admin_proyectos.py - Configuración adicional para el admin de Django

from django.contrib import admin
from .models import Proyecto, Tarea, ProyectoComentario, TareaComentario

# Registrar los modelos de Proyectos y Tareas
@admin.register(Proyecto)
class ProyectoAdmin(admin.ModelAdmin):
    """
    Configuración para el modelo Proyecto en el panel de administración.
    """
    list_display = (
        'nombre', 'descripcion', 'privacidad', 'creado_por', 
        'fecha_creacion', 'get_miembros_count'
    )
    search_fields = ('nombre', 'descripcion')
    list_filter = ('privacidad', 'creado_por', 'fecha_creacion')
    date_hierarchy = 'fecha_creacion'
    readonly_fields = ('fecha_creacion', 'fecha_actualizacion')
    filter_horizontal = ('miembros',)
    
    fieldsets = (
        ('Información Principal', {
            'fields': ('nombre', 'descripcion', 'privacidad')
        }),
        ('Participantes', {
            'fields': ('creado_por', 'miembros')
        }),
        ('Metadatos', {
            'fields': ('fecha_creacion', 'fecha_actualizacion'),
            'classes': ('collapse',)
        })
    )
    
    def get_miembros_count(self, obj):
        """Muestra el número de miembros del proyecto"""
        return obj.miembros.count()
    get_miembros_count.short_description = 'Miembros'
    
    def save_model(self, request, obj, form, change):
        """Asigna el usuario actual como creador si es un nuevo objeto"""
        if not obj.pk:
            obj.creado_por = request.user
        super().save_model(request, obj, form, change)

@admin.register(Tarea)
class TareaAdmin(admin.ModelAdmin):
    """
    Configuración para el modelo Tarea en el panel de administración.
    """
    list_display = (
        'titulo', 'proyecto', 'estado', 'prioridad', 'creado_por', 
        'asignado_a', 'fecha_limite', 'fecha_creacion'
    )
    search_fields = ('titulo', 'descripcion')
    list_filter = ('estado', 'prioridad', 'proyecto', 'creado_por', 'asignado_a', 'fecha_creacion')
    date_hierarchy = 'fecha_creacion'
    readonly_fields = ('fecha_creacion', 'fecha_actualizacion')
    filter_horizontal = ('participantes',)
    
    fieldsets = (
        ('Información Principal', {
            'fields': ('titulo', 'descripcion', 'proyecto')
        }),
        ('Estado y Prioridad', {
            'fields': ('estado', 'prioridad')
        }),
        ('Asignación', {
            'fields': ('creado_por', 'asignado_a', 'participantes')
        }),
        ('Fechas', {
            'fields': ('fecha_limite', 'fecha_completada')
        }),
        ('Metadatos', {
            'fields': ('fecha_creacion', 'fecha_actualizacion'),
            'classes': ('collapse',)
        })
    )
    
    def save_model(self, request, obj, form, change):
        """Asigna el usuario actual como creador si es un nuevo objeto"""
        if not obj.pk:
            obj.creado_por = request.user
        super().save_model(request, obj, form, change)