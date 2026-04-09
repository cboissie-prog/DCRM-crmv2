# Bugs & Améliorations UI — À traiter

> Fichier de suivi des bugs et demandes UX reportés par l'utilisateur.

---

## BUG-004 — Licences : filtre "Expirant bientôt" sans effet

**Page :** `/licenses`

**Problème :** Le frontend envoyait le paramètre `expiringOnly` mais le backend attendait `expiringSoon`.

**Statut :** ✅ Corrigé — paramètre renommé `expiringSoon` côté frontend.

---

## Bugs résolus

| ID | Description | Résolu |
|----|-------------|--------|
| BUG-001 | Bouton "Modifier" absent sur les fiches détail | ✅ |
| BUG-002 | Pipeline Kanban : drag & drop bloqué sur WON/LOST | ✅ |
| BUG-003 | Pipeline Kanban : hauteur colonnes WON/LOST | ✅ |
| FEAT-001 | Pipelines multiples | ✅ |
| FEAT-002 | Colonnes de pipeline configurables | ✅ |
| FEAT-003 | Refonte flux Leads → Pipeline | ✅ |
