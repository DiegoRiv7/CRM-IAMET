from django.core.management.base import BaseCommand, CommandError
from app.models import TodoItem, Cliente, UserProfile, Contacto
from django.contrib.auth.models import User
from app.bitrix_integration import get_all_bitrix_deals, get_bitrix_company_details, get_bitrix_user_details, get_bitrix_contact_details
from decimal import Decimal
import json

class Command(BaseCommand):
    help = 'Imports or updates opportunities from Bitrix24 into the Django application.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Starting Bitrix24 opportunities import/update...'))

        # Mapeo de nombres de meses a números de dos dígitos (de Bitrix a Django)
        MONTH_NAME_TO_NUMBER_MAPPING = {
            "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
            "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
            "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12"
        }

        # Obtener todas las oportunidades de Bitrix24
        bitrix_opportunities = get_all_bitrix_deals(request=None) # No request object needed for management command

        if not bitrix_opportunities:
            self.stdout.write(self.style.WARNING('No opportunities found in Bitrix24 or webhook URL is not configured.'))
            return

        total_processed = 0
        created_count = 0
        updated_count = 0

        for deal in bitrix_opportunities:
            total_processed += 1
            bitrix_deal_id = deal.get('ID')
            deal_title = deal.get('TITLE', 'Oportunidad sin título')
            self.stdout.write(f'Processing Bitrix Deal ID: {bitrix_deal_id} - {deal_title}')

            try:
                # Skip deals without proper data if needed, but always try to create the basic opportunity
                self.stdout.write(f'  Processing: {deal_title}')
                
                # --- 1. Find or Create Cliente (Company) ---
                cliente_obj = None
                bitrix_company_id = deal.get('COMPANY_ID')
                if bitrix_company_id and bitrix_company_id != '0':
                    try:
                        cliente_obj = Cliente.objects.get(bitrix_company_id=bitrix_company_id)
                        self.stdout.write(f'  Found existing local client: {cliente_obj.nombre_empresa}')
                    except Cliente.DoesNotExist:
                        company_details = get_bitrix_company_details(bitrix_company_id, request=None)
                        if company_details:
                            cliente_obj, created = Cliente.objects.get_or_create(
                                bitrix_company_id=company_details['ID'],
                                defaults={'nombre_empresa': company_details['TITLE']}
                            )
                            if created:
                                self.stdout.write(self.style.SUCCESS(f'  Created new local client: {cliente_obj.nombre_empresa}'))
                            else:
                                self.stdout.write(f'  Found existing local client (after get_or_create): {cliente_obj.nombre_empresa}')
                        else:
                            self.stdout.write(self.style.WARNING(f'  Could not fetch details for Bitrix Company ID: {bitrix_company_id}. Using default client.'))
                            # Create default client if can't fetch details
                            cliente_obj, created = Cliente.objects.get_or_create(
                                nombre_empresa='Cliente Desconocido',
                                defaults={'bitrix_company_id': None}
                            )
                else:
                    self.stdout.write('  Bitrix deal has no associated company ID. Using default client.')
                    # Create default client for deals without company ID
                    cliente_obj, created = Cliente.objects.get_or_create(
                        nombre_empresa='Cliente Desconocido',
                        defaults={'bitrix_company_id': None}
                    )

                # --- 2. Find or Create Usuario (Assigned User) ---
                usuario_obj = None
                bitrix_assigned_by_id = deal.get('ASSIGNED_BY_ID')
                if bitrix_assigned_by_id:
                    try:
                        user_profile = UserProfile.objects.get(bitrix_user_id=bitrix_assigned_by_id)
                        usuario_obj = user_profile.user
                        self.stdout.write(f'  Found existing local user: {usuario_obj.username}')
                    except UserProfile.DoesNotExist:
                        user_details = get_bitrix_user_details(bitrix_assigned_by_id, request=None)
                        if user_details:
                            username = f"bitrix_user_{bitrix_assigned_by_id}"
                            first_name = user_details.get('NAME', '')
                            last_name = user_details.get('LAST_NAME', '')
                            usuario_obj, created = User.objects.get_or_create(
                                username=username,
                                defaults={
                                    'first_name': first_name,
                                    'last_name': last_name,
                                    'is_active': True
                                }
                            )
                            if created:
                                UserProfile.objects.create(user=usuario_obj, bitrix_user_id=bitrix_assigned_by_id)
                                self.stdout.write(self.style.SUCCESS(f'  Created new local user: {usuario_obj.username}'))
                            else:
                                self.stdout.write(f'  Found existing local user (after get_or_create): {usuario_obj.username}')
                        else:
                            self.stdout.write(self.style.WARNING(f'  Could not fetch details for Bitrix User ID: {bitrix_assigned_by_id}. Using default user.'))
                            # Create default user if can't fetch details
                            usuario_obj, created = User.objects.get_or_create(
                                username='default_user',
                                defaults={
                                    'first_name': 'Usuario',
                                    'last_name': 'Desconocido',
                                    'is_active': True
                                }
                            )
                else:
                    self.stdout.write('  Bitrix deal has no assigned user ID. Using default user.')
                    # Create default user for deals without assigned user
                    usuario_obj, created = User.objects.get_or_create(
                        username='default_user',
                        defaults={
                            'first_name': 'Usuario',
                            'last_name': 'Desconocido',
                            'is_active': True
                        }
                    )

                # --- 3. Find or Create Contacto (if available) ---
                contacto_obj = None
                bitrix_contact_id = deal.get('CONTACT_ID')
                if bitrix_contact_id:
                    try:
                        contacto_obj = Contacto.objects.get(bitrix_contact_id=bitrix_contact_id)
                        self.stdout.write(f'  Found existing local contact: {contacto_obj.nombre} {contacto_obj.apellido}')
                    except Contacto.DoesNotExist:
                        contact_details = get_bitrix_contact_details(bitrix_contact_id, request=None)
                        if contact_details:
                            contact_name_full = f"{contact_details.get('NAME', '')} {contact_details.get('LAST_NAME', '')}".strip()
                            contacto_obj, created = Contacto.objects.get_or_create(
                                bitrix_contact_id=bitrix_contact_id,
                                defaults={
                                    'nombre': contact_details.get('NAME', ''),
                                    'apellido': contact_details.get('LAST_NAME', ''),
                                    'cliente': cliente_obj if cliente_obj else None # Link contact to client if client exists
                                }
                            )
                            if created:
                                self.stdout.write(self.style.SUCCESS(f'  Created new local contact: {contact_name_full}'))
                            else:
                                self.stdout.write(f'  Found existing local contact (after get_or_create): {contact_name_full}')
                        else:
                            self.stdout.write(self.style.WARNING(f'  Could not fetch details for Bitrix Contact ID: {bitrix_contact_id}. Skipping contact creation.'))
                else:
                    self.stdout.write('  Bitrix deal has no associated contact ID.')

                # --- 4. Map Bitrix fields to TodoItem fields ---
                # Custom fields from Bitrix (replace with your actual field IDs if different)
                # Example: UF_CRM_1752859685662 for PRODUCTO
                producto_bitrix_id = deal.get('UF_CRM_1752859685662')
                area_bitrix_id = deal.get('UF_CRM_1752859525038')
                mes_cierre_bitrix_id = deal.get('UF_CRM_1752859877756')
                probabilidad_bitrix_id = deal.get('UF_CRM_1752855787179')
                
                self.stdout.write(f'  Bitrix raw product ID: {producto_bitrix_id}')
                self.stdout.write(f'  Bitrix raw area ID: {area_bitrix_id}')
                self.stdout.write(f'  Bitrix raw mes_cierre ID: {mes_cierre_bitrix_id}')
                self.stdout.write(f'  Bitrix raw probabilidad ID: {probabilidad_bitrix_id}')

                # Mapeos de Bitrix ID a Django Value
                PRODUCTO_BITRIX_ID_TO_DJANGO_VALUE = {
                    "176": "ZEBRA", "178": "PANDUIT", "180": "APC", "182": "AVIGILION",
                    "184": "GENETEC", "186": "AXIS", "188": "SOFTWARE", "190": "RUNRATE",
                    "192": "PÓLIZA", "194": "CISCO", "374": "RFID", "376": "CONSUMIBLE",
                    "378": "IMPRESORA INDUSTRIAL", "380": "SCANNER", "382": "TABLETA",
                    "582": "SERVICIO",
                }

                AREA_BITRIX_ID_TO_DJANGO_VALUE = {
                    "164": "Sistemas", "166": "Recursos Humanos", "168": "Compras",
                    "170": "Seguridad", "172": "Mantenimiento", "174": "Almacén",
                }

                MES_COBRO_BITRIX_ID_TO_DJANGO_VALUE = {
                    "196": "Enero", "198": "Febrero", "200": "Marzo", "202": "Abril",
                    "204": "Mayo", "206": "Junio", "208": "Julio", "210": "Agosto",
                    "212": "Septiembre", "214": "Octubre", "216": "Noviembre", "218": "Diciembre",
                }

                PROBABILIDAD_BITRIX_ID_TO_VALUE_STRING = {
                    "220": "0%", "124": "10%", "126": "20%", "128": "30%",
                    "130": "40%", "132": "50%", "134": "60%", "136": "70%",
                    "138": "80%", "140": "90%", "142": "100%",
                }

                producto = PRODUCTO_BITRIX_ID_TO_DJANGO_VALUE.get(str(producto_bitrix_id), 'SOFTWARE') # Default
                area = AREA_BITRIX_ID_TO_DJANGO_VALUE.get(str(area_bitrix_id), 'Sistemas') # Default
                mes_cierre = MES_COBRO_BITRIX_ID_TO_DJANGO_VALUE.get(str(mes_cierre_bitrix_id), 'Enero') # Default
                
                probabilidad_cierre = 0 # Default value
                if probabilidad_bitrix_id is not None:
                    prob_str = PROBABILIDAD_BITRIX_ID_TO_VALUE_STRING.get(str(probabilidad_bitrix_id))
                    if prob_str:
                        try:
                            parsed_prob = int(prob_str.replace('%', ''))
                            probabilidad_cierre = min(parsed_prob, 100) # Cap at 100
                        except ValueError:
                            self.stdout.write(self.style.WARNING(f'  Invalid probability string from Bitrix: {prob_str}. Setting to default (0).'))
                            probabilidad_cierre = 0
                    else:
                        self.stdout.write(self.style.WARNING(f'  Unknown probability ID from Bitrix: {probabilidad_bitrix_id}. Setting to default (0).'))
                        probabilidad_cierre = 0

                # Ensure monto is a Decimal - handle any format
                try:
                    monto = Decimal(str(deal.get('OPPORTUNITY', 0.0) or 0.0))
                except (ValueError, TypeError):
                    monto = Decimal('0.0')

                # --- 5. Create or Update TodoItem (Opportunity) ---
                # ALWAYS create the opportunity with the essential data
                opportunity, created = TodoItem.objects.update_or_create(
                    bitrix_deal_id=bitrix_deal_id,
                    defaults={
                        'oportunidad': deal_title or f'Oportunidad {bitrix_deal_id}',  # Always have a name
                        'monto': monto,
                        'cliente': cliente_obj,  # We ensure this exists above
                        'usuario': usuario_obj,  # We ensure this exists above
                        'producto': producto or 'SOFTWARE',  # Default value
                        'area': area or 'Sistemas',  # Default value
                        'mes_cierre': mes_cierre or 'Enero',  # Default value
                        'probabilidad_cierre': probabilidad_cierre,
                        'comentarios': deal.get('COMMENTS', ''),
                        'bitrix_company_id': bitrix_company_id,
                        'bitrix_stage_id': deal.get('STAGE_ID'),
                        'contacto': contacto_obj,
                    }
                )

                if created:
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f'  Successfully created opportunity: {opportunity.oportunidad}'))
                else:
                    updated_count += 1
                    self.stdout.write(self.style.SUCCESS(f'  Successfully updated opportunity: {opportunity.oportunidad}'))

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  Error processing Bitrix Deal ID {bitrix_deal_id} ({deal_title}): {e}'))
                # Try to create a minimal opportunity record with just the essentials
                try:
                    self.stdout.write(self.style.WARNING(f'  Attempting minimal import for deal {bitrix_deal_id}'))
                    # Get or create default client and user
                    default_cliente, _ = Cliente.objects.get_or_create(
                        nombre_empresa='Cliente Desconocido',
                        defaults={'bitrix_company_id': None}
                    )
                    default_usuario, _ = User.objects.get_or_create(
                        username='default_user',
                        defaults={'first_name': 'Usuario', 'last_name': 'Desconocido', 'is_active': True}
                    )
                    
                    opportunity, created = TodoItem.objects.update_or_create(
                        bitrix_deal_id=bitrix_deal_id,
                        defaults={
                            'oportunidad': deal_title or f'Oportunidad {bitrix_deal_id}',
                            'monto': Decimal(deal.get('OPPORTUNITY', 0.0) or 0.0),
                            'cliente': default_cliente,
                            'usuario': default_usuario,
                            'producto': 'SOFTWARE',
                            'area': 'Sistemas',
                            'mes_cierre': 'Enero',
                            'probabilidad_cierre': 0,
                            'comentarios': deal.get('COMMENTS', ''),
                            'bitrix_company_id': deal.get('COMPANY_ID'),
                            'bitrix_stage_id': deal.get('STAGE_ID'),
                            'contacto': None,
                        }
                    )
                    if created:
                        created_count += 1
                        self.stdout.write(self.style.SUCCESS(f'  Minimal import successful: {opportunity.oportunidad}'))
                    else:
                        updated_count += 1
                        self.stdout.write(self.style.SUCCESS(f'  Minimal update successful: {opportunity.oportunidad}'))
                except Exception as e2:
                    self.stdout.write(self.style.ERROR(f'  Even minimal import failed for {bitrix_deal_id}: {e2}'))

        self.stdout.write(self.style.SUCCESS('--- Bitrix24 opportunities import/update finished ---'))
        self.stdout.write(self.style.SUCCESS(f'Total opportunities processed: {total_processed}'))
        self.stdout.write(self.style.SUCCESS(f'New opportunities created: {created_count}'))
        self.stdout.write(self.style.SUCCESS(f'Opportunities updated: {updated_count}'))
