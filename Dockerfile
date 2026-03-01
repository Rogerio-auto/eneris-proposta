# ==============================================================
# Dockerfile — API Eneris Proposta (Puppeteer + Express)
# ==============================================================
FROM node:20-slim

# Instala dependências do Chromium para Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Cria diretório da aplicação
WORKDIR /app

# Copia package.json e instala dependências
COPY package.json ./
RUN npm install --production

# Copia os arquivos da aplicação
COPY server.js ./

# Copia os templates HTML para a pasta /app/templates
RUN mkdir -p templates
COPY eneris-proposta.htm templates/
COPY eneris-proposta2.htm templates/
COPY proposta2.html templates/

# Porta exposta
ENV PORT=3000
EXPOSE 3000

# Inicia o servidor
CMD ["node", "server.js"]
