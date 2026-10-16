"""
#5 — Cola justa entre empresas para el trabajo caro de CPU (el OCR).

Lo que se prueba: que una empresa con muchas peticiones NO deje esperando a las
demás detrás de todas ellas, que el tope global se respete, y que cuando no
alcanza turno se levante `RecursoOcupado` para degradar en vez de morir en el
timeout del servidor.
"""
import threading
import time

from django.test import SimpleTestCase

import tenants.concurrencia as cc
from tenants.concurrencia import RecursoOcupado, turno
from tenants.context import tenant_context
from tenants.models import Tenant


def _t(slug):
    return Tenant(slug=slug, nombre=slug, db_name=f'crm_{slug}', db_user=f'u_{slug}', db_password='x')


class ColaJustaTests(SimpleTestCase):

    @classmethod
    def tearDownClass(cls):
        # tenant_context registra el alias de BD de cada empresa; Django recorre
        # TODOS los alias al desmontar y tropieza con los que aparecieron a
        # mitad de la prueba.
        from django.db import connections

        from tenants.connections import olvidar_alias
        for a in [a for a in list(connections.databases) if a.startswith('t_')]:
            olvidar_alias(a)
        super().tearDownClass()

    def setUp(self):
        cc._turnos.clear()
        cc._cupos.clear()

    def test_una_empresa_ruidosa_no_bloquea_a_las_demas(self):
        """A lanza 4 peticiones; B lanza 1. B no debe quedar detrás de las 4:
        como A solo puede tener UNA en cola, B compite contra una, no contra cuatro."""
        orden = []
        arrancar = threading.Event()

        def trabajo(tenant, etiqueta, dura):
            def _():
                arrancar.wait()
                try:
                    with turno('prueba', max_global=1, espera=10):
                        orden.append(etiqueta)
                        time.sleep(dura)
                except RecursoOcupado:
                    orden.append(etiqueta + '!')
            with tenant_context(tenant):
                from tenants.context import bind_tenant
                return bind_tenant(_)

        a, b = _t('ruidosa'), _t('tranquila')
        hilos = [threading.Thread(target=trabajo(a, f'A{i}', 0.08)) for i in range(4)]
        hilos.append(threading.Thread(target=trabajo(b, 'B', 0.01)))
        for h in hilos:
            h.start()
        arrancar.set()
        for h in hilos:
            h.join(timeout=20)

        self.assertIn('B', orden, 'B alcanzó turno')
        # Sin la cola justa, B terminaría después de las 4 de A. Con ella, B
        # entra a más tardar tras la primera de A que ya estuviera corriendo.
        self.assertLessEqual(orden.index('B'), 2,
                             f'B no debe esperar a todas las de A (orden: {orden})')

    def test_tope_global_se_respeta(self):
        """Con tope 1, nunca hay dos ejecutándose a la vez (aunque sean de
        empresas distintas): protege la CPU del servidor."""
        simultaneos, pico = 0, 0
        candado = threading.Lock()

        def trabajo(slug):
            def _():
                nonlocal simultaneos, pico
                with turno('prueba', max_global=1, espera=10):
                    with candado:
                        simultaneos += 1
                        pico = max(pico, simultaneos)
                    time.sleep(0.05)
                    with candado:
                        simultaneos -= 1
            with tenant_context(_t(slug)):
                from tenants.context import bind_tenant
                return bind_tenant(_)

        hilos = [threading.Thread(target=trabajo(f'e{i}')) for i in range(5)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join(timeout=20)
        self.assertEqual(pico, 1, 'el tope global debe impedir ejecuciones simultáneas')

    def test_dos_empresas_pueden_correr_a_la_vez_si_el_tope_lo_permite(self):
        simultaneos, pico = 0, 0
        candado = threading.Lock()

        def trabajo(slug):
            def _():
                nonlocal simultaneos, pico
                with turno('prueba2', max_global=2, espera=10):
                    with candado:
                        simultaneos += 1
                        pico = max(pico, simultaneos)
                    time.sleep(0.12)
                    with candado:
                        simultaneos -= 1
            with tenant_context(_t(slug)):
                from tenants.context import bind_tenant
                return bind_tenant(_)

        hilos = [threading.Thread(target=trabajo(f'x{i}')) for i in range(4)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join(timeout=20)
        self.assertEqual(pico, 2, 'con tope 2 deben poder correr dos a la vez')

    def test_sin_turno_a_tiempo_levanta_para_degradar(self):
        """Quien llama debe poder seguir sin el trabajo caro, no morir esperando."""
        listo = threading.Event()
        suelta = threading.Event()

        def ocupante():
            with turno('lento', max_global=1, espera=5):
                listo.set()
                suelta.wait(timeout=5)

        h = threading.Thread(target=ocupante)
        h.start()
        listo.wait(timeout=5)
        with tenant_context(_t('otra')):
            with self.assertRaises(RecursoOcupado):
                with turno('lento', max_global=1, espera=0.2):
                    pass
        suelta.set()
        h.join(timeout=5)

    def test_modo_clasico_sin_empresa_sigue_funcionando(self):
        """Sin multitenant (IAMET) el comportamiento es el de siempre: uno a la vez."""
        with turno('clasico', max_global=1, espera=5):
            pass
        with turno('clasico', max_global=1, espera=5):
            pass  # el turno se libera correctamente
