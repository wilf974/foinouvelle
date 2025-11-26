#!/bin/bash

# Script pour trouver toutes les références au certificat SSL problématique
# Usage: sudo ./find-ssl-refs.sh

echo "🔍 Recherche des références au certificat SSL de psaumes365..."
echo "=============================================================="

# Chercher dans tous les fichiers de configuration Nginx
echo "📂 Recherche dans /etc/nginx/..."
grep -r "psaumes365.woutils.com" /etc/nginx/ 2>/dev/null | grep -v ".disabled" || echo "Aucune référence trouvée"

echo ""
echo "📂 Recherche des fichiers contenant 'fullchain.pem'..."
grep -r "fullchain.pem" /etc/nginx/ 2>/dev/null | grep -v ".disabled" || echo "Aucune référence trouvée"

echo ""
echo "📂 Liste des fichiers dans sites-enabled:"
ls -la /etc/nginx/sites-enabled/

echo ""
echo "📂 Liste des fichiers dans sites-available:"
ls -la /etc/nginx/sites-available/ | grep -v ".disabled"

