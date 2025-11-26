# Vérification de la configuration HTTPS

## ✅ Vérifications à effectuer après le déploiement

### 1. Vérifier que Nginx est configuré

```bash
# Vérifier la configuration Nginx
sudo nginx -t

# Vérifier que le site est activé
ls -la /etc/nginx/sites-enabled/ | grep foinouvelle

# Voir la configuration
sudo cat /etc/nginx/sites-available/foinouvelle
```

### 2. Vérifier que le certificat SSL existe

```bash
# Vérifier les certificats Let's Encrypt
sudo ls -la /etc/letsencrypt/live/foinouvelle.woutils.com/

# Vérifier la date d'expiration
sudo certbot certificates
```

### 3. Vérifier que le conteneur Docker fonctionne

```bash
cd /opt/apps/foinouvelle
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs
```

### 4. Tester l'accès HTTPS

```bash
# Test depuis le serveur
curl -I https://foinouvelle.woutils.com

# Ou depuis votre machine locale
curl -I https://foinouvelle.woutils.com
```

### 5. Vérifier la redirection HTTP → HTTPS

```bash
# Doit rediriger vers HTTPS
curl -I http://foinouvelle.woutils.com
```

## 🔧 Si HTTPS ne fonctionne pas

### Problème : Certificat non généré

```bash
# Générer manuellement le certificat
sudo certbot --nginx -d foinouvelle.woutils.com --non-interactive --agree-tos --email admin@foinouvelle.woutils.com --redirect
```

### Problème : Nginx ne démarre pas

```bash
# Vérifier les erreurs
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

### Problème : Port 443 bloqué

```bash
# Vérifier que le port 443 est ouvert
sudo ufw status
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
```

### Problème : Le conteneur Docker ne répond pas

```bash
# Vérifier que le conteneur écoute sur localhost:2000
sudo docker compose -f docker-compose.prod.yml logs
sudo netstat -tlnp | grep 2000
```

## 🔄 Renouvellement automatique du certificat

Le certificat SSL est automatiquement renouvelé par Certbot. Pour tester le renouvellement :

```bash
# Test de renouvellement (dry-run)
sudo certbot renew --dry-run
```

## 📋 Checklist de déploiement HTTPS

- [ ] Nginx installé et configuré
- [ ] Configuration Nginx copiée dans `/etc/nginx/sites-available/foinouvelle`
- [ ] Lien symbolique créé dans `/etc/nginx/sites-enabled/`
- [ ] Certificat SSL généré avec Certbot
- [ ] Conteneur Docker démarré et accessible sur `127.0.0.1:2000`
- [ ] Ports 80 et 443 ouverts dans le firewall
- [ ] Redirection HTTP → HTTPS fonctionnelle
- [ ] Site accessible en HTTPS : https://foinouvelle.woutils.com

