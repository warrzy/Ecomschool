# Plan de finalisation ECOM-SCHOOL — 2026-11

Compagnon de `docs/audit-global-2026-11.md` (v2). Aucun développement lancé — en attente de GO.

## Découpage des lots

| Lot | Périmètre | Dépendances | Risques | Critères d'acceptation | Tests | Effort |
|---|---|---|---|---|---|---|
| **I1 — Exploitation & restauration** | Cron `restore-verify.sh` en environnement isolé + alerting simple (log+email/webhook), doc runbook restore | Aucune | Restauration de test sur DB dédiée, jamais préprod | Restauration d'un dump+uploads rejouée OK, rapport auto ; échec → alerte | restore-verify + script de rapport | S · immédiat |
| **I2 — Durcissement dépendances** | `npm audit fix` (zod≥4.6.6, deepmerge-ts, fast-uri) + revue mysql2/uuid (sans impact réel) | Aucune | zod fix possible breaking (pin si besoin) | 0 vuln `high` exploitable ; tsc/build verts | tsc+eslint+build+2 recettes | S · immédiat |
| **I3 — Notifications email/SMS** | Canal sortant dans `comm/` : welcome, reçu, absence, rappel échéance, reset password ; config provider par école | Prestataire SMTP/ESP + SMS (ex. Brevo/Twilio/Orange) — **externe** | Coûts, délivrabilité, opt-in | Envoi réel test + file + retry + unsubscribe minimum | Recette envois simulés + intégration provider | M · **externe requis** |
| **I4 — Paiements LIVE** | Activer rail live dans `payments/` (providers/intents/idempotence/webhooks signés/réconciliation déjà prêts) — PayDunya + Wave derrière flag par école | Contrats marchands + clés API **(externe)** ; test sandbox→live | Fraude, callbacks, refunds live, montants réels | 1 paiement live e2e + refund + réconciliation, flag OFF par défaut | Recette sandbox étendue + test live plafonné | L · **externe requis** |
| **I5 — Portail enseignant** | `/teacher` : présences de ses classes + saisie notes restreinte (matières affectées, période ouverte), réception annonces | Modèle Teacher↔Course existant ; permissions nouvelles | Verrouillage période, droits fins, validation coordonnateur | Enseignant saisit présences+notes dans son périmètre uniquement ; isolation ; pas de publication | Recette parcours enseignant + isolation | M · interne |
| **I6 — Portail élève** | `/student` : emploi du temps, résultats détaillés, ressources/documents | Modèles existants | Fuite données entre élèves | Élève ne voit que ses données | Recette isolation + pages | S·M · interne |
| **I7 — Fin d'année scolaire** | Assistant clôture→ouverture : clôturer année, créer année+exercice compta+campagnes réinscription en une procédure, rapport de bascule | AcademicYear CLOSED + accountingExercise + G2 campagnes existants | Ordre des étapes, partial-failure | Parcours guidé idempotent + rollback partiel | Recette fin d'année e2e | M · interne |
| **J1 — RH/paie** | Contrats, présences personnel, paie, congés | Rien existant | Périmètre légal/pays | À cadrer fonctionnellement avant tout dev | — | XL · lot distinct |
| **J2 — Sectoriels** | Cantine, transport, internat, bibliothèque | Demande client | — | Chacun = lot optionnel contractuel | — | L chacun |

**Immédiats (interne) :** I1, I2, I5, I6, I7 — **externe requis :** I3 (provider), I4 (contrats+clés).

## Checklist GO / NO-GO

Légende : ✅ requis déjà prouvé · ☐ requis restant · ○ optionnel.

### Pilote 1 école
- ✅ Chaîne cœur e2e testée préprod (élèves→notes→bulletins→frais→paiements manuels)
- ✅ Isolation, permissions, audit, CSV sécurisés
- ✅ Sauvegarde quotidienne vérifiable + procédure rollback
- ☐ Restauration rejouée une fois avec rapport (I1)
- ☐ Vulns prod corrigées (I2)
- ○ Notifications par email (peut démarrer en interne)
- ○ Paiement en ligne (guichet manuel accepté)

### Commercialisation Essentiel
- Tout le pilote + 
- ☐ Onboarding documenté reproductible (procédure + bootstrap auto)
- ☐ Monitoring + alerte sortante (I1)
- ☐ Facturation abonnement opérationnelle (même manuelle, documentée)
- ○ Portail élève minimal

### Commercialisation Pro
- Tout Essentiel +
- ☐ Notifications email minimum (I3 partiel : SMTP seul suffit)
- ☐ Restauration planifiée récurrente
- ○ Portail enseignant (recommandé, pas bloquant si workflow admin documenté)

### Commercialisation Premium
- Tout Pro +
- ☐ Rail paiement LIVE e2e avec refund live (I4)
- ☐ Portail enseignant (I5)
- ☐ Fin d'année assistée (I7)

**Préuves exigées au-delà des tests unitaires :** parcours e2e rejoués en préprod, restauration réelle rejouée, un paiement live plafonné, un envoi email réel, onboarding complet d'une école de A à Z chronométré.
