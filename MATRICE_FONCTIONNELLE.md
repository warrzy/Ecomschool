# MATRICE FONCTIONNELLE — ECOM-SCHOOL

14 novembre 2026 — Méthode : état réel = fonctionnalité présente dans le code **et** accessible dans l'UI **et** couverte par une recette exécutée. Une route ou un modèle seul ne suffit pas. Taux d'avancement = (fonctionnalités testées / fonctionnalités requises pour le domaine complet).

Légende : ✅ opérationnel+testé · 🟡 partiel · ⚙️ backend seul · ❌ absent

## A. Gestion scolaire

| Fonctionnalité | État | Preuve | Reste | Prio |
|---|---|---|---|---|
| Établissements/années scolaires | ✅ | modèles + `/app` + recettes | — | — |
| Classes/niveaux/matières/programmes | ✅ | référentiels + UI | — | — |
| Élèves/parents/inscriptions | ✅ | G2-E 91/91 | — | — |
| Admissions/réinscriptions | ✅ | pipeline G2, listes d'attente, tests | — | — |
| Emplois du temps | 🟡 | modèles présents | conflits/génération auto | P2 |
| Enseignants/affectations | ✅ | `Teacher` + matières/classes | dossier RH (voir C) | P2 |
| Absences/retards (élèves) | ✅ | saisie + portail | — | — |
| Notes/moyennes/classements | ✅ | évaluations + bulletins | — | — |
| Bulletins/délibérations | ✅ | H5 117/117, PDF, règles/niveau | — | — |
| Documents administratifs | ✅ | G4, gabarits, PDF | — | — |
| Portails parent/élève | ✅ | H1 + `/student` | — | — |
| Portail enseignant | 🟡 | notes/présences | self-service (relevé, planning) | P2 |
| Communication/notifications familles | ❌ | aucun envoi SMS/email/WhatsApp | canal sortant entier | **P0** |
| **Taux A** | **~85%** | 11/13 opérationnels | | |

## B. Finance & comptabilité 360°

| Fonctionnalité | État | Preuve | Reste | Prio |
|---|---|---|---|---|
| Frais scolaires/échéanciers | ✅ | modèles + UI | — | — |
| Facturation/encaissements/reçus | ✅ | flux complet | — | — |
| Impayés/relances | ✅ | `FeeReminder` | relance par SMS/email (canal absent) | P1 |
| Caisse | ✅ | trésorerie + guichet caissier | — | — |
| Dépenses/recettes | ✅ | + comptabilisation auto | — | — |
| Budgets/trésorerie | 🟡 | trésorerie oui, prévisionnel non | budgets | P3 |
| Plan SYSCOHADA | ✅ | starter plan configurable | — | — |
| Journaux/écritures | ✅ | équilibrées, idempotentes | — | — |
| Grand livre/balance | ✅ | + CSV | — | — |
| Comptes fournisseurs/clients | 🟡 | mappings, pas de tiers détaillés | balance âgée | P2 |
| Rapprochement bancaire | ❌ | aucun modèle | `BankStatement`+lettrage | P2 |
| Immobilisations/amortissements | ❌ | aucun modèle | `Asset`+plans+OD | P2 |
| Bilan/compte de résultat/états | ❌ | GL+balance seulement | agrégation soldes | **P1** |
| Rapports/dashboards financiers | ✅ | vues + exports | — | — |
| **Taux B** | **~65%** | 9/14 complets | | |

## C. Ressources humaines

| Fonctionnalité | État | Reste | Prio |
|---|---|---|---|
| Personnel/dossiers/contrats/carrières | ❌ | module entier | **P0** |
| Présences/congés personnel | ❌ | module entier | P1 |
| Paie (salaires/primes/vacations/cotisations/bulletins) | ❌ | module entier | **P0** |
| Pilotage RH (effectifs/masse salariale/alertes) | ❌ | module entier | P1 |
| **Taux C** | **0%** | | |

## D. Gestion universitaire

| Fonctionnalité | État | Reste | Prio |
|---|---|---|---|
| Facultés/départements/filières | ❌ | modèles LMD | P2 |
| LMD/UE/crédits/semestres | ❌ | refonte référentiels | P2 |
| Inscriptions pédagogiques/sessions/rattrapages | ❌ | module entier | P2 |
| Relevés de notes/validation UE | ❌ | module entier | P2 |
| Stages/mémoires/vacataires | ❌ | module entier | P3 |
| **Taux D** | **0%** | périmètre maternelle→lycée couvert | |

## E. Administration SaaS

| Fonctionnalité | État | Preuve | Reste | Prio |
|---|---|---|---|---|
| Multi-établissements/cloisonnement | ✅ | isolation testée partout | — | — |
| Utilisateurs/permissions | ✅ | ~103 clés, 8 rôles | rôle « scolarité » demandé | P3 |
| Abonnements/formules | ✅ | plans + modules activables | — | — |
| Quotas/limitations | 🟡 | plans existent | enforcement dur | P2 |
| Facturation établissements clients | 🟡 | `PlatformCreditNote` | facture plateforme complète | P2 |
| Supervision technique | ✅ | monitoring+alerting Discord | — | — |
| Sauvegardes/restauration | ✅ | I1 testé réel (97 tables) | récurrence en cron | P1 |
| Sécurité/journalisation | ✅ | audit log, throttle, lock | — | — |
| Paramétrage par école | ✅ | délibérations, compta, gabarits | — | — |
| **Taux E** | **~90%** | | | |

## F. Paiements & communications

| Intégration | État | Détail | Prio |
|---|---|---|---|
| PayDunya | 🟡 sandbox | G3-C 71/71, jamais LIVE | **P0** pour Premium |
| Orange/Moov Money | 🟡 manuel | saisie manuelle de référence | P1 |
| Paiement manuel | ✅ | espèces/chèque/virement | — |
| Vérification transactions | 🟡 | sandbox uniquement | P1 |
| Rapprochement paiements | ❌ | dépend rapprochement bancaire | P2 |
| SMS | ❌ | aucun provider | **P0** |
| Email | ❌ | aucun provider | **P0** |
| WhatsApp | ❌ | aucun provider | P2 |
| Notifications internes | ✅ | journal/app | — |
| **Taux F** | **~40%** | | |

---

## Synthèse par périmètre de commercialisation

| Cible | Couverture réelle | Bloquants |
|---|---|---|
| Maternelle → lycée (Essentiel) | ~85% — **pilot possible** | notifications familles |
| Collège/lycée (Pro) | ~70% | notifications, bilan/CR |
| Institut/université (Premium) | **0%** | module université + paiements LIVE |
| RH/paie (toutes cibles) | **0%** | module entier |
