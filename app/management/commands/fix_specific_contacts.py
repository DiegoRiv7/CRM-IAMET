from django.core.management.base import BaseCommand
from app.models import TodoItem, Contacto
from app.bitrix_integration import get_bitrix_contact_details

class Command(BaseCommand):
    help = 'Fix specific opportunities that should have contacts but dont'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('🔧 Fixing specific missing contacts...'))

        # IDs específicos encontrados en el diagnóstico que tienen contacto en Bitrix
        problem_deals = [2460, 2464, 2462, 2458, 2454, 2452, 2442, 2438]
        
        for deal_id in problem_deals:
            try:
                opportunity = TodoItem.objects.get(bitrix_deal_id=deal_id)
                self.stdout.write(f"\n🔍 Processing: {opportunity.oportunidad} (Deal ID: {deal_id})")
                
                if opportunity.contacto:
                    self.stdout.write("✅ Already has contact, skipping")
                    continue
                
                # Obtener el CONTACT_ID desde Bitrix24 (esto requiere una llamada adicional)
                # Por simplicidad, usaremos los IDs que conocemos del diagnóstico
                contact_ids = {
                    2460: 1580,  # Omar Noriega
                    2464: 1526,  # Griselda Perez  
                    2462: 1582,  # Carlos Garcia Z
                    2458: 1434,  # Alma Silva
                    2454: 1576,  # Gustavo Hernandez
                    2452: 1568,  # luis moreno
                    2442: 1568,  # luis moreno
                    2438: 1430,  # Luis Gonzalez
                }
                
                contact_id = contact_ids.get(deal_id)
                if not contact_id:
                    self.stdout.write("❌ No contact ID mapping found")
                    continue
                
                # Verificar si el contacto ya existe localmente
                existing_contact = Contacto.objects.filter(bitrix_contact_id=contact_id).first()
                if existing_contact:
                    self.stdout.write(f"✅ Found existing contact: {existing_contact.nombre} {existing_contact.apellido}")
                    opportunity.contacto = existing_contact
                    opportunity.save()
                    self.stdout.write("✅ Opportunity updated with existing contact")
                    continue
                
                # Obtener detalles del contacto desde Bitrix24
                self.stdout.write(f"📡 Fetching contact details for ID {contact_id}")
                contact_details = get_bitrix_contact_details(contact_id)
                
                if not contact_details:
                    self.stdout.write("❌ Could not fetch contact details")
                    continue
                
                # Crear el contacto
                self.stdout.write("🆕 Creating new contact...")
                try:
                    contacto_obj = Contacto.objects.create(
                        nombre=contact_details.get('NAME', 'Sin nombre'),
                        apellido=contact_details.get('LAST_NAME', ''),
                        telefono=contact_details.get('PHONE', [{}])[0].get('VALUE', '') if contact_details.get('PHONE') else '',
                        email=contact_details.get('EMAIL', [{}])[0].get('VALUE', '') if contact_details.get('EMAIL') else '',
                        bitrix_contact_id=contact_id,
                        company_id=contact_details.get('COMPANY_ID'),
                        cliente=opportunity.cliente
                    )
                    
                    # Asignar el contacto a la oportunidad
                    opportunity.contacto = contacto_obj
                    opportunity.save()
                    
                    self.stdout.write(self.style.SUCCESS(f"✅ Created and assigned contact: {contacto_obj.nombre} {contacto_obj.apellido}"))
                    
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f"❌ Error creating contact: {e}"))
                    self.stdout.write(self.style.ERROR(f"Contact data: {contact_details}"))
                    import traceback
                    self.stdout.write(self.style.ERROR(f"Traceback: {traceback.format_exc()}"))
                
            except TodoItem.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"❌ Opportunity with Deal ID {deal_id} not found"))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"❌ Unexpected error processing Deal ID {deal_id}: {e}"))
        
        self.stdout.write(self.style.SUCCESS('\n🎯 Specific contact fixing completed!'))