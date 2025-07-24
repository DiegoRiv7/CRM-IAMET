from django import forms
from .models import TodoItem, Cliente, Cotizacion, DetalleCotizacion # Importa todos los modelos necesarios
from django.contrib.auth.models import User


class VentaForm(forms.ModelForm):
    # El campo 'cliente' se define aquí, y su queryset se filtrará en el __init__
    cliente = forms.ModelChoiceField(
        queryset=Cliente.objects.all(), # Se inicializa con todos, luego se filtra
        label="Cliente",
        empty_label="Selecciona un cliente" # Opción para no seleccionar ninguno inicialmente
    )
    usuario = forms.ModelChoiceField(
        queryset=User.objects.filter(is_active=True),
        label="Vendedor",
        required=False
    )

    class Meta:
        model = TodoItem
        fields = [
            'oportunidad', 'cliente', 'usuario', 'contacto', 'monto',
            'probabilidad_cierre', 'mes_cierre', 'area', 'producto',
            'comentarios'
        ]
        widgets = {
            'comentarios': forms.Textarea(attrs={'rows': 3}),
        }

    def __init__(self, *args, **kwargs):
        user = kwargs.pop('user', None) # Obtener el usuario de los kwargs
        super().__init__(*args, **kwargs)

        # Si el usuario existe y no es supervisor, filtrar los clientes
        if user and not user.groups.filter(name='Supervisores').exists():
            self.fields['cliente'].queryset = Cliente.objects.filter(asignado_a=user)
            self.fields['usuario'].widget = forms.HiddenInput()
            self.fields['usuario'].required = False
        else:
            # Si es supervisor, puede elegir cualquier usuario
            self.fields['usuario'].queryset = User.objects.filter(is_active=True)
            self.fields['usuario'].required = True

        # Añadir clases de Tailwind a todos los campos
        for field_name, field in self.fields.items():
            if isinstance(field.widget, (forms.TextInput, forms.NumberInput, forms.Textarea, forms.Select, forms.DateInput)):
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
    class Meta:
        model = Cotizacion # Indica que este formulario está basado en el modelo Cotizacion
        # Define qué campos del modelo Cotizacion quieres incluir en el formulario.
        # Se elimina 'tipo_cotizacion' de aquí porque se maneja manualmente en la vista
        # a través del campo 'institucion' del HTML.
        fields = ['titulo', 'cliente', 'descripcion', 'moneda', 'iva_rate']

        # Opcional: Personaliza las etiquetas de los campos en el formulario
        labels = {
            'titulo': 'Título de la Cotización',
            'cliente': 'Cliente', # Asegurarse de que el cliente tiene una etiqueta
            'descripcion': 'Descripción General',
            'moneda': 'Moneda',
            'iva_rate': 'Tasa de IVA (ej. 0.16 para 16%)',
        }
        # Opcional: Personaliza cómo se ven los campos HTML (clases CSS, tipo de input, etc.)
        widgets = {
            'titulo': forms.TextInput(attrs={'class': 'input-field'}),
            'cliente': forms.Select(attrs={'class': 'input-field'}), # Asegurarse de que el cliente tiene un widget
            'descripcion': forms.Textarea(attrs={'rows': 3, 'class': 'input-field'}),
            'moneda': forms.Select(attrs={'class': 'input-field'}),
            'iva_rate': forms.NumberInput(attrs={'class': 'input-field', 'step': '0.01'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Añadir clases de Tailwind a todos los campos
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