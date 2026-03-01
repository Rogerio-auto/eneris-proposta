# ==============================================================
# Dockerfile — API Eneris Proposta (Puppeteer + Express)
# ==============================================================
FROM node:20-bookworm

# Instala Chromium do sistema + todas as dependências
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Pula o download do Chromium do Puppeteer (usa o do sistema)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

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
