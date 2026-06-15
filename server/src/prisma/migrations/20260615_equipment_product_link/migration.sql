-- Migration additive : lien Équipement → Produit du catalogue
-- Généré manuellement le 2026-06-15 — types alignés avec les migrations précédentes (PostgreSQL)

-- ─── Equipment : ajout de la référence optionnelle vers le catalogue produits ──
ALTER TABLE "Equipment" ADD COLUMN "productId" TEXT;

-- FK optionnelle : si le produit est supprimé du catalogue, on conserve l'équipement
-- en mettant simplement productId à NULL (même politique que contractId).
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
