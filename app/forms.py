from django import forms
from .models import TodoItem, Cliente, Cotizacion, DetalleCotizacion # Importa todos los modelos necesarios
from django.contrib.auth.models import User


class VentaForm(forms.ModelForm):
    BITRIX_STAGE_CHOICES = [
        ('', 'Seleccionar Etapa'),
        ('NEW', 'Solicitud de Cotizacion'),
        ('UC_YUQKW6', 'Cotizando'),
        ('UC_H8L1Z8', 'Cotización Enviada'),
        ('UC_RFMQC1', 'Seguimiento de Cotización.'),
        ('UC_J7Q5HD', 'Vendido sin PO'),
        ('UC_AO5AY3', 'Vendido con PO'),
        ('PREPARATION', 'Vendido en Transito con Proveedor'),
        ('1', 'Programado para entrega'),
        ('EXECUTING', 'Entregado'),
        ('PREPAYMENT_INVOICE', 'Facturado'),
        ('FINAL_INVOICE', 'Pagado'),
        ('2', 'Perdido'),
        ('3', 'Cancelado'),
        ('4', 'Sin respuesta'),
        ('WON', 'Cerrado Ganado'),
        ('LOSE', 'Cerrado Perdido'),
        ('APOLOGY', 'Analizar la falla'),
        ('5', 'Crear campaña'),
    ]

    cliente_nombre = forms.CharField(max_length=200, label="Cliente", required=True)
    bitrix_company_id = forms.CharField(widget=forms.HiddenInput(), required=False)
    bitrix_deal_id = forms.IntegerField(widget=forms.HiddenInput(), required=False) # Explicitly define bitrix_deal_id as hidden
    bitrix_stage_id = forms.ChoiceField(choices=BITRIX_STAGE_CHOICES, required=False, label="Etapa de Bitrix")
    usuario = forms.ModelChoiceField(
        queryset=User.objects.filter(is_active=True),
        label="Vendedor",
        required=False
    )

    class Meta:
        model = TodoItem
        fields = [
            'oportunidad', 'usuario', 'contacto', 'monto',
            'probabilidad_cierre', 'mes_cierre', 'area', 'producto',
            'comentarios', 'bitrix_deal_id', 'bitrix_company_id', 'bitrix_stage_id'
        ]
        widgets = {
            'comentarios': forms.Textarea(attrs={'rows': 3}),
        }

    def __init__(self, *args, **kwargs):
        user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)

        # Eliminar el campo 'cliente' si existe, ya que es reemplazado por 'cliente_nombre' y 'bitrix_company_id'
        if 'cliente' in self.fields:
            del self.fields['cliente']

        # Manejar valores iniciales para cliente_nombre, bitrix_company_id y bitrix_deal_id al editar
        if self.instance.pk: # Si es una instancia existente (editando)
            if self.instance.cliente:
                self.fields['cliente_nombre'].initial = self.instance.cliente.nombre_empresa
            if self.instance.bitrix_company_id:
                self.fields['bitrix_company_id'].initial = self.instance.bitrix_company_id
            if self.instance.bitrix_deal_id: # Set initial for bitrix_deal_id
                self.fields['bitrix_deal_id'].initial = self.instance.bitrix_deal_id

        if user and not user.groups.filter(name='Supervisores').exists():
            self.fields['usuario'].widget = forms.HiddenInput()
            self.fields['usuario'].required = False
        else:
            self.fields['usuario'].queryset = User.objects.filter(is_active=True)
            self.fields['usuario'].required = True

        # Aplicar clases de Tailwind a todos los campos visibles
        for field_name, field in self.fields.items():
            if not isinstance(field.widget, forms.HiddenInput): # No aplicar a campos ocultos
                field.widget.attrs.update({'class': 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500'})



class VentaFilterForm(forms.Form):
    """
    Formulario para filtrar oportunidades de venta.
    """
    AREA_CHOICES = [('', 'Todas las Áreas')] + list(TodoItem.AREA_CHOICES)
    PRODUCTO_CHOICES = [('', 'Todos los Productos')] + list(TodoItem.PRODUCTO_CHOICES)
    MES_CHOICES = [('', 'Todos los Meses')] + list(TodoItem.MES_CHOICES)

    area = forms.ChoiceField(choices=AREA_CHOICES, required=False, label="Filtrar por Área")
    producto = forms.ChoiceField(choices=PRODUCTO_CHOICES, required=False, label="Filtrar por Producto")
    probabilidad_min = forms.IntegerField(required=False, label="Prob. Mínima (%)", min_value=0, max_value=100)
    probabilidad_max = forms.IntegerField(required=False, label="Prob. Máxima (%)", min_value=0, max_value=100)
    mes_cierre = forms.ChoiceField(choices=MES_CHOICES, required=False, label="Filtrar por Mes de Cierre")
    orden_monto = forms.ChoiceField(
        choices=[
            ('', 'Sin Orden'),
            ('monto_asc', 'Monto Ascendente'),
            ('monto_desc', 'Monto Descendente'),
        ],
        required=False,
        label="Ordenar por Monto"
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Añadir clases de Tailwind a todos los campos
        for field_name, field in self.fields.items():
            if isinstance(field.widget, (forms.TextInput, forms.NumberInput, forms.Textarea, forms.Select, forms.DateInput)):
                field.widget.attrs.update({'class': 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500'})


class CotizacionForm(forms.ModelForm):
    """
    Formulario para la creación/edición de una cotización.
    """
    oportunidad = forms.ModelChoiceField(
        queryset=TodoItem.objects.none(),  # Se inicia vacío y se llena con JS
        required=False,
        label="Oportunidad de Venta (Opcional)",
        widget=forms.Select(attrs={'class': 'input-field'})
    )

    class Meta:
        model = Cotizacion
        fields = ['titulo', 'cliente', 'oportunidad', 'descripcion', 'moneda', 'iva_rate']
        labels = {
            'titulo': 'Título de la Cotización',
            'cliente': 'Cliente',
            'oportunidad': 'Oportunidad de Venta (Opcional)',
            'descripcion': 'Descripción General',
            'moneda': 'Moneda',
            'iva_rate': 'Tasa de IVA (ej. 0.16 para 16%)',
        }
        widgets = {
            'titulo': forms.TextInput(attrs={'class': 'input-field'}),
            'cliente': forms.Select(attrs={'class': 'input-field'}),
            'descripcion': forms.Textarea(attrs={'rows': 3, 'class': 'input-field'}),
            'moneda': forms.Select(attrs={'class': 'input-field'}),
            'iva_rate': forms.NumberInput(attrs={'class': 'input-field', 'step': '0.01'}),
        }

    def __init__(self, *args, **kwargs):
        cliente_id = kwargs.pop('cliente_id', None)
        super().__init__(*args, **kwargs)

        if cliente_id:
            self.fields['oportunidad'].queryset = TodoItem.objects.filter(cliente_id=cliente_id).order_by('-fecha_creacion')
        else:
            self.fields['oportunidad'].queryset = TodoItem.objects.none()

        for field_name, field in self.fields.items():
            if isinstance(field.widget, (forms.TextInput, forms.NumberInput, forms.Textarea, forms.Select, forms.DateInput)):
                field.widget.attrs.update({'class': 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500'})


# Nuevo formulario para los detalles de la cotización
class DetalleCotizacionForm(forms.ModelForm):
    """
    Formulario para cada línea de producto/servicio en una cotización.
    """
    MARCA_CHOICES = [
        ('', 'Seleccionar Marca'),
        ('ZEBRA', 'ZEBRA'),
        ('PANDUIT', 'PANDUIT'),
        ('APC', 'APC'),
        ('AVIGILION', 'AVIGILION'),
        ('GENETEC', 'GENETEC'),
        ('AXIS', 'AXIS'),
        ('CISCO', 'CISCO'),
    ]

    marca = forms.ChoiceField(choices=MARCA_CHOICES, required=False, widget=forms.Select(attrs={'class': 'input-field'}))

    class Meta:
        model = DetalleCotizacion
        fields = ['nombre_producto', 'descripcion', 'cantidad', 'precio_unitario', 'descuento_porcentaje', 'marca']
        widgets = {
            'nombre_producto': forms.TextInput(attrs={'class': 'input-field'}),
            'descripcion': forms.Textarea(attrs={'rows': 2, 'class': 'input-field'}),
            'cantidad': forms.NumberInput(attrs={'class': 'input-field'}),
            'precio_unitario': forms.NumberInput(attrs={'class': 'input-field', 'step': '0.01'}),
            'descuento_porcentaje': forms.NumberInput(attrs={'class': 'input-field', 'step': '0.01'}),
        }
        labels = {
            'nombre_producto': 'Producto/Servicio',
            'descripcion': 'Descripción',
            'cantidad': 'Cantidad',
            'precio_unitario': 'Precio Unitario',
            'descuento_porcentaje': 'Descuento (%)',
            'marca': 'Marca',
        }