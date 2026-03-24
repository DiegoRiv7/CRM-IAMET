from django import forms
from django.db.models import Q
from .models import TodoItem, Cliente, Cotizacion, DetalleCotizacion, Contacto, CatalogoCableado, CableadoNodoRed # Importa Contacto
from django.contrib.auth.models import User
from .models import UserProfile # Import UserProfile
from datetime import date


class ClienteForm(forms.ModelForm):
    class Meta:
        model = Cliente
        fields = ['nombre_empresa', 'contacto_principal', 'email']


class OportunidadModalForm(forms.ModelForm):
    class Meta:
        model = TodoItem
        fields = ['area', 'producto', 'probabilidad_cierre', 'mes_cierre', 'monto']


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
            'probabilidad_cierre', 'mes_cierre', 'area', 'producto', 'tipo_negociacion',
            'comentarios', 'bitrix_deal_id', 'bitrix_company_id', 'bitrix_stage_id',
            'monto_facturacion', 'meta_oportunidad'
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
    TIPO_NEGOCIACION_CHOICES = [('', 'Todos los Tipos')] + list(TodoItem.TIPO_NEGOCIACION_CHOICES)
    ETAPA_CHOICES = [
        ('', 'Todas las Etapas'),
        ('vigentes', 'Vigentes'),
        ('ganadas', 'Cerradas Ganadas'),
        ('perdidas', 'Cerradas Perdidas'),
    ]

    area = forms.ChoiceField(choices=AREA_CHOICES, required=False, label="Filtrar por Área")
    producto = forms.ChoiceField(choices=PRODUCTO_CHOICES, required=False, label="Filtrar por Producto")
    empleado = forms.ModelChoiceField(queryset=User.objects.all(), required=False, label="Filtrar por Empleado")
    mes_cierre = forms.ChoiceField(choices=MES_CHOICES, required=False, label="Filtrar por Mes de Cierre")
    tipo_negociacion = forms.ChoiceField(choices=TIPO_NEGOCIACION_CHOICES, required=False, label="Filtrar por Tipo")
    etapa = forms.ChoiceField(choices=ETAPA_CHOICES, required=False, label="Filtrar por Etapa")
    cliente = forms.ModelChoiceField(queryset=Cliente.objects.all().order_by('nombre_empresa'), required=False, label="Filtrar por Cliente")
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
        fields = ['titulo', 'cliente', 'usuario_final', 'oportunidad', 'descripcion', 'comentarios', 'moneda', 'iva_rate']
        labels = {
            'titulo': 'Título de la Cotización',
            'cliente': 'Cliente',
            'usuario_final': 'Nombre del Usuario Final',
            'oportunidad': 'Oportunidad de Venta (Opcional)',
            'descripcion': 'Descripción General',
            'comentarios': 'Comentarios Adicionales',
            'moneda': 'Moneda',
            'iva_rate': 'Tasa de IVA (ej. 0.16 para 16%)',
        }
        widgets = {
            'titulo': forms.TextInput(attrs={'class': 'input-field'}),
            'cliente': forms.Select(attrs={'class': 'input-field'}),
            'usuario_final': forms.TextInput(attrs={'class': 'input-field', 'placeholder': 'Ej. Juan Pérez'}),
            'descripcion': forms.Textarea(attrs={'rows': 3, 'class': 'textarea-field'}),
            'comentarios': forms.Textarea(attrs={'rows': 4, 'class': 'textarea-field', 'placeholder': 'Comentarios que aparecerán en el PDF de la cotización...'}),
            'moneda': forms.Select(attrs={'class': 'input-field'}),
            'iva_rate': forms.NumberInput(attrs={'class': 'input-field', 'step': '0.01'}),
        }

    def __init__(self, *args, **kwargs):
        user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)

        from .views_grupos import get_clientes_visibles_q
        if user:
            self.fields['cliente'].queryset = Cliente.objects.filter(
                get_clientes_visibles_q(user)
            ).order_by('nombre_empresa')
        else:
            self.fields['cliente'].queryset = Cliente.objects.all().order_by('nombre_empresa')

        cliente_id = self.initial.get('cliente') or (self.data.get('cliente') if self.data else None)
        if cliente_id:
            self.fields['oportunidad'].queryset = TodoItem.objects.filter(cliente_id=cliente_id).order_by('-fecha_creacion')
        else:
            self.fields['oportunidad'].queryset = TodoItem.objects.all().order_by('-fecha_creacion')

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


class NuevaOportunidadForm(forms.ModelForm):
    """
    Formulario optimizado para crear nuevas oportunidades con autocompletado y validaciones inteligentes.
    """
    
    # Campo para cliente con autocompletado
    cliente_nombre = forms.CharField(
        max_length=200, 
        label="Cliente",
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Buscar cliente existente o crear uno nuevo...',
            'autocomplete': 'off',
            'list': 'clientes-list'
        }),
        help_text="Empieza a escribir para buscar clientes existentes"
    )
    
    # Campo para contacto con autocompletado
    contacto_nombre = forms.CharField(
        max_length=200,
        label="Contacto",
        required=False,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Nombre del contacto...',
            'autocomplete': 'off'
        })
    )
    
    # Campos mejorados con mejor UX
    oportunidad = forms.CharField(
        max_length=200,
        label="Nombre de la Oportunidad",
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Ej: Implementación de sistema de seguridad...'
        })
    )
    
    monto = forms.DecimalField(
        max_digits=10,
        decimal_places=2,
        label="Monto Estimado (USD)",
        widget=forms.NumberInput(attrs={
            'class': 'form-control',
            'placeholder': '0.00',
            'step': '0.01',
            'min': '0'
        })
    )
    
    comentarios = forms.CharField(
        required=False,
        label="Comentarios / Observaciones",
        widget=forms.Textarea(attrs={
            'class': 'form-control',
            'rows': 3,
            'placeholder': 'Información adicional relevante para esta oportunidad...'
        })
    )
    
    # Campos calculados automáticamente
    mes_cierre_auto = forms.BooleanField(
        required=False,
        initial=True,
        label="Calcular mes de cierre automáticamente",
        widget=forms.CheckboxInput(attrs={'class': 'form-check-input'})
    )

    class Meta:
        model = TodoItem
        fields = [
            'oportunidad', 'monto', 'probabilidad_cierre', 
            'mes_cierre', 'area', 'producto', 'tipo_negociacion', 'comentarios'
        ]
        widgets = {
            'probabilidad_cierre': forms.NumberInput(attrs={
                'class': 'form-control',
                'min': '5',
                'max': '100',
                'step': '5',
                'value': '25'
            }),
            'mes_cierre': forms.Select(attrs={'class': 'form-control'}),
            'area': forms.Select(attrs={'class': 'form-control'}),
            'producto': forms.Select(attrs={'class': 'form-control'}),
            'tipo_negociacion': forms.Select(attrs={'class': 'form-control'}),
        }

    def __init__(self, *args, **kwargs):
        self.user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)
        
        # Configurar mes de cierre automático (mes actual + 1)
        if not self.initial.get('mes_cierre'):
            current_month = date.today().month
            next_month = current_month + 1 if current_month < 12 else 1
            self.fields['mes_cierre'].initial = f"{next_month:02d}"
        
        # Configurar usuario por defecto
        if self.user:
            # No mostrar campo de usuario, se asigna automáticamente
            pass
    
    def clean_cliente_nombre(self):
        cliente_nombre = self.cleaned_data.get('cliente_nombre')
        if not cliente_nombre or len(cliente_nombre.strip()) < 2:
            raise forms.ValidationError("El nombre del cliente debe tener al menos 2 caracteres.")
        return cliente_nombre.strip()
    
    def clean_monto(self):
        monto = self.cleaned_data.get('monto')
        if monto and monto < 0:
            raise forms.ValidationError("El monto no puede ser negativo.")
        return monto
    
    def save(self, commit=True):
        instance = super().save(commit=False)
        
        # Asignar usuario automáticamente
        if self.user:
            instance.usuario = self.user
        
        # Buscar o crear cliente
        cliente_nombre = self.cleaned_data.get('cliente_nombre')
        if cliente_nombre:
            cliente, created = Cliente.objects.get_or_create(
                nombre_empresa__iexact=cliente_nombre,
                defaults={
                    'nombre_empresa': cliente_nombre,
                    'asignado_a': self.user
                }
            )
            instance.cliente = cliente
        
        # Buscar o crear contacto si se proporcionó
        contacto_nombre = self.cleaned_data.get('contacto_nombre')
        if contacto_nombre and instance.cliente:
            nombre_parts = contacto_nombre.split(' ', 1)
            contacto, created = Contacto.objects.get_or_create(
                nombre__iexact=nombre_parts[0],
                cliente=instance.cliente,
                defaults={
                    'nombre': nombre_parts[0],
                    'apellido': nombre_parts[1] if len(nombre_parts) > 1 else '',
                    'cliente': instance.cliente
                }
            )
            instance.contacto = contacto
        
        return instance
        
        
        class ActividadForm(forms.ModelForm):
            class Meta:
                model = Actividad
                fields = ['titulo', 'descripcion', 'fecha_inicio', 'fecha_fin', 'participantes', 'color', 'oportunidad']
                widgets = {
                    'fecha_inicio': forms.DateTimeInput(attrs={'type': 'datetime-local'}),
                    'fecha_fin': forms.DateTimeInput(attrs={'type': 'datetime-local'}),
                    'participantes': forms.SelectMultiple(attrs={'class': 'select2'}),
                    'oportunidad': forms.Select(attrs={'class': 'select2'}),
                }
        
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.fields['participantes'].queryset = User.objects.all().order_by('username')
                self.fields['oportunidad'].queryset = TodoItem.objects.all().order_by('oportunidad')
                self.fields['oportunidad'].required = False # Make opportunity optional