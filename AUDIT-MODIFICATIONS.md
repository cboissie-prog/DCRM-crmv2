# AUDIT-MODIFICATIONS.md — Liste détaillée des modifications à effectuer

> Issue de l'audit du 12/06/2026 (voir `RAPPORT-AUDIT.html` pour le contexte complet de chaque constat).
> Chaque tâche est autonome et conçue pour être confiée à un agent : fichiers concernés, approche, critères d'acceptation.
> Ordre = priorité. Ne pas committer `dev.db` ni `.env`. Après chaque tâche serveur : `cd server && npx tsc --noEmit`. Après chaque tâche client : `cd client && npx tsc -b && npx eslint .`.

---

## PHASE 1 — BLOQUANT (à faire avant toute mise en production)

### T-01 · Sécuriser le webhook VoIP (C-01)
**Fichiers** : `server/src/routes/calls.ts:24-91`, `server/src/index.ts`, `.env.production.example`, `server/.env`
- Ajouter une variable d'env `VOIP_WEBHOOK_SECRET` (vérifiée au boot comme les JWT_SECRET si on veut activer le module calls).
- Dans `POST /calls/webhook` : rejeter (401) toute requête dont le header `X-Webhook-Secret` (ou signature HMAC-SHA256 du body si le provider VoIP le supporte) ne correspond pas.
- Valider `recording_url` avec `z.string().url()` + n'accepter que `https:` et idéalement une allowlist de domaines du provider VoIP (variable `VOIP_RECORDING_HOSTS`).
- Dans `GET /calls/:id/recording/stream` : ne plus faire `res.redirect(recordingUrl)` vers un domaine non allowlisté (sinon 403).
- Ajouter un rate limit dédié sur `/api/calls/webhook`.
**Acceptation** : webhook sans secret → 401 ; `recording_url: "javascript:..."` ou domaine inconnu → 400 ; le flux nominal du provider passe toujours.

### T-02 · Réparer le build client : erreurs TypeScript + bugs modales (C-02)
**Fichiers** : voir liste d'erreurs ci-dessous — objectif `cd client && npx tsc -b` = 0 erreur.
- `TargetsPage.tsx:328,342` et `ImportCsvModal.tsx:88` : remplacer la prop `isOpen` par `open` (signature réelle de `Modal`) — **bug runtime : ces modales ne s'ouvrent jamais, vérifier le comportement après correction**.
- `Spinner` : soit ajouter une prop `size`, soit retirer `size="..."` dans `ImportCsvModal.tsx:156`, `ForgotPasswordPage.tsx:87`, `ResetPasswordPage.tsx:119`.
- Imports inutilisés : `Sidebar.tsx:5` (BarChart2, Zap, Activity), `CallsPage.tsx:18` (Calendar), `PipelinePage.tsx:17` (ChevronDown), `ReportsPage.tsx:11` (Users, X, ChevronRight), `TargetsPage.tsx:14-15` (Euro, AlertCircle), `AutomationsPage.tsx:39` (ConditionDef).
- Formatters Recharts (`ReportsPage.tsx:407`, `TargetsPage.tsx:407`) : typer `(v: ValueType)` et convertir en interne (`Number(v)`).
- `AutomationsPage.tsx:504` : corriger le cast `Record<string, string | string[]>` (passer par `unknown` ou mieux, typer les conditions correctement).
- `authStore.ts:48` : remplacer le `catch {}` vide par un commentaire explicite ou un log (`no-empty`).
- Corriger le reste des 49 erreurs ESLint (`npx eslint . --fix` puis traiter le résiduel à la main).
**Acceptation** : `npm run build` (client) passe ; les modales « Nouvel objectif » / « Modifier l'objectif » / import CSV s'ouvrent réellement.

### T-03 · Corriger `skipDuplicates` incompatible SQLite (C-03)
**Fichiers** : `server/src/routes/contacts.ts:143`, `server/src/routes/companies.ts:112`, `server/src/automation-engine.ts:142,158`
- Retirer `skipDuplicates: true` des 4 appels `createMany` (la déduplication est déjà faite en amont pour les imports CSV ; pour les notifications il n'y a pas de contrainte unique donc l'option était sans effet).
- Si une déduplication DB reste souhaitée pour les imports : faire un `findMany` préalable (déjà en place) — aucun autre changement nécessaire.
**Acceptation** : import CSV d'entreprises et de contacts fonctionne en dev SQLite ; une automatisation `NOTIFY_ROLE` crée bien des notifications en dev. (Erreur actuelle vérifiée : « Unknown argument skipDuplicates ».)

### T-04 · Réparer la chaîne RBAC : seed + bypass ADMIN serveur (C-04)
**Fichiers** : `server/src/prisma/seed.ts:152-175`, `server/src/middleware/auth.ts`, `server/src/routes/auth.ts`
- Dans le seed : après création des rôles, lier chaque user à son rôle (`roleId: rolesByName[user.role].id`) — y compris dans la branche `update` des upserts pour réparer les bases existantes. Ajouter en fin de seed un `updateMany` de rattrapage : pour chaque rôle système, `user.updateMany({ where: { role: name, roleId: null }, data: { roleId } })`.
- Décision d'architecture à appliquer partout : **le serveur accorde `['*']` à tout user `role === 'ADMIN'`**, quel que soit le mode d'auth. Concrètement : dans `generateTokens`/login/refresh (`auth.ts`), si `user.role === 'ADMIN'`, mettre `permissions: ['*']` dans le JWT (cohérent avec la branche API-key du middleware et avec le bypass client).
**Acceptation** : sur une base recréée de zéro (`rm dev.db && db:push && db:seed`), l'admin ET le commercial peuvent se connecter et accéder à leurs modules ; `GET /api/roles` fonctionne pour l'admin.

### T-05 · Renvoyer les permissions au login (C-05)
**Fichiers** : `server/src/routes/auth.ts:36-75`, `client/src/store/authStore.ts`
- Le login doit renvoyer `user.permissions` (les mêmes que celles mises dans le JWT). Fusionner au passage les deux `findUnique` en un seul avec `include: { roleRef: ... }` (L-07).
- Côté client, en filet de sécurité : dans `authStore.login`, si `user.permissions` est absent, parser le JWT avec `parseJwtPayload(accessToken)` (déjà exporté par `lib/api.ts`).
**Acceptation** : un COMMERCIAL fraîchement connecté voit immédiatement sa sidebar complète (companies, contacts, pipeline, tickets…) sans attendre un refresh de token.

### T-06 · Retirer les identifiants de démo de l'écran de login (C-06)
**Fichiers** : `client/src/pages/auth/LoginPage.tsx:25,104-123`, `server/src/prisma/seed.ts`
- Supprimer `defaultValues: { email: 'admin@crm.local', password: 'admin123' }`.
- Supprimer (ou conditionner à `import.meta.env.DEV`) le panneau « Comptes de démo ».
- Séparer le seed en deux : `seed.ts` (données minimales : permissions, rôles, et un admin dont le mot de passe provient de `ADMIN_INITIAL_PASSWORD` env ou généré+affiché une fois) et `seed-demo.ts` (données de démo actuelles). Mettre à jour le script npm `db:seed` / ajouter `db:seed:demo`.
**Acceptation** : l'écran de login ne révèle plus rien ; un déploiement prod n'embarque plus admin123.

### T-07 · Initialiser les migrations Prisma (C-07)
**Fichiers** : `server/src/prisma/`, `server/package.json`
- Créer la migration initiale : `npx prisma migrate dev --name init` (sur une base dev propre ; utiliser `migrate diff` + `migrate resolve --applied` pour baseliner la base existante sans la perdre).
- Committer le dossier `migrations/`.
- Documenter dans le README/PLAN la règle : toute évolution de schéma passe par `db:migrate`, `db:push` réservé au prototypage.
- Vérifier que la migration initiale s'applique sur PostgreSQL (au moins via un conteneur/база de test) — c'est l'occasion de détecter les types divergents.
**Acceptation** : `prisma migrate deploy` fonctionne sur une base PostgreSQL vierge ; `start:prod` ne casse plus.

### T-08 · Configurer `trust proxy` (C-08)
**Fichiers** : `server/src/index.ts`
- Ajouter `app.set('trust proxy', 1)` (un seul proxy : nginx Plesk) — conditionnable à `NODE_ENV === 'production'`.
- Vérifier que `express-rate-limit` ne lève plus son warning de validation X-Forwarded-For et que `req.ip` reflète l'IP cliente dans les logs morgan.
**Acceptation** : en prod, deux clients distincts ont des compteurs de rate-limit distincts.

---

## PHASE 2 — SÉCURITÉ

### T-09 · Ajouter des permissions RBAC aux modules calls et apikeys (E-01)
**Fichiers** : `server/src/routes/calls.ts`, `server/src/routes/apikeys.ts`, `server/src/prisma/seed.ts`
- Créer les permissions : `calls:read`, `calls:create`, `calls:update`, `calls:delete`, `calls:listen` (streaming/upload d'enregistrements), `apikeys:manage`.
- Les ajouter au seed (catégories « Appels » et « Paramètres ») et aux rôles : ADMIN tout ; MANAGER tout sauf `apikeys:manage` (à discuter) ; COMMERCIAL `calls:read/create/update` ; TECHNICIEN `calls:read/create/update`.
- Appliquer `requirePermission(...)` sur chaque route (sauf le webhook qui a son propre secret, cf. T-01).
- UI : entourer les boutons concernés de `<CanDo permission="calls:...">` dans `CallsPage.tsx` ; masquer l'onglet clés API si pas `apikeys:manage`.
**Acceptation** : un TECHNICIEN ne peut plus supprimer un appel ni créer de clé API ; régression testée pour l'ADMIN.

### T-10 · Valider les uploads d'enregistrements (E-02)
**Fichiers** : `server/src/routes/calls.ts:11-22,279-297`
- `multer.fileFilter` : n'accepter que les MIME audio (`audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/mp4`, `audio/x-m4a`) ET extensions correspondantes ; sinon 400 `INVALID_FILE_TYPE`.
- Réduire `fileSize` à une valeur réaliste (ex. 50 Mo) ; rendre configurable par env si besoin.
- Servir le bon `Content-Type` selon l'extension stockée (au lieu de `audio/mpeg` systématique).
**Acceptation** : upload d'un `.exe` renommé → 400 ; upload d'un mp3 → OK et lisible.

### T-11 · Corriger l'IDOR notifications (E-04)
**Fichiers** : `server/src/routes/notifications.ts:27-32`
- Remplacer `update({ where: { id } })` par `updateMany({ where: { id, userId: req.userId } })` et renvoyer 404 si `count === 0`.
**Acceptation** : marquer comme lue la notification d'un autre user → 404.

### T-12 · Rendre transactionnel le remplacement des permissions d'un rôle (E-05)
**Fichiers** : `server/src/routes/roles.ts:148-193`
- Envelopper `deleteMany` + `createMany` (+ la suppression des refresh tokens) dans `prisma.$transaction`.
- Valider en amont que tous les `permissionIds` existent (`permission.findMany` + comparaison) → 400 sinon.
**Acceptation** : envoyer un id de permission bidon ne vide plus le rôle ; cas nominal inchangé.

### T-13 · Neutraliser l'injection de formules CSV (E-06)
**Fichiers** : `server/src/routes/companies.ts:136-150`, `tickets.ts:108-124`, `contacts.ts` (export), idéalement factorisé dans `server/src/lib/csv.ts` (à créer)
- Créer un helper `csvEscape` partagé : en plus de l'échappement actuel, préfixer d'une apostrophe `'` toute valeur commençant par `=`, `+`, `-`, `@`, tab ou CR.
- Remplacer les 3 implémentations locales par le helper.
**Acceptation** : une entreprise nommée `=HYPERLINK(...)` s'exporte inerte dans Excel.

### T-14 · Mettre à jour les dépendances vulnérables (E-09)
**Fichiers** : `client/package.json`, `server/package.json`
- `npm audit fix` dans les deux projets (client : react-router 3 high ; serveur : express/qs, uuid).
- Si `uuid` n'est importé nulle part côté serveur (à vérifier) : le supprimer (L-04).
- Re-lancer build + smoke test après mise à jour (react-router v7 mineure = risque faible).
**Acceptation** : `npm audit` = 0 high/critical dans les deux projets ; l'app démarre et navigue.

### T-15 · Durcir le cycle de vie des refresh tokens (E-10)
**Fichiers** : `server/src/routes/auth.ts`, `server/src/routes/users.ts:146-170`, `server/src/scheduler.ts`
- Stocker un hash SHA-256 du refresh token en DB (comme les clés API) au lieu du token en clair ; comparer par hash au refresh/logout.
- Détection de réutilisation : si un refresh token présenté est introuvable mais correspond (signature JWT valide) à un user → supprimer tous les refresh tokens de ce user (révocation famille) + log sécurité.
- `PATCH /users/:id/password` : après changement, `refreshToken.deleteMany({ where: { userId } })` (déconnexion des autres sessions), comme le fait déjà reset-password.
- Ajouter au scheduler un job quotidien de purge : `refreshToken.deleteMany({ where: { expiresAt: { lt: now } } })` + purge des `passwordResetToken` expirés.
**Acceptation** : les tokens en base sont des hash ; un changement de mot de passe invalide les sessions ; la table ne croît plus indéfiniment.

### T-16 · Centraliser la gestion d'erreurs + mapping Prisma (E-11)
**Fichiers** : `server/src/middleware/errorHandler.ts`, puis l'ensemble des routes (refactor progressif)
- Créer un helper `handleRouteError(err, res)` (ou passer aux middlewares d'erreur via `next(err)`) qui mappe : `ZodError`→400, `P2002`→409, `P2025`→404, `P2003`→400, sinon 500 — **et logge systématiquement l'erreur** (`console.error` à minima, logger structuré après T-23).
- Remplacer les `catch { res.status(500)... }` muets, en commençant par `users.ts` (email dupliqué → 409 actuellement 500), `roles.ts`, `calls.ts`.
**Acceptation** : créer deux users avec le même email → 409 + message clair ; toute 500 laisse une trace dans les logs.

### T-17 · Valider PATCH password avec Zod (E-12)
**Fichiers** : `server/src/routes/users.ts:146-170`
- Schéma Zod : `{ currentPassword: z.string().min(1) (requis si non-admin), newPassword: z.string().min(8) }` ; plus aucun appel `bcrypt.compare(undefined, …)`.
- En profiter pour appliquer une politique minimale : longueur ≥ 10 recommandée + rejet des mots de passe identiques à l'ancien.
**Acceptation** : requête sans `currentPassword` (non-admin) → 400 explicite, plus de 500.

### T-18 · Durcir la config production : CORS + CSP (E-13)
**Fichiers** : `server/src/index.ts:52-65`
- CORS : en production, n'autoriser que `FRONTEND_URL` (retirer les regex 192.168/10.x quand `NODE_ENV === 'production'`).
- Tester le SPA servi par Express avec la CSP par défaut de Helmet ; si elle casse des assets, configurer explicitement `helmet({ contentSecurityPolicy: { directives: ... } })` plutôt que de la désactiver. Vérifier images Leaflet (tiles OSM = domaine externe) et avatars.
**Acceptation** : en prod, une origine LAN inconnue est refusée ; la carte Leaflet et les graphiques s'affichent avec la CSP active.

---

## PHASE 3 — FIABILITÉ PROD

### T-19 · Exclure /api du fallback SPA (E-03)
**Fichiers** : `server/src/index.ts:123-128`
- Remplacer `app.get('*', ...)` par un handler qui fait `if (req.path.startsWith('/api')) return next()` avant `sendFile` (ou `app.get(/^(?!\/api).*/, ...)`).
**Acceptation** : `GET /api/inexistant` → 404 JSON `{ success:false, error:{ code:'NOT_FOUND' } }` ; `GET /tickets` (navigateur) → index.html.

### T-20 · Recherche insensible à la casse compatible PostgreSQL (E-07)
**Fichiers** : `server/src/routes/search.ts`, `tickets.ts`, `contacts.ts`, `companies.ts`, `calls.ts`, `knowledge.ts` (toutes les clauses `contains`)
- Ajouter `mode: 'insensitive'` à chaque `contains` de recherche. ⚠️ SQLite ne supporte pas `mode` → soit conditionner par `DATABASE_PROVIDER`, soit (mieux) créer un helper `ciContains(field, q)` dans `server/src/lib/query.ts` qui renvoie la bonne forme selon le provider.
**Acceptation** : sur PostgreSQL, chercher « dupont » trouve « Dupont » ; le dev SQLite fonctionne toujours.

### T-21 · Stopper proprement le cron des automatisations au restart (E-08)
**Fichiers** : `server/src/scheduler.ts:93-152`
- Stocker le 3e cron dans une variable module (`automationTask`), le `stop()` dans `startScheduler()` comme les deux autres.
**Acceptation** : modifier 3 fois `schedulerTime` ne crée qu'une seule exécution horaire (vérifiable par log au boot du job).

### T-22 · Corriger le matching téléphonique du webhook (M-12)
**Fichiers** : `server/src/routes/calls.ts:42-53`, `server/src/prisma/schema.prisma`, routes contacts (create/update)
- Ajouter aux contacts des champs `phoneNormalized`/`mobileNormalized` (chiffres uniquement, format E.164 simplifié), remplis à la création/màj + script de backfill.
- Le webhook compare le numéro normalisé en égalité (ou suffixe sur les 9 derniers chiffres pour gérer +33 vs 0).
**Acceptation** : un appel de « +33472123456 » se rattache au contact stocké « 04 72 12 34 56 ».

### T-23 · Logger structuré + audit trail (M-07)
**Fichiers** : nouveau `server/src/lib/logger.ts`, intégration progressive
- Introduire pino (ou winston) : niveaux, JSON en prod, pretty en dev ; remplacer les `console.*` du serveur.
- Créer une table `AuditLog` (userId, action, entity, entityId, meta JSON, createdAt) + helper `audit(req, action, entity, id, meta?)` ; tracer au minimum : login/logout, création/suppression d'utilisateurs, changement de rôle/permissions, suppression d'entités, création/révocation de clé API, écoute/suppression d'enregistrements.
**Acceptation** : chaque action sensible apparaît dans AuditLog avec l'auteur.

### T-24 · Gouvernance RGPD des enregistrements (M-09)
**Fichiers** : `server/src/scheduler.ts`, `server/src/routes/calls.ts`, settings
- Ajouter un setting `callRecordingRetentionDays` (défaut ex. 180) + job quotidien qui supprime fichiers + champs `recordingPath/recordingUrl` au-delà.
- Journaliser les écoutes (`calls:listen`) dans l'audit trail (T-23).
- Documenter la procédure d'effacement d'un contact (droit à l'oubli) : anonymisation contact + appels liés.
**Acceptation** : un enregistrement plus vieux que la rétention disparaît automatiquement ; les écoutes sont tracées.

### T-25 · Hygiène repo : gitignore uploads, versionner la doc, committer (M-10, M-06 partiel)
**Fichiers** : `.gitignore`, racine du repo
- Ajouter `server/uploads/` au `.gitignore`.
- Retirer la règle `*.md` du `.gitignore` et versionner CLAUDE.md, PLAN.md, API.md, PROGRESS.md, DESIGN.md (BUGS.md/JOURNAL.md au choix). Si certains docs doivent rester privés, les ignorer nommément.
- Committer le travail en cours (59 fichiers modifiés) en commits thématiques avant d'attaquer ces tâches.
**Acceptation** : un `git clone` frais contient la doc nécessaire pour travailler ; `uploads/` ne peut plus être commité.

---

## PHASE 4 — QUALITÉ & PRODUIT

### T-26 · Mettre en place tests + CI (M-06)
**Fichiers** : nouveaux — `server/tests/`, `client/src/**/*.test.tsx`, `.github/workflows/ci.yml`
- Serveur : vitest + supertest. Prioriser : auth (login/refresh/logout/reset), RBAC (requirePermission, bypass admin), webhook calls (secret, validation), import CSV, roles transaction (T-12), notifications IDOR (T-11).
- Client : vitest + testing-library sur authStore, hooks useApi, CanDo/ProtectedRoute.
- CI GitHub Actions : jobs lint client, `tsc --noEmit` serveur, `tsc -b` client, tests, build. Bloquer le merge si rouge.
**Acceptation** : `npm test` passe dans les deux projets ; la CI tourne sur push.

### T-27 · Activer les gardes de routes côté client (M-01)
**Fichiers** : `client/src/App.tsx`, `client/src/components/ProtectedRoute.tsx`
- Envelopper les routes par module : `/users` → `users:read`, `/settings` → `settings:write`, `/settings/roles` → `settings:roles`, `/automations` → `automation:read`, `/reports`+`/targets` → `reports:read`, etc. (aligné sur les permissions serveur).
- Prévoir une page « Accès refusé » plutôt qu'un redirect silencieux vers /dashboard (meilleure UX de diagnostic).
**Acceptation** : un TECHNICIEN qui tape `/users` voit « Accès refusé » au lieu d'une page cassée.

### T-28 · Rationaliser la taxonomie des permissions (M-02, M-03)
**Fichiers** : `server/src/routes/settings.ts`, `users.ts`, `licenses.ts`, `knowledge.ts`, `search.ts`, `seed.ts`
- `GET /settings` → `settings:read` (write réservé aux PUT/actions).
- `POST /users/targets` + `GET /users/targets` → nouvelle permission `targets:read`/`targets:write` (ou `reports:write`).
- Licences : créer `licenses:*` (ou documenter explicitement le rattachement à equipment).
- `knowledge.ts` : remplacer les checks `ADMIN || MANAGER` par les permissions `knowledge:update`/`knowledge:create` déjà existantes.
- `users.ts GET/PUT/:id` : conserver la logique "soi-même", mais utiliser `users:read`/`users:update` pour l'accès aux autres.
- `search.ts` : filtrer chaque catégorie de résultats selon les permissions du demandeur (`contacts:read`, `companies:read`, `tickets:read`, `pipeline:read`).
- Supprimer du seed les permissions `interventions:*` orphelines (ou créer le module).
**Acceptation** : matrice permission↔route cohérente, documentée dans API.md.

### T-29 · Automatisations alignées sur les pipelines dynamiques (M-04)
**Fichiers** : `server/src/automation-engine.ts:335-390,294-304`
- `runOpportunityInactive` : remplacer `stage: { notIn: ['WON','LOST'] }` par une exclusion basée sur les `PipelineStage` avec `isWon`/`isLost` (jointure sur le pipeline de l'opportunité).
- Dedup des tickets en retard : élargir la fenêtre anti-doublon (ex. 24 h, configurable via `conditions.renotifyHours`) pour éviter la re-notification à chaque run horaire.
**Acceptation** : une opportunité dans un stage `isWon` custom n'est plus relancée ; un ticket en retard ne génère qu'une notification par 24 h.

### T-30 · Unifier le modèle de rôle (M-05)
**Fichiers** : `server/src/prisma/schema.prisma`, `users.ts`, `auth.ts`, `seed.ts`, client (affichage rôle)
- Cible : `roleId`/`roleRef` devient la source de vérité ; `User.role` (texte) reste un cache dérivé de `roleRef.name` (mis à jour automatiquement) ou est supprimé à terme.
- `users.ts` : remplacer `z.enum([...4 rôles])` par une validation contre la table Role (permet les rôles custom) ; toujours synchroniser `role` + `roleId` ensemble.
- Garder le bypass serveur `'*'` sur `roleRef.name === 'ADMIN'` (cohérent avec T-04).
**Acceptation** : créer un rôle custom dans l'UI puis l'assigner à un utilisateur fonctionne de bout en bout.

### T-31 · UI de réactivation des utilisateurs (M-08)
**Fichiers** : `server/src/routes/users.ts:30-39`, `client/src/pages/users/UsersPage.tsx`
- `GET /users?includeInactive=true` (réservé `users:read` + filtre par défaut inchangé).
- UI : toggle « Afficher les désactivés » + bouton « Réactiver » (PUT isActive: true, déjà supporté).
**Acceptation** : un utilisateur désactivé peut être retrouvé et réactivé sans toucher à la base.

### T-32 · Harmoniser les hooks API client (M-11)
**Fichiers** : `client/src/hooks/useApi.ts` + pages consommatrices
- Standardiser : tous les hooks renvoient le payload typé (`data.data`), avec un hook dédié `useListWithMeta` quand `meta` est nécessaire (pagination).
- `useUpdate` : accepter l'id comme variable de mutation (`mutate({ id, ...data })`) pour les listes.
- Migration mécanique des pages (rechercher `\.data\?\.data` et les usages de meta).
**Acceptation** : plus de double déréférencement incohérent ; tsc et lint OK.

### T-33 · Finitions diverses (L-01…L-08, M-12 reste)
**Fichiers** : multiples
- L-01 : `npm i -D @types/express@^4` côté serveur (supprime ~12 erreurs TS `string | string[]`). Objectif : `npx tsc --noEmit` serveur = 0 erreur.
- L-02 : `const PORT = Number(process.env.PORT) || 3001`.
- L-03 : déplacer `autoprefixer`, `postcss`, `tailwindcss`, `@types/leaflet` en devDependencies ; supprimer `@types/react-router-dom`.
- L-05 : retirer les casts `(prisma as any)` dans `apikeys.ts` et `middleware/auth.ts` (régénérer le client Prisma si besoin).
- L-06 : envoyer l'email de reset hors du cycle requête (setImmediate/queue) pour neutraliser l'oracle de timing.
- L-08 : une seule source de stockage du token côté client (garder `localStorage.accessToken`, retirer `accessToken` du persist Zustand, ou l'inverse).
- LoginPage : si le panneau démo est conservé en dev, corriger `lucas@crm.local` → `jean.dupont@crm.local / test123`.
**Acceptation** : 0 erreur `tsc` serveur ; dépendances rangées ; comportements inchangés.

### T-34 · Fonctionnalités produit à planifier (backlog, hors correctifs)
- Pièces jointes sur les tickets (upload + permissions + rétention).
- Invitation par email à la création d'un utilisateur (token de définition de mot de passe au lieu d'un mot de passe transmis).
- Notifications temps réel (SSE pour commencer : endpoint `/api/notifications/stream`).
- 2FA TOTP pour les comptes ADMIN ; verrouillage progressif de compte après échecs de login.
- Sauvegardes PostgreSQL automatisées + procédure de restauration testée.
- Nettoyer API.md des routes devis/factures non implémentées (Pennylane).

---

## Récapitulatif des dépendances entre tâches

| Tâche | Dépend de |
|-------|-----------|
| T-04, T-05 | aucune (mais tester ensemble : chaîne login→permissions) |
| T-09 | T-04 (le bypass ADMIN doit exister pour ne pas enfermer l'admin) |
| T-20 | T-07 recommandé (tester sur PostgreSQL) |
| T-23, T-24 | T-23 avant T-24 (audit des écoutes) |
| T-26 | idéalement après T-02/T-03 (sinon la CI naît rouge) |
| T-27, T-28 | T-28 d'abord (les gardes client doivent référencer la taxonomie finale) |
| T-30 | T-04 |
| T-32 | T-02 (build vert d'abord) |
