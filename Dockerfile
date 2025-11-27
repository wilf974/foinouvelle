# Image de base Node.js
FROM node:18-alpine

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package.json ./

# Installer les dépendances
RUN npm install --production

# Copier les fichiers de l'application
COPY index.html ./
COPY server.js ./

# Exposer le port
EXPOSE 2000

# Commande de démarrage
CMD ["node", "server.js"]


