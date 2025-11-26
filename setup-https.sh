#!/bin/bash

# Script pour configurer HTTPS manuellement
# Usage: sudo ./setup-https.sh

set -e

DOMAIN="foinouvelle.woutils.com"
APP_DIR="/opt/apps/foinouvelle"
NGINX_CONF="/etc/nginx/sites-available/foinouvelle"

echo "🔒 Configuration HTTPS pour $DOMAIN"
echo "===================================="

if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  Ce script nécessite les privilèges sudo"
    exit 1
fi

# Vérifier que Nginx est installé
if ! command -v nginx &> /dev/null; then
    echo "📦 Installation de Nginx et Certbot..."
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
fi

# Vérifier que le conteneur Docker fonctionne
echo "🐳 Vérification du conteneur Docker..."
cd $APP_DIR
if ! docker compose -f docker-compose.prod.yml ps | grep -q "Up"; then
    echo "❌ Le conteneur Docker n'est pas démarré. Démarrez-le d'abord avec:"
    echo "   cd $APP_DIR && sudo docker compose -f docker-compose.prod.yml up -d"
    exit 1
fi
echo "✅ Conteneur Docker fonctionne"

# Copier la configuration Nginx
echo "🌐 Configuration de Nginx..."
if [ -f "$APP_DIR/nginx.conf" ]; then
    cp "$APP_DIR/nginx.conf" $NGINX_CONF
    # Remplacer le domaine dans la configuration
    sed -i "s/foinouvelle.woutils.com/$DOMAIN/g" $NGINX_CONF
    
    # Créer le lien symbolique
    if [ ! -L "/etc/nginx/sites-enabled/foinouvelle" ]; then
        ln -s $NGINX_CONF /etc/nginx/sites-enabled/foinouvelle
    fi
    
    # Tester la configuration Nginx
    echo "🧪 Test de la configuration Nginx..."
    if nginx -t; then
        echo "✅ Configuration Nginx valide"
        # Recharger Nginx
        systemctl reload nginx
        echo "✅ Nginx rechargé"
    else
        echo "❌ Erreur dans la configuration Nginx"
        exit 1
    fi
else
    echo "❌ Fichier nginx.conf non trouvé dans $APP_DIR"
    exit 1
fi

# Générer le certificat SSL
echo ""
echo "📜 Génération du certificat SSL avec Let's Encrypt..."
echo "⚠️  Assurez-vous que le domaine $DOMAIN pointe vers cette machine!"
echo "⚠️  Les ports 80 et 443 doivent être ouverts dans le firewall"
echo ""

# Vérifier si le certificat existe déjà
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo "✅ Certificat SSL déjà présent pour $DOMAIN"
    certbot certificates | grep -A 5 "$DOMAIN"
else
    echo "📝 Génération du nouveau certificat..."
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect
    
    if [ $? -eq 0 ]; then
        echo "✅ Certificat SSL généré avec succès!"
    else
        echo "❌ Erreur lors de la génération du certificat"
        echo ""
        echo "💡 Vérifiez que:"
        echo "   1. Le domaine $DOMAIN pointe vers cette IP"
        echo "   2. Les ports 80 et 443 sont ouverts"
        echo "   3. Nginx fonctionne correctement"
        echo ""
        echo "Vous pouvez essayer manuellement:"
        echo "   sudo certbot --nginx -d $DOMAIN"
        exit 1
    fi
fi

# Vérifier que HTTPS fonctionne
echo ""
echo "🔍 Vérification de HTTPS..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN || echo "000")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    echo "✅ HTTPS fonctionne correctement! (Code: $HTTP_CODE)"
    echo ""
    echo "🌐 Votre application est accessible sur: https://$DOMAIN"
else
    echo "⚠️  HTTPS ne répond pas encore (Code: $HTTP_CODE)"
    echo "💡 Attendez quelques minutes et réessayez"
fi

echo ""
echo "✨ Configuration HTTPS terminée!"

