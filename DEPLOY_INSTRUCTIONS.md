# Instructions de déploiement - Mise à jour

Les fichiers de déploiement ont été ajoutés au dépôt. Sur votre VPS, exécutez :

```bash
# Aller dans le répertoire du projet
cd /opt/apps/foinouvelle/foinouvelle

# Mettre à jour le dépôt
sudo git pull origin main

# Rendre le script exécutable
sudo chmod +x deploy.sh

# Lancer le déploiement
sudo ./deploy.sh
```

Le script va :
1. Vérifier que tout est à jour
2. Créer le fichier .env (si nécessaire)
3. Construire et démarrer Docker
4. Configurer Nginx
5. Générer le certificat SSL

**Important** : Le script vous demandera de configurer le fichier `.env` avant de continuer.


