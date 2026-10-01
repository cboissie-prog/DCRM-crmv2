# EntityPicker — Implementation Plan

> **For agentic workers:** implémenter tâche par tâche, une tâche = un commit. Les sous-agents tournent en **Sonnet**, jamais en Fable. Cases `- [ ]` pour le suivi.

**Goal:** Un composant unique `EntityPicker` (recherche serveur + bouton « + Créer » ouvrant une mini-modale empilée) remplace tous les champs de sélection d'entreprise, contact, équipement, contrat et produit des formulaires du CRM, et les quatre implémentations divergentes existantes disparaissent.

**Architecture:** `EntityPicker` s'appuie sur `SearchSelect` (combobox à recherche distante) et délègue la création à cinq `Quick<Entity>Modal` (react-hook-form + Zod v4, `Modal size="sm"`). Le serveur gagne le paramètre `search` sur `GET /equipment` et `GET /contracts`. Les pages sont migrées une par une, puis le code remplacé est supprimé.

**Tech Stack:** React 19 + TypeScript, TanStack Query v5, react-hook-form + Zod v4 (client), Express + Prisma + Zod v3 (serveur), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-01-entity-picker-design.md`

## Global Constraints

- Permissions de création : `companies:create`, `contacts:create`, `equipment:create`, `contracts:create`, `products:create` via `usePermission()` (`client/src/hooks/usePermission.ts`).
- Listes de référentiel via `useReferencesQuery()` / `useReferences()` (`client/src/hooks/useReferences.ts`) : domaines `equipment_type`, `contract_type`, `product_category`.
- Montants saisis et envoyés en **euros HT**, libellé « Prix HT ».
- Recherche serveur : `GET /<ressource>?search=&limit=20` + filtres de contexte ; utiliser `ciContains` de `server/src/lib/query.ts`.
- Aucun changement de schéma Prisma, aucune migration.
- Les champs « utilisateur assigné » restent en `<select>` natif (`useUsersList`).
- Après chaque tâche : `npx tsc --noEmit -p .` (server) ou `npm run lint && npm run build` (client) propres ; suites de tests vertes.
- Docs API (`server/docs/API.md` + `openapi.json`) mises à jour dans la tâche serveur.
- Fin de chaque message de commit :
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_016RAaqJuUGBhiYy8YDw5EDR`

---

### Task 1: Recherche serveur sur équipements et contrats

**Files:**
- Modify: `server/src/routes/equipment.ts` (GET `/`, ~l.31-47)
- Modify: `server/src/routes/contracts.ts` (GET `/`, ~l.39-54)
- Modify: `server/docs/API.md`, `server/docs/openapi.json`
- Create: `server/tests/api/search-params.test.ts`

**Steps:**
- [ ] `equipment.ts` : lire `search` dans `req.query` ; si présent, `where.OR = [{ brand: ciContains(search) }, { model: ciContains(search) }, { serialNumber: ciContains(search) }]` (pas de champ `name` sur `Equipment`).
- [ ] `contracts.ts` : idem avec `where.OR = [{ title: ciContains(search) }, { reference: ciContains(search) }]` (vérifier le nom exact des colonnes dans `schema.prisma`, modèle `Contract`).
- [ ] Documenter le paramètre `search` dans API.md (tableau + détail des deux routes) et openapi.json (`parameters` des deux GET).
- [ ] Tests : créer une entreprise, deux équipements et deux contrats de test ; vérifier que `?search=` renvoie la bonne ligne (insensible à la casse), que la recherche vide renvoie tout, nettoyage en `afterAll`.
- [ ] `npx vitest run` vert, `tsc` propre. Commit : `feat(api): parametre search sur GET /equipment et GET /contracts`.

---

### Task 2: Composant `EntityPicker` et modales de création

**Files:**
- Create: `client/src/components/ui/EntityPicker.tsx`
- Create: `client/src/components/ui/quick-create/types.ts` (`QuickCreateModalProps`, `EntityPickerContext`, `PickerEntity`)
- Create: `client/src/components/ui/quick-create/QuickCompanyModal.tsx`
- Create: `client/src/components/ui/quick-create/QuickContactModal.tsx`
- Create: `client/src/components/ui/quick-create/QuickEquipmentModal.tsx`
- Create: `client/src/components/ui/quick-create/QuickContractModal.tsx`
- Create: `client/src/components/ui/quick-create/QuickProductModal.tsx`
- Create: `client/src/components/ui/quick-create/index.ts`
- Create: `client/src/components/ui/EntityPicker.test.tsx`

**Interfaces:**
- Produces : `EntityPicker` (props de la spec §3), `EntityPickerContext`, `PickerEntity`.
- Consumes : `SearchSelect` (`components/ui/SearchSelect.tsx`), `Modal`, `CompanySearchInput` (`SocietePrefill`), `usePermission`, `useReferencesQuery`, `api`, `toast`.

**Steps:**
- [ ] `types.ts` : types partagés ; table `ENTITY_META: Record<PickerEntity, { resource: string; permission: string; listQueryKey: string; label: string }>` (`companies`, `contacts`, `equipment`, `contracts`, `products`).
- [ ] `EntityPicker.tsx` :
  - `onSearch(query)` → `api.get('/<resource>', { params: { search, limit: 20, ...filtres contexte } })` ; filtres : `companyId` (contact/equipment/contract), `category`/`type`/`isActive: 'true'` (product). Mapper en `SearchSelectOption` avec libellé/sous-libellé par entité (spec §3).
  - Ligne flex : `SearchSelect` (flex-1) + bouton `btn-secondary` « + Créer » (icône `Plus`) si permission et `!noCreate`.
  - État `createOpen` ; rendu de la `Quick<Entity>Modal` correspondante avec `context`, `onCreated(option)` → `queryClient.invalidateQueries({ queryKey: [listQueryKey] })`, `toast.success`, `onChange(option.id, option)`, fermeture.
  - Affichage de `error` sous le champ (classe `text-xs text-red-600`).
- [ ] Modales (schémas Zod v4 alignés sur le serveur) :
  - Company : `name` min 1, `phone`, `email` ; `CompanySearchInput` au-dessus, `onSelect` pré-remplit `name`, `siret`, `vatNumber`, `billingAddress`, `city`, `postalCode`, `country`. POST `/companies`.
  - Contact : `firstName`, `lastName` min 1, `email`, `phone`, `companyId` (EntityPicker company avec `noCreate={false}` — ses enfants reçoivent `noCreate`). POST `/contacts`.
  - Equipment : `companyId` requis (EntityPicker company, pré-rempli), `type` requis (select référentiel `equipment_type`), `brand`, `model`, `serialNumber`. POST `/equipment`.
  - Contract : `companyId`, `type` (référentiel `contract_type`), `title`, `startDate`, `endDate` requis, `endDate >= startDate`. POST `/contracts`.
  - Product : `name`, `category` (référentiel `product_category`, pré-rempli depuis `context.productCategory`), `price` nombre ≥ 0 (« Prix HT »), `reference` ; envoyer `type: context.productType` si fourni et `isActive: true`. POST `/products`.
  - Chaque modale : `reset()` à l'ouverture, erreur API affichée (`error.response.data.error.message`), bouton « Créer et sélectionner », `onCreated({ id, label, sublabel })`.
- [ ] `EntityPicker.test.tsx` (jsdom, mock de `api`) : (1) la recherche appelle `/contacts` avec `search` et `companyId` du contexte ; (2) sans permission, pas de bouton « Créer » ; (3) avec permission `companies:create` (store `user.permissions` ou mécanisme utilisé par `usePermission`), le bouton existe ; (4) `onChange` reçoit l'id renvoyé par `onCreated`.
- [ ] `npm run lint`, `npm run build`, `npm test` verts. Commit : `feat(ui): EntityPicker + modales de creation rapide (entreprise, contact, equipement, contrat, produit)`.

---

### Task 3: Migration Contrats, Équipements, Licences

**Files:**
- Modify: `client/src/pages/contracts/ContractsPage.tsx` (entreprise ~l.315, produit modèle ~l.292)
- Modify: `client/src/pages/equipment/EquipmentPage.tsx` (entreprise ~l.375, produit ~l.357, contrat ~l.398 ; supprimer `QuickContractModal` ~l.516)
- Modify: `client/src/pages/licenses/LicensesPage.tsx` (entreprise ~l.292, produit logiciel, équipement ~l.350 ; supprimer `QuickEquipmentModal` ~l.462)

**Steps:**
- [ ] Contrats : `EntityPicker entity="company"` (valueLabel = nom en édition) ; produit modèle → `EntityPicker entity="product" context={{ productCategory: 'CONTRACT_TEMPLATE' }}`, conserver la logique de pré-remplissage à la sélection (`option.meta` porte l'objet produit).
- [ ] Équipements : entreprise, produit catalogue (contexte selon l'usage actuel : catégorie/type physique), contrat lié avec `context={{ companyId }}` ; supprimer `QuickContractModal` et ses états.
- [ ] Licences : entreprise, produit logiciel (`context` = type/catégorie logiciel utilisés par la requête actuelle `products-software`), équipement lié avec `context={{ companyId }}` ; supprimer `QuickEquipmentModal`.
- [ ] Les requêtes `useQuery` de listes à 200 devenues inutiles sont supprimées.
- [ ] Lint + build ; vérification manuelle en dev (créer une entreprise depuis la modale contrat, soumettre). Commit : `feat(parc): EntityPicker sur Contrats, Equipements, Licences`.

---

### Task 4: Migration fiche société et Pipeline

**Files:**
- Modify: `client/src/pages/parc/ParcClientPage.tsx` (contrat lié ~l.671, produits ~l.841 et ~l.1058, équipement ~l.898)
- Modify: `client/src/pages/pipeline/PipelinePage.tsx` (entreprise ~l.537, contact ~l.558)

**Steps:**
- [ ] ParcClientPage : les quatre champs en `EntityPicker` avec `context={{ companyId: <id de la fiche> }}` ; pas de champ entreprise.
- [ ] Pipeline : `EntityPicker company` puis `EntityPicker contact context={{ companyId }}` ; changer d'entreprise remet `contactId` à `null`.
- [ ] Lint + build ; vérification manuelle. Commit : `feat(ui): EntityPicker sur la fiche societe et les opportunites`.

---

### Task 5: Migration Leads, Appels, Tickets, Contacts et suppression du code remplacé

**Files:**
- Modify: `client/src/pages/pipeline/LeadsPage.tsx` (création ~l.596, édition ~l.622)
- Modify: `client/src/pages/calls/CallsPage.tsx` (formulaire ~l.1123-1204, sous-modales ~l.1362-1372 et ~l.1451)
- Modify: `client/src/pages/tickets/TicketsPage.tsx` (contact ~l.1446, entreprise ~l.1505, mini-formulaires inline)
- Modify: `client/src/pages/contacts/ContactsPage.tsx` (entreprise ~l.450, bascule « Nouvelle »)
- Delete: `client/src/components/ui/ContactInlinePicker.tsx`, `client/src/lib/contactPicker.ts`

**Steps:**
- [ ] Leads : un seul `EntityPicker contact` en création et édition ; retirer `resolveContactPicker` du submit.
- [ ] Appels : contact + entreprise en `EntityPicker` dans le formulaire principal ; sous-modales ticket/lead : contact + entreprise en `EntityPicker` ; supprimer les mini-formulaires inline et leurs états.
- [ ] Tickets : contact + entreprise en `EntityPicker` ; supprimer les mini-formulaires « Nouveau contact / Nouvelle entreprise » et leurs états/permissions locales.
- [ ] Contacts : entreprise en `EntityPicker` ; supprimer la bascule locale « + Nouvelle » (garder `CompanySearchInput` pour la page Entreprises).
- [ ] Supprimer `ContactInlinePicker.tsx` et `lib/contactPicker.ts` ; `grep -rn "ContactInlinePicker\|contactPicker\|QuickContractModal\|QuickEquipmentModal" client/src` doit être vide.
- [ ] Lint + build + `npm test` ; vérification manuelle des quatre pages. Commit : `refactor(ui): EntityPicker sur Leads, Appels, Tickets, Contacts — suppression des implementations divergentes`.

---

### Task 6: Clôture

- [ ] Suite serveur complète verte, lint/build/test client verts.
- [ ] `PROGRESS.md` : mention de la création à la volée sur les formulaires concernés.
- [ ] `JOURNAL.md` (local) : entrée de session.
- [ ] Push `origin/master` ; déploiement Plesk par Clément ; vérification en prod : créer une entreprise depuis la modale Contrat.
