#!/bin/bash

# Script pour corriger les configurations Nginx avec certificats SSL manquants
# Usage: sudo ./fix-nginx.sh

set -e

echo "🔧 Correction des configurations Nginx"
echo "======================================"

if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  Ce script nécessite les privilèges sudo"
    exit 1
fi

# Trouver toutes les configurations Nginx avec des certificats SSL manquants
echo "🔍 Recherche des configurations problématiques..."

NGINX_SITES="/etc/nginx/sites-enabled"

# Désactiver temporairement les sites avec certificats SSL manquants
for site in $(ls $NGINX_SITES); do
    SITE_PATH="$NGINX_SITES/$site"
    
    # Vérifier si la configuration référence un certificat SSL
    if grep -q "ssl_certificate" "$SITE_PATH" 2>/dev/null; then
        # Extraire le chemin du certificat
        CERT_PATH=$(grep "ssl_certificate" "$SITE_PATH" | head -1 | awk '{print $2}' | tr -d ';')
        
        if [ -n "$CERT_PATH" ] && [ ! -f "$CERT_PATH" ]; then
            echo "⚠️  Site $site référence un certificat manquant: $CERT_PATH"
            echo "📝 Commentaire de la section SSL..."
            
            # Créer une sauvegarde
            cp "$SITE_PATH" "$SITE_PATH.backup"
            
            # Commenter les lignes SSL
            sed -i 's/^[[:space:]]*ssl_certificate/#ssl_certificate/g' "$SITE_PATH"
            sed -i 's/^[[:space:]]*ssl_certificate_key/#ssl_certificate_key/g' "$SITE_PATH"
            sed -i 's/^[[:space:]]*listen[[:space:]]*443/listen 80 #443/g' "$SITE_PATH"
            sed -i 's/^[[:space:]]*ssl_protocols/#ssl_protocols/g' "$SITE_PATH"
            sed -i 's/^[[:space:]]*ssl_ciphers/#ssl_ciphers/g' "$SITE_PATH"
            
            echo "✅ Configuration $site corrigée (SSL commenté)"
        fi
    fi
done

# Tester la configuration Nginx
echo ""
echo "🧪 Test de la configuration Nginx..."
if nginx -t; then
    echo "✅ Configuration Nginx valide"
    systemctl reload nginx
    echo "✅ Nginx rechargé"
else
    echo "❌ Erreur dans la configuration Nginx"
    echo "💡 Vérifiez les erreurs ci-dessus"
    exit 1
fi

echo ""
echo "✨ Correction terminée!"
echo "💡 Vous pouvez maintenant configurer HTTPS pour foinouvelle.woutils.com"

