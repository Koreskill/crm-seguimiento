FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (cache layer)
COPY package*.json ./
RUN npm install --production

# Copiar el resto del código
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
