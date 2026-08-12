-- Passage au pilotage 100 % mensuel des objectifs (décision produit du 2026-08-12) :
-- purge des objectifs au format trimestriel "AAAA-Qn", que l'API n'accepte plus.
-- ⚠️ Destructif : les cibles trimestrielles ne sont pas converties en mensuelles.

DELETE FROM "SalesTarget"   WHERE "period" LIKE '%-Q%';
DELETE FROM "CompanyTarget" WHERE "period" LIKE '%-Q%';
