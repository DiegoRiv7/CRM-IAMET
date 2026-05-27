# Usa una imagen base de Python
FROM python:3.13-slim-bookworm

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /app

# Instala dependencias del sistema
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
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Copia el archivo de requisitos e instala las dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia todo el código de la aplicación al contenedor
COPY . .

# Copia y hace ejecutable el script de entrada
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Crea los directorios para archivos estáticos y media
RUN mkdir -p staticfiles media

# Expone el puerto en el que Gunicorn se ejecutará
EXPOSE 8000

# Configura el entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]

# Comando para ejecutar la aplicación con Gunicorn
# workers=5: la máquina tiene 7.7 GiB libres; con polling cada 15s desde varios
# usuarios + PDFs ocasionales, 3 workers gevent se saturaban. 5 deja ~2 libres
# para PDFs o queries pesadas sin bloquear el resto del tráfico.
# timeout=120: requests más largos que esto se matan (PDFs muy grandes mejor offline).
CMD ["gunicorn", "cartera_clientes.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "5", "--worker-class", "gevent", "--timeout", "120", "--max-requests", "1000", "--max-requests-jitter", "100"]