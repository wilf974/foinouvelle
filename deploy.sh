#!/bin/bash

# Script de déploiement pour Foi Nouvelle sur VPS
# Usage: ./deploy.sh

set -e  # Arrêter en cas d'erreur

# Configuration
APP_NAME="foinouvelle"
APP_DIR="/opt/apps/foinouvelle"
DOMAIN="foinouvelle.woutils.com"
REPO_URL="https://github.com/wilf974/foinouvelle.git"

echo "🚀 Déploiement de Foi Nouvelle sur $DOMAIN"
echo "=========================================="

# Vérifier si on est root ou sudo
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  Ce script nécessite les privilèges sudo"
    exit 1
fi

# Créer le répertoire de l'application
echo "📁 Création du répertoire $APP_DIR..."
mkdir -p $APP_DIR
cd $APP_DIR

# Cloner ou mettre à jour le dépôt
if [ -d ".git" ]; then
    echo "🔄 Mise à jour du dépôt Git..."
    git pull origin main
else
    # Si le répertoire existe mais n'est pas un dépôt Git, le nettoyer
    if [ "$(ls -A $APP_DIR 2>/dev/null)" ]; then
        echo "⚠️  Le répertoire $APP_DIR existe mais n'est pas un dépôt Git"
        echo "📦 Nettoyage du répertoire..."
        # Sauvegarder .env s'il existe
        if [ -f ".env" ]; then
            echo "💾 Sauvegarde du fichier .env..."
            cp .env /tmp/foinouvelle.env.backup
        fi
        # Supprimer tout sauf .env si présent
        find . -mindepth 1 -maxdepth 1 ! -name '.env' -exec rm -rf {} +
        # Restaurer .env si sauvegardé
        if [ -f "/tmp/foinouvelle.env.backup" ]; then
            mv /tmp/foinouvelle.env.backup .env
        fi
    fi
    echo "📥 Clonage du dépôt Git..."
    git clone $REPO_URL .
fi

# S'assurer qu'on est dans le bon répertoire
cd $APP_DIR

# Créer le fichier .env s'il n'existe pas
if [ ! -f ".env" ]; then
    echo "📝 Création du fichier .env..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        # Créer un fichier .env avec les valeurs par défaut
        cat > .env << 'EOF'
# Clé API Google Gemini
API_KEY=

# Informations de contact
CONTACT_EMAIL=bethelcorse@gmail.com
CONTACT_PHONE=04 95 20 76 43

# Email d'administration pour les notifications
ADMIN_NOTIFICATION_EMAIL=jean.maillot14@gmail.com

# Port du serveur
PORT=2000
EOF
    fi
    echo "⚠️  IMPORTANT: Modifiez le fichier .env avec vos clés API avant de continuer!"
    echo "   Éditez: nano $APP_DIR/.env"
    read -p "Appuyez sur Entrée après avoir configuré le fichier .env..."
fi

# Construire et démarrer les conteneurs Docker
echo "🐳 Construction et démarrage des conteneurs Docker..."
docker compose -f docker-compose.prod.yml down 2>/dev/null || true
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

# Attendre que le conteneur soit prêt
echo "⏳ Attente du démarrage du conteneur..."
sleep 5

# Vérifier que le conteneur fonctionne
if docker compose -f docker-compose.prod.yml ps | grep -q "Up"; then
    echo "✅ Conteneur démarré avec succès!"
else
    echo "❌ Erreur: Le conteneur n'a pas démarré correctement"
    docker compose -f docker-compose.prod.yml logs
    exit 1
fi

# Configuration Nginx
echo "🌐 Configuration de Nginx..."

# Vérifier si Nginx est installé
if ! command -v nginx &> /dev/null; then
    echo "📦 Installation de Nginx..."
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
fi

# Copier la configuration Nginx
NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
if [ -f "nginx.conf" ]; then
    cp nginx.conf $NGINX_CONF
    # Remplacer le domaine dans la configuration
    sed -i "s/foinouvelle.woutils.com/$DOMAIN/g" $NGINX_CONF
    
    # Créer le lien symbolique
    if [ ! -L "/etc/nginx/sites-enabled/$APP_NAME" ]; then
        ln -s $NGINX_CONF /etc/nginx/sites-enabled/$APP_NAME
    fi
    
    # Tester la configuration Nginx
    nginx -t
    
    # Recharger Nginx
    systemctl reload nginx
    echo "✅ Configuration Nginx appliquée"
else
    echo "⚠️  Fichier nginx.conf non trouvé, configuration Nginx ignorée"
fi

# Configuration SSL avec Let's Encrypt
echo "🔒 Configuration du certificat SSL..."

# Vérifier si le certificat existe déjà
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo "📜 Génération du certificat SSL avec Let's Encrypt..."
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect
    echo "✅ Certificat SSL généré"
else
    echo "✅ Certificat SSL déjà présent"
    # Renouveler le certificat si nécessaire
    certbot renew --quiet
fi

echo ""
echo "✨ Déploiement terminé avec succès!"
echo "🌐 Application accessible sur: https://$DOMAIN"
echo ""
echo "📋 Commandes utiles:"
echo "   - Voir les logs: cd $APP_DIR && docker compose -f docker-compose.prod.yml logs -f"
echo "   - Redémarrer: cd $APP_DIR && docker compose -f docker-compose.prod.yml restart"
echo "   - Arrêter: cd $APP_DIR && docker compose -f docker-compose.prod.yml down"

