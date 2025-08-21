# app/models.py

from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from decimal import Decimal # Importa Decimal para manejar números con precisión
from django.db.models.signals import post_save
from django.dispatch import receiver

class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    bitrix_user_id = models.IntegerField(blank=True, null=True, verbose_name="ID de Usuario en Bitrix24")

    def __str__(self):
        return f"Perfil de {self.user.username}"

@receiver(post_save, sender=User)
def create_or_update_user_profile(sender, instance, created, **kwargs):
    UserProfile.objects.get_or_create(user=instance)

class PendingFileUpload(models.Model):
    """
    Modelo para manejar archivos pendientes de subir al drive de proyectos de Bitrix24
    """
    UPLOAD_PENDING = 'pending'
    UPLOAD_IN_PROGRESS = 'in_progress'  
    UPLOAD_SUCCESS = 'success'
    UPLOAD_FAILED = 'failed'
    
    UPLOAD_STATUS_CHOICES = [
        (UPLOAD_PENDING, 'Pendiente'),
        (UPLOAD_IN_PROGRESS, 'En Progreso'),
        (UPLOAD_SUCCESS, 'Exitoso'),
        (UPLOAD_FAILED, 'Falló'),
    ]
    
    project_id = models.CharField(max_length=100, verbose_name="ID del Proyecto en Bitrix24")
    filename = models.CharField(max_length=200, verbose_name="Nombre del Archivo")
    file_content = models.BinaryField(verbose_name="Contenido del Archivo")
    file_size = models.IntegerField(verbose_name="Tamaño del Archivo (bytes)")
    
    status = models.CharField(
        max_length=20,
        choices=UPLOAD_STATUS_CHOICES,
        default=UPLOAD_PENDING,
        verbose_name="Estado de la Subida"
    )
    
    attempts = models.IntegerField(default=0, verbose_name="Intentos de Subida")
    max_attempts = models.IntegerField(default=3, verbose_name="Máximo de Intentos")
    
    error_message = models.TextField(blank=True, null=True, verbose_name="Mensaje de Error")
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Creación")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Última Actualización")
    completed_at = models.DateTimeField(blank=True, null=True, verbose_name="Fecha de Finalización")
    
    # Información adicional
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Creado por")
    oportunidad_id = models.CharField(max_length=100, blank=True, null=True, verbose_name="ID de la Oportunidad")
    
    def __str__(self):
        return f"{self.filename} - Proyecto {self.project_id} ({self.status})"
    
    class Meta:
        verbose_name = "Archivo Pendiente de Subir"
        verbose_name_plural = "Archivos Pendientes de Subir"
        ordering = ['-created_at']

class Cliente(models.Model):
    """
    Modelo para representar un cliente en la base de datos.
    """
    nombre_empresa = models.CharField(max_length=200, verbose_name="Nombre de la Empresa")
    contacto_principal = models.CharField(max_length=200, blank=True, null=True, verbose_name="Contacto Principal")
    telefono = models.CharField(max_length=20, blank=True, null=True, verbose_name="Teléfono")
    email = models.EmailField(blank=True, null=True, verbose_name="Email")
    direccion = models.CharField(max_length=255, blank=True, null=True, verbose_name="Dirección")
    bitrix_company_id = models.IntegerField(unique=True, null=True, blank=True, verbose_name="ID de Compañía en Bitrix24")
    # Relación con el modelo User de Django para asignar un cliente a un usuario
    asignado_a = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='clientes_asignados', verbose_name="Asignado a")
    fecha_creacion = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Creación")
    fecha_actualizacion = models.DateTimeField(auto_now=True, verbose_name="Última Actualización")

    def __str__(self):
        """
        Representación en cadena del objeto Cliente.
        """
        return self.nombre_empresa

    class Meta:
        """
        Metadatos del modelo Cliente.
        """
        verbose_name = "Cliente"
        verbose_name_plural = "Clientes"
        ordering = ['nombre_empresa'] # Ordena los clientes por nombre de empresa por defecto

class TodoItem(models.Model):
    """
    Modelo para representar una oportunidad de venta.
    """
    # Opciones para el campo 'area'
    AREA_CHOICES = [
        ('SISTEMAS', 'Sistemas'),
        ('Recursos Humanos', 'Recursos Humanos'),
        ('Compras', 'Compras'),
        ('Seguridad', 'Seguridad'),
        ('Mantenimiento', 'Mantenimiento'),
        ('Almacén', 'Almacén'),
    ]

    # Opciones para el campo 'producto'
    PRODUCTO_CHOICES = [
        ('ZEBRA', 'ZEBRA'),
        ('PANDUIT', 'PANDUIT'),
        ('APC', 'APC'),
        ('AVIGILION', 'AVIGILION'),
        ('GENETEC', 'GENETEC'),
        ('AXIS', 'AXIS'),
        ('SOFTWARE', 'SOFTWARE'),
        ('RUNRATE', 'RUNRATE'),
        ('PÓLIZA', 'PÓLIZA'),
        ('CISCO', 'CISCO'),
        ('SERVICIO', 'Servicio'),
    ]

    # Opciones para el campo 'mes_cierre'
    MES_CHOICES = [
        ('01', 'Enero'), ('02', 'Febrero'), ('03', 'Marzo'), ('04', 'Abril'),
        ('05', 'Mayo'), ('06', 'Junio'), ('07', 'Julio'), ('08', 'Agosto'),
        ('09', 'Septiembre'), ('10', 'Octubre'), ('11', 'Noviembre'), ('12', 'Diciembre'),
    ]

    # 'usuario' es el campo que vincula la oportunidad con el usuario que la creó/posee
    usuario = models.ForeignKey(User, on_delete=models.CASCADE, related_name='oportunidades')
    oportunidad = models.CharField(max_length=200, verbose_name="Oportunidad de Venta")
    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='oportunidades', verbose_name="Cliente")
    contacto = models.ForeignKey(
        'Contacto', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='oportunidades', 
        verbose_name="Contacto del Cliente"
    )
    producto = models.CharField(max_length=100, choices=PRODUCTO_CHOICES, verbose_name="Producto / Servicio", default='ZEBRA')
    monto = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Monto de la Oportunidad", default=Decimal('0.00'))
    probabilidad_cierre = models.IntegerField(verbose_name="Probabilidad de Cierre (%)", default=5)
    mes_cierre = models.CharField(max_length=50, choices=MES_CHOICES, verbose_name="Mes de Cierre Esperado", default='01')
    area = models.CharField(max_length=50, choices=AREA_CHOICES, verbose_name="Área")
    comentarios = models.TextField(blank=True, null=True, verbose_name="Comentarios")
    bitrix_deal_id = models.IntegerField(blank=True, null=True, verbose_name="ID de Oportunidad en Bitrix24")
    bitrix_company_id = models.IntegerField(blank=True, null=True, verbose_name="ID de Compañía en Bitrix24")
    bitrix_stage_id = models.CharField(max_length=50, blank=True, null=True, verbose_name="ID de Etapa en Bitrix24")
    fecha_creacion = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Creación")
    fecha_actualizacion = models.DateTimeField(auto_now=True, verbose_name="Última Actualización")

    class Meta:
        """
        Metadatos del modelo TodoItem.
        """
        verbose_name = "Oportunidad de Venta"
        verbose_name_plural = "Oportunidades de Venta"
        ordering = ['-fecha_creacion'] # Ordena por fecha de creación descendente

    def __str__(self):
        """
        Representación en cadena del objeto TodoItem.
        """
        return self.oportunidad

class Contacto(models.Model):
    nombre = models.CharField(max_length=100, verbose_name="Nombre del Contacto")
    apellido = models.CharField(max_length=100, blank=True, null=True, verbose_name="Apellido del Contacto")
    bitrix_contact_id = models.IntegerField(unique=True, null=True, blank=True, verbose_name="ID de Contacto en Bitrix24")
    company_id = models.IntegerField(null=True, blank=True, verbose_name="ID de Compañía en Bitrix24") # To link with Bitrix Company
    cliente = models.ForeignKey(Cliente, on_delete=models.SET_NULL, null=True, blank=True, related_name='contactos', verbose_name="Cliente Asociado")
    fecha_creacion = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Creación")
    fecha_actualizacion = models.DateTimeField(auto_now=True, verbose_name="Última Actualización")

    def __str__(self):
        return f"{self.nombre} {self.apellido or ''}".strip()

    class Meta:
        verbose_name = "Contacto"
        verbose_name_plural = "Contactos"
        ordering = ['nombre', 'apellido']

class Cotizacion(models.Model):
    """
    Modelo para representar una cotización.
    Relacionada con un Cliente y contiene los totales.
    """
    # Opciones para el tipo de cotización (Bajanet o Iamet)
    TIPO_COTIZACION_CHOICES = [
        ('Bajanet', 'Bajanet'),
        ('Iamet', 'Iamet'),
    ]
    
    titulo = models.CharField(max_length=255, default="Cotización", verbose_name="Título de la Cotización")
    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='cotizaciones', verbose_name="Cliente")
    usuario_final = models.CharField(max_length=255, blank=True, null=True, verbose_name="Nombre del Usuario Final")
    oportunidad = models.ForeignKey(TodoItem, on_delete=models.SET_NULL, null=True, blank=True, related_name='cotizaciones', verbose_name="Oportunidad de Venta") # NUEVO CAMPO
    bitrix_deal_id = models.CharField(max_length=255, blank=True, null=True, verbose_name="Bitrix Deal ID")
    fecha_creacion = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Creación")

    # Nuevo campo para la descripción general de la cotización
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción General de la Cotización")
    # Nuevo campo para un nombre específico para el PDF (opcional, si quieres que sea diferente al título)
    nombre_cotizacion = models.CharField(max_length=255, blank=True, null=True, verbose_name="Nombre para el PDF de la Cotización")

    # Campos para los totales de la cotización
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Subtotal")
    iva_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.16'), verbose_name="Tasa de IVA") # Ej. 0.16 para 16%
    iva_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Monto de IVA")
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Total")
    moneda = models.CharField(max_length=5, default='USD', verbose_name="Moneda") # Ej. MXN, USD

    # Campo para el tipo de cotización
    tipo_cotizacion = models.CharField(
        max_length=10,
        choices=TIPO_COTIZACION_CHOICES,
        default='Bajanet', # Valor por defecto
        verbose_name="Tipo de Cotización"
    )

    # Campo para controlar la visibilidad de la columna de descuento
    descuento_visible = models.BooleanField(default=True, verbose_name="Mostrar Columna de Descuento")

    # Campo para comentarios adicionales de la cotización
    comentarios = models.TextField(blank=True, null=True, verbose_name="Comentarios Adicionales", help_text="Comentarios que aparecerán en el PDF de la cotización")

    # Usuario que creó la cotización
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Creado por")

    class Meta:
        """
        Metadatos del modelo Cotizacion.
        """
        verbose_name = "Cotización"
        verbose_name_plural = "Cotizaciones"
        ordering = ['-fecha_creacion'] # Ordena por fecha de creación descendente

    def __str__(self):
        """
        Representación en cadena del objeto Cotizacion.
        """
        return f"Cotización: {self.titulo} para {self.cliente.nombre_empresa} (ID: {self.id})"

class DetalleCotizacion(models.Model):
    """
    Modelo para representar cada línea de producto/servicio dentro de una cotización.
    """
    MARCA_CHOICES = [
        ('ZEBRA', 'ZEBRA'),
        ('PANDUIT', 'PANDUIT'),
        ('APC', 'APC'),
        ('AVIGILION', 'AVIGILION'),
        ('GENETEC', 'GENETEC'),
        ('AXIS', 'AXIS'),
        ('CISCO', 'CISCO'),
    ]

    cotizacion = models.ForeignKey(Cotizacion, on_delete=models.CASCADE, related_name='detalles', verbose_name="Cotización")
    nombre_producto = models.CharField(max_length=255, verbose_name="Nombre del Producto")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    cantidad = models.PositiveIntegerField(default=1, verbose_name="Cantidad")
    precio_unitario = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Precio Unitario")
    descuento_porcentaje = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'), verbose_name="Descuento (%)")
    precio_con_descuento = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Precio con Descuento")
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Total por Ítem")
    marca = models.CharField(max_length=50, choices=MARCA_CHOICES, blank=True, null=True, verbose_name="Marca")
    no_parte = models.CharField(max_length=100, blank=True, null=True, verbose_name="Número de Parte")
    orden = models.PositiveIntegerField(default=0, verbose_name="Orden") # Nuevo campo para el orden
    
    # Campo para distinguir entre productos normales y títulos de sección
    TIPO_CHOICES = [
        ('producto', 'Producto'),
        ('titulo', 'Título de Sección'),
    ]
    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES, default='producto', verbose_name="Tipo")

    class Meta:
        """
        Metadatos del modelo DetalleCotizacion.
        """
        verbose_name = "Detalle de Cotización"
        verbose_name_plural = "Detalles de Cotización"
        # Puedes añadir un unique_together si un producto no debe repetirse en la misma cotización
        # unique_together = (('cotizacion', 'nombre_producto'),)

    def get_total_item(self):
        """Calcula el total para este ítem de la cotización aplicando el descuento y redondeando a 2 decimales."""
        # Los títulos no tienen cálculos de total
        if self.tipo == 'titulo':
            return Decimal('0.00')
        
        item_total = self.cantidad * self.precio_unitario
        item_total -= item_total * (self.descuento_porcentaje / Decimal('100.00'))
        return item_total.quantize(Decimal('0.01')) # Redondea a 2 decimales
        
    def __str__(self):
        """
        Representación en cadena del objeto DetalleCotizacion.
        """
        return f"{self.cantidad} x {self.nombre_producto} en Cotización {self.cotizacion.id}"

class Volumetria(models.Model):
    """
    Modelo para representar una volumetría generada.
    Similar a Cotizacion pero para volumetrías técnicas.
    """
    titulo = models.CharField(max_length=255, default="Análisis Volumétrico", verbose_name="Título de la Volumetría")
    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='volumetrias', verbose_name="Cliente")
    usuario_final = models.CharField(max_length=255, blank=True, null=True, verbose_name="Nombre del Usuario Final")
    oportunidad = models.ForeignKey(TodoItem, on_delete=models.CASCADE, related_name='volumetrias', verbose_name="Oportunidad de Venta")
    
    # Datos técnicos de la volumetría
    categoria = models.CharField(max_length=50, default='CAT6', verbose_name="Categoría de Cable")
    color = models.CharField(max_length=50, default='Azul', verbose_name="Color de Cable")
    cantidad_nodos = models.PositiveIntegerField(default=1, verbose_name="Cantidad de Nodos")
    distancia = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Distancia (metros)")
    
    # Datos financieros
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Subtotal")
    iva_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.16'), verbose_name="Tasa de IVA")
    iva_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Monto de IVA")
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Total")
    moneda = models.CharField(max_length=5, default='USD', verbose_name="Moneda")
    
    # Métricas de rentabilidad
    total_costo_proveedor = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Costo Total Proveedor")
    ganancia_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Ganancia Total")
    margen_utilidad = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'), verbose_name="Margen de Utilidad (%)")
    precio_por_nodo = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Precio por Nodo")
    costo_por_nodo = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Costo por Nodo")
    
    # Archivo PDF generado
    pdf_content = models.BinaryField(blank=True, null=True, verbose_name="Contenido del PDF")
    
    # Información de proyecto Bitrix24
    bitrix_project_id = models.CharField(max_length=100, blank=True, null=True, verbose_name="ID del Proyecto en Bitrix24")
    
    # Metadatos
    elaborado_por = models.CharField(max_length=255, verbose_name="Elaborado por")
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Creado por")
    fecha_creacion = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Creación")
    fecha_actualizacion = models.DateTimeField(auto_now=True, verbose_name="Última Actualización")
    
    def __str__(self):
        return f"Volumetría: {self.titulo} para {self.cliente.nombre_empresa} (ID: {self.id})"
    
    def get_filename(self):
        """Genera el nombre del archivo PDF"""
        if self.bitrix_project_id:
            # Contar volumetrías para este proyecto para numeración
            count = Volumetria.objects.filter(
                oportunidad=self.oportunidad,
                bitrix_project_id=self.bitrix_project_id,
                id__lte=self.id
            ).count()
            if count > 1:
                return f"Volumetria_Proyecto_{self.bitrix_project_id}_V{count}.pdf"
            else:
                return f"Volumetria_Proyecto_{self.bitrix_project_id}.pdf"
        else:
            return f"Volumetria_{self.id}.pdf"
    
    class Meta:
        verbose_name = "Volumetría"
        verbose_name_plural = "Volumetrías"
        ordering = ['-fecha_creacion']

class DetalleVolumetria(models.Model):
    """
    Modelo para representar cada línea de producto/servicio dentro de una volumetría.
    """
    volumetria = models.ForeignKey(Volumetria, on_delete=models.CASCADE, related_name='detalles', verbose_name="Volumetría")
    nombre_producto = models.CharField(max_length=255, verbose_name="Nombre del Producto")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    cantidad = models.PositiveIntegerField(default=1, verbose_name="Cantidad")
    precio_unitario = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Precio Unitario")
    precio_proveedor = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Precio Proveedor")
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Total por Ítem")
    total_proveedor = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), verbose_name="Total Proveedor")
    
    def __str__(self):
        return f"{self.cantidad} x {self.nombre_producto} en Volumetría {self.volumetria.id}"
    
    class Meta:
        verbose_name = "Detalle de Volumetría"
        verbose_name_plural = "Detalles de Volumetría"

class CatalogoCableado(models.Model):
    """
    Catálogo de productos para cableado de nodos de red.
    Almacena números de parte, descripciones y precios.
    """
    TIPO_PRODUCTO_CHOICES = [
        ('CABLE', 'Cable'),
        ('JACK', 'Jack'),
        ('PATCHCORD', 'Patchcord'),
        ('FACEPLATE', 'Faceplate'),
    ]
    
    numero_parte = models.CharField(
        max_length=100,
        unique=True,
        verbose_name="Número de Parte"
    )
    tipo_producto = models.CharField(
        max_length=20,
        choices=TIPO_PRODUCTO_CHOICES,
        verbose_name="Tipo de Producto"
    )
    descripcion = models.TextField(
        verbose_name="Descripción del Producto"
    )
    marca = models.CharField(
        max_length=100,
        default="PANDUIT",
        verbose_name="Marca"
    )
    precio_unitario = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        verbose_name="Precio Unitario"
    )
    activo = models.BooleanField(
        default=True,
        verbose_name="Producto Activo"
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"{self.numero_parte} - {self.tipo_producto} ({self.marca})"
    
    class Meta:
        verbose_name = "Catálogo de Cableado"
        verbose_name_plural = "Catálogo de Cableado"
        ordering = ['tipo_producto', 'numero_parte']


class CableadoNodoRed(models.Model):
    """
    Modelo para almacenar la configuración de cableado de nodos de red en volumetrías.
    Parte 1 del formulario de nodos de red (Cableado, Infraestructura, Mano de Obra).
    """
    # Relación con volumetría
    volumetria = models.ForeignKey(
        Volumetria, 
        on_delete=models.CASCADE, 
        related_name='cableado_nodos', 
        verbose_name="Volumetría"
    )
    
    # Configuración básica del nodo
    cantidad_nodos = models.PositiveIntegerField(
        default=1, 
        verbose_name="Cantidad de Nodos"
    )
    metros_cable = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        default=Decimal('0.00'), 
        verbose_name="Metros de Cable Total"
    )
    
    # Números de parte de componentes
    cable_numero_parte = models.CharField(
        max_length=100, 
        verbose_name="No. Parte Cable"
    )
    jack_numero_parte = models.CharField(
        max_length=100, 
        verbose_name="No. Parte Jack"
    )
    patchcord_numero_parte = models.CharField(
        max_length=100, 
        verbose_name="No. Parte Patchcord"
    )
    faceplate_numero_parte = models.CharField(
        max_length=100, 
        verbose_name="No. Parte Faceplate"
    )
    
    # Información adicional (se llenará automáticamente desde catálogo)
    cable_descripcion = models.CharField(
        max_length=255, 
        blank=True, 
        verbose_name="Descripción Cable"
    )
    jack_descripcion = models.CharField(
        max_length=255, 
        blank=True, 
        verbose_name="Descripción Jack"
    )
    patchcord_descripcion = models.CharField(
        max_length=255, 
        blank=True, 
        verbose_name="Descripción Patchcord"
    )
    faceplate_descripcion = models.CharField(
        max_length=255, 
        blank=True, 
        verbose_name="Descripción Faceplate"
    )
    
    # Precios (se calcularán automáticamente)
    cable_precio_unitario = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        default=Decimal('0.00'), 
        verbose_name="Precio Unitario Cable"
    )
    jack_precio_unitario = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        default=Decimal('0.00'), 
        verbose_name="Precio Unitario Jack"
    )
    patchcord_precio_unitario = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        default=Decimal('0.00'), 
        verbose_name="Precio Unitario Patchcord"
    )
    faceplate_precio_unitario = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        default=Decimal('0.00'), 
        verbose_name="Precio Unitario Faceplate"
    )
    
    # Totales calculados
    subtotal_cableado = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        default=Decimal('0.00'), 
        verbose_name="Subtotal Cableado"
    )
    
    # Metadatos
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)
    
    def calculate_totals(self):
        """Calcula los totales basado en la lógica: 1 nodo = 1 faceplate + 2 jacks + 2 patchcords + cable"""
        # Por nodo: 1 faceplate, 2 jacks, 2 patchcords
        total_faceplates = self.cantidad_nodos * 1
        total_jacks = self.cantidad_nodos * 2
        total_patchcords = self.cantidad_nodos * 2
        # Cable: metros totales especificados
        total_metros_cable = self.metros_cable
        
        # Calcular subtotales
        subtotal_cable = total_metros_cable * self.cable_precio_unitario
        subtotal_jacks = total_jacks * self.jack_precio_unitario
        subtotal_patchcords = total_patchcords * self.patchcord_precio_unitario
        subtotal_faceplates = total_faceplates * self.faceplate_precio_unitario
        
        self.subtotal_cableado = subtotal_cable + subtotal_jacks + subtotal_patchcords + subtotal_faceplates
        return self.subtotal_cableado
    
    def __str__(self):
        return f"Cableado {self.cantidad_nodos} nodos - Volumetría {self.volumetria.id}"
    
    class Meta:
        verbose_name = "Configuración de Cableado"
        verbose_name_plural = "Configuraciones de Cableado"


class OportunidadProyecto(models.Model):
    """
    Modelo para vincular oportunidades con proyectos de Bitrix24.
    Evita crear proyectos duplicados para la misma oportunidad.
    """
    oportunidad = models.ForeignKey(
        TodoItem, 
        on_delete=models.CASCADE, 
        related_name='proyectos_bitrix', 
        verbose_name="Oportunidad de Venta"
    )
    bitrix_project_id = models.CharField(
        max_length=100, 
        verbose_name="ID del Proyecto en Bitrix24"
    )
    bitrix_deal_id = models.CharField(
        max_length=100, 
        blank=True, 
        null=True, 
        verbose_name="ID del Deal en Bitrix24"
    )
    proyecto_nombre = models.CharField(
        max_length=255, 
        verbose_name="Nombre del Proyecto"
    )
    carpeta_volumetrias_id = models.CharField(
        max_length=100, 
        blank=True, 
        null=True, 
        verbose_name="ID de la Carpeta Volumetrías"
    )
    created_by = models.ForeignKey(
        User, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        verbose_name="Creado por"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True, 
        verbose_name="Fecha de Creación"
    )
    fecha_actualizacion = models.DateTimeField(
        auto_now=True, 
        verbose_name="Última Actualización"
    )
    
    # Contador de volumetrías generadas para este proyecto
    volumetrias_generadas = models.PositiveIntegerField(
        default=0, 
        verbose_name="Número de Volumetrías Generadas"
    )

    def __str__(self):
        return f"Proyecto {self.bitrix_project_id} - {self.oportunidad.oportunidad}"

    class Meta:
        verbose_name = "Proyecto de Oportunidad"
        verbose_name_plural = "Proyectos de Oportunidades"
        ordering = ['-fecha_creacion']
        # Asegurar que cada oportunidad tenga solo un proyecto asociado
        unique_together = ('oportunidad', 'bitrix_project_id')


class Marca(models.Model):
    """
    Modelo para gestionar las marcas de productos
    """
    nombre = models.CharField(
        max_length=50, 
        unique=True,
        verbose_name="Nombre de la Marca"
    )
    activa = models.BooleanField(
        default=True,
        verbose_name="Marca Activa"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Creación"
    )

    def __str__(self):
        return self.nombre

    class Meta:
        verbose_name = "Marca"
        verbose_name_plural = "Marcas"
        ordering = ['nombre']


class ProductoCatalogo(models.Model):
    """
    Modelo para gestionar el catálogo de productos importables desde Excel
    """
    marca = models.ForeignKey(
        Marca,
        on_delete=models.CASCADE,
        verbose_name="Marca"
    )
    no_parte = models.CharField(
        max_length=100,
        verbose_name="Número de Parte"
    )
    descripcion = models.TextField(
        verbose_name="Descripción del Producto"
    )
    precio = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        verbose_name="Precio Unitario"
    )
    fecha_actualizacion = models.DateTimeField(
        auto_now=True,
        verbose_name="Última Actualización"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Creación"
    )
    activo = models.BooleanField(
        default=True,
        verbose_name="Producto Activo"
    )

    def __str__(self):
        return f"{self.marca.nombre} - {self.no_parte}"

    class Meta:
        verbose_name = "Producto del Catálogo"
        verbose_name_plural = "Productos del Catálogo"
        ordering = ['marca__nombre', 'no_parte']
        unique_together = ['marca', 'no_parte']


class ImportacionProductos(models.Model):
    """
    Modelo para registrar el historial de importaciones de productos
    """
    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="Usuario que Importó"
    )
    fecha_importacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Importación"
    )
    marca = models.ForeignKey(
        Marca,
        on_delete=models.CASCADE,
        verbose_name="Marca Importada",
        null=True,
        blank=True
    )
    productos_importados = models.IntegerField(
        default=0,
        verbose_name="Productos Importados"
    )
    productos_actualizados = models.IntegerField(
        default=0,
        verbose_name="Productos Actualizados"
    )
    productos_nuevos = models.IntegerField(
        default=0,
        verbose_name="Productos Nuevos"
    )
    observaciones = models.TextField(
        blank=True,
        null=True,
        verbose_name="Observaciones"
    )

    def __str__(self):
        marca_nombre = self.marca.nombre if self.marca else "Múltiples marcas"
        return f"Importación {marca_nombre} - {self.fecha_importacion.strftime('%Y-%m-%d %H:%M')}"

    class Meta:
        verbose_name = "Importación de Productos"
        verbose_name_plural = "Importaciones de Productos"
        ordering = ['-fecha_importacion']