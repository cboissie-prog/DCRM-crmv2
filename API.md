# Documentation API — DCRM CRM v2

## Base URL
```
http://localhost:3001/api          (dev)
https://votre-domaine.com/api      (prod)
```

## Authentification

Deux méthodes acceptées sur toutes les routes protégées :

### JWT (usage navigateur)
```
Authorization: Bearer <access_token>
```
Obtenu via `POST /auth/login`. Durée de vie : 15 minutes. Renouvelable via `POST /auth/refresh` (refresh token en cookie httpOnly, 7 jours).

### API Key (usage externe / intégrations)
```
X-API-Key: dcrm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Clés à durée de vie longue générées via `POST /apikeys`. Idéal pour Zapier, n8n, Make, scripts, webhooks entrants.

---

## Rate Limiting

| Scope | Limite |
|-------|--------|
| Global | 500 req / 15 min |
| Auth (login, forgot-password) | 20 req / 15 min |

---

## Format des Réponses

### Succès
```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 25 }
}
```

### Erreur
```json
{
  "success": false,
  "error": {
    "code": "SNAKE_CASE_CODE",
    "message": "Message lisible"
  }
}
```

| Code HTTP | Code erreur | Signification |
|-----------|-------------|---------------|
| 400 | `VALIDATION_ERROR` | Corps de requête invalide |
| 401 | `UNAUTHORIZED` | Token absent ou expiré |
| 403 | `FORBIDDEN` | Permission insuffisante |
| 404 | `NOT_FOUND` | Ressource introuvable |
| 409 | `CONFLICT` | Contrainte d'unicité |
| 500 | `INTERNAL_ERROR` | Erreur serveur |

---

## Paramètres de Pagination

```
?page=1&limit=25&sortBy=createdAt&sortOrder=desc&search=dupont
```

---

## Endpoints

---

### Health

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/health` | Non | État du serveur |

---

### Auth `/api/auth`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/auth/login` | Non | Connexion — retourne access token + cookie refresh |
| POST | `/auth/refresh` | Cookie | Renouvelle l'access token |
| POST | `/auth/logout` | JWT | Déconnexion — invalide refresh token |
| POST | `/auth/forgot-password` | Non | Demande de reset mot de passe par email |
| POST | `/auth/reset-password` | Non | Reset avec token reçu par email |
| GET | `/auth/me` | JWT | Profil de l'utilisateur connecté |

**POST /auth/login**
```json
{ "email": "string", "password": "string" }
```

**POST /auth/reset-password**
```json
{ "token": "string", "password": "string (min 8 chars)" }
```

---

### API Keys `/api/apikeys`

> Gestion des clés d'accès pour les intégrations externes.

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/apikeys` | Authentifié | Liste les clés de l'utilisateur courant |
| POST | `/apikeys` | Authentifié | Génère une nouvelle clé (affichée une seule fois) |
| DELETE | `/apikeys/:id` | Authentifié | Révoque une clé |

**POST /apikeys**
```json
{
  "name": "string",
  "expiresAt": "ISO date (optionnel)"
}
```

**Réponse POST** (la clé complète n'est affichée qu'à la création) :
```json
{
  "success": true,
  "data": {
    "id": "clxxx",
    "name": "Mon intégration n8n",
    "key": "dcrm_abcdef1234567890abcdef1234567890",
    "prefix": "dcrm_abc",
    "expiresAt": null,
    "createdAt": "2026-06-10T..."
  }
}
```

**GET /apikeys — liste**
```json
{
  "success": true,
  "data": [
    {
      "id": "clxxx",
      "name": "Mon intégration n8n",
      "prefix": "dcrm_abc",
      "lastUsedAt": "2026-06-10T...",
      "expiresAt": null,
      "isActive": true,
      "createdAt": "2026-06-10T..."
    }
  ]
}
```

---

### Users `/api/users`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/users` | `users:read` | Liste des utilisateurs actifs |
| POST | `/users` | `users:create` | Créer un utilisateur |
| GET | `/users/:id` | Authentifié | Détail utilisateur (soi-même, ADMIN, MANAGER) |
| PUT | `/users/:id` | Authentifié | Modifier utilisateur |
| DELETE | `/users/:id` | `users:delete` | Désactiver utilisateur (soft delete) |
| PATCH | `/users/:id/password` | Authentifié | Changer mot de passe |
| GET | `/users/targets` | `reports:read` | Objectifs de vente par utilisateur |
| POST | `/users/targets` | `reports:read` | Définir/mettre à jour un objectif |

**POST /users**
```json
{
  "email": "string",
  "password": "string (min 8)",
  "firstName": "string",
  "lastName": "string",
  "phone": "string?",
  "role": "ADMIN | MANAGER | COMMERCIAL | TECHNICIEN"
}
```

**PATCH /users/:id/password**
```json
{
  "currentPassword": "string? (requis si non-ADMIN)",
  "newPassword": "string (min 8)"
}
```

---

### Rôles & Permissions `/api/roles`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/roles` | `settings:roles` | Liste des rôles avec compteurs |
| GET | `/roles/permissions/all` | `settings:roles` | Toutes les permissions groupées par catégorie |
| GET | `/roles/:id` | `settings:roles` | Détail d'un rôle avec ses permissions |
| POST | `/roles` | `settings:roles` | Créer un nouveau rôle |
| PUT | `/roles/:id` | `settings:roles` | Modifier le label d'un rôle |
| PUT | `/roles/:id/permissions` | `settings:roles` | Remplacer les permissions d'un rôle |
| DELETE | `/roles/:id` | `settings:roles` | Supprimer un rôle (impossible si système ou utilisé) |

**POST /roles**
```json
{ "name": "string (converti en UPPERCASE)", "label": "string" }
```

**PUT /roles/:id/permissions**
```json
{ "permissionIds": ["string", "string"] }
```

---

### Contacts `/api/contacts`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/contacts` | `contacts:read` | Liste paginée avec filtres |
| POST | `/contacts` | `contacts:create` | Créer un contact |
| GET | `/contacts/:id` | `contacts:read` | Détail avec leads, tickets, activités, NPS |
| PUT | `/contacts/:id` | `contacts:update` | Modifier un contact |
| DELETE | `/contacts/:id` | `contacts:delete` | Désactiver (soft delete) |
| POST | `/contacts/import/csv` | `contacts:create` | Import CSV batch (max 500 lignes) |
| GET | `/contacts/export/csv` | `contacts:read` | Export CSV |

**Query params GET /contacts**
```
search?       recherche sur nom, email, téléphone
status?       PROSPECT | CLIENT | INACTIVE | LOST
source?       WEBSITE | PHONE_INBOUND | EMAIL | TRADE_SHOW | REFERRAL | COLD_CALL | SOCIAL_MEDIA | OTHER
companyId?
page?         défaut 1
limit?        défaut 25, max 100
sortBy?       createdAt | updatedAt | firstName | lastName | email | status | source | leadScore
sortOrder?    asc | desc
```

**POST /contacts et PUT /contacts/:id**
```json
{
  "firstName": "string",
  "lastName": "string",
  "email": "string?",
  "phone": "string?",
  "mobile": "string?",
  "position": "string?",
  "companyId": "string?",
  "source": "string?",
  "status": "string?",
  "tags": "string?",
  "notes": "string?"
}
```

---

### Entreprises `/api/companies`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/companies` | `companies:read` | Liste paginée avec filtres |
| POST | `/companies` | `companies:create` | Créer une entreprise |
| GET | `/companies/:id` | `companies:read` | Détail avec contacts, tickets, contrats, équipements |
| PUT | `/companies/:id` | `companies:update` | Modifier une entreprise |
| DELETE | `/companies/:id` | `companies:delete` | Désactiver (soft delete) |
| POST | `/companies/import/csv` | `companies:import` | Import CSV batch (max 500 lignes) |
| GET | `/companies/export/csv` | `companies:read` | Export CSV |
| GET | `/companies/data/map` | `companies:read` | Données pour cartographie (entreprises géolocalisées) |

**Query params GET /companies**
```
search?       recherche sur nom, siret, ville
sector?       filtre exact
page?         défaut 1
limit?        défaut 25, max 100
sortBy?       createdAt | updatedAt | name | city | sector | employees | annualRevenue
sortOrder?    asc | desc
```

**POST /companies et PUT /companies/:id**
```json
{
  "name": "string",
  "siret": "string?",
  "vatNumber": "string?",
  "website": "string?",
  "sector": "string?",
  "employees": "number?",
  "annualRevenue": "number?",
  "billingAddress": "string?",
  "shippingAddress": "string?",
  "city": "string?",
  "postalCode": "string?",
  "country": "string?",
  "lat": "number?",
  "lng": "number?",
  "notes": "string?",
  "tags": "string?"
}
```

---

### Pipeline & Leads `/api/pipeline`

#### Leads

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/pipeline/leads` | `pipeline:read` | Liste des leads |
| POST | `/pipeline/leads` | `pipeline:create` | Créer un lead |
| PUT | `/pipeline/leads/:id` | `pipeline:update` | Modifier un lead |
| PATCH | `/pipeline/leads/:id/status` | `pipeline:update` | Changer le status |
| DELETE | `/pipeline/leads/:id` | `pipeline:delete` | Supprimer un lead |
| POST | `/pipeline/leads/:id/convert` | `pipeline:update` | Convertir en opportunité |

**POST /pipeline/leads**
```json
{
  "contactId": "string",
  "source": "string?",
  "title": "string",
  "description": "string?",
  "score": "number? (0-100)"
}
```

**PATCH /pipeline/leads/:id/status**
```json
{ "status": "NEW | CONTACTED | QUALIFIED | CONVERTED | LOST | UNREACHABLE" }
```

**POST /pipeline/leads/:id/convert**
```json
{ "pipelineId": "string?", "stage": "string?" }
```

#### Opportunités

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/pipeline/opportunities` | `pipeline:read` | Liste des opportunités |
| POST | `/pipeline/opportunities` | `pipeline:create` | Créer une opportunité |
| GET | `/pipeline/opportunities/:id` | `pipeline:read` | Détail avec activités, produits |
| PUT | `/pipeline/opportunities/:id` | `pipeline:update` | Modifier une opportunité |
| PATCH | `/pipeline/opportunities/:id/stage` | `pipeline:update` | Changer le stage |

**POST /pipeline/opportunities**
```json
{
  "title": "string",
  "contactId": "string?",
  "companyId": "string?",
  "leadId": "string?",
  "pipelineId": "string?",
  "stage": "string?",
  "value": "number?",
  "probability": "number? (0-100)",
  "expectedCloseDate": "ISO date?",
  "assignedToId": "string?",
  "notes": "string?",
  "tags": "string?",
  "lostReason": "string?",
  "remindAt": "ISO date?"
}
```

**PATCH /pipeline/opportunities/:id/stage**
```json
{ "stage": "string", "lostReason": "string? (requis si LOST)" }
```

---

### Pipelines `/api/pipelines`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/pipelines` | `pipeline:read` | Liste des pipelines avec stages |
| POST | `/pipelines` | `pipeline:create` | Créer un pipeline |
| PUT | `/pipelines/:id` | `pipeline:update` | Modifier un pipeline |
| PATCH | `/pipelines/:id/default` | `pipeline:update` | Définir comme pipeline par défaut |
| DELETE | `/pipelines/:id` | `pipeline:delete` | Supprimer un pipeline |
| POST | `/pipelines/:id/stages` | `pipeline:create` | Ajouter un stage |
| PUT | `/pipelines/:id/stages/:stageId` | `pipeline:update` | Modifier un stage |
| DELETE | `/pipelines/:id/stages/:stageId` | `pipeline:delete` | Supprimer un stage |
| PATCH | `/pipelines/:id/stages/reorder` | `pipeline:update` | Réordonner les stages |

**PATCH /pipelines/:id/stages/reorder**
```json
{ "stages": [{ "id": "string", "order": "number" }] }
```

---

### Produits `/api/products`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/products` | `products:read` | Liste paginée |
| POST | `/products` | `products:create` | Créer un produit |
| GET | `/products/:id` | `products:read` | Détail |
| PUT | `/products/:id` | `products:update` | Modifier |
| DELETE | `/products/:id` | `products:delete` | Désactiver (soft delete) |

**POST /products**
```json
{
  "reference": "string?",
  "name": "string",
  "description": "string?",
  "category": "string",
  "type": "string?",
  "price": "number",
  "vatRate": "number?",
  "unit": "string?",
  "stock": "number?",
  "supplier": "string?",
  "imageUrl": "string?",
  "isActive": "boolean?"
}
```

---

### Tickets SAV `/api/tickets`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/tickets` | `tickets:read` | Liste paginée avec filtres |
| POST | `/tickets` | `tickets:create` | Créer un ticket (réf auto TKT-YYYY-XXXX) |
| GET | `/tickets/:id` | `tickets:read` | Détail avec commentaires |
| PUT | `/tickets/:id` | `tickets:update` | Modifier |
| PATCH | `/tickets/:id/status` | `tickets:update` | Changer le statut |
| POST | `/tickets/:id/comments` | `tickets:update` | Ajouter un commentaire |
| PATCH | `/tickets/:id/time` | `tickets:update` | Enregistrer temps passé (minutes) |
| DELETE | `/tickets/:id` | `tickets:delete` | Supprimer (hard delete) |
| GET | `/tickets/export/csv` | `tickets:export` | Export CSV |

**Query params GET /tickets**
```
search?       titre, référence, description
status?       OPEN | IN_PROGRESS | WAITING | RESOLVED | CLOSED
priority?     LOW | NORMAL | HIGH | CRITICAL
category?
assignedToId?
companyId?
page?         défaut 1
limit?        défaut 25, max 100
```

**POST /tickets**
```json
{
  "title": "string",
  "description": "string",
  "category": "string",
  "priority": "LOW | NORMAL | HIGH | CRITICAL",
  "contactId": "string?",
  "companyId": "string?",
  "contractId": "string?",
  "equipmentId": "string?",
  "assignedToId": "string?",
  "notes": "string?"
}
```

**PATCH /tickets/:id/status**
```json
{ "status": "string", "timeSpent": "number? (minutes)" }
```

**POST /tickets/:id/comments**
```json
{ "content": "string", "isInternal": "boolean?", "authorName": "string?" }
```

---

### Contrats `/api/contracts`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/contracts` | `contracts:read` | Liste paginée avec filtres |
| POST | `/contracts` | `contracts:create` | Créer un contrat (réf auto CTR-YYYY-XXXX) |
| GET | `/contracts/:id` | `contracts:read` | Détail avec alertes renouvellement |
| PUT | `/contracts/:id` | `contracts:update` | Modifier |
| DELETE | `/contracts/:id` | `contracts:delete` | Supprimer (hard delete) |
| GET | `/contracts/stats/mrr` | `contracts:read` | MRR/ARR global |

**Query params GET /contracts**
```
status?           DRAFT | ACTIVE | EXPIRED | CANCELLED | RENEWED
type?
companyId?
expiringSoon?     "true" = expirant dans 60 jours
page?             défaut 1
limit?            défaut 25, max 100
```

**POST /contracts**
```json
{
  "companyId": "string",
  "type": "string",
  "title": "string",
  "description": "string?",
  "status": "string?",
  "startDate": "ISO date",
  "endDate": "ISO date",
  "renewalDate": "ISO date?",
  "monthlyAmount": "number?",
  "annualAmount": "number?",
  "slaResponseTime": "number?",
  "slaWorkingHours": "string?",
  "autoRenewal": "boolean?",
  "notes": "string?"
}
```

**GET /contracts/stats/mrr — réponse**
```json
{
  "success": true,
  "data": {
    "mrr": 12500,
    "arr": 150000,
    "byType": { "MAINTENANCE": 8000, "SLA": 4500 },
    "total": 42
  }
}
```

---

### Équipements `/api/equipment`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/equipment` | `equipment:read` | Liste paginée avec filtres |
| POST | `/equipment` | `equipment:create` | Créer un équipement |
| GET | `/equipment/:id` | `equipment:read` | Détail avec tickets et licences |
| PUT | `/equipment/:id` | `equipment:update` | Modifier |
| DELETE | `/equipment/:id` | `equipment:delete` | Supprimer (hard delete) |

**Query params GET /equipment**
```
companyId?
type?
status?
warrantyExpiringSoon?     "true" = dans 90 jours
page?                     défaut 1
limit?                    défaut 50, max 200
```

**POST /equipment**
```json
{
  "companyId": "string",
  "contractId": "string?",
  "type": "string",
  "brand": "string?",
  "model": "string?",
  "serialNumber": "string?",
  "purchaseDate": "ISO date?",
  "warrantyExpiry": "ISO date?",
  "location": "string?",
  "status": "string?",
  "notes": "string?"
}
```

---

### Licences `/api/licenses`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/licenses` | `equipment:read` | Liste paginée avec filtres |
| POST | `/licenses` | `equipment:create` | Créer une licence |
| PUT | `/licenses/:id` | `equipment:update` | Modifier |
| DELETE | `/licenses/:id` | `equipment:delete` | Supprimer (hard delete) |

**Query params GET /licenses**
```
companyId?
type?
expiringSoon?     "true" = dans 60 jours
page?             défaut 1
limit?            défaut 50, max 200
```

**POST /licenses**
```json
{
  "companyId": "string",
  "equipmentId": "string?",
  "software": "string",
  "vendor": "string?",
  "licenseKey": "string?",
  "seats": "number?",
  "type": "string?",
  "purchaseDate": "ISO date?",
  "expiryDate": "ISO date?",
  "cost": "number?",
  "notes": "string?"
}
```

---

### Activités `/api/activities`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/activities` | `activities:read` | Liste paginée avec filtres |
| POST | `/activities` | `activities:create` | Créer une activité |
| PUT | `/activities/:id` | `activities:update` | Modifier |
| DELETE | `/activities/:id` | `activities:delete` | Supprimer (hard delete) |

**Query params GET /activities**
```
contactId?
companyId?
opportunityId?
type?         EMAIL | CALL | MEETING | NOTE | TASK | OTHER
page?         défaut 1
limit?        défaut 25, max 100
```

**POST /activities**
```json
{
  "type": "EMAIL | CALL | MEETING | NOTE | TASK | OTHER",
  "title": "string",
  "description": "string?",
  "contactId": "string?",
  "companyId": "string?",
  "opportunityId": "string?",
  "dueDate": "ISO date?"
}
```

---

### Agenda `/api/appointments`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/appointments` | `appointments:read` | Liste avec filtres date/utilisateur |
| POST | `/appointments` | `appointments:create` | Créer un RDV (notifie les participants) |
| PUT | `/appointments/:id` | `appointments:update` | Modifier |
| DELETE | `/appointments/:id` | `appointments:delete` | Supprimer (hard delete) |

**Query params GET /appointments**
```
from?     ISO date (gte startAt)
to?       ISO date (lte startAt)
userId?
```

**POST /appointments**
```json
{
  "title": "string",
  "description": "string?",
  "type": "string",
  "startAt": "ISO date",
  "endAt": "ISO date",
  "location": "string?",
  "ticketId": "string?",
  "notes": "string?",
  "userIds": ["string"],
  "contactIds": ["string"]
}
```

---

### Dashboard `/api/dashboard`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/dashboard/today` | `dashboard:read` | RDV du jour, tickets urgents, activités en retard |
| GET | `/dashboard/stats` | `dashboard:read` | KPIs globaux, alertes, pipeline |
| GET | `/dashboard/revenue` | `dashboard:read` | CA gagné par mois |
| GET | `/dashboard/churn-risks` | `dashboard:read` | Entreprises à risque de churn |
| GET | `/dashboard/nps` | `dashboard:read` | Score NPS global |

**Query params GET /dashboard/revenue**
```
months?   1-24, défaut 12
```

---

### Notifications `/api/notifications`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/notifications` | Authentifié | 50 dernières notifications de l'utilisateur |
| PATCH | `/notifications/read-all` | Authentifié | Marquer toutes comme lues |
| PATCH | `/notifications/:id/read` | Authentifié | Marquer une notification comme lue |
| DELETE | `/notifications/all` | Authentifié | Supprimer toutes les notifications |
| DELETE | `/notifications/:id` | Authentifié | Supprimer une notification |

**Réponse GET /notifications**
```json
{
  "success": true,
  "data": [...],
  "meta": { "unreadCount": 3 }
}
```

**Types de notifications** : `TICKET_ASSIGNED`, `TICKET_URGENT`, `CONTRACT_EXPIRING`, `LICENSE_EXPIRING`, `WARRANTY_EXPIRING`, `OPPORTUNITY_INACTIVE`, `AUTOMATION_TRIGGERED`, `NPS_RECEIVED`, `LEAD_SCORED`, `CHURN_RISK`, `APPOINTMENT_CREATED`, `APPOINTMENT_REMINDER`

---

### Base de connaissance `/api/knowledge`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/knowledge/categories` | `knowledge:read` | Compteurs par catégorie |
| GET | `/knowledge` | `knowledge:read` | Liste paginée (brouillons visibles par ADMIN/MANAGER) |
| POST | `/knowledge` | `knowledge:create` | Créer un article |
| GET | `/knowledge/:id` | `knowledge:read` | Détail (auto-incrémente vues) |
| PUT | `/knowledge/:id` | `knowledge:update` | Modifier |
| DELETE | `/knowledge/:id` | `knowledge:delete` | Supprimer |

**POST /knowledge**
```json
{
  "title": "string",
  "content": "string",
  "category": "string",
  "tags": "string?",
  "isPublished": "boolean?"
}
```

---

### Automatisations `/api/automations`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/automations` | `automation:read` | Liste avec stats d'exécution |
| POST | `/automations` | `automation:create` | Créer une automatisation |
| GET | `/automations/:id/logs` | `automation:read` | 50 derniers logs |
| PUT | `/automations/:id` | `automation:update` | Modifier |
| PATCH | `/automations/:id` | `automation:update` | Activer/désactiver |
| DELETE | `/automations/:id` | `automation:delete` | Supprimer |

**Triggers disponibles** : `OPPORTUNITY_CREATED`, `OPPORTUNITY_STAGE_CHANGED`, `TICKET_CREATED`, `TICKET_ASSIGNED`, `TICKET_RESOLVED`, `LEAD_SCORE_THRESHOLD`

**POST /automations**
```json
{
  "name": "string",
  "description": "string?",
  "trigger": "string",
  "conditions": "string? (JSON stringifié)",
  "actions": "string (JSON stringifié)",
  "isActive": "boolean?"
}
```

---

### Objectifs `/api/targets`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/targets` | `reports:read` | Objectifs par période (COMMERCIAL : seulement les siens) |
| GET | `/targets/forecast` | `reports:read` | Prévisions pondérées |
| POST | `/targets` | `reports:read` | Créer/mettre à jour (upsert) un objectif |
| PUT | `/targets/:id` | `reports:read` | Modifier un objectif |
| DELETE | `/targets/:id` | `reports:read` | Supprimer |

**Query params GET /targets**
```
period?   format "YYYY-QN" ou "YYYY-MM", défaut trimestre courant
```

---

### Parc informatique `/api/parc`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/parc/overview` | `equipment:read` | Vue d'ensemble par client (équipements, licences, alertes) |

---

### Rapports `/api/reports`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/reports/sales-targets` | `reports:read` | Objectifs avec CA réel calculé |
| POST | `/reports/sales-targets` | `reports:read` | Créer un objectif |
| PUT | `/reports/sales-targets/:id` | `reports:read` | Modifier un objectif |
| DELETE | `/reports/sales-targets/:id` | `reports:read` | Supprimer |
| GET | `/reports/pipeline-forecast` | `reports:read` | Prévisions par stage de pipeline |
| GET | `/reports/commercial-performance` | `reports:read` | Performance par commercial |
| GET | `/reports/periods` | `reports:read` | 8 derniers trimestres disponibles |

---

### Paramètres `/api/settings`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/settings` | `settings:write` | Tous les paramètres |
| GET | `/settings/:key` | `settings:read` | Un paramètre |
| PUT | `/settings/:key` | `settings:write` | Modifier un paramètre |
| POST | `/settings/actions/run-contract-update` | `settings:write` | Déclencher mise à jour statuts contrats |

**Clés disponibles** : `contractExpiringSoonDays`, `licenseExpiringSoonDays`, `schedulerEnabled`, `schedulerTime`, `companyName`, `companyLogoUrl`, `companyAddress`, `companyContactEmail`, `companyPhone`, `companySiret`, `companyVatNumber`

---

### Recherche globale `/api/search`

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/search?q=xxx` | Authentifié | Recherche multi-entités (min 2 chars) |

**Réponse** : 5 résultats max par type (contacts, companies, tickets, opportunities)

```json
{
  "success": true,
  "data": {
    "contacts": [{ "id": "...", "label": "Prénom Nom", "sub": "Entreprise", "link": "/contacts/...", "type": "contact" }],
    "companies": [...],
    "tickets": [...],
    "opportunities": [...]
  }
}
```

---

## Permissions disponibles

| Clé | Description |
|-----|-------------|
| `dashboard:read` | Voir le tableau de bord |
| `contacts:read` | Voir les contacts |
| `contacts:create` | Créer des contacts |
| `contacts:update` | Modifier des contacts |
| `contacts:delete` | Supprimer des contacts |
| `companies:read` | Voir les entreprises |
| `companies:create` | Créer des entreprises |
| `companies:update` | Modifier des entreprises |
| `companies:delete` | Supprimer des entreprises |
| `companies:import` | Importer des entreprises CSV |
| `pipeline:read` | Voir le pipeline |
| `pipeline:create` | Créer leads/opportunités |
| `pipeline:update` | Modifier leads/opportunités |
| `pipeline:delete` | Supprimer leads/opportunités |
| `tickets:read` | Voir les tickets |
| `tickets:create` | Créer des tickets |
| `tickets:update` | Modifier des tickets |
| `tickets:delete` | Supprimer des tickets |
| `tickets:export` | Exporter les tickets |
| `contracts:read` | Voir les contrats |
| `contracts:create` | Créer des contrats |
| `contracts:update` | Modifier des contrats |
| `contracts:delete` | Supprimer des contrats |
| `equipment:read` | Voir équipements/licences/parc |
| `equipment:create` | Créer équipements/licences |
| `equipment:update` | Modifier équipements/licences |
| `equipment:delete` | Supprimer équipements/licences |
| `activities:read` | Voir les activités |
| `activities:create` | Créer des activités |
| `activities:update` | Modifier des activités |
| `activities:delete` | Supprimer des activités |
| `appointments:read` | Voir l'agenda |
| `appointments:create` | Créer des RDV |
| `appointments:update` | Modifier des RDV |
| `appointments:delete` | Supprimer des RDV |
| `products:read` | Voir le catalogue |
| `products:create` | Créer des produits |
| `products:update` | Modifier des produits |
| `products:delete` | Supprimer des produits |
| `reports:read` | Voir les rapports et objectifs |
| `knowledge:read` | Voir la base de connaissance |
| `knowledge:create` | Créer des articles |
| `knowledge:update` | Modifier des articles |
| `knowledge:delete` | Supprimer des articles |
| `automation:read` | Voir les automatisations |
| `automation:create` | Créer des automatisations |
| `automation:update` | Modifier des automatisations |
| `automation:delete` | Supprimer des automatisations |
| `users:read` | Voir les utilisateurs |
| `users:create` | Créer des utilisateurs |
| `users:delete` | Désactiver des utilisateurs |
| `settings:read` | Lire les paramètres |
| `settings:write` | Modifier les paramètres |
| `settings:roles` | Gérer les rôles et permissions |

> **Note** : Les utilisateurs ADMIN contournent toutes les vérifications de permissions.

---

## Non implémenté

Les endpoints suivants sont **intentionnellement absents** — gérés par des outils externes :

- `Quotes` (devis) → Pennylane
- `Invoices` (factures) → Pennylane
