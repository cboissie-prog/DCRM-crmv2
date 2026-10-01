# EntityPicker — sélection d'entités liées avec création à la volée

**Date** : 2026-10-01
**Statut** : validé par Clément (périmètre, UX en mini-modale empilée)

## 1. Problème

Partout où un formulaire demande de choisir une entité existante (entreprise, contact,
équipement, contrat, produit du catalogue), l'utilisateur doit souvent quitter la modale,
créer l'entité sur sa page, puis revenir. Le flux est cassé.

Inventaire du 01/10/2026 :

| Formulaire | Champ | Widget actuel | Création inline |
|---|---|---|---|
| Contrat (`ContractsPage`) | Entreprise* | select natif (200) | non |
| Contrat | Produit modèle de contrat | select natif | non |
| Équipement (`EquipmentPage`) | Entreprise* | select natif (200) | non |
| Équipement | Produit catalogue | select natif | non |
| Équipement | Contrat lié | select natif | oui (`QuickContractModal`) |
| Licence (`LicensesPage`) | Entreprise* | select natif (200) | non |
| Licence | Produit logiciel | select natif | non |
| Licence | Équipement lié | select natif | oui (`QuickEquipmentModal`) |
| Opportunité (`PipelinePage`) | Entreprise, Contact | select natif (200) | non |
| Lead édition (`LeadsPage`) | Contact | select natif | non (la création a `ContactInlinePicker`) |
| Lead création | Contact | `ContactInlinePicker` | oui (création différée) |
| Ticket (`TicketsPage`) | Contact, Entreprise | `SearchSelect` + mini-form inline | oui |
| Appel (`CallsPage`) | Contact, Entreprise | select natif + mini-form inline | oui |
| Ticket depuis appel | Contact / Entreprise | `ContactInlinePicker` / select | oui / non |
| Lead depuis appel | Contact | `ContactInlinePicker` | oui |
| Contact (`ContactsPage`) | Entreprise | select natif + bascule « Nouvelle » | oui |
| Fiche société, onglet Équipements (`ParcClientPage`) | Contrat lié | select natif | non |
| Fiche société, onglet Licences | Équipement lié, Produit logiciel | select natif | non |
| Fiche société, onglet Contrats | Produit modèle | select natif | non |

Deux défauts supplémentaires :

- **Quatre implémentations** du même besoin coexistent (`ContactInlinePicker` + `lib/contactPicker.ts`,
  mini-formulaires inline de Tickets/Appels/Contacts, `QuickContractModal`, `QuickEquipmentModal`).
- La plupart des listes chargent **200 entrées sans recherche serveur** : au-delà, les
  entités deviennent invisibles dans les formulaires.

## 2. Périmètre

**Inclus**

- Un composant unique `EntityPicker` pour cinq entités : `company`, `contact`, `equipment`,
  `contract`, `product`.
- Recherche serveur sur les cinq entités (ajout du paramètre `search` sur équipements et contrats).
- Création à la volée dans une mini-modale empilée, pour les cinq entités, conditionnée
  par la permission `<entité>:create`.
- Migration de **tous** les champs du tableau ci-dessus (champs cassés et implémentations
  divergentes) vers `EntityPicker`, puis suppression du code remplacé.

**Exclus**

- Les champs « utilisateur assigné / participant / technicien » : un utilisateur a besoin
  d'un compte, il ne se crée pas à la volée. Ils restent en select natif (`useUsersList`).
- Les filtres de page (statut, catégorie, recherche de liste).
- Le choix d'un pipeline ou d'une étape (boutons, gérés dans Réglages).
- Toute évolution des champs métier des entités créées : les mini-modales créent des
  enregistrements minimaux, l'utilisateur complète ensuite sur la fiche.

## 3. Composant `EntityPicker`

Fichier : `client/src/components/ui/EntityPicker.tsx`.

```ts
type PickerEntity = 'company' | 'contact' | 'equipment' | 'contract' | 'product'

interface EntityPickerContext {
  /** Filtre et pré-remplissage pour contact / equipment / contract */
  companyId?: string | null
  /** Filtre et pré-remplissage pour product : catégorie (ex. CONTRACT_TEMPLATE) */
  productCategory?: string
  /** Filtre et pré-remplissage pour product : type (ex. software, hardware) */
  productType?: string
}

interface EntityPickerProps {
  entity: PickerEntity
  value: string | null
  /** Libellé de la valeur courante, pour l'afficher sans recharger (édition) */
  valueLabel?: string
  onChange: (id: string | null, option?: SearchSelectOption) => void
  context?: EntityPickerContext
  allowNone?: boolean
  disabled?: boolean
  placeholder?: string
  error?: string
  /** Masque le bouton « + Créer » même avec la permission (ex. profondeur 2) */
  noCreate?: boolean
}
```

Comportement :

- **Recherche** : s'appuie sur `SearchSelect` existant. `onSearch(query)` appelle
  `GET /<ressource>?search=<query>&limit=20` plus les filtres du contexte
  (`companyId` pour contacts/équipements/contrats, `category`/`type`/`isActive=true` pour produits).
  Les libellés sont construits par entité : nom + ville (entreprise), prénom nom + entreprise
  (contact), nom ou marque modèle + n° de série (équipement), titre + type + dates (contrat),
  nom + référence + prix HT (produit).
- **Bouton « + Créer »** à droite du champ, rendu seulement si `usePermission('<ressource>:create')`
  est vrai et `noCreate` faux. Il ouvre la mini-modale de création de l'entité.
- **Après création** : toast de succès, `queryClient.invalidateQueries` sur la clé de liste
  de l'entité, puis `onChange(newId, option)`. La mini-modale se ferme, le champ affiche
  l'entité créée. La création est **immédiate en base** : annuler ensuite la modale parente
  ne la supprime pas (comportement actuel des mini-formulaires Tickets/Appels, retenu pour
  sa simplicité).
- **Profondeur** : le champ entreprise des mini-modales Contact, Équipement et Contrat est
  lui-même un `EntityPicker entity="company"`, qui autorise la création. Ce picker imbriqué
  passe `noCreate` à ses propres enfants éventuels : profondeur maximale = 1 niveau
  d'imbrication (créer une entreprise depuis la création d'un contact, pas plus).

Permissions utilisées : `companies:create`, `contacts:create`, `equipment:create`,
`contracts:create`, `products:create` (clés existantes du seed).

## 4. Mini-modales de création

Fichiers : `client/src/components/ui/quick-create/Quick<Entity>Modal.tsx` (cinq fichiers)
et `client/src/components/ui/quick-create/index.ts`. Toutes utilisent `Modal size="sm"`,
react-hook-form + Zod v4, les mêmes contraintes que les schémas serveur.

| Entité | Champs (astérisque = requis) | Pré-remplissage depuis le contexte |
|---|---|---|
| Entreprise | nom*, recherche SIRENE (`CompanySearchInput`), téléphone, email | SIRENE → SIRET, TVA, adresse, ville, code postal |
| Contact | prénom*, nom*, email, téléphone, entreprise (`EntityPicker company`) | `companyId` |
| Équipement | entreprise* (`EntityPicker company`), type* (référentiel `equipment_type`), nom, marque, modèle, n° de série | `companyId` |
| Contrat | entreprise* (`EntityPicker company`), type* (référentiel `contract_type`), titre*, date de début*, date de fin* | `companyId` |
| Produit | nom*, catégorie* (référentiel `product_category`), prix HT*, référence | `productCategory`, `productType` ; `isActive = true` |

Interface commune :

```ts
interface QuickCreateModalProps {
  open: boolean
  onClose: () => void
  context?: EntityPickerContext
  onCreated: (option: SearchSelectOption) => void
}
```

Règles :

- Les listes de référentiel passent par `useReferencesQuery` existant.
- Les montants sont saisis et envoyés en euros HT, libellé « Prix HT », conformément à la convention du projet.
- En cas d'échec API, le message `error.message` renvoyé par le serveur s'affiche dans la
  mini-modale, qui reste ouverte. La modale parente n'est jamais affectée.
- Le formulaire est réinitialisé à chaque ouverture.

## 5. Côté serveur

- `GET /equipment` : nouveau paramètre `search` (contains insensible à la casse via `ciContains`
  sur `name`, `brand`, `model`, `serialNumber`).
- `GET /contracts` : nouveau paramètre `search` (sur `title`, `reference`).
- Les routes entreprises, contacts et produits ont déjà `search`. Aucune modification de
  schéma Prisma, aucune migration.
- `server/docs/API.md` et `server/docs/openapi.json` mis à jour pour les deux routes.

## 6. Migration des formulaires

Ordre de migration, un commit par page :

1. Contrats — entreprise, produit modèle (`productCategory: 'CONTRACT_TEMPLATE'`).
2. Équipements — entreprise, produit catalogue, contrat lié (remplace `QuickContractModal`).
3. Licences — entreprise, produit logiciel, équipement lié (remplace `QuickEquipmentModal`).
4. Fiche société (`ParcClientPage`) — contrat lié, équipement lié, produits (×2) ; le
   `companyId` de la fiche est passé en contexte, pas de champ entreprise.
5. Pipeline — entreprise, contact (contexte `companyId` = entreprise choisie ; changer
   d'entreprise réinitialise le contact).
6. Leads — création et édition sur le même `EntityPicker contact` ; suppression de
   `ContactInlinePicker` et `lib/contactPicker.ts` une fois les appels migrés.
7. Appels — formulaire principal (contact, entreprise) et sous-modales ticket/lead.
8. Tickets — contact, entreprise ; suppression des mini-formulaires inline.
9. Contacts — entreprise ; suppression de la bascule « Nouvelle » locale.

À la fin : plus aucune occurrence de `ContactInlinePicker`, `contactPicker.ts`,
`QuickContractModal`, `QuickEquipmentModal`, ni de mini-formulaire « Nouveau contact /
Nouvelle entreprise » codé dans une page. `CompanySearchInput` est conservé (utilisé par
`QuickCompanyModal` et par la page Entreprises).

## 7. Tests

- **Serveur** : `tests/api/search-params.test.ts` — `GET /equipment?search=` et
  `GET /contracts?search=` renvoient les bonnes lignes, insensibles à la casse, et respectent
  les permissions existantes.
- **Client** (vitest + Testing Library, comme `CanDo.test.tsx`) :
  `EntityPicker.test.tsx` — appel de recherche avec les filtres du contexte, bouton « + Créer »
  absent sans permission et présent avec, `onChange` appelé avec l'entité créée après
  `onCreated`.
- **Manuel** en dev : chaque formulaire migré, création d'une entité depuis le champ puis
  soumission du formulaire parent ; cas « entreprise créée depuis la création d'un contact ».
- Suites existantes vertes (232 tests serveur), lint et build client propres.

## 8. Hors périmètre, pour plus tard

- Création différée (rollback si la modale parente est annulée).
- Création d'un utilisateur à la volée.
- Recherche serveur sur `GET /licenses` (aucun picker ne cible une licence).
