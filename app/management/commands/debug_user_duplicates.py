from django.core.management.base import BaseCommand
from app.models import UserProfile, TodoItem
from django.contrib.auth.models import User
from app.bitrix_integration import get_all_bitrix_deals
from collections import Counter

class Command(BaseCommand):
    help = 'Debug the specific UserProfile duplicate errors from import'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('🔍 Debugging UserProfile duplicate errors...'))

        # Obtener algunos deals problemáticos de los logs
        problematic_deal_ids = [424, 426, 428, 430, 432, 444, 478, 498, 504, 506, 510]
        
        self.stdout.write('📡 Fetching deals from Bitrix24...')
        bitrix_deals = get_all_bitrix_deals()
        
        if not bitrix_deals:
            self.stdout.write(self.style.ERROR('❌ Could not fetch deals from Bitrix24'))
            return
            
        # Crear diccionario para búsqueda rápida
        bitrix_deals_dict = {deal.get('ID'): deal for deal in bitrix_deals}
        
        # Analizar cada deal problemático
        for deal_id in problematic_deal_ids:
            deal_id_str = str(deal_id)
            self.stdout.write(f'\n--- Deal ID {deal_id} ---')
            
            bitrix_deal = bitrix_deals_dict.get(deal_id_str)
            if not bitrix_deal:
                self.stdout.write('❌ Deal not found in Bitrix24')
                continue
                
            assigned_by_id = bitrix_deal.get('ASSIGNED_BY_ID')
            self.stdout.write(f'ASSIGNED_BY_ID: {assigned_by_id}')
            
            if assigned_by_id:
                # Buscar UserProfiles con este bitrix_user_id
                profiles = UserProfile.objects.filter(bitrix_user_id=assigned_by_id)
                count = profiles.count()
                
                self.stdout.write(f'UserProfiles found: {count}')
                
                if count > 1:
                    self.stdout.write('🔥 DUPLICATE FOUND!')
                    for i, profile in enumerate(profiles):
                        user = profile.user
                        opp_count = TodoItem.objects.filter(usuario=user).count()
                        self.stdout.write(f'  {i+1}. User: {user.username} (ID: {user.id}) - {user.first_name} {user.last_name}')
                        self.stdout.write(f'      Opportunities: {opp_count}')
                        self.stdout.write(f'      UserProfile ID: {profile.id}')
                        self.stdout.write(f'      Bitrix User ID: {profile.bitrix_user_id}')
                elif count == 1:
                    profile = profiles.first()
                    self.stdout.write(f'✅ Single profile: {profile.user.username}')
                else:
                    self.stdout.write('❌ No UserProfile found')
        
        # Análisis general de duplicados
        self.stdout.write('\n📊 GENERAL ANALYSIS:')
        
        # Buscar todos los bitrix_user_ids duplicados
        all_profiles = UserProfile.objects.exclude(bitrix_user_id__isnull=True)
        bitrix_ids = [profile.bitrix_user_id for profile in all_profiles]
        id_counts = Counter(bitrix_ids)
        duplicates = {bitrix_id: count for bitrix_id, count in id_counts.items() if count > 1}
        
        if duplicates:
            self.stdout.write(f'🔥 Found {len(duplicates)} Bitrix IDs with duplicates:')
            for bitrix_id, count in duplicates.items():
                self.stdout.write(f'  Bitrix ID {bitrix_id}: {count} profiles')
                profiles = UserProfile.objects.filter(bitrix_user_id=bitrix_id)
                for profile in profiles:
                    self.stdout.write(f'    - {profile.user.username} (User ID: {profile.user.id})')
        else:
            self.stdout.write('✅ No duplicate bitrix_user_ids found in database')
        
        # Verificar si hay Users sin UserProfile
        users_without_profile = User.objects.filter(userprofile__isnull=True)
        if users_without_profile.exists():
            self.stdout.write(f'\n⚠️  Found {users_without_profile.count()} Users without UserProfile:')
            for user in users_without_profile[:5]:
                self.stdout.write(f'  - {user.username} (ID: {user.id})')
        
        # Verificar si hay UserProfiles con bitrix_user_id nulo o vacío
        null_profiles = UserProfile.objects.filter(bitrix_user_id__isnull=True)
        if null_profiles.exists():
            self.stdout.write(f'\n⚠️  Found {null_profiles.count()} UserProfiles without bitrix_user_id:')
            for profile in null_profiles[:5]:
                self.stdout.write(f'  - {profile.user.username} (Profile ID: {profile.id})')
        
        self.stdout.write(self.style.SUCCESS('\n🎯 Debug analysis completed!'))