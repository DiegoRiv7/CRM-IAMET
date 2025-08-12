from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group


class Command(BaseCommand):
    help = 'Crear el grupo de Ingenieros para el sistema de gestión de ventas'

    def handle(self, *args, **options):
        # Crear el grupo 'Ingenieros' si no existe
        engineers_group, created = Group.objects.get_or_create(name='Ingenieros')
        
        if created:
            self.stdout.write(
                self.style.SUCCESS(
                    f'✅ Grupo "Ingenieros" creado exitosamente.'
                )
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    f'⚠️ El grupo "Ingenieros" ya existe.'
                )
            )

        # Mostrar información sobre permisos
        self.stdout.write('\n' + '='*50)
        self.stdout.write('INFORMACIÓN DEL GRUPO INGENIEROS:')
        self.stdout.write('='*50)
        self.stdout.write(f'📋 Nombre del grupo: {engineers_group.name}')
        self.stdout.write(f'🆔 ID del grupo: {engineers_group.id}')
        self.stdout.write(f'👥 Usuarios asignados: {engineers_group.user_set.count()}')
        
        self.stdout.write('\n🔑 PERMISOS DEL GRUPO INGENIEROS:')
        self.stdout.write('-'*30)
        self.stdout.write('• Acceso a Home')
        self.stdout.write('• Acceso a Oportunidades') 
        self.stdout.write('• Acceso EXCLUSIVO a Volumetría')
        self.stdout.write('• Acceso al Asistente Virtual')
        self.stdout.write('• Cerrar Sesión')
        
        self.stdout.write('\n❌ RESTRICCIONES PARA INGENIEROS:')
        self.stdout.write('-'*35)
        self.stdout.write('• Sin acceso a Cotizaciones')
        self.stdout.write('• Sin acceso a Incrementa')
        self.stdout.write('• Sin acceso a Dashboard (solo superusuarios)')
        self.stdout.write('• Sin acceso a funciones administrativas')

        self.stdout.write('\n💡 PARA ASIGNAR USUARIOS AL GRUPO:')
        self.stdout.write('-'*35)
        self.stdout.write('1. Ir al Admin de Django (/admin/)')
        self.stdout.write('2. Seleccionar "Users" en Authentication and Authorization')
        self.stdout.write('3. Editar el usuario deseado')
        self.stdout.write('4. En "Groups", seleccionar "Ingenieros"')
        self.stdout.write('5. Guardar cambios')
        
        self.stdout.write('\n' + '='*50)
        self.stdout.write('✅ Comando ejecutado correctamente.')