#!/usr/bin/env python
"""
Script para diagnosticar y arreglar problemas de login
"""
import os
import sys
import django

# Configurar Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.contrib.auth.models import User, Group
from app.models import UserProfile

def fix_login_issues():
    """
    Diagnostica y arregla problemas comunes de login
    """
    print("=== DIAGNÓSTICO DE PROBLEMAS DE LOGIN ===\n")
    
    # 1. Verificar que existe el grupo 'Supervisores'
    print("1. Verificando grupo 'Supervisores'...")
    supervisores_group, created = Group.objects.get_or_create(name='Supervisores')
    if created:
        print("   ✅ Grupo 'Supervisores' creado")
    else:
        print("   ✅ Grupo 'Supervisores' ya existe")
    
    # 2. Verificar y crear perfiles de usuario
    print("\n2. Verificando perfiles de usuario...")
    users = User.objects.all()
    
    if not users:
        print("   ❌ No hay usuarios en el sistema")
        print("   💡 Ejecuta: python manage.py createsuperuser")
        return
    
    for user in users:
        profile, created = UserProfile.objects.get_or_create(user=user)
        if created:
            print(f"   ✅ Perfil creado para usuario: {user.username}")
        else:
            print(f"   ✅ Perfil existente para usuario: {user.username}")
    
    # 3. Mostrar estado de usuarios
    print("\n3. Estado de usuarios:")
    for user in users:
        is_supervisor = user.groups.filter(name='Supervisores').exists()
        print(f"   - Usuario: {user.username}")
        print(f"     Activo: {'Sí' if user.is_active else 'No'}")
        print(f"     Superusuario: {'Sí' if user.is_superuser else 'No'}")
        print(f"     Supervisor: {'Sí' if is_supervisor else 'No'}")
        print(f"     Grupos: {[g.name for g in user.groups.all()]}")
        print()
    
    # 4. Crear superusuario de prueba si no hay ningún superusuario
    superusers = User.objects.filter(is_superuser=True)
    if not superusers:
        print("4. No hay superusuarios, creando usuario de prueba...")
        try:
            test_user = User.objects.create_superuser(
                username='admin',
                email='admin@test.com',
                password='admin123'
            )
            UserProfile.objects.get_or_create(user=test_user)
            print("   ✅ Usuario de prueba creado:")
            print("   Username: admin")
            print("   Password: admin123")
            print("   ⚠️  CAMBIA ESTA CONTRASEÑA EN PRODUCCIÓN")
        except Exception as e:
            print(f"   ❌ Error creando usuario de prueba: {e}")
    else:
        print("4. ✅ Ya existen superusuarios en el sistema")
    
    print("\n=== DIAGNÓSTICO COMPLETADO ===")
    print("\n💡 Si el problema persiste:")
    print("1. Verifica que el usuario esté activo")
    print("2. Verifica las URLs en settings.py (LOGIN_URL, LOGIN_REDIRECT_URL)")
    print("3. Revisa los logs del servidor Django")

if __name__ == '__main__':
    fix_login_issues()