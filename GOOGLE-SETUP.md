# Configuration de l'intégration Google — DCRM

## 1. Prérequis Google Cloud Console

### Créer un projet GCP
1. Aller sur [console.cloud.google.com](https://console.cloud.google.com)
2. Créer un projet ou en sélectionner un existant

### Activer les APIs nécessaires
Dans **APIs & Services > Bibliothèque**, activer :
- **Google Calendar API** (obligatoire pour la synchro agenda)
- **Google People API** n'est pas requise (on utilise l'id_token OpenID pour l'email)

### Configurer l'écran de consentement OAuth
Dans **APIs & Services > Écran de consentement OAuth** :
- Type d'utilisateur : **Interne** si le compte Google est un Workspace d'entreprise (recommandé — restreint aux comptes @dcb-technologies.fr) ; **Externe** sinon (requiert validation Google)
- Remplir : nom de l'application, email de contact, domaine autorisé
- Scopes à déclarer :
  - `openid`
  - `email`
  - `profile`
  - `https://www.googleapis.com/auth/calendar.events`

### Créer un identifiant OAuth 2.0 (Client ID « Application Web »)
Dans **APIs & Services > Identifiants > Créer des identifiants > ID client OAuth 2.0** :
- Type : **Application Web**
- **URIs de redirection autorisées** (ajouter les deux) :

| Environnement | URI Login Google | URI Calendar |
|---------------|-----------------|--------------|
| Développement | `http://localhost:3001/api/auth/google/callback` | `http://localhost:3001/api/google/calendar/callback` |
| Production    | `https://votre-domaine.com/api/auth/google/callback` | `https://votre-domaine.com/api/google/calendar/callback` |

Après création, noter le **Client ID** et le **Client Secret**.

---

## 2. Variables d'environnement à configurer

Ajouter dans le fichier `.env` du serveur :

```env
# ─── Google OAuth ───────────────────────────────────────────────────────
# Identifiant et secret OAuth (Google Cloud Console > Identifiants)
GOOGLE_CLIENT_ID=<votre-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<votre-client-secret>

# URI de callback pour le LOGIN Google (doit correspondre à Google Cloud Console)
# Valeur par défaut si absente : http://localhost:3001/api/auth/google/callback
GOOGLE_REDIRECT_URI=https://votre-domaine.com/api/auth/google/callback

# URI de callback pour la connexion Google CALENDAR (distinct du login)
# Valeur par défaut si absente : dérivée de GOOGLE_REDIRECT_URI ou http://localhost:3001/api/google/calendar/callback
GOOGLE_CALENDAR_REDIRECT_URI=https://votre-domaine.com/api/google/calendar/callback

# Clé de chiffrement AES-256-GCM des refresh tokens Google stockés en base
# Générer : openssl rand -hex 32  (64 caractères hexadécimaux)
TOKEN_ENC_KEY=<64_hex_chars>

# URL du frontend (utilisée pour les redirections après OAuth)
FRONTEND_URL=https://votre-domaine.com
```

---

## 3. Settings applicatifs (table Setting en DB)

Ces paramètres s'ajoutent/modifient depuis la page **Paramètres** de l'interface CRM (ou directement en base) :

| Clé | Valeur par défaut | Description |
|-----|-------------------|-------------|
| `googleAllowedDomain` | `dcb-technologies.fr` | Domaine email autorisé pour l'auto-création de compte via Google |
| `googleAutoCreateRole` | `COMMERCIAL` | Rôle assigné aux utilisateurs auto-créés via Google |

---

## 4. Fonctionnement résumé

### 4.1 Login avec Google

1. L'utilisateur clique **"Continuer avec Google"** sur la page de login
2. Le CRM redirige vers `GET /api/auth/google` → génère une URL de consentement Google et redirige
3. Google redirige vers `/api/auth/google/callback?code=...&state=...`
4. Le serveur vérifie le CSRF state (cookie `gauth_state`), échange le code contre un id_token, décode l'email

**Logique de liaison :**
- Email trouvé en DB → le `googleId` est posé sur le compte existant (liaison unique)
- Email inconnu + domaine autorisé (`googleAllowedDomain`) → compte créé automatiquement avec le rôle `googleAutoCreateRole`
- Email inconnu + domaine non autorisé → redirection `/login?error=google_unauthorized`
- Compte désactivé (`isActive=false`) → redirection `/login?error=account_disabled`

5. Le serveur pose un cookie `refreshToken` (httpOnly, 7j) et redirige vers `/auth/google/success`
6. La page `GoogleCallbackPage` appelle `POST /auth/refresh` pour récupérer l'`accessToken`, puis `GET /auth/me` pour les données utilisateur

### 4.2 Connexion du Google Calendar

1. Depuis la page Agenda, l'utilisateur clique **"Connecter mon agenda Google"**
2. `GET /api/google/calendar/connect` → retourne une URL d'autorisation avec le scope `calendar.events`
3. Google redirige vers `/api/google/calendar/callback` — le serveur stocke le refresh token Google chiffré (AES-256-GCM) dans `GoogleCredential`
4. `GET /api/google/status` indique l'état de la connexion

### 4.3 Synchronisation bidirectionnelle

- **Synchro automatique** : le scheduler lance `runCalendarSync()` toutes les 5 minutes
- **CRM → Google (push)** : chaque création/modification/suppression de RDV push l'événement vers Google Calendar des participants connectés
- **Google → CRM (pull)** : le polling incrémental via `syncToken` importe les événements créés ou modifiés dans Google Calendar
- **Anti-boucle** : l'`etag` de chaque événement est stocké ; si l'etag entrant = etag stocké, l'événement est ignoré (c'est le CRM qui avait fait la modif)
- **Conflits** : last-write-wins — `event.updated` vs `appointment.updatedAt`
- **Erreur d'authentification** (token révoqué / `invalid_grant`) : `calendarSyncEnabled` passe à `false` + notification in-app

### 4.4 Visibilité des calendriers

- Par défaut, chaque utilisateur ne voit que ses propres RDV
- Un ADMIN peut accorder l'accès au calendrier d'un utilisateur à un autre (`POST /api/calendar-access`)
- `GET /api/google/status` expose `connected`, `googleEmail`, `calendarSyncEnabled`, `lastSyncAt`

---

## 5. Notifications push (optionnel)

La synchro peut fonctionner en deux modes :

| Mode | Variable | Latence |
|------|----------|---------|
| Polling seul | `GOOGLE_WEBHOOK_URL=` (vide, défaut) | ~5 min |
| Push + polling secours | `GOOGLE_WEBHOOK_URL=https://…` | quasi temps réel |

### Activer les push

Ajouter dans `.env` (production) :

```env
GOOGLE_WEBHOOK_URL=https://dcrm.dcb-technologies.fr/api/google/notifications
```

**Exigences Google :**
- URL **HTTPS publique** avec certificat TLS valide (Let's Encrypt, etc.)
- Domaine vérifié dans Google Cloud Console → [Search Console](https://search.google.com/search-console) (ou via enregistrement DNS TXT)
- L'URL doit être joignable depuis Internet (pas de firewall bloquant les IP Google)

### Cycle de vie d'un canal

1. **Connexion** : après le callback OAuth Calendar, `registerWatchForUser()` appelle `calendar.events.watch()` — Google répond avec un `resourceId` et une date d'expiration (7 jours maximum)
2. **Notification** : à chaque modification dans l'agenda, Google POST sur `/api/google/notifications` (headers uniquement, pas de corps)
3. **Traitement** : le serveur vérifie le `channelToken`, répond **200 immédiatement**, puis déclenche `pullUserCalendar()` en arrière-plan
4. **Renouvellement** : le cron horaire (`0 * * * *`) appelle `renewExpiringChannels()` — les canaux expirant dans < 24 h sont renouvelés automatiquement (close + reopen)

### Polling de secours

Même avec les push activés, le polling toutes les **5 minutes** reste actif pour :
- Les utilisateurs sans canal actif (ex : canal expiré avant renouvellement)
- Les nouveaux utilisateurs en attente d'un watch
- Les environnements sans `GOOGLE_WEBHOOK_URL`

Les utilisateurs **avec** un canal actif (`channelExpiresAt > now`) sont exclus du polling (sauf synchro manuelle `force=true`).

### Développement local

Laisser `GOOGLE_WEBHOOK_URL=` vide. Le polling seul est utilisé. Pour tester les push en local, utiliser [ngrok](https://ngrok.com/) :

```bash
ngrok http 3001
# Puis : GOOGLE_WEBHOOK_URL=https://<tunnel>.ngrok.io/api/google/notifications
```

---

## 6. Vérification rapide en développement

```bash
# Après configuration du .env :
cd server && npm run dev

# Tester la route Google (doit rediriger vers accounts.google.com) :
curl -I http://localhost:3001/api/auth/google
# → HTTP/1.1 302  Location: https://accounts.google.com/...

# Tester le status sans credential (doit renvoyer connected:false) :
# (avec un token Bearer valide)
curl http://localhost:3001/api/google/status -H "Authorization: Bearer <token>"
# → {"success":true,"data":{"connected":false,...}}
```
