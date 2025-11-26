#!/bin/bash

# Script de nettoyage pour corriger la structure du dépôt
# Usage: sudo ./cleanup.sh

set -e

APP_DIR="/opt/apps/foinouvelle"
REPO_URL="https://github.com/wilf974/foinouvelle.git"

echo "🧹 Nettoyage de la structure du dépôt"
echo "======================================"

if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  Ce script nécessite les privilèges sudo"
    exit 1
fi

# Aller dans le répertoire parent
cd /opt/apps

# Si le sous-dossier foinouvelle/foinouvelle existe, le nettoyer
if [ -d "$APP_DIR/foinouvelle" ]; then
    echo "📦 Sauvegarde du fichier .env s'il existe..."
    if [ -f "$APP_DIR/foinouvelle/.env" ]; then
        cp "$APP_DIR/foinouvelle/.env" /tmp/foinouvelle.env.backup
        echo "✅ .env sauvegardé dans /tmp/foinouvelle.env.backup"
    fi
    
    echo "🗑️  Suppression du sous-dossier foinouvelle/foinouvelle..."
    rm -rf "$APP_DIR/foinouvelle"
fi

# Si le répertoire principal existe mais n'est pas un dépôt Git
if [ -d "$APP_DIR" ] && [ ! -d "$APP_DIR/.git" ]; then
    echo "📦 Sauvegarde du fichier .env s'il existe..."
    if [ -f "$APP_DIR/.env" ]; then
        cp "$APP_DIR/.env" /tmp/foinouvelle.env.backup
        echo "✅ .env sauvegardé dans /tmp/foinouvelle.env.backup"
    fi
    
    echo "🗑️  Nettoyage du répertoire $APP_DIR..."
    rm -rf "$APP_DIR"/*
    rm -rf "$APP_DIR"/.* 2>/dev/null || true
fi

# Cloner le dépôt directement dans /opt/apps/foinouvelle
if [ ! -d "$APP_DIR/.git" ]; then
    echo "📥 Clonage du dépôt dans $APP_DIR..."
    git clone $REPO_URL $APP_DIR
    
    # Restaurer .env si sauvegardé
    if [ -f "/tmp/foinouvelle.env.backup" ]; then
        echo "💾 Restauration du fichier .env..."
        mv /tmp/foinouvelle.env.backup "$APP_DIR/.env"
        echo "✅ .env restauré"
    fi
else
    echo "✅ Le dépôt Git existe déjà dans $APP_DIR"
    cd $APP_DIR
    git pull origin main
fi

echo ""
echo "✅ Nettoyage terminé!"
echo "📂 Le dépôt est maintenant dans: $APP_DIR"
echo ""
echo "🚀 Vous pouvez maintenant exécuter:"
echo "   cd $APP_DIR"
echo "   sudo chmod +x deploy.sh"
echo "   sudo ./deploy.sh"

