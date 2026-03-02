
import os

filepath = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm/_scripts_muro.html'
with open(filepath, 'r') as f:
    content = f.read()

# 1. Precise update for Simulation
sim_old = 'Su compromiso y eficiencia han sido piezas clave en nuestro éxito."'
sim_new = 'Su compromiso ha sido pieza clave en nuestro éxito:\\n\\n✨ <b>Eficiencia General:</b> 98.4%\\n✅ <b>Tareas resueltas:</b> 52\\n🛠 <b>Actividades:</b> 128\\n💰 <b>Venta cobrada:</b> $245,000\\n\\n¡Gracias por dar siempre el 100%! 🚀🔥"'
content = content.replace(sim_old, sim_new)

# 2. Fix the Employee of the Month title repetition
# The sim currently has "🏆 <b>EMPLEADO DEL MES</b> 🏆\n\n" at the start.
# I'll remove it from simulation since the card already has it.
sim_title_old = 'contenido: "🏆 <b>EMPLEADO DEL MES</b> 🏆\\n\\n¡Es un honor anunciar'
sim_title_new = 'contenido: "¡Es un honor anunciar'
content = content.replace(sim_title_old, sim_title_new)

with open(filepath, 'w') as f:
    f.write(content)

print("Success")
