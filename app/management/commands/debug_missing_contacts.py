from django.core.management.base import BaseCommand
from app.models import TodoItem
from app.bitrix_integration import get_all_bitrix_deals, get_bitrix_contact_details

class Command(BaseCommand):
    help = 'Debug opportunities missing contacts to see why they are not being assigned'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('🔍 Debugging missing contacts...'))

        # Obtener oportunidades sin contacto
        missing_contact_opportunities = TodoItem.objects.filter(contacto__isnull=True)
        
        self.stdout.write(f"📊 Found {missing_contact_opportunities.count()} opportunities without contact")
        
        # Obtener todas las negociaciones de Bitrix24
        self.stdout.write("📡 Fetching deals from Bitrix24...")
        bitrix_deals = get_all_bitrix_deals()
        
        if not bitrix_deals:
            self.stdout.write(self.style.ERROR("❌ Could not fetch deals from Bitrix24"))
            return
            
        self.stdout.write(f"✅ Got {len(bitrix_deals)} deals from Bitrix24")
        
        # Crear diccionario para búsqueda rápida
        bitrix_deals_dict = {deal.get('ID'): deal for deal in bitrix_deals}
        
        count = 0
        for opportunity in missing_contact_opportunities[:10]:  # Solo los primeros 10 para no saturar
            count += 1
            self.stdout.write(f"\n--- {count}. {opportunity.oportunidad} ---")
            self.stdout.write(f"Django ID: {opportunity.id}")
            self.stdout.write(f"Bitrix Deal ID: {opportunity.bitrix_deal_id}")
            
            # Buscar la negociación correspondiente en Bitrix24
            bitrix_deal = bitrix_deals_dict.get(str(opportunity.bitrix_deal_id))
            
            if bitrix_deal:
                contact_id = bitrix_deal.get('CONTACT_ID')
                self.stdout.write(f"Bitrix CONTACT_ID: {contact_id}")
                
                if contact_id and contact_id != '0':
                    self.stdout.write("🔍 Has contact ID, fetching details...")
                    contact_details = get_bitrix_contact_details(contact_id)
                    
                    if contact_details:
                        name = contact_details.get('NAME', '')
                        last_name = contact_details.get('LAST_NAME', '')
                        self.stdout.write(f"✅ Contact details found: {name} {last_name}")
                    else:
                        self.stdout.write("❌ Could not fetch contact details")
                else:
                    self.stdout.write("ℹ️ No CONTACT_ID in Bitrix deal")
            else:
                self.stdout.write("❌ Deal not found in Bitrix24 response")
        
        self.stdout.write(self.style.SUCCESS(f'\n🎯 Debugging completed. Checked {count} opportunities.'))