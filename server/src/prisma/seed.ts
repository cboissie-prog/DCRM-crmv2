import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ─── USERS ─────────────────────────────────────────────
  const adminPwd = await bcrypt.hash('admin123', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@crm.local' },
    update: {},
    create: { email: 'admin@crm.local', password: adminPwd, firstName: 'Admin', lastName: 'CRM', phone: '06 12 34 56 78', role: 'ADMIN' },
  })
  // Commercial requis pour les tests
  const commercial1 = await prisma.user.upsert({
    where: { email: 'jean.dupont@crm.local' },
    update: {},
    create: { email: 'jean.dupont@crm.local', password: await bcrypt.hash('test123', 12), firstName: 'Jean', lastName: 'Dupont', phone: '06 23 45 67 89', role: 'COMMERCIAL' },
  })
  const technicien1 = await prisma.user.upsert({
    where: { email: 'alex@crm.local' },
    update: {},
    create: { email: 'alex@crm.local', password: await bcrypt.hash('password123', 12), firstName: 'Alexandre', lastName: 'Petit', phone: '06 34 56 78 90', role: 'TECHNICIEN' },
  })
  const technicien2 = await prisma.user.upsert({
    where: { email: 'marie@crm.local' },
    update: {},
    create: { email: 'marie@crm.local', password: await bcrypt.hash('password123', 12), firstName: 'Marie', lastName: 'Bernard', phone: '06 45 67 89 01', role: 'TECHNICIEN' },
  })
  console.log('✅ Users créés')

  // ─── COMPANIES ─────────────────────────────────────────
  const boulangerie = await prisma.company.create({ data: { name: 'Boulangerie Dupont', sector: 'Commerce alimentaire', employees: 8, city: 'Lyon', postalCode: '69001', billingAddress: '12 Rue de la République, 69001 Lyon', lat: 45.7640, lng: 4.8357, tags: '["client","caisse"]' } })
  const pharmacie = await prisma.company.create({ data: { name: 'Pharmacie des Fleurs', sector: 'Pharmacie', employees: 12, city: 'Lyon', postalCode: '69003', billingAddress: '45 Cours Lafayette, 69003 Lyon', lat: 45.7578, lng: 4.8498, tags: '["client","caisse","maintenance"]' } })
  const restaurant = await prisma.company.create({ data: { name: 'Restaurant Le Bouchon', sector: 'Restauration', employees: 15, city: 'Villeurbanne', postalCode: '69100', billingAddress: '8 Avenue du 8 Mai, 69100 Villeurbanne', lat: 45.7714, lng: 4.8797, tags: '["client","caisse","site-web"]' } })
  const cabinet = await prisma.company.create({ data: { name: 'Cabinet Médical Lumière', sector: 'Santé', employees: 6, city: 'Lyon', postalCode: '69008', billingAddress: '23 Boulevard des Belges, 69008 Lyon', lat: 45.7484, lng: 4.8541, tags: '["client","maintenance","site-web"]' } })
  const boutique = await prisma.company.create({ data: { name: 'Boutique Mode & Style', sector: 'Commerce habillement', employees: 5, city: 'Caluire', postalCode: '69300', billingAddress: '15 Rue Centrale, 69300 Caluire', lat: 45.7934, lng: 4.8497, tags: '["client","caisse"]' } })
  const startup = await prisma.company.create({ data: { name: 'TechStartup SAS', sector: 'Informatique', employees: 25, city: 'Lyon', postalCode: '69002', billingAddress: '3 Rue Victor Hugo, 69002 Lyon', lat: 45.7579, lng: 4.8322, tags: '["prospect","site-web","maintenance"]' } })
  const immobilier = await prisma.company.create({ data: { name: 'Immobilier Prestige', sector: 'Immobilier', employees: 10, city: 'Lyon', postalCode: '69006', billingAddress: '67 Rue Garibaldi, 69006 Lyon', lat: 45.7617, lng: 4.8472, tags: '["client","site-web","maintenance"]' } })
  const auto = await prisma.company.create({ data: { name: 'Garage Renard Auto', sector: 'Automobile', employees: 18, city: 'Bron', postalCode: '69500', billingAddress: '102 Avenue du Progrès, 69500 Bron', lat: 45.7325, lng: 4.9082, tags: '["client","maintenance"]' } })
  console.log('✅ Entreprises créées')

  // ─── CONTACTS ──────────────────────────────────────────
  const contact1 = await prisma.contact.create({ data: { firstName: 'Pierre', lastName: 'Dupont', email: 'pierre.dupont@boulangerie.fr', phone: '04 72 12 34 56', mobile: '06 78 90 12 34', position: 'Gérant', companyId: boulangerie.id, status: 'CLIENT', source: 'REFERRAL', leadScore: 85 } })
  const contact2 = await prisma.contact.create({ data: { firstName: 'Claire', lastName: 'Moreau', email: 'c.moreau@pharmacie-fleurs.fr', phone: '04 72 23 45 67', position: 'Directrice', companyId: pharmacie.id, status: 'CLIENT', source: 'PHONE_INBOUND', leadScore: 90 } })
  const contact3 = await prisma.contact.create({ data: { firstName: 'Jean-Marc', lastName: 'Rousseau', email: 'jm.rousseau@lebouchon.fr', phone: '04 72 34 56 78', position: 'Propriétaire', companyId: restaurant.id, status: 'CLIENT', source: 'REFERRAL', leadScore: 75 } })
  const contact4 = await prisma.contact.create({ data: { firstName: 'Dr. Anne', lastName: 'Lefebvre', email: 'a.lefebvre@cabinet-lumiere.fr', phone: '04 72 45 67 89', position: 'Médecin associé', companyId: cabinet.id, status: 'CLIENT', source: 'WEBSITE', leadScore: 70 } })
  const contact5 = await prisma.contact.create({ data: { firstName: 'Isabelle', lastName: 'Fontaine', email: 'i.fontaine@mode-style.fr', mobile: '06 89 01 23 45', position: 'Gérante', companyId: boutique.id, status: 'CLIENT', source: 'PHONE_INBOUND', leadScore: 60 } })
  const contact6 = await prisma.contact.create({ data: { firstName: 'Thomas', lastName: 'Girard', email: 't.girard@techstartup.fr', phone: '04 72 56 78 90', position: 'CEO', companyId: startup.id, status: 'PROSPECT', source: 'WEBSITE', leadScore: 78 } })
  const contact7 = await prisma.contact.create({ data: { firstName: 'Nathalie', lastName: 'Simon', email: 'n.simon@immo-prestige.fr', phone: '04 72 67 89 01', position: 'Directrice', companyId: immobilier.id, status: 'CLIENT', source: 'REFERRAL', leadScore: 82 } })
  const contact8 = await prisma.contact.create({ data: { firstName: 'Robert', lastName: 'Renard', email: 'r.renard@garage-renard.fr', phone: '04 72 78 90 12', position: 'Patron', companyId: auto.id, status: 'CLIENT', source: 'PHONE_INBOUND', leadScore: 65 } })
  console.log('✅ Contacts créés')

  // ─── PRODUCTS ──────────────────────────────────────────
  await prisma.product.createMany({ data: [
    { reference: 'CR-001', name: 'Caisse enregistreuse TPV Pro', category: 'CASH_REGISTER', type: 'PRODUCT', price: 1890, vatRate: 20, description: 'Caisse tactile 15" avec lecteur CB intégré, imprimante thermique et tiroir caisse', supplier: 'Casio Business' },
    { reference: 'CR-002', name: 'Caisse enregistreuse TPV Compact', category: 'CASH_REGISTER', type: 'PRODUCT', price: 1290, vatRate: 20, description: 'Caisse compacte idéale petits commerces', supplier: 'Casio Business' },
    { reference: 'CR-003', name: 'Terminal de paiement CB', category: 'CASH_REGISTER', type: 'PRODUCT', price: 450, vatRate: 20, description: 'Terminal CB sans fil Bluetooth', supplier: 'Ingenico' },
    { reference: 'HW-001', name: 'PC Bureau Pro', category: 'HARDWARE', type: 'PRODUCT', price: 890, vatRate: 20, description: 'PC i5 16Go RAM 512Go SSD', supplier: 'Dell' },
    { reference: 'HW-002', name: 'Laptop Professionnel 14"', category: 'HARDWARE', type: 'PRODUCT', price: 1190, vatRate: 20, description: 'Laptop i7 16Go RAM 512Go SSD', supplier: 'Lenovo' },
    { reference: 'HW-003', name: 'Switch 24 ports', category: 'NETWORK', type: 'PRODUCT', price: 320, vatRate: 20, supplier: 'Cisco' },
    { reference: 'HW-004', name: 'NAS 4 baies', category: 'HARDWARE', type: 'PRODUCT', price: 580, vatRate: 20, supplier: 'Synology' },
    { reference: 'SW-001', name: 'Antivirus Pro (1 an)', category: 'SOFTWARE', type: 'SUBSCRIPTION', price: 45, vatRate: 20, unit: 'poste/an', supplier: 'Bitdefender' },
    { reference: 'SW-002', name: 'Logiciel comptabilité', category: 'SOFTWARE', type: 'SUBSCRIPTION', price: 890, vatRate: 20, unit: 'licence/an', supplier: 'EBP' },
    { reference: 'SVC-001', name: 'Maintenance informatique mensuelle', category: 'MAINTENANCE', type: 'SUBSCRIPTION', price: 149, vatRate: 20, unit: 'mois' },
    { reference: 'SVC-002', name: 'Intervention terrain (heure)', category: 'MAINTENANCE', type: 'SERVICE', price: 85, vatRate: 20, unit: 'heure' },
    { reference: 'SVC-003', name: 'Création site web vitrine', category: 'WEBSITE', type: 'SERVICE', price: 1500, vatRate: 20, unit: 'projet' },
    { reference: 'SVC-004', name: 'Hébergement web + maintenance (an)', category: 'WEBSITE', type: 'SUBSCRIPTION', price: 360, vatRate: 20, unit: 'an' },
    { reference: 'SVC-005', name: 'Formation utilisateur (demi-journée)', category: 'TRAINING', type: 'SERVICE', price: 350, vatRate: 20, unit: 'session' },
    { reference: 'SVC-006', name: 'Maintenance caisse mensuelle', category: 'CASH_REGISTER', type: 'SUBSCRIPTION', price: 29, vatRate: 20, unit: 'mois' },
  ]})
  console.log('✅ Produits créés')

  // ─── CONTRACTS ─────────────────────────────────────────
  const ctr1 = await prisma.contract.create({ data: { reference: 'CTR-2024-0001', companyId: pharmacie.id, type: 'IT_MAINTENANCE', title: 'Maintenance informatique complète', status: 'ACTIVE', startDate: new Date('2024-01-01'), endDate: new Date('2026-12-31'), monthlyAmount: 299, slaResponseTime: 4, slaWorkingHours: '9h-18h lun-ven', autoRenewal: true } })
  const ctr2 = await prisma.contract.create({ data: { reference: 'CTR-2024-0002', companyId: restaurant.id, type: 'CASH_REGISTER_MAINTENANCE', title: 'Maintenance caisses enregistreuses', status: 'ACTIVE', startDate: new Date('2024-03-01'), endDate: new Date('2026-02-28'), monthlyAmount: 89, slaResponseTime: 8, autoRenewal: false } })
  const ctr3 = await prisma.contract.create({ data: { reference: 'CTR-2024-0003', companyId: cabinet.id, type: 'FULL_SUPPORT', title: 'Support informatique complet', status: 'ACTIVE', startDate: new Date('2024-06-01'), endDate: new Date('2026-05-31'), monthlyAmount: 199, slaResponseTime: 2, autoRenewal: true } })
  const ctr4 = await prisma.contract.create({ data: { reference: 'CTR-2025-0001', companyId: immobilier.id, type: 'WEB_HOSTING', title: 'Hébergement & maintenance site web', status: 'ACTIVE', startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31'), annualAmount: 360, autoRenewal: true } })
  const ctr5 = await prisma.contract.create({ data: { reference: 'CTR-2025-0002', companyId: boulangerie.id, type: 'CASH_REGISTER_MAINTENANCE', title: 'Maintenance caisse TPV', status: 'EXPIRING_SOON', startDate: new Date('2025-01-01'), endDate: new Date('2026-05-15'), monthlyAmount: 29, autoRenewal: false } })
  const ctr6 = await prisma.contract.create({ data: { reference: 'CTR-2023-0001', companyId: auto.id, type: 'IT_MAINTENANCE', title: 'Maintenance parc informatique', status: 'ACTIVE', startDate: new Date('2023-07-01'), endDate: new Date('2026-06-30'), monthlyAmount: 149, autoRenewal: true } })
  console.log('✅ Contrats créés')

  // ─── EQUIPMENT ─────────────────────────────────────────
  const eq1 = await prisma.equipment.create({ data: { companyId: pharmacie.id, contractId: ctr1.id, type: 'DESKTOP', brand: 'Dell', model: 'OptiPlex 7090', serialNumber: 'SN-DEL-2023-001', purchaseDate: new Date('2023-03-15'), warrantyExpiry: new Date('2026-03-15'), location: 'Bureau principal', status: 'ACTIVE' } })
  const eq2 = await prisma.equipment.create({ data: { companyId: pharmacie.id, contractId: ctr1.id, type: 'PRINTER', brand: 'HP', model: 'LaserJet Pro M404', serialNumber: 'SN-HP-2023-012', purchaseDate: new Date('2023-03-15'), warrantyExpiry: new Date('2025-03-15'), location: 'Accueil', status: 'ACTIVE' } })
  const eq3 = await prisma.equipment.create({ data: { companyId: restaurant.id, contractId: ctr2.id, type: 'CASH_REGISTER', brand: 'Casio', model: 'TPV Pro 15"', serialNumber: 'SN-CA-2022-045', purchaseDate: new Date('2022-09-01'), warrantyExpiry: new Date('2025-09-01'), location: 'Caisse 1', status: 'ACTIVE' } })
  const eq4 = await prisma.equipment.create({ data: { companyId: restaurant.id, contractId: ctr2.id, type: 'CASH_REGISTER', brand: 'Casio', model: 'TPV Pro 15"', serialNumber: 'SN-CA-2022-046', purchaseDate: new Date('2022-09-01'), warrantyExpiry: new Date('2025-09-01'), location: 'Caisse 2', status: 'ACTIVE' } })
  await prisma.equipment.create({ data: { companyId: cabinet.id, contractId: ctr3.id, type: 'SERVER', brand: 'HP', model: 'ProLiant MicroServer', serialNumber: 'SN-HP-2021-089', purchaseDate: new Date('2021-06-10'), warrantyExpiry: new Date('2024-06-10'), location: 'Salle serveur', status: 'ACTIVE' } })
  await prisma.equipment.create({ data: { companyId: boulangerie.id, type: 'CASH_REGISTER', brand: 'Casio', model: 'TPV Compact', serialNumber: 'SN-CA-2023-102', purchaseDate: new Date('2023-11-20'), warrantyExpiry: new Date('2026-11-20'), location: 'Caisse', status: 'ACTIVE' } })
  await prisma.equipment.create({ data: { companyId: auto.id, contractId: ctr6.id, type: 'DESKTOP', brand: 'Lenovo', model: 'ThinkCentre M75q', serialNumber: 'SN-LEN-2022-078', purchaseDate: new Date('2022-07-01'), warrantyExpiry: new Date('2025-07-01'), location: 'Accueil', status: 'ACTIVE' } })
  await prisma.equipment.create({ data: { companyId: auto.id, contractId: ctr6.id, type: 'LAPTOP', brand: 'Lenovo', model: 'ThinkPad E15', serialNumber: 'SN-LEN-2022-079', purchaseDate: new Date('2022-07-01'), warrantyExpiry: new Date('2025-07-01'), location: 'Bureau direction', status: 'ACTIVE' } })
  console.log('✅ Équipements créés')

  // ─── LICENSES ──────────────────────────────────────────
  await prisma.license.createMany({ data: [
    { companyId: pharmacie.id, equipmentId: eq1.id, software: 'Windows 11 Pro', vendor: 'Microsoft', seats: 1, type: 'PERPETUAL', purchaseDate: new Date('2023-03-15'), cost: 259 },
    { companyId: pharmacie.id, software: 'Antivirus Bitdefender', vendor: 'Bitdefender', seats: 3, type: 'ANNUAL', expiryDate: new Date('2026-04-30'), cost: 135 },
    { companyId: pharmacie.id, software: 'Logiciel de caisse PharmaPOS', vendor: 'PharmaSoft', seats: 2, type: 'ANNUAL', expiryDate: new Date('2026-01-31'), cost: 890 },
    { companyId: cabinet.id, software: 'Doctolib Pro', vendor: 'Doctolib', seats: 3, type: 'MONTHLY', expiryDate: new Date('2026-12-31'), cost: 129 },
    { companyId: cabinet.id, software: 'Antivirus Bitdefender', vendor: 'Bitdefender', seats: 4, type: 'ANNUAL', expiryDate: new Date('2026-06-15'), cost: 180 },
    { companyId: restaurant.id, software: 'Logiciel gestion restaurant', vendor: 'Lightspeed', seats: 2, type: 'MONTHLY', expiryDate: new Date('2026-12-31'), cost: 89 },
    { companyId: auto.id, software: 'Logiciel garage automobile', vendor: 'AutoSoft Pro', seats: 3, type: 'ANNUAL', expiryDate: new Date('2025-07-15'), cost: 450 },
  ]})
  console.log('✅ Licences créées')

  // ─── PIPELINES ─────────────────────────────────────────
  const defaultPipeline = await prisma.pipeline.upsert({
    where: { id: 'pipeline-default' },
    update: {},
    create: {
      id: 'pipeline-default',
      name: 'Commercial',
      description: 'Pipeline commercial principal',
      color: '#6366f1',
      isDefault: true,
      order: 0,
      stages: {
        create: [
          { key: 'NEW',           name: 'Nouveau',        color: '#94a3b8', order: 0 },
          { key: 'QUALIFICATION', name: 'Qualification',  color: '#3b82f6', order: 1 },
          { key: 'PROPOSAL',      name: 'Proposition',    color: '#8b5cf6', order: 2 },
          { key: 'NEGOTIATION',   name: 'Négociation',    color: '#f97316', order: 3 },
          { key: 'WON',           name: 'Gagné',          color: '#10b981', order: 4, isWon: true },
          { key: 'LOST',          name: 'Perdu',          color: '#ef4444', order: 5, isLost: true },
        ],
      },
    },
  })
  console.log('✅ Pipeline par défaut créé')

  // ─── OPPORTUNITIES ─────────────────────────────────────
  const opp1 = await prisma.opportunity.create({ data: { title: 'Remplacement parc informatique', contactId: contact6.id, companyId: startup.id, pipelineId: defaultPipeline.id, stage: 'PROPOSAL', value: 15000, probability: 60, expectedCloseDate: new Date('2026-06-30'), assignedToId: commercial1.id, notes: 'Client intéressé par 15 postes + réseau complet' } })
  const opp2 = await prisma.opportunity.create({ data: { title: 'Création site web e-commerce', contactId: contact3.id, companyId: restaurant.id, pipelineId: defaultPipeline.id, stage: 'NEGOTIATION', value: 3500, probability: 75, expectedCloseDate: new Date('2026-05-15'), assignedToId: commercial1.id } })
  const opp3 = await prisma.opportunity.create({ data: { title: 'Contrat maintenance annuel', contactId: contact8.id, companyId: auto.id, pipelineId: defaultPipeline.id, stage: 'QUALIFICATION', value: 2400, probability: 40, expectedCloseDate: new Date('2026-07-01'), assignedToId: commercial1.id } })
  await prisma.opportunity.create({ data: { title: 'Extension contrat pharmacie', contactId: contact2.id, companyId: pharmacie.id, pipelineId: defaultPipeline.id, stage: 'WON', value: 5800, probability: 100, expectedCloseDate: new Date('2026-01-15'), closedAt: new Date('2026-01-10'), assignedToId: commercial1.id } })
  await prisma.opportunity.create({ data: { title: 'Caisses boutique 2e magasin', contactId: contact5.id, companyId: boutique.id, pipelineId: defaultPipeline.id, stage: 'NEW', value: 2800, probability: 20, expectedCloseDate: new Date('2026-08-01'), assignedToId: commercial1.id } })
  await prisma.opportunity.create({ data: { title: 'Site web immobilier', contactId: contact7.id, companyId: immobilier.id, pipelineId: defaultPipeline.id, stage: 'WON', value: 4200, probability: 100, closedAt: new Date('2026-02-20'), assignedToId: commercial1.id } })
  console.log('✅ Opportunités créées')

  // ─── TICKETS ───────────────────────────────────────────
  const tkt1 = await prisma.ticket.create({ data: { reference: 'TKT-2026-0001', title: 'PC bureau qui ne démarre plus', description: 'Le PC du bureau principal ne démarre plus depuis ce matin. Écran noir au démarrage.', category: 'HARDWARE_FAILURE', priority: 'HIGH', status: 'IN_PROGRESS', contactId: contact2.id, companyId: pharmacie.id, contractId: ctr1.id, equipmentId: eq1.id, assignedToId: technicien1.id, createdById: admin.id, timeSpent: 45 } })
  const tkt2 = await prisma.ticket.create({ data: { reference: 'TKT-2026-0002', title: 'Imprimante ticket caisse ne fonctionne plus', description: "L'imprimante de tickets de la caisse 1 ne sort plus rien.", category: 'CASH_REGISTER_SAV', priority: 'NORMAL', status: 'NEW', contactId: contact3.id, companyId: restaurant.id, contractId: ctr2.id, equipmentId: eq3.id, createdById: admin.id } })
  const tkt3 = await prisma.ticket.create({ data: { reference: 'TKT-2026-0003', title: 'Connexion internet instable', description: 'Coupures internet fréquentes depuis 3 jours, impactant le logiciel de caisse.', category: 'NETWORK', priority: 'CRITICAL', status: 'IN_PROGRESS', contactId: contact1.id, companyId: boulangerie.id, assignedToId: technicien2.id, createdById: admin.id, timeSpent: 120 } })
  await prisma.ticket.create({ data: { reference: 'TKT-2026-0004', title: 'Mise à jour logiciel comptabilité', description: 'Besoin de mettre à jour le logiciel EBP vers la dernière version.', category: 'SOFTWARE_BUG', priority: 'LOW', status: 'RESOLVED', contactId: contact4.id, companyId: cabinet.id, contractId: ctr3.id, assignedToId: technicien1.id, createdById: admin.id, resolvedAt: new Date('2026-03-25'), timeSpent: 60 } })
  await prisma.ticket.create({ data: { reference: 'TKT-2026-0005', title: 'Sauvegarde serveur en erreur', description: 'La sauvegarde automatique du serveur échoue depuis une semaine.', category: 'HARDWARE_FAILURE', priority: 'HIGH', status: 'WAITING_CLIENT', contactId: contact4.id, companyId: cabinet.id, contractId: ctr3.id, assignedToId: technicien1.id, createdById: admin.id, timeSpent: 90 } })
  await prisma.ticket.create({ data: { reference: 'TKT-2026-0006', title: 'Bug affichage site web mobile', description: "La page d'accueil du site ne s'affiche pas correctement sur mobile.", category: 'WEBSITE', priority: 'NORMAL', status: 'NEW', contactId: contact7.id, companyId: immobilier.id, createdById: admin.id } })
  console.log('✅ Tickets créés')

  // ─── TICKET COMMENTS ───────────────────────────────────
  await prisma.ticketComment.createMany({ data: [
    { ticketId: tkt1.id, content: "J'ai diagnostiqué une panne du disque dur. Commande de remplacement en cours.", isInternal: true, authorName: 'Alexandre Petit' },
    { ticketId: tkt1.id, content: 'Bonjour, nous avons identifié le problème. Nous allons remplacer le disque dur. Intervention prévue demain matin.', isInternal: false, authorName: 'Alexandre Petit' },
    { ticketId: tkt3.id, content: 'Vérification effectuée chez le client. Le routeur présente des signes de défaillance. Remplacement nécessaire.', isInternal: true, authorName: 'Marie Bernard' },
  ]})

  // ─── NPS RESPONSES ─────────────────────────────────────
  const tkt4 = await prisma.ticket.findFirst({ where: { reference: 'TKT-2026-0004' } })
  if (tkt4) {
    await prisma.npsResponse.create({ data: { ticketId: tkt4.id, contactId: contact4.id, companyId: cabinet.id, score: 9, comment: 'Très réactif et professionnel, merci !' } })
  }
  console.log('✅ NPS créées')

  // ─── ACTIVITIES ────────────────────────────────────────
  await prisma.activity.createMany({ data: [
    { type: 'CALL', title: 'Appel de suivi', description: 'Vérification satisfaction après installation caisse', userId: commercial1.id, contactId: contact1.id, companyId: boulangerie.id, completedAt: new Date('2026-03-10') },
    { type: 'MEETING', title: 'Réunion présentation offre maintenance', description: 'Présentation contrat maintenance annuel', userId: commercial1.id, contactId: contact6.id, companyId: startup.id, opportunityId: opp1.id, completedAt: new Date('2026-03-20') },
    { type: 'EMAIL', title: 'Envoi devis remplacement parc', userId: commercial1.id, contactId: contact6.id, companyId: startup.id, opportunityId: opp1.id, completedAt: new Date('2026-03-22'), emailOpened: true, emailOpenedAt: new Date('2026-03-22T14:32:00') },
    { type: 'CALL', title: 'Négociation contrat', description: 'Discussion sur le prix du site web', userId: commercial1.id, contactId: contact3.id, companyId: restaurant.id, opportunityId: opp2.id, completedAt: new Date('2026-04-01') },
    { type: 'NOTE', title: 'Note interne', description: 'Client demande à être rappelé la semaine prochaine concernant le budget', userId: commercial1.id, contactId: contact8.id, companyId: auto.id, opportunityId: opp3.id },
    { type: 'TASK', title: 'Relancer TechStartup', description: 'Relance suite envoi devis', userId: commercial1.id, contactId: contact6.id, companyId: startup.id, dueDate: new Date('2026-04-14') },
    { type: 'SYSTEM', title: 'Ticket créé', description: 'Ticket TKT-2026-0001 créé', companyId: pharmacie.id, isAutomatic: true },
    { type: 'SYSTEM', title: 'Contrat signé', description: 'Contrat CTR-2024-0001 activé', companyId: pharmacie.id, isAutomatic: true },
  ]})
  console.log('✅ Activités créées')

  // ─── APPOINTMENTS ──────────────────────────────────────
  await prisma.appointment.create({ data: {
    title: 'Intervention PC Pharmacie',
    type: 'INTERVENTION',
    startAt: new Date('2026-04-08T09:00:00'),
    endAt: new Date('2026-04-08T11:00:00'),
    location: '45 Cours Lafayette, 69003 Lyon',
    ticketId: tkt1.id,
    users: { create: [{ userId: technicien1.id }] },
    contacts: { create: [{ contactId: contact2.id }] },
  }})
  await prisma.appointment.create({ data: {
    title: 'RDV commercial TechStartup',
    type: 'CLIENT_MEETING',
    startAt: new Date('2026-04-10T14:00:00'),
    endAt: new Date('2026-04-10T15:30:00'),
    location: '3 Rue Victor Hugo, 69002 Lyon',
    users: { create: [{ userId: commercial1.id }] },
    contacts: { create: [{ contactId: contact6.id }] },
  }})
  await prisma.appointment.create({ data: {
    title: 'Livraison routeur boulangerie',
    type: 'DELIVERY',
    startAt: new Date('2026-04-09T10:00:00'),
    endAt: new Date('2026-04-09T11:30:00'),
    location: '12 Rue de la République, 69001 Lyon',
    users: { create: [{ userId: technicien2.id }] },
    contacts: { create: [{ contactId: contact1.id }] },
  }})
  console.log('✅ Rendez-vous créés')

  // ─── LEADS ─────────────────────────────────────────────
  await prisma.lead.create({ data: { contactId: contact6.id, source: 'WEBSITE', title: 'Demande info site web + maintenance', score: 78, status: 'QUALIFIED' } })
  await prisma.lead.create({ data: { contactId: contact5.id, source: 'PHONE_INBOUND', title: 'Extension boutique - nouveau point de vente', score: 55, status: 'CONTACTED' } })
  console.log('✅ Leads créés')

  // ─── SALES TARGETS ─────────────────────────────────────
  await prisma.salesTarget.createMany({ data: [
    { userId: commercial1.id, period: '2026-Q2', target: 25000, actual: 8700 },
    { userId: commercial1.id, period: '2026-Q1', target: 22000, actual: 21200 },
    { userId: admin.id, period: '2026-Q2', target: 10000, actual: 3200 },
  ]})
  console.log('✅ Objectifs commerciaux créés')

  // ─── KNOWLEDGE BASE ────────────────────────────────────
  await prisma.knowledgeArticle.createMany({ data: [
    { title: 'Procédure de réinitialisation caisse Casio TPV', content: '## Réinitialisation caisse Casio TPV Pro\n\n### Étapes\n1. Éteindre la caisse\n2. Maintenir la touche `JOURNAL` enfoncée\n3. Allumer la caisse tout en maintenant la touche\n4. Entrer le code superviseur (par défaut: 0000)\n5. Sélectionner "Remise à zéro partielle"\n\n### Attention\nCette procédure efface les données de vente. Toujours faire une sauvegarde avant.', category: 'Procédures caisses', tags: '["caisse","casio","réinitialisation"]', views: 24 },
    { title: 'Dépannage connexion internet : protocole d\'intervention', content: '## Protocole dépannage réseau\n\n### Vérifications de base\n1. Vérifier les voyants de la box\n2. Redémarrer box + switch\n3. Vérifier les câbles RJ45\n4. Tester depuis un autre appareil\n\n### Si le problème persiste\n- Contacter le FAI du client\n- Vérifier les logs du routeur\n- Tester en mode bypass\n\n### Remplacement routeur\nSi le routeur est défaillant, utiliser le stock de remplacement (étagère B3 en atelier).', category: 'Procédures réseau', tags: '["réseau","internet","dépannage"]', views: 18 },
    { title: 'Mise à jour Windows : procédure client', content: '## Mise à jour Windows en entreprise\n\n### Avant intervention\n- Sauvegarder les données importantes\n- Vérifier l\'espace disque disponible (min 20Go)\n- Prévoir 1h minimum\n\n### Procédure\n1. Paramètres > Windows Update\n2. Vérifier les mises à jour\n3. Installer toutes les mises à jour importantes\n4. Redémarrer et vérifier le bon fonctionnement\n\n### Post-installation\n- Vérifier que les logiciels métier fonctionnent toujours\n- Documenter dans la fiche équipement', category: 'Procédures informatiques', tags: '["windows","mise-à-jour","procédure"]', views: 31 },
    { title: 'Codes erreurs courants caisses Casio', content: '## Codes erreurs Casio TPV\n\n| Code | Signification | Solution |\n|------|---------------|----------|\n| E001 | Erreur imprimante | Vérifier le papier, nettoyer la tête |\n| E003 | Erreur CB | Vérifier la connexion terminal |\n| E010 | Erreur réseau | Vérifier connexion internet |\n| E015 | Erreur disque | Contacter le SAV Casio |', category: 'Procédures caisses', tags: '["casio","erreur","code"]', views: 42 },
  ]})
  console.log('✅ Base de connaissance créée')

  // ─── NOTIFICATIONS ─────────────────────────────────────
  await prisma.notification.createMany({ data: [
    { userId: admin.id, type: 'TICKET_URGENT', title: 'Ticket critique', message: 'TKT-2026-0003 : Connexion internet instable - CRITIQUE', link: '/tickets', isRead: false },
    { userId: admin.id, type: 'CONTRACT_EXPIRING', title: 'Contrat expirant bientôt', message: 'Contrat CTR-2025-0002 (Boulangerie Dupont) expire dans 38 jours', link: '/contracts', isRead: false },
    { userId: technicien1.id, type: 'TICKET_ASSIGNED', title: 'Ticket assigné', message: 'TKT-2026-0001 vous a été assigné', link: '/tickets', isRead: false },
    { userId: commercial1.id, type: 'LEAD_SCORED', title: 'Lead qualifié', message: 'Thomas Girard (TechStartup) a un score de 78 - À contacter', link: '/pipeline/leads', isRead: true },
  ]})
  console.log('✅ Notifications créées')

  console.log('\n✅ Seed terminé avec succès !')
  console.log('\n📋 Comptes de connexion:')
  console.log('   Admin: admin@crm.local / admin123')
  console.log('   Commercial: jean.dupont@crm.local / test123')
  console.log('   Technicien: alex@crm.local / password123')
}

main().catch(console.error).finally(() => prisma.$disconnect())
