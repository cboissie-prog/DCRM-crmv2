# Documentation API

## Base URL
```
http://localhost:3001/api
```

## Authentification
Toutes les routes protégées nécessitent le header :
```
Authorization: Bearer <access_token>
```

---

## Endpoints

### Auth
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| POST    | /auth/login              | Connexion                      |
| POST    | /auth/logout             | Déconnexion                    |
| POST    | /auth/refresh            | Refresh du token               |
| POST    | /auth/forgot-password    | Demande réinitialisation MDP   |
| POST    | /auth/reset-password     | Réinitialisation MDP           |

### Users
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /users                   | Liste des utilisateurs         |
| POST    | /users                   | Créer un utilisateur           |
| GET     | /users/:id               | Détail utilisateur             |
| PUT     | /users/:id               | Modifier utilisateur           |
| DELETE  | /users/:id               | Supprimer utilisateur          |
| GET     | /users/me                | Profil courant                 |

### Contacts
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /contacts                | Liste (filtres, pagination)    |
| POST    | /contacts                | Créer contact                  |
| GET     | /contacts/:id            | Détail contact                 |
| PUT     | /contacts/:id            | Modifier contact               |
| DELETE  | /contacts/:id            | Supprimer contact              |
| GET     | /contacts/:id/activities | Historique activités           |
| POST    | /contacts/import         | Import CSV                     |

### Companies
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /companies               | Liste entreprises              |
| POST    | /companies               | Créer entreprise               |
| GET     | /companies/:id           | Détail entreprise              |
| PUT     | /companies/:id           | Modifier entreprise            |
| DELETE  | /companies/:id           | Supprimer entreprise           |

### Leads
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /leads                   | Liste leads                    |
| POST    | /leads                   | Créer lead                     |
| GET     | /leads/:id               | Détail lead                    |
| PUT     | /leads/:id               | Modifier lead                  |
| POST    | /leads/:id/convert       | Convertir en opportunité       |

### Opportunities
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /opportunities           | Liste opportunités             |
| POST    | /opportunities           | Créer opportunité              |
| GET     | /opportunities/:id       | Détail opportunité             |
| PUT     | /opportunities/:id       | Modifier opportunité           |
| PATCH   | /opportunities/:id/stage | Changer étape pipeline         |

### Products
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /products                | Liste produits                 |
| POST    | /products                | Créer produit                  |
| GET     | /products/:id            | Détail produit                 |
| PUT     | /products/:id            | Modifier produit               |

### Quotes
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /quotes                  | Liste devis                    |
| POST    | /quotes                  | Créer devis                    |
| GET     | /quotes/:id              | Détail devis                   |
| PUT     | /quotes/:id              | Modifier devis                 |
| POST    | /quotes/:id/send         | Envoyer par email              |
| POST    | /quotes/:id/convert      | Convertir en facture           |
| GET     | /quotes/:id/pdf          | Télécharger PDF                |

### Invoices
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /invoices                | Liste factures                 |
| POST    | /invoices                | Créer facture                  |
| GET     | /invoices/:id            | Détail facture                 |
| PUT     | /invoices/:id            | Modifier facture               |
| POST    | /invoices/:id/send       | Envoyer par email              |
| POST    | /invoices/:id/payment    | Enregistrer paiement           |
| GET     | /invoices/:id/pdf        | Télécharger PDF                |

### Contracts
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /contracts               | Liste contrats                 |
| POST    | /contracts               | Créer contrat                  |
| GET     | /contracts/:id           | Détail contrat                 |
| PUT     | /contracts/:id           | Modifier contrat               |

### Tickets
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /tickets                 | Liste tickets                  |
| POST    | /tickets                 | Créer ticket                   |
| GET     | /tickets/:id             | Détail ticket                  |
| PUT     | /tickets/:id             | Modifier ticket                |
| POST    | /tickets/:id/comments    | Ajouter commentaire            |

### Activities
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /activities              | Liste activités                |
| POST    | /activities              | Créer activité                 |
| PUT     | /activities/:id          | Modifier activité              |
| DELETE  | /activities/:id          | Supprimer activité             |

### Dashboard
| Méthode | Route                    | Description                    |
|---------|--------------------------|--------------------------------|
| GET     | /dashboard/stats         | KPIs principaux                |
| GET     | /dashboard/revenue       | Données CA (graphique)         |
| GET     | /dashboard/pipeline      | Stats pipeline                 |

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
    "code": "VALIDATION_ERROR",
    "message": "Le champ email est requis",
    "details": { "field": "email" }
  }
}
```

## Paramètres de Pagination
```
?page=1&limit=25&sortBy=createdAt&sortOrder=desc&search=dupont
```
