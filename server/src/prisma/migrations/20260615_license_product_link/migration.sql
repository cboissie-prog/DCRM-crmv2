-- Migration additive : lien Licence → Produit du catalogue
-- Généré manuellement le 2026-06-15 — types alignés avec les migrations précédentes (PostgreSQL)

-- ─── License : ajout de la référence optionnelle vers le catalogue produits ────
ALTER TABLE "License" ADD COLUMN "productId" TEXT;

-- FK optionnelle : si le produit est supprimé du catalogue, on conserve la licence
-- en mettant simplement productId à NULL (même politique que equipmentId).
ALTER TABLE "License" ADD CONSTRAINT "License_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
