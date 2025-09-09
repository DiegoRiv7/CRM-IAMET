from django.core.management.base import BaseCommand
from app.models import TodoItem, Contacto
from app.bitrix_integration import get_all_bitrix_deals, get_bitrix_contact_details
from collections import Counter

class Command(BaseCommand):
    help = 'Analyze all opportunities missing contacts and categorize the reasons'

    def add_arguments(self, parser):
        parser.add_argument('--fix', action='store_true', help='Attempt to fix the fixable cases')
        parser.add_argument('--limit', type=int, default=50, help='Limit number of cases to analyze')

    def handle(self, *args, **options):
        fix_mode = options['fix']
        limit = options['limit']
        
        self.stdout.write(self.style.SUCCESS('🔍 Analyzing all missing contacts...'))

        # Obtener oportunidades sin contacto
        missing_contact_opportunities = TodoItem.objects.filter(contacto__isnull=True)
        total_missing = missing_contact_opportunities.count()
        
        self.stdout.write(f"📊 Total opportunities without contact: {total_missing}")
        
        if total_missing == 0:
            self.stdout.write(self.style.SUCCESS("🎉 All opportunities have contacts assigned!"))
            return
        
        # Obtener todas las negociaciones de Bitrix24
        self.stdout.write("📡 Fetching deals from Bitrix24...")
        bitrix_deals = get_all_bitrix_deals()
        
        if not bitrix_deals:
            self.stdout.write(self.style.ERROR("❌ Could not fetch deals from Bitrix24"))
            return
            
        # Crear diccionario para búsqueda rápida
        bitrix_deals_dict = {deal.get('ID'): deal for deal in bitrix_deals}
        
        # Categorías de problemas
        categories = {
            'no_contact_id_bitrix': [],      # Sin CONTACT_ID en Bitrix24
            'contact_id_zero': [],           # CONTACT_ID = 0 
            'contact_not_found_bitrix': [],  # Contacto no encontrado en Bitrix24
            'contact_exists_local': [],      # Contacto existe localmente pero no está asignado
            'api_error': [],                 # Error al obtener datos de API
            'fixable': []                    # Se pueden crear/asignar automáticamente
        }
        
        fixed_count = 0
        analyzed_count = 0
        
        # Analizar casos limitados
        for opportunity in missing_contact_opportunities[:limit]:
            analyzed_count += 1
            self.stdout.write(f"\n--- {analyzed_count}. {opportunity.oportunidad} ---")
            
            # Buscar la negociación correspondiente en Bitrix24
            bitrix_deal = bitrix_deals_dict.get(str(opportunity.bitrix_deal_id))
            
            if not bitrix_deal:
                self.stdout.write("❌ Deal not found in Bitrix24")
                categories['api_error'].append(opportunity)
                continue
            
            contact_id = bitrix_deal.get('CONTACT_ID')
            self.stdout.write(f"Bitrix CONTACT_ID: {contact_id}")
            
            # Categorizar según el tipo de problema
            if not contact_id or contact_id == '0':
                self.stdout.write("ℹ️ No contact assigned in Bitrix24 (normal)")
                if not contact_id:
                    categories['no_contact_id_bitrix'].append(opportunity)
                else:
                    categories['contact_id_zero'].append(opportunity)
                continue
            
            # Verificar si el contacto ya existe localmente
            existing_contact = Contacto.objects.filter(bitrix_contact_id=contact_id).first()
            if existing_contact:
                self.stdout.write(f"🔗 Contact exists locally but not assigned: {existing_contact.nombre} {existing_contact.apellido}")
                categories['contact_exists_local'].append((opportunity, existing_contact))
                
                if fix_mode:
                    try:
                        opportunity.contacto = existing_contact
                        opportunity.save()
                        self.stdout.write(self.style.SUCCESS("✅ FIXED: Assigned existing contact"))
                        fixed_count += 1
                        continue
                    except Exception as e:
                        self.stdout.write(self.style.ERROR(f"❌ Error assigning contact: {e}"))
                continue
            
            # Intentar obtener detalles del contacto de Bitrix24
            self.stdout.write("📡 Fetching contact details from Bitrix24...")
            contact_details = get_bitrix_contact_details(contact_id)
            
            if not contact_details:
                self.stdout.write("❌ Contact not found in Bitrix24")
                categories['contact_not_found_bitrix'].append(opportunity)
                continue
            
            name = contact_details.get('NAME', '')
            last_name = contact_details.get('LAST_NAME', '')
            self.stdout.write(f"📝 Contact info: {name} {last_name}")
            
            # Este caso es fixable
            categories['fixable'].append((opportunity, contact_details, contact_id))
            
            if fix_mode:
                try:
                    # Crear el contacto
                    contacto_obj = Contacto.objects.create(
                        nombre=name or 'Sin nombre',
                        apellido=last_name or '',
                        bitrix_contact_id=contact_id,
                        company_id=contact_details.get('COMPANY_ID'),
                        cliente=opportunity.cliente
                    )
                    
                    # Asignar a la oportunidad
                    opportunity.contacto = contacto_obj
                    opportunity.save()
                    
                    self.stdout.write(self.style.SUCCESS(f"✅ FIXED: Created and assigned contact: {contacto_obj.nombre} {contacto_obj.apellido}"))
                    fixed_count += 1
                    
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f"❌ Error creating contact: {e}"))
        
        # Mostrar resumen por categorías
        self.stdout.write(self.style.SUCCESS(f'\n📈 ANALYSIS SUMMARY (of {analyzed_count} analyzed):'))
        self.stdout.write(f"🚫 No CONTACT_ID in Bitrix24: {len(categories['no_contact_id_bitrix'])}")
        self.stdout.write(f"0️⃣ CONTACT_ID = 0 (normal): {len(categories['contact_id_zero'])}")
        self.stdout.write(f"❌ Contact not found in Bitrix24: {len(categories['contact_not_found_bitrix'])}")
        self.stdout.write(f"🔗 Contact exists locally but not assigned: {len(categories['contact_exists_local'])}")
        self.stdout.write(f"🛠️ API errors: {len(categories['api_error'])}")
        self.stdout.write(f"✅ Fixable cases: {len(categories['fixable'])}")
        
        if fix_mode:
            self.stdout.write(self.style.SUCCESS(f"\n🔧 FIXED: {fixed_count} opportunities"))
            remaining = total_missing - fixed_count
            self.stdout.write(f"📊 Remaining without contact: {remaining}")
        else:
            total_fixable = len(categories['contact_exists_local']) + len(categories['fixable'])
            self.stdout.write(f"\n💡 FIXABLE: {total_fixable} opportunities can be fixed")
            self.stdout.write("Run with --fix flag to automatically fix them!")
        
        # Mostrar algunos ejemplos de cada categoría
        if categories['contact_exists_local']:
            self.stdout.write(f"\n🔗 Examples of existing contacts not assigned:")
            for i, (opp, contact) in enumerate(categories['contact_exists_local'][:3]):
                self.stdout.write(f"   • {opp.oportunidad} → {contact.nombre} {contact.apellido}")
        
        if categories['fixable']:
            self.stdout.write(f"\n✅ Examples of fixable cases:")
            for i, (opp, details, _) in enumerate(categories['fixable'][:3]):
                name = details.get('NAME', '')
                last_name = details.get('LAST_NAME', '')
                self.stdout.write(f"   • {opp.oportunidad} → {name} {last_name}")
        
        if categories['no_contact_id_bitrix']:
            self.stdout.write(f"\n🚫 Examples with no contact in Bitrix24 (normal):")
            for i, opp in enumerate(categories['no_contact_id_bitrix'][:3]):
                self.stdout.write(f"   • {opp.oportunidad}")
        
        self.stdout.write(self.style.SUCCESS('\n🎯 Analysis completed!'))