import json
from django.core.management.base import BaseCommand
from app.models import Contacto, Cliente
from app.bitrix_integration import get_all_bitrix_contacts, get_all_bitrix_companies
from django.utils import timezone

class Command(BaseCommand):
    help = 'Sincroniza contactos y compañías desde Bitrix24 a la base de datos de Django.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Iniciando sincronización de compañías y contactos de Bitrix24...'))

        # Sincronizar compañías primero
        bitrix_companies = get_all_bitrix_companies()
        if not bitrix_companies:
            self.stdout.write(self.style.WARNING('No se encontraron compañías en Bitrix24 o hubo un error.'))
        else:
            for b_company in bitrix_companies:
                company_id = b_company.get('ID')
                company_title = b_company.get('TITLE')
                if company_id and company_title:
                    cliente, created = Cliente.objects.update_or_create(
                        bitrix_company_id=company_id,
                        defaults={
                            'nombre_empresa': company_title,
                            'fecha_actualizacion': timezone.now()
                        }
                    )
                    if created:
                        self.stdout.write(self.style.SUCCESS(f'Compañía creada: {company_title} (Bitrix ID: {company_id})'))
                    else:
                        self.stdout.write(self.style.SUCCESS(f'Compañía actualizada: {company_title} (Bitrix ID: {company_id})'))
                else:
                    self.stdout.write(self.style.WARNING(f'Compañía de Bitrix con datos incompletos: {b_company}'))

        # Sincronizar contactos
        bitrix_contacts = get_all_bitrix_contacts()
        if not bitrix_contacts:
            self.stdout.write(self.style.WARNING('No se encontraron contactos en Bitrix24 o hubo un error.'))
            return

        for b_contact in bitrix_contacts:
            contact_id = b_contact.get('ID')
            first_name = b_contact.get('NAME', '')
            last_name = b_contact.get('LAST_NAME', '')
            company_id = b_contact.get('COMPANY_ID') # ID de la compañía en Bitrix

            if not contact_id:
                self.stdout.write(self.style.WARNING(f'Contacto de Bitrix sin ID: {b_contact}'))
                continue

            # Buscar la compañía de Django asociada al ID de Bitrix
            cliente_instance = None
            if company_id:
                try:
                    cliente_instance = Cliente.objects.get(bitrix_company_id=company_id)
                except Cliente.DoesNotExist:
                    self.stdout.write(self.style.WARNING(f'No se encontró Cliente de Django para Bitrix Company ID: {company_id} (Contacto: {first_name} {last_name}). Se creará el contacto sin vincular a cliente.'))
                    # Opcional: Podrías crear la compañía aquí si no existe, pero ya se hizo un paso antes.
                    # Si la compañía no existe en Django, el contacto se creará sin FK a Cliente.

            contact_defaults = {
                'nombre': first_name,
                'apellido': last_name,
                'company_id': company_id, # Guardar el ID de la compañía de Bitrix directamente en el Contacto
                'fecha_actualizacion': timezone.now()
            }
            
            # Si se encontró la instancia de Cliente, vincularla
            if cliente_instance:
                contact_defaults['cliente'] = cliente_instance # Asignar la instancia de Cliente

            contacto, created = Contacto.objects.update_or_create(
                bitrix_contact_id=contact_id,
                defaults=contact_defaults
            )

            if created:
                self.stdout.write(self.style.SUCCESS(f'Contacto creado: {first_name} {last_name} (Bitrix ID: {contact_id})'))
            else:
                self.stdout.write(self.style.SUCCESS(f'Contacto actualizado: {first_name} {last_name} (Bitrix ID: {contact_id})'))

        self.stdout.write(self.style.SUCCESS('Sincronización completada.'))
