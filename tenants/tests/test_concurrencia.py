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
        """A tiene 4 peticiones en marcha; B llega con una. B NO debe quedar
        detrás de las cuatro.

        La prueba arranca una de A primero y espera a que esté dentro, para que
        el escenario sea siempre el mismo: con una empresa ocupando el recurso,
        llega B y después llegan las otras tres de A. Si el reparto fuera por
        orden de llegada de verdad, B entra en segundo lugar. (Antes esto pasaba
        o fallaba según el humor del planificador de hilos, y en el servidor
        fallaba: B entraba de última.)
        """
        orden = []
        dentro = threading.Event()
        soltar = threading.Event()

        def primera():
            with tenant_context(_t('ruidosa')):
                from tenants.context import bind_tenant

                def _():
                    with turno('prueba', max_global=1, espera=10):
                        orden.append('A0')
                        dentro.set()
                        soltar.wait(timeout=5)
                return bind_tenant(_)

        def trabajo(tenant, etiqueta):
            with tenant_context(tenant):
                from tenants.context import bind_tenant

                def _():
                    try:
                        with turno('prueba', max_global=1, espera=10):
                            orden.append(etiqueta)
                            time.sleep(0.03)
                    except RecursoOcupado:
                        orden.append(etiqueta + '!')
                return bind_tenant(_)

        h0 = threading.Thread(target=primera())
        h0.start()
        self.assertTrue(dentro.wait(timeout=5), 'la primera entró')

        hb = threading.Thread(target=trabajo(_t('tranquila'), 'B'))
        hb.start()
        time.sleep(0.15)                      # B ya está formada
        resto = [threading.Thread(target=trabajo(_t('ruidosa'), f'A{i}')) for i in range(1, 4)]
        for h in resto:
            h.start()
        time.sleep(0.15)                      # las de A llegaron DESPUÉS que B
        soltar.set()
        for h in [h0, hb, *resto]:
            h.join(timeout=20)

        self.assertEqual(orden[0], 'A0')
        self.assertEqual(orden[1], 'B',
                         f'B llegó antes que las otras de A: debe entrar segunda (orden: {orden})')

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
