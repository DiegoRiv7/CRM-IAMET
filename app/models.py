# app/models.py

from django.db import models
import logging

logger = logging.getLogger(__name__)
from django.contrib.auth.models import User
from django.utils import timezone
from decimal import Decimal # Importa Decimal para manejar números con precisión
from datetime import timedelta
from django.db.models.signals import post_save
from django.dispatch import receiver

class UserProfile(models.Model):
    AVATAR_TIPO_CHOICES = [
        ('1', 'Humano'),
        ('fox-hero', 'Zorro Súper Héroe'),
        ('dinosaur', 'Dinosaurio T-Rex'),
        ('panda', 'Panda'),
        ('eagle', 'Águila'),
        ('shark', 'Tiburón'),
        ('lobo', 'Lobo'),
        ('buho', 'Buho'),
        ('axolote', 'Axolote'),
        ('cocodrilo', 'Cocodrilo'),
    ]
    
    LANGUAGE_CHOICES = [
        ('es', 'Español'),
        ('en', 'English'),
    ]
    
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    bitrix_user_id = models.IntegerField(blank=True, null=True, verbose_name="ID de Usuario en Bitrix24")
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True, verbose_name="Avatar o Foto de Perfil")
    usar_animado = models.BooleanField(default=False, verbose_name="Usar avatar animado por defecto")
    avatar_tipo = models.CharField(max_length=20, choices=AVATAR_TIPO_CHOICES, default='1', verbose_name="Tipo de Avatar")
    language = models.CharField(max_length=2, choices=LANGUAGE_CHOICES, default='es', verbose_name="Idioma de preferencia")

    def get_avatar_url(self):
        logger.info(f"get_avatar_url para usuario: {self.user.username}")
        logger.info(f"  - self.avatar: {self.avatar}")
        logger.info(f"  - self.usar_animado: {self.usar_animado}")
        logger.info(f"  - self.avatar_tipo: {self.avatar_tipo}")
        if self.avatar:
            return self.avatar.url
        elif self.usar_animado:
            if self.avatar_tipo == 'fox-hero':
                return '/static/images/fox-hero-avatar.jpeg'
            # Aquí puedes agregar más casos para otros avatares
            # Por ejemplo:
            elif self.avatar_tipo == 'dinosaur':
                return '/static/images/dinosaurio.jpeg'
            elif self.avatar_tipo == 'lobo':
                return '/static/images/lobo.jpeg'
            elif self.avatar_tipo == 'buho':
                return '/static/images/buho.jpeg'
            elif self.avatar_tipo == 'axolote':
                return '/static/images/axolote.jpeg'
            elif self.avatar_tipo == 'eagle':
                return '/static/images/aguila.jpeg'
            elif self.avatar_tipo == 'panda':
                return '/static/images/panda.jpeg'
            elif self.avatar_tipo == 'cocodrilo':
                return '/static/images/cocodrilo.jpeg'
            elif self.avatar_tipo == '1':
                # Para avatar tipo "1" (humano), devolver None para mostrar iniciales
                return None
            else:
                # Para tipos desconocidos, devolver None para mostrar iniciales
                return None
        else:
            # Devuelve None si no hay imagen ni animado, para mostrar iniciales
            return None

    def iniciales(self):
        nombres = self.user.get_full_name() or self.user.username
        partes = nombres.split()
        if len(partes) == 1:
            return partes[0][:2].upper()
        return (partes[0][0] + partes[-1][0]).upper()

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
    # Categorías de cliente con porcentajes de utilidad
    CATEGORIA_CHOICES = [
        ('A', 'Categoría A - 15% utilidad'),
        ('B', 'Categoría B - 20% utilidad'),
        ('C', 'Categoría C - 25% utilidad'),
    ]
    
    nombre_empresa = models.CharField(max_length=200, verbose_name="Nombre de la Empresa")
    contacto_principal = models.CharField(max_length=200, blank=True, null=True, verbose_name="Contacto Principal")
    telefono = models.CharField(max_length=20, blank=True, null=True, verbose_name="Teléfono")
    email = models.EmailField(blank=True, null=True, verbose_name="Email")
    direccion = models.CharField(max_length=255, blank=True, null=True, verbose_name="Dirección")
    bitrix_company_id = models.IntegerField(unique=True, null=True, blank=True, verbose_name="ID de Compañía en Bitrix24")
    
    # Campo de categorización del cliente
    categoria = models.CharField(
        max_length=1,
        choices=CATEGORIA_CHOICES,
        default='C',
        verbose_name="Categoría del Cliente",
        help_text="Categoría que determina el porcentaje de utilidad aplicado en las volumetrías"
    )
    
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

    # Opciones para el tipo de negociación
    TIPO_NEGOCIACION_CHOICES = [
        ('runrate', 'Runrate'),
        ('proyecto', 'Proyecto'),
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
    tipo_negociacion = models.CharField(max_length=20, choices=TIPO_NEGOCIACION_CHOICES, verbose_name="Tipo de Negociación", default='runrate')
    etapa_corta = models.CharField(max_length=50, blank=True, null=True, verbose_name="Etapa (Corta)")
    etapa_completa = models.CharField(max_length=200, blank=True, null=True, verbose_name="Etapa (Completa)")
    etapa_color = models.CharField(max_length=7, blank=True, null=True, verbose_name="Color de Etapa")
    comentarios = models.TextField(blank=True, null=True, verbose_name="Comentarios")
    bitrix_deal_id = models.IntegerField(blank=True, null=True, verbose_name="ID de Oportunidad en Bitrix24")
    bitrix_company_id = models.IntegerField(blank=True, null=True, verbose_name="ID de Compañía en Bitrix24")
    bitrix_stage_id = models.CharField(max_length=50, blank=True, null=True, verbose_name="ID de Etapa en Bitrix24")
    
    # Nuevo campo para CRM avanzado
    estado_crm = models.CharField(
        max_length=50, 
        default='nueva',
        verbose_name="Estado CRM",
        help_text="Estado detallado para seguimiento tipo Bitrix24"
    )
    
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
    precio_proveedor = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio Proveedor"
    )
    categoria = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        verbose_name="Categoría Cable (CAT6, CAT6A, etc.)"
    )
    color = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        verbose_name="Color"
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


class InfraestructuraTuberia(models.Model):
    """
    Modelo para almacenar la configuración de infraestructura de tubería en volumetrías.
    Parte 2 del formulario de nodos de red (Infraestructura).
    """
    # Tipos de tubería disponibles
    TIPO_TUBERIA_CHOICES = [
        ('steel', 'Steel (Conduit Metálico)'),
        ('flexible', 'Flexible (Conduit Flexible)'),
    ]
    
    # Diámetros comunes en pulgadas
    DIAMETRO_CHOICES = [
        ('1/2', '1/2" (12.7 mm)'),
        ('3/4', '3/4" (19.05 mm)'),
        ('1', '1" (25.4 mm)'),
        ('1-1/4', '1-1/4" (31.75 mm)'),
        ('1-1/2', '1-1/2" (38.1 mm)'),
        ('2', '2" (50.8 mm)'),
        ('2-1/2', '2-1/2" (63.5 mm)'),
        ('3', '3" (76.2 mm)'),
        ('4', '4" (101.6 mm)'),
    ]
    
    # Tipos de equipo de elevación
    TIPO_EQUIPO_CHOICES = [
        ('grua-telescopica', 'Grúa Telescópica'),
        ('plataforma-elevadora', 'Plataforma Elevadora'),
        ('andamio', 'Andamio'),
        ('escalera-extension', 'Escalera de Extensión'),
        ('montacargas', 'Montacargas'),
    ]
    
    # Relación con volumetría
    volumetria = models.ForeignKey(
        Volumetria, 
        on_delete=models.CASCADE, 
        related_name='infraestructura_tuberia', 
        verbose_name="Volumetría"
    )
    
    # Configuración de tubería
    tipo_tuberia = models.CharField(
        max_length=20,
        choices=TIPO_TUBERIA_CHOICES,
        verbose_name="Tipo de Tubería"
    )
    diametro = models.CharField(
        max_length=10,
        choices=DIAMETRO_CHOICES,
        verbose_name="Diámetro de Tubería"
    )
    metros_tuberia = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        verbose_name="Metros de Tubería"
    )
    
    # Información adicional del producto (se llenará automáticamente desde catálogo)
    numero_parte = models.CharField(
        max_length=100,
        blank=True,
        verbose_name="Número de Parte"
    )
    descripcion_producto = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="Descripción del Producto"
    )
    precio_unitario = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio Unitario por Metro"
    )
    precio_proveedor = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio Proveedor por Metro"
    )
    
    # Campos de equipo de elevación
    usa_equipo_elevacion = models.BooleanField(
        default=False,
        verbose_name="Usa Equipo de Elevación"
    )
    tipo_equipo_elevacion = models.CharField(
        max_length=30,
        choices=TIPO_EQUIPO_CHOICES,
        blank=True,
        null=True,
        verbose_name="Tipo de Equipo de Elevación"
    )
    dias_equipo_elevacion = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Días de Uso del Equipo"
    )
    precio_equipo_elevacion = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio por Día del Equipo"
    )
    
    # Totales calculados
    subtotal_infraestructura = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Subtotal Infraestructura"
    )
    subtotal_proveedor_infraestructura = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Subtotal Proveedor Infraestructura"
    )
    subtotal_equipo_elevacion = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Subtotal Equipo de Elevación"
    )
    
    # Metadatos
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)
    
    def calculate_totals(self):
        """Calcula los totales basado en metros de tubería y precios"""
        # Calcular subtotal de tubería
        self.subtotal_infraestructura = self.metros_tuberia * self.precio_unitario
        self.subtotal_proveedor_infraestructura = self.metros_tuberia * self.precio_proveedor
        
        # Calcular subtotal de equipo de elevación
        if self.usa_equipo_elevacion and self.dias_equipo_elevacion > 0:
            self.subtotal_equipo_elevacion = self.dias_equipo_elevacion * self.precio_equipo_elevacion
        else:
            self.subtotal_equipo_elevacion = Decimal('0.00')
        
        # Total de infraestructura (tubería + equipo de elevación)
        total_infraestructura = self.subtotal_infraestructura + self.subtotal_equipo_elevacion
        return total_infraestructura
    
    def get_descripcion_completa(self):
        """Retorna descripción completa del tipo y diámetro"""
        tipo_display = dict(self.TIPO_TUBERIA_CHOICES).get(self.tipo_tuberia, self.tipo_tuberia)
        diametro_display = dict(self.DIAMETRO_CHOICES).get(self.diametro, self.diametro)
        return f"{tipo_display} - {diametro_display}"
    
    def __str__(self):
        return f"Tubería {self.get_descripcion_completa()} - {self.metros_tuberia}m - Volumetría {self.volumetria.id}"
    
    class Meta:
        verbose_name = "Configuración de Infraestructura"
        verbose_name_plural = "Configuraciones de Infraestructura"


class ManoObraVolumetria(models.Model):
    """
    Modelo para almacenar la configuración de mano de obra en volumetrías.
    Parte 3 del formulario de nodos de red (Mano de Obra).
    Solo se guardan los campos que tienen valores > 0.
    """
    # Relación con volumetría
    volumetria = models.ForeignKey(
        Volumetria, 
        on_delete=models.CASCADE, 
        related_name='mano_obra', 
        verbose_name="Volumetría"
    )
    
    # Campos de mano de obra (solo valores > 0 se guardan)
    supervisor = models.PositiveIntegerField(
        default=0,
        verbose_name="Cantidad de Supervisores"
    )
    tecnico = models.PositiveIntegerField(
        default=0,
        verbose_name="Cantidad de Técnicos"
    )
    casetas = models.PositiveIntegerField(
        default=0,
        verbose_name="Cantidad de Casetas"
    )
    comidas = models.PositiveIntegerField(
        default=0,
        verbose_name="Cantidad de Comidas"
    )
    combustible = models.PositiveIntegerField(
        default=0,
        verbose_name="Cantidad de Combustible (litros/días)"
    )
    
    # Precios unitarios (se actualizarán más adelante con los precios reales)
    precio_supervisor = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio Unitario Supervisor"
    )
    precio_tecnico = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio Unitario Técnico"
    )
    precio_casetas = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio Unitario Casetas"
    )
    precio_comidas = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio Unitario Comidas"
    )
    precio_combustible = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Precio Unitario Combustible"
    )
    
    # Totales calculados
    subtotal_mano_obra = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="Subtotal Mano de Obra"
    )
    
    # Metadatos
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)
    
    def calculate_totals(self):
        """Calcula los totales basado en cantidades y precios unitarios"""
        total_supervisor = self.supervisor * self.precio_supervisor
        total_tecnico = self.tecnico * self.precio_tecnico
        total_casetas = self.casetas * self.precio_casetas
        total_comidas = self.comidas * self.precio_comidas
        total_combustible = self.combustible * self.precio_combustible
        
        self.subtotal_mano_obra = (
            total_supervisor + total_tecnico + total_casetas + 
            total_comidas + total_combustible
        )
        return self.subtotal_mano_obra
    
    def has_any_items(self):
        """Verifica si tiene algún item con cantidad > 0"""
        return any([
            self.supervisor > 0,
            self.tecnico > 0,
            self.casetas > 0,
            self.comidas > 0,
            self.combustible > 0
        ])
    
    def get_items_summary(self):
        """Retorna un resumen de los items con cantidad > 0"""
        items = []
        if self.supervisor > 0:
            items.append(f"{self.supervisor} Supervisor(es)")
        if self.tecnico > 0:
            items.append(f"{self.tecnico} Técnico(s)")
        if self.casetas > 0:
            items.append(f"{self.casetas} Caseta(s)")
        if self.comidas > 0:
            items.append(f"{self.comidas} Comida(s)")
        if self.combustible > 0:
            items.append(f"{self.combustible} Combustible")
        return ", ".join(items) if items else "Sin elementos"
    
    def __str__(self):
        return f"Mano de Obra: {self.get_items_summary()} - Volumetría {self.volumetria.id}"
    
    class Meta:
        verbose_name = "Configuración de Mano de Obra"
        verbose_name_plural = "Configuraciones de Mano de Obra"


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


# ===============================================
# MODELOS PARA CRM AVANZADO DE OPORTUNIDADES  
# ===============================================

class OportunidadEstado(models.Model):
    """
    Estados personalizados para el seguimiento detallado de oportunidades (tipo Bitrix24)
    """
    ESTADO_CHOICES = [
        ('nueva', 'Nueva'),
        ('contacto_inicial', 'Contacto Inicial'),
        ('calificada', 'Calificada'),
        ('propuesta', 'Propuesta Enviada'),
        ('negociacion', 'En Negociación'),
        ('cotizacion_enviada', 'Cotización Enviada'),
        ('seguimiento', 'En Seguimiento'),
        ('vendida', 'Vendida'),
        ('entregada', 'Entregada'),
        ('facturada', 'Facturada'),
        ('pagada', 'Pagada'),
        ('perdida', 'Perdida'),
        ('cancelada', 'Cancelada'),
        ('pausada', 'Pausada'),
    ]
    
    COLOR_CHOICES = [
        ('#007AFF', 'Azul'),
        ('#32D74B', 'Verde'),
        ('#FFD60A', 'Amarillo'),
        ('#FF9F0A', 'Naranja'),
        ('#FF453A', 'Rojo'),
        ('#AF52DE', 'Morado'),
        ('#8E8E93', 'Gris'),
    ]
    
    codigo = models.CharField(max_length=50, choices=ESTADO_CHOICES, unique=True, verbose_name="Código del Estado")
    nombre = models.CharField(max_length=100, verbose_name="Nombre del Estado")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    color = models.CharField(max_length=7, choices=COLOR_CHOICES, default='#007AFF', verbose_name="Color")
    orden = models.PositiveIntegerField(default=0, verbose_name="Orden de Visualización")
    activo = models.BooleanField(default=True, verbose_name="Estado Activo")
    
    class Meta:
        verbose_name = "Estado de Oportunidad"
        verbose_name_plural = "Estados de Oportunidades"
        ordering = ['orden', 'nombre']
    
    def __str__(self):
        return self.nombre


class OportunidadActividad(models.Model):
    """
    Timeline de actividades para cada oportunidad (estilo Bitrix24)
    """
    TIPO_ACTIVIDAD_CHOICES = [
        ('creacion', '🆕 Oportunidad Creada'),
        ('cambio_estado', '🔄 Cambio de Estado'),
        ('comentario', '💬 Comentario'),
        ('llamada', '📞 Llamada'),
        ('email', '📧 Email'),
        ('reunion', '🤝 Reunión'),
        ('cotizacion', '📄 Cotización'),
        ('documento', '📎 Documento'),
        ('tarea', '✅ Tarea'),
        ('seguimiento', '👁️ Seguimiento'),
        ('propuesta', '📋 Propuesta'),
        ('sistema', '⚙️ Sistema'),
    ]
    
    oportunidad = models.ForeignKey(
        TodoItem, 
        on_delete=models.CASCADE, 
        related_name='actividades_crm',
        verbose_name="Oportunidad"
    )
    
    tipo = models.CharField(
        max_length=20, 
        choices=TIPO_ACTIVIDAD_CHOICES,
        verbose_name="Tipo de Actividad"
    )
    
    titulo = models.CharField(max_length=200, verbose_name="Título")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    
    usuario = models.ForeignKey(
        User, 
        on_delete=models.CASCADE,
        verbose_name="Usuario"
    )
    
    fecha_creacion = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Creación")
    
    # Campos opcionales para diferentes tipos de actividad
    estado_anterior = models.CharField(max_length=50, blank=True, null=True, verbose_name="Estado Anterior")
    estado_nuevo = models.CharField(max_length=50, blank=True, null=True, verbose_name="Estado Nuevo")
    monto_anterior = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True, verbose_name="Monto Anterior")
    monto_nuevo = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True, verbose_name="Monto Nuevo")
    
    class Meta:
        verbose_name = "Actividad de Oportunidad"
        verbose_name_plural = "Actividades de Oportunidades"
        ordering = ['-fecha_creacion']
    
    def __str__(self):
        return f"{self.titulo} - {self.oportunidad.oportunidad}"


class OportunidadComentario(models.Model):
    """
    Comentarios en el timeline de la oportunidad
    """
    oportunidad = models.ForeignKey(
        TodoItem,
        on_delete=models.CASCADE,
        related_name='comentarios_crm',
        verbose_name="Oportunidad"
    )
    
    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="Usuario"
    )
    
    contenido = models.TextField(verbose_name="Contenido del Comentario")
    
    fecha_creacion = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Creación")
    fecha_actualizacion = models.DateTimeField(auto_now=True, verbose_name="Última Actualización")
    
    # Para respuestas a comentarios
    comentario_padre = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        blank=True,
        null=True,
        related_name='respuestas_crm',
        verbose_name="Comentario Padre"
    )
    
    class Meta:
        verbose_name = "Comentario de Oportunidad"
        verbose_name_plural = "Comentarios de Oportunidades"
        ordering = ['-fecha_creacion']
    
    def __str__(self):
        return f"Comentario de {self.usuario.username} en {self.oportunidad.oportunidad}"


class OportunidadArchivo(models.Model):
    """
    Archivos adjuntos a las oportunidades
    """
    TIPO_ARCHIVO_CHOICES = [
        ('imagen', '🖼️ Imagen'),
        ('documento', '📄 Documento'),
        ('cotizacion', '📋 Cotización'),
        ('contrato', '📝 Contrato'),
        ('presentacion', '📊 Presentación'),
        ('otro', '📎 Otro'),
    ]
    
    oportunidad = models.ForeignKey(
        TodoItem,
        on_delete=models.CASCADE,
        related_name='archivos_crm',
        verbose_name="Oportunidad"
    )
    
    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="Subido por"
    )
    
    archivo = models.FileField(
        upload_to='oportunidades_archivos/%Y/%m/',
        verbose_name="Archivo"
    )
    
    nombre_original = models.CharField(max_length=255, verbose_name="Nombre Original")
    tipo = models.CharField(max_length=20, choices=TIPO_ARCHIVO_CHOICES, default='otro', verbose_name="Tipo de Archivo")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    
    fecha_subida = models.DateTimeField(auto_now_add=True, verbose_name="Fecha de Subida")
    tamaño = models.PositiveIntegerField(default=0, verbose_name="Tamaño (bytes)")
    
    class Meta:
        verbose_name = "Archivo de Oportunidad"
        verbose_name_plural = "Archivos de Oportunidades"
        ordering = ['-fecha_subida']
    
    def __str__(self):
        return f"{self.nombre_original} - {self.oportunidad.oportunidad}"
    
    @property
    def tamaño_legible(self):
        """Convierte bytes a formato legible"""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if self.tamaño < 1024.0:
                return f"{self.tamaño:.1f} {unit}"
            self.tamaño /= 1024.0
        return f"{self.tamaño:.1f} TB"


class Notificacion(models.Model):
    """
    Modelo para el sistema de notificaciones de usuarios
    """
    TIPO_CHOICES = [
        ('mencion', 'Mención en comentario'),
        ('respuesta', 'Respuesta a comentario'),
        ('comentario_oportunidad', 'Nuevo comentario en oportunidad'),
        ('proyecto_agregado', 'Agregado a proyecto'),
        ('sistema', 'Notificación del sistema'),
    ]
    
    usuario_destinatario = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='notificaciones_recibidas',
        verbose_name="Usuario Destinatario"
    )
    usuario_remitente = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='notificaciones_enviadas',
        verbose_name="Usuario Remitente",
        null=True,
        blank=True
    )
    tipo = models.CharField(
        max_length=25,
        choices=TIPO_CHOICES,
        verbose_name="Tipo de Notificación"
    )
    titulo = models.CharField(
        max_length=200,
        verbose_name="Título de la Notificación"
    )
    mensaje = models.TextField(
        verbose_name="Mensaje de la Notificación"
    )
    oportunidad = models.ForeignKey(
        'TodoItem',
        on_delete=models.CASCADE,
        related_name='notificaciones',
        verbose_name="Oportunidad Relacionada",
        null=True,
        blank=True
    )
    comentario = models.ForeignKey(
        'OportunidadComentario',
        on_delete=models.CASCADE,
        related_name='notificaciones',
        verbose_name="Comentario Relacionado",
        null=True,
        blank=True
    )
    proyecto_id = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="ID del Proyecto"
    )
    proyecto_nombre = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        verbose_name="Nombre del Proyecto"
    )
    leida = models.BooleanField(
        default=False,
        verbose_name="Notificación Leída"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Creación"
    )
    fecha_lectura = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha de Lectura"
    )
    
    class Meta:
        verbose_name = "Notificación"
        verbose_name_plural = "Notificaciones"
        ordering = ['-fecha_creacion']
    
    def __str__(self):
        return f"{self.titulo} - {self.usuario_destinatario.username}"
    
    def marcar_como_leida(self):
        """Marca la notificación como leída"""
        if not self.leida:
            self.leida = True
            self.fecha_lectura = timezone.now()
            self.save()
    
    def get_url(self):
        """Obtiene la URL a la que debe dirigirse la notificación"""
        if self.tipo == 'proyecto_agregado' and self.proyecto_id:
            # Por ahora redirigir a la sección de tareas y proyectos
            # En el futuro se podría dirigir al detalle del proyecto específico
            return "/app/tareas-proyectos/"
        elif self.oportunidad:
            return f"/app/cotizaciones/oportunidad/{self.oportunidad.id}/"
        return "/app/todos/"


class Proyecto(models.Model):
    """Modelo para los proyectos del sistema"""
    
    TIPOS_CHOICES = [
        ('runrate', 'Runrate'),
        ('ingenieria', 'Ingeniería'),
    ]
    
    PRIVACIDAD_CHOICES = [
        ('publico', 'Público'),
        ('privado', 'Privado'),
    ]
    
    nombre = models.CharField(
        max_length=255,
        verbose_name="Nombre del Proyecto"
    )
    descripcion = models.TextField(
        blank=True,
        null=True,
        verbose_name="Descripción"
    )
    tipo = models.CharField(
        max_length=20,
        choices=TIPOS_CHOICES,
        default='runrate',
        verbose_name="Tipo de Proyecto"
    )
    privacidad = models.CharField(
        max_length=20,
        choices=PRIVACIDAD_CHOICES,
        default='publico',
        verbose_name="Privacidad"
    )
    creado_por = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='proyectos_creados',
        verbose_name="Creado por"
    )
    miembros = models.ManyToManyField(
        User,
        related_name='proyectos_participando',
        blank=True,
        verbose_name="Miembros del Proyecto"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Creación"
    )
    fecha_actualizacion = models.DateTimeField(
        auto_now=True,
        verbose_name="Última Actualización"
    )
    
    class Meta:
        verbose_name = "Proyecto"
        verbose_name_plural = "Proyectos"
        ordering = ['-fecha_creacion']
    
    def __str__(self):
        return self.nombre
    
    def get_miembros_display(self):
        """Obtiene una representación de los miembros para mostrar"""
        miembros_list = []
        for miembro in self.miembros.all()[:3]:  # Máximo 3 para mostrar
            iniciales = ''.join([palabra[0].upper() for palabra in (miembro.get_full_name() or miembro.username).split()[:2]])
            
            # Obtener avatar_url del usuario
            avatar_url = None
            if hasattr(miembro, 'userprofile'):
                try:
                    avatar_url = miembro.userprofile.get_avatar_url()
                except:
                    avatar_url = None
            
            miembros_list.append({
                'id': miembro.id,
                'nombre': miembro.get_full_name() or miembro.username,
                'iniciales': iniciales,
                'avatar_url': avatar_url
            })
        return miembros_list
    
    def get_avance_porcentaje(self):
        """Calcula el porcentaje de avance del proyecto"""
        # Por ahora devolver un valor aleatorio entre 0-100
        # En el futuro se calculará basado en tareas completadas
        import random
        return random.randint(20, 95)
    
    def get_rol_usuario(self, usuario):
        """Obtiene el rol del usuario en el proyecto"""
        if self.creado_por == usuario:
            return "Jefe de proyecto"
        elif usuario in self.miembros.all():
            return "Miembro"
        else:
            return "No te has unido al proyecto"


class ProyectoComentario(models.Model):
    """Modelo para los comentarios del feed de un proyecto"""
    
    proyecto = models.ForeignKey(
        Proyecto,
        on_delete=models.CASCADE,
        related_name='comentarios',
        verbose_name="Proyecto"
    )
    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="Usuario"
    )
    contenido = models.TextField(
        verbose_name="Contenido"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Creación"
    )
    fecha_edicion = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha de Última Edición"
    )
    editado = models.BooleanField(
        default=False,
        verbose_name="Editado"
    )
    usuarios_mencionados = models.ManyToManyField(
        User,
        related_name='menciones_proyecto',
        blank=True,
        verbose_name="Usuarios Mencionados"
    )
    
    class Meta:
        verbose_name = "Comentario de Proyecto"
        verbose_name_plural = "Comentarios de Proyecto"
        ordering = ['fecha_creacion']
    
    def __str__(self):
        return f"{self.usuario.username} - {self.proyecto.nombre} - {self.fecha_creacion.strftime('%Y-%m-%d %H:%M')}"
    
    def get_contenido_con_menciones(self):
        """Convierte las menciones @usuario en enlaces"""
        import re
        contenido = self.contenido
        
        # Buscar patrones @usuario
        def reemplazar_mencion(match):
            username = match.group(1)
            try:
                usuario = User.objects.get(username=username)
                return f'<span class="mencion" data-user-id="{usuario.id}">@{username}</span>'
            except User.DoesNotExist:
                return match.group(0)
        
        contenido = re.sub(r'@(\w+)', reemplazar_mencion, contenido)
        return contenido
    
    def extraer_menciones(self):
        """Extrae los usuarios mencionados del contenido"""
        import re
        menciones = re.findall(r'@(\w+)', self.contenido)
        usuarios_mencionados = []
        
        for username in menciones:
            try:
                usuario = User.objects.get(username=username)
                usuarios_mencionados.append(usuario)
            except User.DoesNotExist:
                continue
        
        return usuarios_mencionados
    
    def save(self, *args, **kwargs):
        # Si se está editando (no es creación), marcar como editado
        if self.pk:
            self.editado = True
            self.fecha_edicion = timezone.now()
        
        super().save(*args, **kwargs)
        
        # Después de guardar, actualizar menciones
        usuarios_mencionados = self.extraer_menciones()
        self.usuarios_mencionados.set(usuarios_mencionados)


class ProyectoArchivo(models.Model):
    """Modelo para archivos adjuntos en comentarios de proyecto"""
    
    comentario = models.ForeignKey(
        ProyectoComentario,
        on_delete=models.CASCADE,
        related_name='archivos',
        verbose_name="Comentario"
    )
    archivo = models.FileField(
        upload_to='proyectos/archivos/%Y/%m/',
        verbose_name="Archivo"
    )
    nombre_original = models.CharField(
        max_length=255,
        verbose_name="Nombre Original"
    )
    tamaño = models.PositiveIntegerField(
        verbose_name="Tamaño en bytes"
    )
    tipo_contenido = models.CharField(
        max_length=100,
        blank=True,
        verbose_name="Tipo de Contenido"
    )
    fecha_subida = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Subida"
    )
    
    class Meta:
        verbose_name = "Archivo de Proyecto"
        verbose_name_plural = "Archivos de Proyecto"
        ordering = ['fecha_subida']
    
    def __str__(self):
        return f"{self.nombre_original} - {self.comentario.proyecto.nombre}"
    
    def get_icono(self):
        """Devuelve el icono apropiado según el tipo de archivo"""
        if self.tipo_contenido:
            if self.tipo_contenido.startswith('image/'):
                return '🖼️'
            elif self.tipo_contenido.startswith('video/'):
                return '🎥'
            elif 'pdf' in self.tipo_contenido:
                return '📄'
            elif any(ext in self.tipo_contenido for ext in ['word', 'document']):
                return '📝'
            elif any(ext in self.tipo_contenido for ext in ['excel', 'spreadsheet']):
                return '📊'
            elif any(ext in self.tipo_contenido for ext in ['zip', 'rar', 'compressed']):
                return '🗜️'
        return '📁'
    
    def get_tamaño_legible(self):
        """Convierte el tamaño en bytes a formato legible"""
        if self.tamaño < 1024:
            return f"{self.tamaño} B"
        elif self.tamaño < 1024 * 1024:
            return f"{self.tamaño / 1024:.1f} KB"
        elif self.tamaño < 1024 * 1024 * 1024:
            return f"{self.tamaño / (1024 * 1024):.1f} MB"
        else:
            return f"{self.tamaño / (1024 * 1024 * 1024):.1f} GB"


class TareaComentario(models.Model):
    """Modelo para los comentarios del feed de una tarea"""
    
    tarea = models.ForeignKey(
        'Tarea',
        on_delete=models.CASCADE,
        related_name='comentarios',
        verbose_name="Tarea"
    )
    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="Usuario"
    )
    contenido = models.TextField(
        verbose_name="Contenido"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Creación"
    )
    fecha_edicion = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha de Última Edición"
    )
    editado = models.BooleanField(
        default=False,
        verbose_name="Editado"
    )
    
    class Meta:
        verbose_name = "Comentario de Tarea"
        verbose_name_plural = "Comentarios de Tarea"
        ordering = ['fecha_creacion']
    
    def __str__(self):
        return f"{self.usuario.username} - {self.tarea.titulo} - {self.fecha_creacion.strftime('%Y-%m-%d %H:%M')}"
    
    def get_contenido_con_menciones(self):
        """Convierte las menciones @usuario en enlaces"""
        import re
        contenido = self.contenido
        
        # Buscar patrones @usuario
        def reemplazar_mencion(match):
            username = match.group(1)
            try:
                usuario = User.objects.get(username=username)
                return f'<span class="mencion" data-user-id="{usuario.id}">@{username}</span>'
            except User.DoesNotExist:
                return match.group(0)
        
        contenido = re.sub(r'@(\w+)', reemplazar_mencion, contenido)
        return contenido
    
    def extraer_menciones(self):
        """Extrae los usuarios mencionados del contenido"""
        import re
        menciones = re.findall(r'@(\w+)', self.contenido)
        usuarios_mencionados = []
        
        for username in menciones:
            try:
                usuario = User.objects.get(username=username)
                usuarios_mencionados.append(usuario)
            except User.DoesNotExist:
                continue
        
        return usuarios_mencionados
    
    def save(self, *args, **kwargs):
        # Si se está editando (no es creación), marcar como editado
        if self.pk:
            self.editado = True
            self.fecha_edicion = timezone.now()
        
        super().save(*args, **kwargs)

class TareaArchivo(models.Model):
    """Modelo para archivos adjuntos en comentarios de tarea"""
    
    comentario = models.ForeignKey(
        TareaComentario,
        on_delete=models.CASCADE,
        related_name='archivos',
        verbose_name="Comentario"
    )
    archivo = models.FileField(
        upload_to='tareas/archivos/%Y/%m/',
        verbose_name="Archivo"
    )
    nombre_original = models.CharField(
        max_length=255,
        verbose_name="Nombre Original"
    )
    tamaño = models.PositiveIntegerField(
        verbose_name="Tamaño en bytes"
    )
    tipo_contenido = models.CharField(
        max_length=100,
        blank=True,
        verbose_name="Tipo de Contenido"
    )
    fecha_subida = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Subida"
    )
    
    class Meta:
        verbose_name = "Archivo de Tarea"
        verbose_name_plural = "Archivos de Tarea"
        ordering = ['fecha_subida']
    
    def get_icono(self):
        """Devuelve el icono apropiado según el tipo de archivo"""
        if self.tipo_contenido:
            if self.tipo_contenido.startswith('image/'):
                return '🖼️'
            elif self.tipo_contenido.startswith('video/'):
                return '🎥'
            elif 'pdf' in self.tipo_contenido:
                return '📄'
            elif any(ext in self.tipo_contenido for ext in ['word', 'document']):
                return '📝'
            elif any(ext in self.tipo_contenido for ext in ['excel', 'spreadsheet']):
                return '📊'
            elif any(ext in self.tipo_contenido for ext in ['powerpoint', 'presentation']):
                return '📽️'
        return '📎'  # Icono por defecto
    
    def get_tamaño_legible(self):
        """Convierte el tamaño en bytes a formato legible"""
        if self.tamaño < 1024:
            return f"{self.tamaño} B"
        elif self.tamaño < 1024 * 1024:
            return f"{self.tamaño / 1024:.1f} KB"
        elif self.tamaño < 1024 * 1024 * 1024:
            return f"{self.tamaño / (1024 * 1024):.1f} MB"
        else:
            return f"{self.tamaño / (1024 * 1024 * 1024):.1f} GB"

    def __str__(self):
        return f"{self.nombre_original} - {self.comentario.tarea.titulo}"


class Tarea(models.Model):
    """
    Modelo para representar tareas dentro de proyectos
    """
    PRIORIDAD_CHOICES = [
        ('baja', 'Baja'),
        ('media', 'Media'),
        ('alta', 'Alta'),
    ]
    
    ESTADO_CHOICES = [
        ('pendiente', 'Pendiente'),
        ('en_progreso', 'En Progreso'),
        ('completada', 'Completada'),
        ('cancelada', 'Cancelada'),
    ]
    
    titulo = models.CharField(
        max_length=200,
        verbose_name="Título de la Tarea"
    )
    descripcion = models.TextField(
        blank=True,
        verbose_name="Descripción"
    )
    proyecto = models.ForeignKey(
        'Proyecto',
        on_delete=models.CASCADE,
        verbose_name="Proyecto",
        related_name='tareas'
    )
    creado_por = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='tareas_creadas',
        verbose_name="Creado por"
    )
    asignado_a = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tareas_asignadas',
        verbose_name="Asignado a"
    )
    participantes = models.ManyToManyField(
        User,
        blank=True,
        related_name='tareas_participando',
        verbose_name="Participantes"
    )
    observadores = models.ManyToManyField(
        User,
        blank=True,
        related_name='tareas_observando',
        verbose_name="Observadores"
    )
    prioridad = models.CharField(
        max_length=20,
        choices=PRIORIDAD_CHOICES,
        default='media',
        verbose_name="Prioridad"
    )
    estado = models.CharField(
        max_length=20,
        choices=ESTADO_CHOICES,
        default='pendiente',
        verbose_name="Estado"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Creación"
    )
    fecha_limite = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha Límite"
    )
    fecha_completada = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha de Completado"
    )
    pausado = models.BooleanField(
        default=False,
        verbose_name="Pausado"
    )
    tiempo_trabajado = models.DurationField(
        default=timedelta(0),
        verbose_name="Tiempo Trabajado"
    )
    trabajando_actualmente = models.BooleanField(
        default=False,
        verbose_name="Trabajando Actualmente"
    )
    
    class Meta:
        verbose_name = "Tarea"
        verbose_name_plural = "Tareas"
        ordering = ['-fecha_creacion']
    
    def __str__(self):
        return f"{self.titulo} - {self.proyecto.nombre}"
    
    def get_prioridad_color(self):
        """Retorna el color asociado a la prioridad"""
        colors = {
            'baja': '#28a745',
            'media': '#ffc107', 
            'alta': '#dc3545'
        }
        return colors.get(self.prioridad, '#6c757d')
    
    def get_estado_color(self):
        """Retorna el color asociado al estado"""
        colors = {
            'pendiente': '#6c757d',
            'en_progreso': '#007bff',
            'completada': '#28a745',
            'cancelada': '#dc3545'
        }
        return colors.get(self.estado, '#6c757d')


class Notificacion(models.Model):
    """
    Modelo para el sistema de notificaciones del dock
    """
    TIPO_CHOICES = [
        ('tarea_asignacion', 'Asignación de Tarea'),
        ('tarea_nueva', 'Nueva Tarea'),
        ('proyecto_nuevo', 'Nuevo Proyecto'),
        ('comentario', 'Nuevo Comentario'),
        ('cumpleanos', 'Cumpleaños'),
        ('general', 'General'),
    ]
    
    usuario = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notificaciones',
        verbose_name="Usuario"
    )
    tipo = models.CharField(
        max_length=20,
        choices=TIPO_CHOICES,
        default='general',
        verbose_name="Tipo de Notificación"
    )
    titulo = models.CharField(
        max_length=200,
        verbose_name="Título"
    )
    mensaje = models.TextField(
        verbose_name="Mensaje"
    )
    url = models.URLField(
        blank=True,
        null=True,
        verbose_name="URL de destino"
    )
    leida = models.BooleanField(
        default=False,
        verbose_name="Leída"
    )
    fecha_creacion = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de Creación"
    )
    creado_por = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notificaciones_enviadas',
        verbose_name="Creado por"
    )
    
    class Meta:
        ordering = ['-fecha_creacion']
        verbose_name = "Notificación"
        verbose_name_plural = "Notificaciones"
    
    def __str__(self):
        return f"{self.titulo} - {self.usuario.username}"


class Actividad(models.Model):
    """
    Modelo para representar una actividad o evento en el calendario.
    """
    # Opciones de colores para las actividades
    COLOR_CHOICES = [
        ('#007AFF', 'Azul'),
        ('#34C759', 'Verde'),
        ('#FF9500', 'Naranja'),
        ('#FF3B30', 'Rojo'),
        ('#AF52DE', 'Morado'),
        ('#5856D6', 'Índigo'),
        ('#FF2D55', 'Rosa'),
    ]

    titulo = models.CharField(max_length=200, verbose_name="Título de la Actividad")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    
    fecha_inicio = models.DateTimeField(verbose_name="Fecha y Hora de Inicio")
    fecha_fin = models.DateTimeField(verbose_name="Fecha y Hora de Fin")
    
    creado_por = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='actividades_creadas',
        verbose_name="Creado por"
    )
    
    participantes = models.ManyToManyField(
        User, 
        related_name='actividades_participando',
        blank=True,
        verbose_name="Participantes"
    )
    
    color = models.CharField(
        max_length=7,
        choices=COLOR_CHOICES,
        default='#007AFF',
        verbose_name="Color del Evento"
    )
    
    # Enlace opcional a una oportunidad
    oportunidad = models.ForeignKey(
        TodoItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='actividades_calendario',
        verbose_name="Oportunidad Relacionada"
    )

    class Meta:
        verbose_name = "Actividad del Calendario"
        verbose_name_plural = "Actividades del Calendario"
        ordering = ['fecha_inicio']

    def __str__(self):
        return f"{self.titulo} ({self.fecha_inicio.strftime('%d/%m/%Y %H:%M')})"

class EmpleadoDelMes(models.Model):
    """Modelo para almacenar al empleado del mes."""
    usuario = models.OneToOneField(User, on_delete=models.CASCADE, verbose_name="Usuario")
    mes = models.PositiveIntegerField(verbose_name="Mes")
    ano = models.PositiveIntegerField(verbose_name="Año")
    monto_total = models.DecimalField(max_digits=12, decimal_places=2, verbose_name="Monto Total de Oportunidades")

    class Meta:
        verbose_name = "Empleado del Mes"
        verbose_name_plural = "Empleados del Mes"
        ordering = ['-ano', '-mes']

    def __str__(self):
        return f"{self.usuario.get_full_name() or self.usuario.username} - {self.mes}/{self.ano}"