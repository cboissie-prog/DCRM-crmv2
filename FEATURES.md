# Fonctionnalités Détaillées du CRM

> Note : Devis et factures gérés via Pennylane (outil externe). Ce CRM importe les stats financières.

---

## 1. Authentification & Utilisateurs

- Connexion email/mot de passe + JWT refresh tokens
- Rôles : `ADMIN`, `MANAGER`, `COMMERCIAL`, `TECHNICIEN`
- Profil utilisateur (nom, email, téléphone, avatar)
- Permissions par rôle
- Réinitialisation mot de passe par email

---

## 2. Contacts & Entreprises

- Fiche contact (nom, prénom, email, téléphone, mobile, poste)
- Association entreprise
- Tags, source d'acquisition, statut (prospect/client/inactif/perdu)
- Historique complet des interactions (timeline)
- Import/export CSV
- Recherche et filtres avancés
- Fiche entreprise (raison sociale, SIRET, TVA, adresses)
- Secteur d'activité, CA potentiel / réalisé
- Contacts, deals, tickets, contrats associés

---

## 3. Pipeline Commercial

- Leads avec score de qualification (0-100) **[SCORING AUTO]**
- Source du lead (web, appel, email, salon, parrainage)
- Conversion lead → opportunité
- Pipeline Kanban (drag & drop) : Nouveau → Qualification → Proposition → Négociation → Gagné/Perdu
- Valeur estimée, probabilité, date closing prévue
- Vue liste + vue Kanban
- Raison de perte archivée

---

## 4. Catalogue Produits & Services

- **Produits** : Caisses enregistreuses, Matériel informatique, Logiciels
  - Référence, nom, description, photo, prix HT/TTC, TVA, stock, fournisseur
- **Services** : Maintenance, Installation, Site web, Formation
  - Tarif horaire ou forfaitaire, durée estimée, récurrence

---

## 5. Stats Financières (import Pennylane)

- Dashboard CA mensuel / annuel
- **MRR / ARR** (revenu récurrent mensuel/annuel depuis contrats)
- Prévisions de ventes (pipeline pondéré)
- Impayés et retards de paiement
- Export données comptables CSV

---

## 6. Contrats de Maintenance

- Types : Maintenance informatique, Maintenance caisse, Hébergement web
- Durée, dates début/fin/renouvellement, montant mensuel/annuel
- SLA (délai intervention, plages horaires)
- Équipements couverts
- Alertes renouvellement (60j, 30j, 7j avant expiration)
- Génération factures récurrentes (export vers Pennylane)

---

## 7. Support & Tickets SAV

- Création ticket (client, sujet, description, priorité)
- Catégories : Panne matérielle, Bug logiciel, SAV caisse, Réseau, Site web
- Priorités : Faible, Normal, Élevé, Critique
- Statut : Nouveau → En cours → En attente client → Résolu → Fermé
- Assignation technicien, chronomètre temps passé intégré
- Notes internes vs messages client
- Lien contrat de maintenance + SLA tracking
- Rapport d'intervention PDF
- **NPS automatique après résolution** (email satisfaction client)

---

## 8. Parc Informatique Client ⭐

- Inventaire complet des équipements chez chaque client
  - PCs, serveurs, imprimantes, caisses enregistreuses, switches, NAS...
- Champs : N° de série, marque, modèle, date d'achat, date de garantie
- Alertes expiration de garantie
- Lien avec tickets SAV (quel équipement est en panne)
- Lien avec contrats (équipements couverts)
- Historique interventions par équipement

---

## 9. Licences Logicielles ⭐

- Suivi des licences par client (Windows, antivirus, logiciel caisse, Office...)
- Nombre de postes, date d'expiration, fournisseur
- Alertes expiration (60j, 30j avant)
- Renouvellement lié à un contrat ou devis Pennylane

---

## 10. Agenda & Interventions

- Calendrier (jour / semaine / mois)
- Types : RDV client, Intervention terrain, Appel, Formation, Livraison
- Assignation techniciens, lien avec ticket ou opportunité
- Rappels email + notification in-app
- Vue planning par technicien
- **Cartographie clients** (vue carte Google Maps des adresses clients)

---

## 11. Activités & Historique

- Log automatique de toutes les actions CRM
- Activités manuelles : Appel, Email, RDV, Note, Tâche
- Timeline par contact / entreprise / opportunité
- **Email tracking** : détection ouverture email envoyé depuis le CRM

---

## 12. Dashboard & Reporting

### Dashboard principal
- KPIs : CA mois, MRR, Tickets ouverts, Opportunités en cours
- Graphique CA sur 12 mois
- Pipeline commercial (entonnoir)
- Alertes : contrats expirant, tickets critiques, relances à faire
- Agenda du jour

### Rapports
- **Commercial** : CA par commercial, par catégorie, par période
- **MRR/ARR** : évolution revenu récurrent
- **Prévisions** : pipeline pondéré par probabilité
- **Objectifs & quotas** : cibles CA par commercial + avancement
- **Support** : tickets par technicien, temps de résolution, SLA
- **Clients** : nouveaux, actifs, **alertes churn** (inactifs > 90j)
- Export Excel/CSV

---

## 13. Automatisations ⭐

Règles configurables "Si X → alors Y" :
- Ticket non traité en 24h → alerte manager
- Opportunité sans activité depuis 15j → tâche relance auto
- Contrat expirant dans 30j → email au client
- Lead score > 70 → notification commercial
- Ticket résolu → envoi NPS automatique
- Facture en retard (via Pennylane) → alerte commercial

---

## 14. Scoring des Leads ⭐

Score 0-100 calculé automatiquement selon :
- Taille entreprise (+ de salariés = + de points)
- Source (référence > web > appel froid)
- Engagement (ouvertures email, réponses)
- Secteur d'activité (correspondent à votre cible)
- Activités récentes (réunions, appels)

---

## 15. Objectifs & Quotas Commerciaux

- Cibles CA par commercial (mensuel / trimestriel / annuel)
- Progression en temps réel vs objectif
- Classement équipe (leaderboard)
- Alertes si en dessous de X% de l'objectif

---

## 16. Alertes Churn ⭐

Détection clients à risque :
- Pas de contact depuis X jours (configurable)
- Tickets récurrents non résolus
- Contrat expirant non renouvelé
- Score de santé client (vert/orange/rouge)

---

## 17. Base de Connaissance Interne

- Wiki pour techniciens
- Articles par catégorie (Procédures, FAQ, Résolutions courantes)
- Recherche full-text
- Lié aux tickets (suggestion d'articles similaires)

---

## 18. NPS & Satisfaction Client

- Envoi automatique après résolution de ticket
- Score NPS (0-10) + commentaire libre
- Dashboard NPS global
- Historique par client

---

## 19. Paramètres & Configuration

- Informations entreprise (logo, adresse, mentions légales)
- Modèles d'email personnalisables
- Étapes pipeline configurables
- Tags & catégories personnalisables
- TVA configurables
- Règles d'automatisation
- Gestion utilisateurs & rôles
