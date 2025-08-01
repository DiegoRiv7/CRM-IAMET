from django import forms
from django.db.models import Q
from .models import TodoItem, Cliente, Cotizacion, DetalleCotizacion, Contacto # Importa Contacto
from django.contrib.auth.models import User
from .models import UserProfile # Import UserProfile


class ClienteForm(forms.ModelForm):
    class Meta:
        model = Cliente
        fields = ['nombre_empresa', 'contacto_principal', 'telefono', 'email', 'direccion']


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
    bitrix_deal_id = forms.IntegerField(widget=forms.HiddenInput(), required=False)
    bitrix_stage_id = forms.ChoiceField(choices=BITRIX_STAGE_CHOICES, required=False, label="Etapa de Bitrix")

    usuario_nombre = forms.CharField(max_length=200, label="Vendedor Responsable", required=False)
    bitrix_assigned_by_id = forms.CharField(widget=forms.HiddenInput(), required=False)

    # New fields for contact
    contacto_nombre = forms.CharField(max_length=200, label="Contacto del Cliente", required=False)
    bitrix_contact_id = forms.CharField(widget=forms.HiddenInput(), required=False)

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

        if 'cliente' in self.fields:
            del self.fields['cliente']
        # Remove original 'contacto' field as it's replaced by contacto_nombre and bitrix_contact_id
        if 'contacto' in self.fields:
            del self.fields['contacto']

        # Set initial values for usuario_nombre and bitrix_assigned_by_id
        if self.instance.pk and self.instance.usuario:
            self.fields['usuario_nombre'].initial = self.instance.usuario.get_full_name() or self.instance.usuario.username
            if hasattr(self.instance.usuario, 'userprofile') and self.instance.usuario.userprofile.bitrix_user_id:
                self.fields['bitrix_assigned_by_id'].initial = self.instance.usuario.userprofile.bitrix_user_id

        # Set initial values for contacto_nombre and bitrix_contact_id
        if self.instance.pk and self.instance.contacto:
            self.fields['contacto_nombre'].initial = str(self.instance.contacto) # Assuming __str__ gives full name
            if self.instance.contacto.bitrix_contact_id:
                self.fields['bitrix_contact_id'].initial = self.instance.contacto.bitrix_contact_id

        if self.instance.pk:
            if self.instance.cliente:
                self.fields['cliente_nombre'].initial = self.instance.cliente.nombre_empresa
            if self.instance.bitrix_company_id:
                self.fields['bitrix_company_id'].initial = self.instance.bitrix_company_id
            if self.instance.bitrix_deal_id:
                self.fields['bitrix_deal_id'].initial = self.instance.bitrix_deal_id

        # Remove the original 'usuario' field from the form's visible fields
        # It will be set in the clean method
        if 'usuario' in self.fields:
            del self.fields['usuario']

        # Apply Tailwind classes
        for field_name, field in self.fields.items():
            if not isinstance(field.widget, forms.HiddenInput):
                field.widget.attrs.update({'class': 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500'})

    def clean(self):
        cleaned_data = super().clean()
        usuario_nombre = cleaned_data.get('usuario_nombre')
        bitrix_assigned_by_id = cleaned_data.get('bitrix_assigned_by_id')
        contacto_nombre = cleaned_data.get('contacto_nombre')
        bitrix_contact_id = cleaned_data.get('bitrix_contact_id')

        # --- Clean and link Usuario (Vendedor Responsable) ---
        if bitrix_assigned_by_id:
            try:
                user_profile = UserProfile.objects.get(bitrix_user_id=bitrix_assigned_by_id)
                cleaned_data['usuario'] = user_profile.user
            except UserProfile.DoesNotExist:
                try:
                    username = f"bitrix_user_{bitrix_assigned_by_id}"
                    user, created = User.objects.get_or_create(
                        username=username,
                        defaults={
                            'first_name': usuario_nombre.split(' ')[0] if usuario_nombre else '',
                            'last_name': ' '.join(usuario_nombre.split(' ')[1:]) if usuario_nombre and len(usuario_nombre.split(' ')) > 1 else '',
                            'is_active': True
                        }
                    )
                    if created:
                        UserProfile.objects.create(user=user, bitrix_user_id=bitrix_assigned_by_id)
                    cleaned_data['usuario'] = user
                except Exception as e:
                    self.add_error('usuario_nombre', f"Error al vincular usuario de Bitrix: {e}")
        elif self.instance.pk and self.instance.usuario:
            cleaned_data['usuario'] = self.instance.usuario
        elif hasattr(self, 'request') and self.request and not self.request.user.groups.filter(name='Supervisores').exists():
            cleaned_data['usuario'] = self.request.user
        else:
            self.add_error('usuario_nombre', 'Debe seleccionar un vendedor responsable.')

        # --- Clean and link Contacto del Cliente ---
        if contacto_nombre:
            if bitrix_contact_id:
                try:
                    contact_obj, created = Contacto.objects.get_or_create(
                        bitrix_contact_id=bitrix_contact_id,
                        defaults={
                            'nombre': contacto_nombre.split(' ')[0] if contacto_nombre else '',
                            'apellido': ' '.join(contacto_nombre.split(' ')[1:]) if contacto_nombre and len(contacto_nombre.split(' ')) > 1 else '',
                            # company_id can be added here if available from Bitrix contact data
                        }
                    )
                    # If not created, update name in case it changed in Bitrix
                    if not created:
                        current_full_name = f"{contact_obj.nombre} {contact_obj.apellido or ''}".strip()
                        if current_full_name != contacto_nombre:
                            contact_obj.nombre = contacto_nombre.split(' ')[0] if contacto_nombre else ''
                            contact_obj.apellido = ' '.join(contacto_nombre.split(' ')[1:]) if contacto_nombre and len(contacto_nombre.split(' ')) > 1 else ''
                            contact_obj.save()

                    cleaned_data['contacto'] = contact_obj
                except Exception as e:
                    self.add_error('contacto_nombre', f"Error al vincular contacto de Bitrix: {e}")
            else:
                # If no bitrix_contact_id, create a local Contacto object
                contact_obj, created = Contacto.objects.get_or_create(
                    nombre=contacto_nombre.split(' ')[0] if contacto_nombre else '',
                    apellido=' '.join(contacto_nombre.split(' ')[1:]) if contacto_nombre and len(contacto_nombre.split(' ')) > 1 else '',
                    bitrix_contact_id__isnull=True, # Ensure we don't accidentally match a Bitrix contact
                    defaults={'bitrix_contact_id': None} # Explicitly set to None
                )
                cleaned_data['contacto'] = contact_obj
        else:
            cleaned_data['contacto'] = None # Or set a default if contact is required

        return cleaned_data

    def save(self, commit=True):
        instance = super().save(commit=False)
        if commit:
            instance.save()
        return instance



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
        user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)

        self.fields['cliente'].queryset = Cliente.objects.all().order_by('nombre_empresa')

        cliente_id = self.initial.get('cliente') or (self.data.get('cliente') if self.data else None)
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