/**
 * Registre des référentiels personnalisables (Réglages > Listes).
 *
 * Chaque domaine décrit une liste de valeurs métier historiquement codée en dur
 * (client/src/lib/utils.ts et pages) et désormais stockée dans la table
 * ReferenceValue. Les valeurs `seed` reprennent exactement les constantes front
 * d'origine : le seed est donc sans effet sur les données existantes.
 *
 * `usage` sert au DELETE (compter les entités qui référencent la clé pour
 * désactiver au lieu de supprimer). `validate: false` (secteurs) = la liste
 * n'est qu'une aide à la saisie, le champ reste libre côté serveur (import
 * SIRENE/CSV peut produire n'importe quel texte).
 */

export interface ReferenceSeedValue {
  key: string
  label: string
  color?: string   // jeton couleur (blue, green, orange, …) — mappé côté client
  icon?: string    // nom d'icône lucide
  isSystem?: boolean
  meta?: Record<string, unknown>
}

export interface ReferenceDomain {
  domain: string
  label: string
  description: string
  /** Champs entité qui stockent la clé — utilisés pour compter l'usage avant suppression. */
  usage: { model: string; field: string }[]
  /** false = liste indicative (champ libre côté serveur) ; true = clé vérifiée à l'écriture. */
  validate: boolean
  /** 'code' = clés MAJUSCULES_UNDERSCORE générées du libellé ; 'free' = clé = libellé (secteurs). */
  keyStyle: 'code' | 'free'
  hasColor: boolean
  hasIcon: boolean
  seed: ReferenceSeedValue[]
}

export const REFERENCE_DOMAINS: ReferenceDomain[] = [
  {
    domain: 'ticket_category',
    label: 'Catégories de tickets',
    description: 'Catégories proposées à la création d\'un ticket SAV.',
    usage: [{ model: 'ticket', field: 'category' }],
    validate: true, keyStyle: 'code', hasColor: true, hasIcon: false,
    seed: [
      { key: 'HARDWARE_FAILURE', label: 'Panne matérielle', color: 'orange' },
      { key: 'SOFTWARE_BUG', label: 'Bug logiciel', color: 'purple' },
      { key: 'CASH_REGISTER_SAV', label: 'SAV Caisse', color: 'blue' },
      { key: 'NETWORK', label: 'Réseau', color: 'cyan' },
      { key: 'WEBSITE', label: 'Site web', color: 'indigo' },
      { key: 'TRAINING', label: 'Formation', color: 'green' },
      { key: 'OTHER', label: 'Autre', color: 'gray', isSystem: true }, // fallback des formulaires et de la création depuis un appel
    ],
  },
  {
    domain: 'call_category',
    label: 'Catégories d\'appels',
    description: 'Catégories des appels téléphoniques (journal des appels).',
    usage: [{ model: 'call', field: 'category' }],
    validate: true, keyStyle: 'code', hasColor: true, hasIcon: false,
    seed: [
      { key: 'INCIDENT', label: 'Incident', color: 'red' },
      { key: 'INFORMATION', label: 'Renseignement', color: 'blue' },
      { key: 'SUPPORT', label: 'Support technique', color: 'cyan' },
      { key: 'COMMERCIAL', label: 'Commercial', color: 'purple' },
      { key: 'SAV', label: 'SAV', color: 'orange' },
      { key: 'OTHER', label: 'Autre', color: 'gray', isSystem: true },
    ],
  },
  {
    domain: 'equipment_type',
    label: 'Types d\'équipement',
    description: 'Types de matériel du parc informatique.',
    usage: [{ model: 'equipment', field: 'type' }],
    validate: true, keyStyle: 'code', hasColor: false, hasIcon: true,
    seed: [
      { key: 'DESKTOP', label: 'PC Bureau', icon: 'Monitor' },
      { key: 'LAPTOP', label: 'Laptop', icon: 'Laptop' },
      { key: 'SERVER', label: 'Serveur', icon: 'Server' },
      { key: 'PRINTER', label: 'Imprimante', icon: 'Printer' },
      { key: 'CASH_REGISTER', label: 'Caisse enregistreuse', icon: 'ShoppingCart' },
      { key: 'SWITCH', label: 'Switch', icon: 'Network' },
      { key: 'ROUTER', label: 'Routeur', icon: 'Router' },
      { key: 'NAS', label: 'NAS', icon: 'HardDrive' },
      { key: 'SCREEN', label: 'Écran', icon: 'Monitor' },
      { key: 'TABLET', label: 'Tablette', icon: 'Tablet' },
      { key: 'PHONE', label: 'Téléphone', icon: 'Smartphone' },
      { key: 'OTHER', label: 'Autre', icon: 'HelpCircle', isSystem: true }, // fallback de l'auto-détection depuis le catalogue
    ],
  },
  {
    domain: 'equipment_status',
    label: 'Statuts d\'équipement',
    description: 'États possibles d\'un équipement du parc.',
    usage: [{ model: 'equipment', field: 'status' }],
    validate: true, keyStyle: 'code', hasColor: true, hasIcon: false,
    seed: [
      { key: 'ACTIVE', label: 'Actif', color: 'green', isSystem: true }, // statut par défaut à la création
      { key: 'IN_REPAIR', label: 'En réparation', color: 'orange' },
      { key: 'RETIRED', label: 'Retraité', color: 'gray' },
      { key: 'LOST', label: 'Perdu', color: 'red' },
    ],
  },
  {
    domain: 'contract_type',
    label: 'Types de contrat',
    description: 'Types de contrats de maintenance et de service.',
    usage: [{ model: 'contract', field: 'type' }],
    validate: true, keyStyle: 'code', hasColor: false, hasIcon: false,
    seed: [
      { key: 'IT_MAINTENANCE', label: 'Maintenance IT' },
      { key: 'CASH_REGISTER_MAINTENANCE', label: 'Maintenance caisses' },
      { key: 'WEB_HOSTING', label: 'Hébergement web' },
      { key: 'SOFTWARE_MAINTENANCE', label: 'Maintenance logiciel' },
      { key: 'FULL_SUPPORT', label: 'Support complet' },
    ],
  },
  {
    domain: 'license_type',
    label: 'Types de licence',
    description: 'Modes de licence des logiciels du parc.',
    usage: [{ model: 'license', field: 'type' }],
    validate: true, keyStyle: 'code', hasColor: false, hasIcon: false,
    seed: [
      { key: 'PERPETUAL', label: 'Perpétuelle', isSystem: true },   // cible de la règle catalogue → licence
      { key: 'ANNUAL', label: 'Annuelle', isSystem: true },         // idem + type par défaut des formulaires
      { key: 'MONTHLY', label: 'Mensuelle' },
      { key: 'SUBSCRIPTION', label: 'Abonnement' },
    ],
  },
  {
    domain: 'contact_status',
    label: 'Statuts de contact',
    description: 'Cycle de vie d\'un contact (prospect, client…).',
    usage: [{ model: 'contact', field: 'status' }],
    validate: true, keyStyle: 'code', hasColor: true, hasIcon: false,
    seed: [
      { key: 'PROSPECT', label: 'Prospect', color: 'blue', isSystem: true }, // défaut à la création + import CSV
      { key: 'CLIENT', label: 'Client', color: 'green' },
      { key: 'INACTIVE', label: 'Inactif', color: 'gray' },
      { key: 'LOST', label: 'Perdu', color: 'red' },
    ],
  },
  {
    domain: 'lead_source',
    label: 'Sources de leads',
    description: 'Origines des leads et contacts (site web, salon, prospection…).',
    usage: [{ model: 'lead', field: 'source' }, { model: 'contact', field: 'source' }],
    validate: true, keyStyle: 'code', hasColor: false, hasIcon: false,
    seed: [
      { key: 'WEBSITE', label: 'Site web' },
      { key: 'PHONE_INBOUND', label: 'Appel entrant' },
      { key: 'EMAIL', label: 'Email' },
      { key: 'TRADE_SHOW', label: 'Salon' },
      { key: 'REFERRAL', label: 'Référence' },
      { key: 'COLD_CALL', label: 'Prospection' },
      { key: 'SOCIAL_MEDIA', label: 'Réseaux sociaux' },
      { key: 'MANUAL', label: 'Saisie manuelle' }, // valeur historique par défaut des leads créés à la main
      { key: 'OTHER', label: 'Autre', isSystem: true },
    ],
  },
  {
    domain: 'sector',
    label: 'Secteurs d\'activité',
    description: 'Secteurs proposés sur les fiches entreprise. Liste indicative : le champ reste libre (import SIRENE/CSV).',
    usage: [{ model: 'company', field: 'sector' }],
    validate: false, keyStyle: 'free', hasColor: true, hasIcon: false,
    seed: [
      { key: 'Commerce alimentaire', label: 'Commerce alimentaire', color: 'amber' },
      { key: 'Pharmacie', label: 'Pharmacie', color: 'blue' },
      { key: 'Restauration', label: 'Restauration', color: 'red' },
      { key: 'Santé', label: 'Santé', color: 'emerald' },
      { key: 'Commerce habillement', label: 'Commerce habillement', color: 'pink' },
      { key: 'Informatique', label: 'Informatique', color: 'indigo' },
      { key: 'Immobilier', label: 'Immobilier', color: 'violet' },
      { key: 'Automobile', label: 'Automobile', color: 'slate' },
      { key: 'Industrie', label: 'Industrie', color: 'orange' },
      { key: 'Services', label: 'Services', color: 'cyan' },
      { key: 'Autre', label: 'Autre', color: 'gray' },
    ],
  },
  {
    domain: 'appointment_type',
    label: 'Types de rendez-vous',
    description: 'Types d\'évènements de l\'agenda (couleur des rendez-vous).',
    usage: [{ model: 'appointment', field: 'type' }],
    validate: true, keyStyle: 'code', hasColor: true, hasIcon: false,
    seed: [
      { key: 'CLIENT_MEETING', label: 'RDV Client', color: 'indigo', isSystem: true }, // créé par le tag « RDV » du pipeline
      { key: 'INTERVENTION', label: 'Intervention', color: 'orange' },
      { key: 'CALL', label: 'Appel', color: 'green', isSystem: true },                 // créé par le tag « Appel » du pipeline
      { key: 'TRAINING', label: 'Formation', color: 'purple' },
      { key: 'DELIVERY', label: 'Livraison', color: 'blue' },
      { key: 'OTHER', label: 'Autre', color: 'slate', isSystem: true },                // rappels automatiques du pipeline
    ],
  },
  {
    domain: 'knowledge_category',
    label: 'Catégories de la base de connaissances',
    description: 'Rubriques des articles internes (procédures, FAQ…).',
    usage: [{ model: 'knowledgeArticle', field: 'category' }],
    validate: true, keyStyle: 'code', hasColor: true, hasIcon: true,
    seed: [
      { key: 'PROCEDURES', label: 'Procédures', color: 'blue', icon: 'ClipboardList' },
      { key: 'FAQ', label: 'FAQ', color: 'violet', icon: 'HelpCircle' },
      { key: 'RESOLUTIONS', label: 'Résolutions', color: 'emerald', icon: 'CheckCircle2' },
      { key: 'HARDWARE', label: 'Matériel', color: 'amber', icon: 'Monitor' },
      { key: 'SOFTWARE', label: 'Logiciels', color: 'indigo', icon: 'Code2' },
      { key: 'NETWORK', label: 'Réseau', color: 'cyan', icon: 'Wifi' },
      { key: 'CASHREGISTER', label: 'Caisse', color: 'orange', icon: 'ShoppingCart' },
      { key: 'OTHER', label: 'Autre', color: 'slate', icon: 'FileText', isSystem: true }, // fallback d'affichage
    ],
  },
  {
    domain: 'product_category',
    label: 'Catégories de produits',
    description: 'Catégories du catalogue. « Compte comme matériel » alimente la création d\'équipements depuis le catalogue.',
    usage: [{ model: 'product', field: 'category' }],
    validate: true, keyStyle: 'code', hasColor: true, hasIcon: true,
    seed: [
      { key: 'CASH_REGISTER', label: 'Caisses enregistreuses', color: 'orange', icon: 'Package', meta: { isPhysical: true } },
      { key: 'HARDWARE', label: 'Matériel informatique', color: 'blue', icon: 'Monitor', meta: { isPhysical: true } },
      { key: 'SOFTWARE', label: 'Logiciels', color: 'purple', icon: 'Key' },
      { key: 'NETWORK', label: 'Réseau', color: 'cyan', icon: 'Globe', meta: { isPhysical: true } },
      { key: 'WEBSITE', label: 'Sites web', color: 'indigo', icon: 'Globe' },
      { key: 'MAINTENANCE', label: 'Maintenance', color: 'yellow', icon: 'Wrench' },
      { key: 'TRAINING', label: 'Formation', color: 'green', icon: 'GraduationCap' },
      { key: 'CONTRACT_TEMPLATE', label: 'Modèle de contrat', color: 'indigo', icon: 'FileText', isSystem: true }, // alimente les modèles de la page Contrats
      { key: 'OTHER', label: 'Autre', color: 'gray', icon: 'Package', isSystem: true, meta: { isPhysical: true } },
    ],
  },
]

export const DOMAIN_BY_KEY: Record<string, ReferenceDomain> =
  Object.fromEntries(REFERENCE_DOMAINS.map(d => [d.domain, d]))
