# Correction rapide du problème Nginx

Le fichier `/etc/nginx/sites-available/psaumes365` référence un certificat SSL qui n'existe pas. Voici comment le corriger :

## Solution rapide

```bash
# 1. Voir le contenu du fichier problématique
sudo cat /etc/nginx/sites-available/psaumes365

# 2. Commenter ou supprimer les lignes SSL problématiques
sudo nano /etc/nginx/sites-available/psaumes365

# Dans nano, rechercher et commenter (ajouter # devant) ces lignes :
# - ssl_certificate
# - ssl_certificate_key
# - listen 443
# - ssl_protocols
# - ssl_ciphers

# Ou simplement désactiver complètement le site
sudo mv /etc/nginx/sites-available/psaumes365 /etc/nginx/sites-available/psaumes365.disabled

# 3. Tester Nginx
sudo nginx -t

# 4. Si OK, recharger
sudo systemctl reload nginx
```

## Solution automatique (une ligne)

```bash
# Désactiver complètement le site psaumes365
sudo mv /etc/nginx/sites-available/psaumes365 /etc/nginx/sites-available/psaumes365.disabled && sudo nginx -t && sudo systemctl reload nginx
```

