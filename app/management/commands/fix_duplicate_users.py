from django.core.management.base import BaseCommand
from app.models import UserProfile, TodoItem
from django.contrib.auth.models import User
from collections import Counter

class Command(BaseCommand):
    help = 'Fix duplicate UserProfile entries that are causing import errors'

    def add_arguments(self, parser):
        parser.add_argument('--fix', action='store_true', help='Actually fix the duplicates, otherwise just show them')

    def handle(self, *args, **options):
        fix_mode = options['fix']
        
        self.stdout.write(self.style.SUCCESS('🔍 Analyzing duplicate UserProfiles...'))

        # Encontrar bitrix_user_ids duplicados
        all_profiles = UserProfile.objects.all()
        bitrix_ids = [profile.bitrix_user_id for profile in all_profiles if profile.bitrix_user_id]
        
        # Contar duplicados
        id_counts = Counter(bitrix_ids)
        duplicates = {bitrix_id: count for bitrix_id, count in id_counts.items() if count > 1}
        
        if not duplicates:
            self.stdout.write(self.style.SUCCESS('🎉 No duplicate UserProfiles found!'))
            return
        
        self.stdout.write(f"📊 Found {len(duplicates)} Bitrix user IDs with duplicates:")
        
        for bitrix_id, count in duplicates.items():
            self.stdout.write(f"\n🔄 Bitrix User ID {bitrix_id} has {count} UserProfiles:")
            
            profiles = UserProfile.objects.filter(bitrix_user_id=bitrix_id)
            
            for i, profile in enumerate(profiles):
                user = profile.user
                self.stdout.write(f"   {i+1}. User: {user.username} ({user.first_name} {user.last_name}) - ID: {user.id}")
                
                # Ver cuántas oportunidades tiene asignadas
                opportunity_count = TodoItem.objects.filter(usuario=user).count()
                self.stdout.write(f"      Opportunities assigned: {opportunity_count}")
            
            if fix_mode:
                self.stdout.write("🔧 Fixing duplicates...")
                
                # Estrategia: mantener el que tenga más oportunidades asignadas
                # Si empate, mantener el más reciente
                profiles_with_counts = []
                for profile in profiles:
                    opp_count = TodoItem.objects.filter(usuario=profile.user).count()
                    profiles_with_counts.append((profile, opp_count))
                
                # Ordenar por: 1) más oportunidades, 2) ID más alto (más reciente)
                profiles_with_counts.sort(key=lambda x: (x[1], x[0].user.id), reverse=True)
                
                keep_profile = profiles_with_counts[0][0]
                remove_profiles = [p[0] for p in profiles_with_counts[1:]]
                
                self.stdout.write(f"   ✅ KEEPING: {keep_profile.user.username} (ID: {keep_profile.user.id})")
                
                for profile_to_remove in remove_profiles:
                    user_to_remove = profile_to_remove.user
                    self.stdout.write(f"   🗑️  REMOVING: {user_to_remove.username} (ID: {user_to_remove.id})")
                    
                    # Reasignar todas las oportunidades del usuario duplicado al usuario que conservamos
                    opportunities_to_reassign = TodoItem.objects.filter(usuario=user_to_remove)
                    count_reassigned = opportunities_to_reassign.count()
                    
                    if count_reassigned > 0:
                        opportunities_to_reassign.update(usuario=keep_profile.user)
                        self.stdout.write(f"      📝 Reassigned {count_reassigned} opportunities")
                    
                    # Eliminar el UserProfile duplicado
                    try:
                        profile_to_remove.delete()
                        self.stdout.write(f"      ✅ Deleted UserProfile")
                        
                        # Si el User no tiene otros UserProfiles, también lo eliminamos
                        if not UserProfile.objects.filter(user=user_to_remove).exists():
                            user_to_remove.delete()
                            self.stdout.write(f"      ✅ Deleted User")
                            
                    except Exception as e:
                        self.stdout.write(self.style.ERROR(f"      ❌ Error deleting: {e}"))
        
        if fix_mode:
            self.stdout.write(self.style.SUCCESS('\n🎯 Duplicate fixing completed!'))
            self.stdout.write('Now you can run import_bitrix_opportunities again without duplicate errors.')
        else:
            self.stdout.write('\n💡 Run with --fix flag to automatically resolve duplicates')
            self.stdout.write('Strategy: Keep the user with most opportunities, reassign others')