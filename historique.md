# Historique des Modifications

## 2025-01-XX - Dockerisation de l'application et externalisation des clés API

### Modifications apportées

**Fichiers créés :**
- `server.js` : Serveur Node.js qui sert l'application et injecte les variables d'environnement
- `package.json` : Configuration npm avec dépendances (dotenv)
- `Dockerfile` : Configuration Docker pour conteneuriser l'application
- `docker-compose.yml` : Configuration Docker Compose pour faciliter le déploiement
- `.dockerignore` : Fichiers à exclure du build Docker
- `.env.example` : Exemple de fichier de variables d'environnement
- `README.md` : Documentation du projet

**Fichier modifié :** `index.html`

### Changements techniques

1. **Externalisation des clés API**
   - Suppression des clés API hardcodées dans `index.html`
   - Remplacement par des placeholders `{{API_KEY}}`, `{{CONTACT_EMAIL}}`, etc.
   - Les variables sont injectées par le serveur Node.js depuis le fichier `.env`

2. **Serveur Node.js**
   - Serveur HTTP simple qui lit `index.html` et remplace les placeholders
   - Utilise `dotenv` pour charger les variables d'environnement
   - Port configurable via `PORT` dans `.env` (défaut : 2000)

3. **Dockerisation**
   - Image basée sur `node:18-alpine` (légère)
   - Configuration Docker Compose avec réseau dédié
   - Port 2000 exposé par défaut
   - Variables d'environnement chargées depuis `.env`

### Variables d'environnement

Les variables suivantes doivent être définies dans `.env` :
- `API_KEY` : Clé API Google Gemini
- `CONTACT_EMAIL` : Email de contact
- `CONTACT_PHONE` : Téléphone de contact
- `ADMIN_NOTIFICATION_EMAIL` : Email d'administration
- `PORT` : Port du serveur (défaut : 2000)

### Sécurité

- Le fichier `.env` est exclu de Git (via `.gitignore`)
- Le fichier `.env` est exclu du build Docker (via `.dockerignore`)
- Un fichier `.env.example` est fourni comme modèle

### Utilisation

**Avec Docker :**
```bash
docker-compose up -d
```

**Sans Docker :**
```bash
npm install
npm start
```

### Résultat

L'application est maintenant entièrement dockerisée et les clés API sont externalisées dans un fichier `.env` sécurisé. L'application peut être déployée facilement sur n'importe quel serveur supportant Docker.

---

## 2025-01-XX - Remplacement de Firebase par SQLite pour le stockage des témoignages

### Modifications apportées

**Fichier modifié :** `index.html`

### Changement majeur

Remplacement complet de Firebase/Firestore par **SQLite** (via SQL.js) pour le stockage des témoignages et des activités. L'application utilise maintenant une base de données locale SQLite stockée dans IndexedDB pour la persistance.

### Modifications techniques

1. **Suppression de Firebase**
   - Suppression de tous les imports Firebase (Firestore, Auth)
   - Suppression de la configuration Firebase
   - Suppression de l'authentification Firebase

2. **Implémentation SQLite avec SQL.js**
   - Ajout de SQL.js via CDN pour SQLite dans le navigateur
   - Création de la fonction `initSQLite()` pour initialiser la base
   - Stockage persistant dans IndexedDB

3. **Structure de la base de données**
   - Table `testimonials` : id, name, story, userId, timestamp, aiApproved
   - Table `activities` : id, action, userId, details, timestamp, admin_notification_target

4. **Fonctions créées**
   - `saveDatabase()` : Sauvegarde la base SQLite dans IndexedDB
   - `loadDatabase()` : Charge la base depuis IndexedDB
   - `loadTestimonials()` : Charge tous les témoignages depuis SQLite
   - `logActivity()` : Journalise les activités dans SQLite

5. **Fonctions modifiées**
   - `submitTestimonial()` : Utilise maintenant SQLite au lieu de Firestore
   - `renderTestimonials()` : Gère les dates SQLite (string) et Firebase (compatibilité)
   - Suppression de `setupTestimonialListener()` (remplacé par `loadTestimonials()`)

6. **Authentification simplifiée**
   - Remplacement de l'authentification Firebase par un ID utilisateur local
   - ID stocké dans `localStorage` pour persistance entre sessions
   - Génération automatique d'un UUID si absent

### Avantages de SQLite

- **Auto-hébergé** : Aucune dépendance externe (Firebase)
- **Gratuit** : Pas de coûts d'infrastructure
- **Local** : Données stockées dans le navigateur
- **SQL natif** : Requêtes SQL standard
- **Persistance** : Données sauvegardées dans IndexedDB

### Limitations

- **Local uniquement** : Les témoignages sont stockés localement dans le navigateur de chaque utilisateur
- **Pas de synchronisation** : Les témoignages ne sont pas partagés entre utilisateurs
- **IndexedDB requis** : Nécessite un navigateur supportant IndexedDB

### Résultat

L'application utilise maintenant SQLite pour stocker les témoignages localement. Chaque utilisateur voit ses propres témoignages approuvés par l'IA, stockés dans son navigateur.

---

## 2025-01-XX - Ajout de l'évaluation par IA des témoignages avant publication

### Modifications apportées

**Fichier modifié :** `index.html`

### Nouvelle fonctionnalité

Implémentation d'un système de modération automatique des témoignages par l'IA Gemini avant leur publication. Chaque témoignage soumis est maintenant évalué par l'IA pour déterminer s'il est approprié à publier.

### Fonctionnalités implémentées

1. **Fonction `evaluateTestimonialWithAI()`**
   - Évalue chaque témoignage avec l'API Gemini
   - Utilise une instruction système pour déterminer si le témoignage est approprié
   - Critères d'approbation : témoignage authentique de foi, contenu respectueux et édifiant
   - Critères de rejet : contenu offensant, spam, contenu inapproprié ou sans lien avec la foi
   - Retourne `true` si approuvé, `false` si rejeté

2. **Modification de `submitTestimonial()`**
   - Appelle `evaluateTestimonialWithAI()` avant d'enregistrer dans Firestore
   - Affiche "Évaluation en cours..." pendant l'évaluation
   - Si rejeté : affiche un message explicatif sans enregistrer
   - Si approuvé : enregistre dans Firestore avec le flag `aiApproved: true`
   - Journalisation des témoignages rejetés pour suivi

3. **Nouvelles clés de traduction**
   - `alert_testimonial_rejected` : Message lorsque le témoignage est rejeté
   - `submit_button_evaluating` : Texte du bouton pendant l'évaluation
   - Traductions ajoutées pour les 8 langues supportées

### Critères d'évaluation de l'IA

**APPROUVÉ si :**
- Témoignage d'expérience personnelle de foi, conversion ou rencontre avec Dieu
- Contenu respectueux, bienveillant et édifiant
- Témoignage authentique et personnel
- Contenu encourageant et inspirant

**REJETÉ si :**
- Contenu offensant, haineux ou discriminatoire
- Spam, publicité ou contenu commercial
- Contenu inapproprié, vulgaire ou offensant
- Contenu sans lien avec la foi chrétienne
- Contenu pouvant nuire à la communauté

### Gestion des erreurs

- Si l'API n'est pas disponible : acceptation par défaut (fallback) pour ne pas bloquer les utilisateurs
- En cas d'erreur API : acceptation par défaut avec journalisation de l'erreur

### Résultat

Tous les témoignages sont maintenant évalués par l'IA avant publication. Seuls les témoignages approuvés sont affichés dans la section des témoignages, garantissant un contenu de qualité et approprié pour la communauté.

---

## 2025-01-XX - Suppression du bouton "Lire la Prière (Audio)"

### Modifications apportées

**Fichier modifié :** `index.html`

### Changement effectué

Suppression du bouton "Lire la Prière (Audio)" et de toute la fonctionnalité associée, car jugée non utile.

### Éléments supprimés

1. **Bouton TTS dans la section de prière**
   - Suppression du bouton `<button id="tts-button">` du template HTML généré
   - Le texte de la prière reste affiché, mais sans option de lecture audio

2. **Fonction `readPrayerAloud()`**
   - Suppression complète de la fonction et de toute sa logique
   - Suppression du code de chargement des voix Web Speech

3. **Références au bouton TTS**
   - Suppression des vérifications du bouton dans `applyTranslations()`
   - Suppression des vérifications du bouton dans `displayMessage()`
   - Suppression de l'exposition `window.readPrayerAloud`

### Résultat

La section de prière affiche maintenant uniquement le texte de la prière sans option de lecture audio. L'interface est simplifiée.

---

## 2025-01-XX - Restauration de l'API Web Speech pour la lecture audio de la prière

### Modifications apportées

**Fichier modifié :** `index.html`

### Problème identifié

La génération audio de la prière utilisait l'API Gemini TTS qui nécessitait une clé API et ne fonctionnait plus correctement. L'utilisateur a indiqué que cela fonctionnait avant avec l'API Google (Web Speech).

### Solution implémentée

Remplacement de l'implémentation Gemini TTS par l'**API Web Speech** du navigateur :
- **Gratuite** : Aucune clé API nécessaire
- **Native** : Intégrée dans tous les navigateurs modernes
- **Multilingue** : Support automatique de toutes les langues
- **Fiable** : Fonctionne directement dans le navigateur

### Modifications techniques

1. **Fonction `readPrayerAloud()`**
   - Utilise maintenant `SpeechSynthesisUtterance` et `window.speechSynthesis`
   - Détection automatique de la langue selon `currentLang`
   - Sélection automatique d'une voix native pour chaque langue
   - Gestion des erreurs améliorée

2. **Bouton TTS**
   - Plus de dépendance à la clé API Gemini
   - Activé par défaut (sauf si l'API Web Speech n'est pas disponible)
   - Vérification de la disponibilité de l'API au lieu de la clé API

3. **Chargement des voix**
   - Ajout d'un système de chargement asynchrone des voix disponibles
   - Support pour les navigateurs qui chargent les voix de manière asynchrone (Chrome)

### Résultat

La lecture audio de la prière fonctionne maintenant sans clé API, de manière fiable et gratuite, dans tous les navigateurs modernes supportant l'API Web Speech.

---

## 2025-01-XX - Correction : Mise à jour automatique de la section de prière lors du changement de langue

### Modifications apportées

**Fichier modifié :** `index.html`

### Problème identifié

Lors du changement de langue, la section de prière (ou de contact) déjà affichée ne se mettait pas à jour automatiquement. L'utilisateur devait recharger la page ou cliquer à nouveau sur le bouton pour voir la traduction.

### Solution implémentée

Modification de la fonction `applyTranslations()` pour :
1. Vérifier si la section `action-message` est visible
2. Détecter le type de contenu affiché (prière ou contact)
3. Mettre à jour automatiquement le contenu avec la nouvelle langue
4. Réactiver correctement le bouton TTS si nécessaire

### Résultat

Maintenant, lorsque l'utilisateur change de langue, la section de prière (ou de contact) se met à jour automatiquement sans nécessiter de rechargement de page ou d'action supplémentaire.

---

## 2025-01-XX - Perfectionnement de la Traduction (i18n)

### Modifications apportées

**Fichier modifié :** `index.html`

### Problèmes identifiés et corrigés

1. **Messages d'erreur hardcodés en français** 
   - Tous les messages d'erreur dans les fonctions JavaScript étaient en français uniquement
   - Ajout de clés de traduction pour tous les messages d'erreur dans les 3 langues (fr, en, es)

2. **Requête de recherche d'église non traduite**
   - La requête Google "église évangélique proche de" était hardcodée en français
   - Ajout de la clé `church_search_query` traduite dans les 3 langues

3. **Erreur de traduction dans le footer espagnol**
   - Correction : "optimisé pour" → "optimizado para" dans le footer espagnol

4. **Clé de traduction manquante pour le titre de la page**
   - Ajout de la clé `app_title` dans les 3 langues pour le titre de la page HTML

### Nouvelles clés de traduction ajoutées

- `app_title` : Titre de la page (fr, en, es)
- `alert_api_missing` : Message d'erreur API manquante
- `alert_api_invalid` : Message d'erreur API invalide
- `alert_generation_failed` : Message d'échec de génération
- `alert_ai_error` : Message d'erreur générale IA
- `alert_firestore_error` : Message d'erreur Firestore
- `alert_max_retries` : Message d'erreur maximum de tentatives
- `alert_api_key_invalid_code` : Message d'erreur code API invalide
- `church_search_query` : Requête de recherche d'église traduite

### Fonctions modifiées

- `generateContentWithSearch()` : Utilise maintenant les traductions pour tous les messages d'erreur
- `handleFaithQuery()` : Utilise les traductions pour les messages d'erreur
- `fetchWithExponentialBackoff()` : Messages d'erreur traduits
- `searchForChurch()` : Requête de recherche traduite selon la langue
- `submitTestimonial()` : Message d'erreur Firestore traduit

### Résultat

Tous les textes affichés à l'utilisateur sont maintenant traduits dans les 3 langues supportées (français, anglais, espagnol). Le système i18n est maintenant complet et cohérent.

---

## 2025-01-XX - Ajout de Plusieurs Langues Supplémentaires

### Modifications apportées

**Fichier modifié :** `index.html`

### Nouvelles langues ajoutées

Ajout de 5 nouvelles langues au système de traduction :
- **Allemand (de)** : Deutsch
- **Italien (it)** : Italiano
- **Portuguais (pt)** : Português
- **Néerlandais (nl)** : Nederlands
- **Polonais (pl)** : Polski

### Modifications techniques

1. **Sélecteur de langue HTML**
   - Ajout des 5 nouvelles options dans le sélecteur de langue
   - Total : 8 langues disponibles (fr, en, es, de, it, pt, nl, pl)

2. **Textes de prière**
   - Ajout des textes de prière de conversion traduits pour les 5 nouvelles langues
   - Tous les textes de prière sont maintenant disponibles dans 8 langues

3. **Traductions complètes**
   - Ajout de toutes les clés de traduction pour chaque nouvelle langue
   - Plus de 60 clés de traduction par langue
   - Couverture complète : navigation, hero, messages, plan de lecture, explorateur IA, communauté, témoignages, partage, étapes, alertes, footer

4. **Système TTS (Text-to-Speech)**
   - Mise à jour du code de langue TTS pour supporter les nouvelles langues
   - Codes de langue : de-DE, it-IT, pt-PT, nl-NL, pl-PL

5. **Système d'instruction IA**
   - Mise à jour du système d'instruction pour reconnaître et utiliser les noms de langues appropriés
   - Support des 8 langues dans les réponses de l'IA

### Langues supportées

Le projet supporte maintenant **8 langues** :
1. Français (fr) - Langue par défaut
2. English (en)
3. Español (es)
4. Deutsch (de)
5. Italiano (it)
6. Português (pt)
7. Nederlands (nl)
8. Polski (pl)

### Résultat

L'application est maintenant multilingue avec un support complet pour 8 langues européennes. Tous les textes, messages d'erreur, textes de prière et fonctionnalités sont traduits et fonctionnels dans toutes les langues supportées.

