# Guide de Déploiement - Foi Nouvelle

Ce guide explique comment déployer l'application Foi Nouvelle sur un VPS avec HTTPS.

## 📋 Prérequis

- VPS avec Ubuntu/Debian
- Accès root ou sudo
- Docker et Docker Compose installés
- Domaine pointant vers l'IP du VPS (foinouvelle.woutils.com)

## 🚀 Installation rapide

### 1. Se connecter au VPS

```bash
ssh user@votre-vps-ip
```

### 2. Installer Docker et Docker Compose (si nécessaire)

```bash
# Mettre à jour le système
sudo apt-get update
sudo apt-get upgrade -y

# Installer Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Installer Docker Compose
sudo apt-get install -y docker-compose-plugin

# Ajouter l'utilisateur au groupe docker
sudo usermod -aG docker $USER
newgrp docker
```

### 3. Cloner le dépôt et déployer

```bash
# Cloner le dépôt
cd /opt
sudo mkdir -p apps
cd apps
sudo git clone https://github.com/wilf974/foinouvelle.git
cd foinouvelle

# Rendre le script exécutable
sudo chmod +x deploy.sh

# Exécuter le script de déploiement
sudo ./deploy.sh
```

### 4. Configurer le fichier .env

Le script vous demandera de configurer le fichier `.env`. Éditez-le :

```bash
sudo nano /opt/apps/foinouvelle/.env
```

Assurez-vous que toutes les variables sont correctement configurées :
- `API_KEY` : Votre clé API Google Gemini
- `CONTACT_EMAIL` : Email de contact
- `CONTACT_PHONE` : Téléphone de contact
- `ADMIN_NOTIFICATION_EMAIL` : Email d'administration
- `PORT` : 2000 (par défaut)

## 🔧 Déploiement manuel (alternative)

Si vous préférez déployer manuellement :

### 1. Cloner le dépôt

```bash
cd /opt/apps
sudo git clone https://github.com/wilf974/foinouvelle.git
cd foinouvelle
```

### 2. Créer le fichier .env

```bash
sudo cp .env.example .env
sudo nano .env
# Éditez avec vos valeurs
```

### 3. Démarrer avec Docker Compose

```bash
sudo docker compose -f docker-compose.prod.yml up -d --build
```

### 4. Configurer Nginx

```bash
# Copier la configuration
sudo cp nginx.conf /etc/nginx/sites-available/foinouvelle

# Remplacer le domaine si nécessaire
sudo sed -i 's/foinouvelle.woutils.com/votre-domaine.com/g' /etc/nginx/sites-available/foinouvelle

# Activer le site
sudo ln -s /etc/nginx/sites-available/foinouvelle /etc/nginx/sites-enabled/

# Tester la configuration
sudo nginx -t

# Recharger Nginx
sudo systemctl reload nginx
```

### 5. Configurer SSL avec Let's Encrypt

```bash
# Installer Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Obtenir le certificat SSL
sudo certbot --nginx -d foinouvelle.woutils.com

# Le certificat sera automatiquement renouvelé
```

## 🔄 Mise à jour de l'application

Pour mettre à jour l'application :

```bash
cd /opt/apps/foinouvelle
sudo git pull origin main
sudo docker compose -f docker-compose.prod.yml down
sudo docker compose -f docker-compose.prod.yml build --no-cache
sudo docker compose -f docker-compose.prod.yml up -d
```

## 📊 Commandes utiles

### Voir les logs

```bash
cd /opt/apps/foinouvelle
sudo docker compose -f docker-compose.prod.yml logs -f
```

### Redémarrer l'application

```bash
cd /opt/apps/foinouvelle
sudo docker compose -f docker-compose.prod.yml restart
```

### Arrêter l'application

```bash
cd /opt/apps/foinouvelle
sudo docker compose -f docker-compose.prod.yml down
```

### Vérifier le statut

```bash
sudo docker compose -f docker-compose.prod.yml ps
```

### Vérifier les logs Nginx

```bash
sudo tail -f /var/log/nginx/foinouvelle-access.log
sudo tail -f /var/log/nginx/foinouvelle-error.log
```

## 🔒 Sécurité

- Le fichier `.env` contient des informations sensibles, ne le partagez jamais
- Le port 2000 n'est exposé que sur localhost (127.0.0.1)
- HTTPS est configuré avec des certificats Let's Encrypt
- Les headers de sécurité sont configurés dans Nginx

## 🐛 Dépannage

### Le conteneur ne démarre pas

```bash
# Voir les logs
sudo docker compose -f docker-compose.prod.yml logs

# Vérifier les variables d'environnement
sudo docker compose -f docker-compose.prod.yml config
```

### Nginx ne fonctionne pas

```bash
# Tester la configuration
sudo nginx -t

# Voir les erreurs
sudo tail -f /var/log/nginx/error.log
```

### Le certificat SSL expire

```bash
# Renouveler manuellement
sudo certbot renew

# Tester le renouvellement
sudo certbot renew --dry-run
```

## 📝 Notes

- L'application est accessible sur : https://foinouvelle.woutils.com
- Le port 2000 est uniquement accessible via Nginx (reverse proxy)
- Les certificats SSL sont automatiquement renouvelés par Certbot


