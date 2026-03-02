
import os

filepath = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm/_scripts_muro.html'
with open(filepath, 'r') as f:
    content = f.read()

# 1. Update Simulation with metrics
sim_old = 'contenido: "🏆 <b>EMPLEADO DEL MES</b> 🏆\\n\\nFelicidades a <b>{{ request.user.get_full_name|default:request.user.username }}</b> por su increíble efectividad del <b>98%</b> durante este periodo. ¡Sigamos trabajando con excelencia! 🚀🔥"'
sim_new = 'contenido: "¡Es un honor anunciar que <b>{{ request.user.get_full_name|default:request.user.username }}</b> ha sido seleccionado como el empleado del mes! 🎉\\n\\nSu compromiso ha sido pieza clave en nuestro éxito:\\n\\n✨ <b>Eficiencia General:</b> 98.4%\\n✅ <b>Tareas resueltas:</b> 52\\n🛠 <b>Actividades:</b> 128\\n💰 <b>Venta cobrada:</b> $245,000\\n\\n¡Gracias por dar siempre el 100%! 🚀🔥"'
content = content.replace(sim_old, sim_new)

# 2. Fix Broken Image in Card Rendering
# We will use a more robust check for p.imagen and use the initials if no image is available
card_rendering_old = """        if (esEmpleadoMes) {
            var fotoWinner = p.imagen || '/static/images/default-avatar.png';
            finalContent = '<div style="text-align:center; padding: 1.5rem 1rem; background: linear-gradient(135deg, #FFF9E6, #FFF); border-radius: 12px; border: 1.5px solid #FCD34D; margin-bottom: 0.5rem; position: relative; overflow: hidden;">' +
                           '<div style="position: absolute; top: -10px; right: -10px; font-size: 4rem; opacity: 0.1; transform: rotate(15deg);">🏆</div>' +
                           '<div style="font-size: 1.25rem; font-weight: 800; color: #D97706; margin-bottom: 1.2rem; letter-spacing: 0.02em;">🌟 RECONOCIMIENTO ESPECIAL 🌟</div>' +
                           '<div style="position: relative; display: inline-block; margin-bottom: 1.2rem;">' +
                           '<img src="' + fotoWinner + '" style="width: 130px; height: 130px; border-radius: 50%; border: 4px solid #FCD34D; object-fit: cover; box-shadow: 0 6px 20px rgba(217, 119, 6, 0.2);">' +
                           '<div style="position: absolute; bottom: 5px; right: 5px; background: #F59E0B; color: #fff; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; border: 3px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">🏆</div>' +
                           '</div>' +
                           '<div style="font-size: 1.1rem; line-height: 1.7; color: #374151;">' + finalContent + '</div>' +
                           '</div>';
            imgHtml = ''; // No mostrar la imagen abajo si es EOM, ya que está arriba
        }"""

card_rendering_new = """        if (esEmpleadoMes) {
            var fotoWinner = p.imagen;
            var winnerAvatarHtml = '';
            if (fotoWinner && fotoWinner !== "") {
                winnerAvatarHtml = '<img src="' + fotoWinner + '" style="width: 130px; height: 130px; border-radius: 50%; border: 4px solid #FCD34D; object-fit: cover; box-shadow: 0 6px 20px rgba(217, 119, 6, 0.2);">';
            } else {
                // Fallback to stylized initials if no photo
                winnerAvatarHtml = '<div style="width:130px;height:130px;border-radius:50%;background:linear-gradient(135deg,#F59E0B,#D97706);display:flex;align-items:center;justify-content:center;font-size:3rem;font-weight:800;color:#fff;border:4px solid #FCD34D;box-shadow:0 6px 20px rgba(217, 119, 6, 0.2);">' + 
                                   (p.autor_iniciales || '??') + '</div>';
            }

            finalContent = '<div style="text-align:center; padding: 2rem 1.5rem; background: linear-gradient(135deg, #FFF9E6, #FFF); border-radius: 16px; border: 1.5px solid #FCD34D; margin-bottom: 0.5rem; position: relative; overflow: hidden; box-shadow: inset 0 0 40px rgba(252, 211, 77, 0.1);">' +
                           '<div style="position: absolute; top: -10px; right: -10px; font-size: 5rem; opacity: 0.08; transform: rotate(15deg);">🏆</div>' +
                           '<div style="position: absolute; bottom: -20px; left: -10px; font-size: 4rem; opacity: 0.05; transform: rotate(-10deg);">🌟</div>' +
                           '<div style="font-size: 1.3rem; font-weight: 800; color: #B45309; margin-bottom: 1.5rem; letter-spacing: 0.05em; text-transform: uppercase;">✨ RECONOCIMIENTO ESPECIAL ✨</div>' +
                           '<div style="position: relative; display: inline-block; margin-bottom: 1.5rem;">' +
                           winnerAvatarHtml +
                           '<div style="position: absolute; bottom: 8px; right: 8px; background: #F59E0B; color: #fff; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; border: 3px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">🏆</div>' +
                           '</div>' +
                           '<div style="font-weight: 800; font-size: 1.4rem; color: #1A1A2E; margin-bottom: 0.8rem; letter-spacing: -0.01em;">🏆 EMPLEADO DEL MES 🏆</div>' +
                           '<div style="font-size: 1rem; line-height: 1.7; color: #4B5563; max-width: 480px; margin: 0 auto; text-align: left; background: #fff; padding: 1.2rem; border-radius: 12px; border: 1px solid rgba(252, 211, 77, 0.4);">' + finalContent + '</div>' +
                           '</div>';
            imgHtml = ''; 
        }"""

content = content.replace(card_rendering_old, card_rendering_new)

with open(filepath, 'w') as f:
    f.write(content)

print("Success")
