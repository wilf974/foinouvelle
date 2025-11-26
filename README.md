# Foi Nouvelle - Application d'Évangélisation

Application web d'évangélisation avec support multilingue, modération IA des témoignages et base de données SQLite.

## 🚀 Démarrage rapide avec Docker

### 1. Créer le fichier .env

Créez un fichier `.env` à la racine du projet avec le contenu suivant :

```env
# Clé API Google Gemini
API_KEY=AIzaSyCBluPCMBtBZWM0ODd10r1OMSS6P8H_2gI

# Informations de contact
CONTACT_EMAIL=bethelcorse@gmail.com
CONTACT_PHONE=04 95 20 76 43

# Email d'administration pour les notifications
ADMIN_NOTIFICATION_EMAIL=jean.maillot14@gmail.com

# Port du serveur
PORT=2000
```

### 2. Lancer avec Docker Compose

```bash
docker-compose up -d
```

L'application sera accessible sur http://localhost:2000

### 3. Arrêter l'application

```bash
docker-compose down
```

## 📦 Structure du projet

- `index.html` - Application web principale
- `server.js` - Serveur Node.js qui injecte les variables d'environnement
- `package.json` - Dépendances Node.js
- `Dockerfile` - Configuration Docker
- `docker-compose.yml` - Configuration Docker Compose
- `.env` - Variables d'environnement (à créer)

## 🔧 Développement local (sans Docker)

### Prérequis

- Node.js 18+

### Installation

```bash
npm install
```

### Lancer le serveur

```bash
npm start
```

L'application sera accessible sur http://localhost:2000

## 🌍 Fonctionnalités

- Support multilingue (8 langues : FR, EN, ES, DE, IT, PT, NL, PL)
- Modération IA des témoignages avec Google Gemini
- Base de données SQLite locale (stockée dans IndexedDB)
- Recherche d'églises via Google
- Partage social
- Interface responsive

## 🔐 Sécurité

⚠️ **Important** : Ne commitez jamais le fichier `.env` dans Git. Il contient des clés API sensibles.

Le fichier `.env` est déjà dans `.gitignore` et `.dockerignore`.

