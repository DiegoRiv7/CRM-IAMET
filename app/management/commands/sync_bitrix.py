from django.core.management.base import BaseCommand
from app.models import Cliente
from app.bitrix_integration import get_all_bitrix_companies

class Command(BaseCommand):
    help = 'Sincroniza los clientes de Bitrix24 con la base de datos local'

    def handle(self, *args, **options):
        self.stdout.write('Iniciando la sincronización de clientes de Bitrix24...')
        clientes_bitrix = get_all_bitrix_companies()
        
        if clientes_bitrix:
            for cliente_b in clientes_bitrix:
                bitrix_id = cliente_b['ID']
                nombre_empresa = cliente_b['TITLE']
                
                cliente, created = Cliente.objects.get_or_create(
                    bitrix_company_id=bitrix_id,
                    defaults={'nombre_empresa': nombre_empresa}
                )
                
                if created:
                    self.stdout.write(self.style.SUCCESS(f'Cliente "{nombre_empresa}" creado.'))
                else:
                    # Opcional: Actualizar el nombre si ha cambiado
                    if cliente.nombre_empresa != nombre_empresa:
                        cliente.nombre_empresa = nombre_empresa
                        cliente.save()
                        self.stdout.write(self.style.SUCCESS(f'Cliente "{nombre_empresa}" actualizado.'))

            self.stdout.write(self.style.SUCCESS('Sincronización completada.'))
        else:
            self.stdout.write(self.style.WARNING('No se pudieron obtener clientes de Bitrix24.'))
