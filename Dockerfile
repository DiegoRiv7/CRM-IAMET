# Usa una imagen base de Python
FROM python:3.13-slim-bookworm

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /app

# Instala dependencias necesarias para mysqlclient y herramientas de compilación
RUN apt-get update && apt-get install -y \
    default-libmysqlclient-dev \
    pkg-config \
    build-essential \
    python3-dev \
    libcairo2 \
    libpango-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    fonts-dejavu-core \
    fonts-noto-color-emoji \
    libpangoft2-1.0-0 \
    libharfbuzz-icu0 \
    && rm -rf /var/lib/apt/lists/*

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