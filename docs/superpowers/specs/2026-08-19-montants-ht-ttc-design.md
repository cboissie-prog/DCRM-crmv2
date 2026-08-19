# Affichage HT + TTC sur tous les montants — Design

**Date** : 2026-08-19
**Statut** : validé par Clément (conversation du 19/08/2026)

## Contexte

La convention DCRM est actée depuis le commit `fe1cf1a` : tous les montants stockés et
agrégés sont en euros **HT**, le TTC n'est jamais stocké ni servi par l'API. Le commit
`fe1cf1a` (mentions « HT » sur les libellés) n'avait jamais été poussé sur GitHub, donc
jamais déployé en prod via Plesk — d'où l'absence de différence visible.

## Objectif

1. Pousser et déployer l'existant (mentions HT).
2. Afficher **partout** où un montant apparaît les deux valeurs : HT (principale) et
   TTC (secondaire, discrète). Cela couvre les KPI du dashboard, les totaux de tableaux
   et colonnes Kanban, les fiches détail, et chaque montant individuel dans les listes.

## Décisions validées

- **Taux de TVA** : taux global fixe de **20 %** pour dériver le TTC de tout montant
  non lié à un produit (opportunités, contrats, objectifs, MRR/ARR, CA…). Quand un
  produit avec son propre `vatRate` est concerné (catalogue), on utilise ce taux.
- **Format** : HT en valeur principale, TTC en petit/gris (`text-xs text-gray-500`)
  dessous (variante `stacked`) ou à la suite (variante `inline` pour cellules denses).
- **Formulaires** : la saisie reste en HT (libellés « … HT (€) » existants) ; un
  indicateur « soit X € TTC » s'affiche sous le champ, recalculé à la frappe.
- **Graphiques** (CA Recharts) : restent en HT avec mention dans le titre — une courbe
  TTC serait la même courbe ×1,2, sans valeur ajoutée.
- **Aucun changement serveur, API ou schéma** : le TTC est une dérivation d'affichage
  pure, calculée côté client.

## Architecture

### Composant `Money` — `client/src/components/ui/Money.tsx`

```tsx
<Money value={montantHT} />                        // stacked, 20 % par défaut
<Money value={montantHT} vatRate={product.vatRate} variant="inline" />
```

- Props : `value: number | null | undefined`, `vatRate?: number` (défaut `20`),
  `variant?: 'stacked' | 'inline'` (défaut `stacked`), `className?`.
- `value` nul/undefined → « — » (comportement de `formatCurrency` conservé).
- Rendu `stacked` : HT sur une ligne (`1 250 € HT`), TTC dessous en
  `text-xs text-gray-500` (`1 500 € TTC`).
- Rendu `inline` : `1 250 € HT` puis ` · 1 500 € TTC` en petit/gris sur la même ligne.
- Formatage via le `formatCurrency` existant de `client/src/lib/utils.ts`
  (fr-FR, EUR, 0 décimale minimum) ; helper exporté `ttcFrom(ht, vatRate = 20)`.

### Indicateur TTC sous les champs de saisie

Petit texte `soit 1 500,00 € TTC` sous chaque input de montant HT dans les
formulaires (opportunités, leads, contrats, licences, CA annuel entreprise,
objectifs). Affiché seulement si le champ contient un nombre valide > 0.
Selon le pattern des formulaires existants (form builder `formFields.ts` ou
formulaires ad hoc), l'indicateur est intégré au niveau le plus factorisé possible.

## Périmètre du balayage (client uniquement)

Toutes les pages affichant des montants passent sur `<Money>` (ou l'indicateur
formulaire), en remplaçant les `formatCurrency` directs, `toLocaleString` et « € »
codés en dur :

| Page | Montants concernés |
|---|---|
| DashboardPage | KPI CA / Pipeline / MRR / ARR (stacked), titre graphique inchangé |
| PipelinePage | cartes Kanban (inline), totaux de colonnes (inline), stats |
| LeadsPage | montants leads |
| ContractsPage | mensuel/annuel, totaux |
| LicensesPage | coûts, totaux |
| ParcClientPage | valeurs, totaux |
| ProductsPage | prix avec le **vrai `vatRate` du produit** |
| EquipmentPage | valeurs d'achat |
| TargetsPage | objectifs/réalisés individuels et entreprise |
| CompanyDetailPage | CA annuel, récap financier |
| ContactDetailPage | montants liés |

Les exports CSV restent en HT uniquement (une colonne, convention données).

## Étapes de livraison

1. Pousser `master` local (contient `fe1cf1a` + `833e77f`) sur GitHub.
2. Implémenter `Money` + indicateur formulaire + balayage des pages.
3. Vérifier build + lint client.
4. Commit, push, déploiement Plesk par Clément.

## Tests

- Build TypeScript (`npm run build` client) et ESLint verts.
- Vérification visuelle des pages principales (dashboard, pipeline, contrats,
  produits) en dev.
- Cas limites : montant nul (« — »), montant 0, `vatRate` produit ≠ 20 (ex. 5,5 %).

## Hors périmètre

- Aucun stockage/servi de TTC (convention inchangée, facturation via Pennylane).
- Pas de taux de TVA configurable dans Réglages (pourra venir plus tard si besoin).
- Graphiques : pas de série TTC.
