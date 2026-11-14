# ROADMAP DE FINALISATION — ECOM-SCHOOL

14 novembre 2026 — Ordre : sécurisation → finir l'existant → compta 360° → RH/paie → université → paiements/comms → recette commerciale. Charges en jours-développement (j), indicatives.

---

## LOT 0 — Sécurisation de l'existant (priorité absolue)

| Travail | Fichiers/modules | Charge | Critères d'acceptation |
|---|---|---|---|
| Installer cron prod (backups+monitor+restore-verify) | `deploy/cron/ecomschool-prod.cron` | 0,1 j | `crontab -l` + run monitor test réel |
| Purge comptes démo prod après tests utilisateur | `scripts/prod-demo-accounts.ts` (purge) | 0,2 j | 0 résidu `demo.local` en prod |
| Récurrence restore-verify validée | `deploy/scripts/restore-verify-run.sh` | 0,2 j | 2 exécutions hebdo OK dans `/var/log` |
| Clôturer vulnérabilité `uuid` via `exceljs` | `package.json` | 0,5 j | `npm audit --omit=dev` propre ou résidu justifié |

**Risques** : purge démo = FK ordering (memberships→données→users→école) — procédure déjà éprouvée en recette.

## LOT 1 — Finalisation parcours existants

| Travail | Dépendances | Charge | CA |
|---|---|---|---|
| Canal notifications familles : provider email + SMS (relances impayés `FeeReminder`, annonces) | aucun rail existant | 4-6 j | 1 relance réelle reçue (test manuel documenté), toggle par école, opt-out |
| Portail enseignant self-service (planning, relevés, mes classes) | `Teacher` | 2-3 j | recette UI enseignant complète |
| Emplois du temps : conflits salle/enseignant | modèles EDT | 3-4 j | refus serveur sur double affectation |
| Workflow fin d'année (clôture année → réinscriptions en masse → nouvelle année) | H6/G2 | 3 j | recette bout-en-bout |
| Quotas plans en enforcement dur | plans | 1-2 j | dépassement bloqué serveur |

## LOT 2 — Comptabilité 360° (comblement H12)

| Travail | Dépendances | Charge | CA |
|---|---|---|---|
| États financiers : bilan + compte de résultat | GL H12 | 3-4 j | bilan équilibré sur exercice recette, PDF |
| Comptes tiers + balance âgée | mappings | 2-3 j | balance âgée clients/fournisseurs exportée |
| Immobilisations + amortissements → OD auto | journaux | 3-4 j | dotation mensuelle postée, idempotente |
| Rapprochement bancaire | encaissements | 3 j | lettrage + écart justifié |
| À-nouveaux clôture exercice | exercices | 2 j | reprise soldes classe 1-5 |

## LOT 3 — RH & paie (module entier)

| Travail | Charge | CA |
|---|---|---|
| `Employee` + contrats + documents + affectations | 4 j | dossier salarié complet |
| Présences personnel + congés (demande/validation/soldes) | 3 j | cycle congé complet |
| `PayrollRun`/`Payslip`/`SalaryComponent` + bulletins PDF | 5-7 j | paie mensuelle, bulletin PDF, cotisations paramétrables BF |
| Écritures paie → compta (66x/42x/44x) via H12 | 2 j | OD paie équilibrée auto |
| Pilotage RH : effectifs, masse salariale, alertes contrats | 2 j | dashboard + alerte expiration |
| Permissions `hr.*` + isolation | 1 j | tests isolation type G2-E |

**Dépendances** : H12 (comptes charges), `Teacher`/`SchoolMembership` (identité). **Risque** : paramétrage social/fiscal BF à valider par un expert local.

## LOT 4 — Gestion universitaire (nouveau périmètre)

| Travail | Charge | CA |
|---|---|---|
| Référentiels LMD : facultés/départements/filières/UE/crédits/semestres | 5-6 j | structure LMD par école type `institut` |
| Inscriptions pédagogiques + sessions/rattrapages | 4 j | inscription UE + session |
| Relevés de notes, validation UE, crédits | 3 j | relevé PDF + validation |
| Stages/mémoires/vacataires | 3-4 j | suivi + évaluation |

**Risque majeur** : le référentiel actuel (niveaux/classes/années) ≠ LMD — nécessite un `schoolType` qui pilote les modèles et les parcours, sans casser le primaire/secondaire existant.

## LOT 5 — Paiements LIVE & comms

| Travail | Charge | CA |
|---|---|---|
| PayDunya LIVE (clés réelles, webhook, vérification) | 3 j | 1 paiement réel tracé + rapproché |
| Orange/Moov API réelles (si contrats opérateurs) | 4-6 j | dépend contrats opérateur BF |
| SMS/WhatsApp providers | (dans lot 1) | envoi réel documenté |

## LOT 6 — Recette commerciale

| Travail | Charge | CA |
|---|---|---|
| Recette bout-en-bout par rôle (7 profils) | 2 j | matrice signée |
| Perf + mobile | 2 j | Lighthouse, parcours mobile |
| Onboarding self-service école (optionnel) | 3 j | création école sans admin plateforme |
| Documentation exploitants + runbook | 2 j | docs/ à jour |

---

## Ordre recommandé de livraison

1. **Lot 0** (immédiat) — sécuriser prod
2. **Lot 1 + 2** — rendre l'existant commercialisable pour primaire/secondaire
3. **Lot 3** — RH/paie (plus gros différenciateur marché BF)
4. **Lot 5** — paiements réels
5. **Lot 4** — université (dernier, plus structurant)
6. **Lot 6** — go commercial

Charge totale indicative : **~60-75 j-développement** hors cycles de recette.
