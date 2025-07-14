# Usa una imagen base de Python
FROM python:3.13-slim-bookworm

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /app

# Instala dependencias necesarias para mysqlclient (¡ESTA ES LA LÍNEA QUE FALTA!)
RUN apt-get update && apt-get install -y default-libmysqlclient-dev pkg-config

# Copia el archivo de requisitos e instala las dependencias
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia todo el código de la aplicación al contenedor
COPY . .

# Expone el puerto en el que Gunicorn se ejecutará
EXPOSE 8000

# Comando para ejecutar la aplicación con Gunicorn
# Asegúrate de que 'cartera_clientes.wsgi' sea la ruta correcta a tu archivo wsgi.py
CMD ["gunicorn", "cartera_clientes.wsgi:application", "--bind", "0.0.0.0:8000"]