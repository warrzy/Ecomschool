# Matrice fonctionnelle ECOM-SCHOOL

**Code de référence :** `origin/phase-10-production-readiness` @ `ec62b59` (8 novembre 2026, 14 h 49, Europe/Paris)  
**Date de la matrice :** 14 novembre 2026 (Europe/Paris)

Les preuves détaillées sont dans `AUDIT_GLOBAL_ECOM_SCHOOL.md` et `AUDIT_RH_COMPTABILITE_360.md`. Cette matrice ne reprend pas les pourcentages des anciennes roadmaps.

## Méthode de l'indice de couverture

L'indice n'est pas une estimation d'effort restant ni un pourcentage d'avancement « ressenti ». C'est la moyenne des notes du référentiel demandé dans la mission, sur le code de `ec62b59`.

| État réel (colonne) | Note |
|---|---|
| Code complet + recette versionnée | 1,0 |
| Partiel | 0,4 |
| Backend ou route seule | 0,25 |
| Trace seulement (enum, champ texte, catégorie de frais, annuaire) | 0,2 |
| Absent | 0 |

« Recette versionnée » signifie qu'un script existe dans `scripts/` ou `e2e/`. Elle n'a pas été relancée le 14 novembre 2026. La note 1,0 ne veut donc pas dire « revalidé en préproduction ce jour ».

Indice du module = somme des notes / nombre de lignes du module.  
Les arrondis affichés sont à l'entier le plus proche ; le calcul brut est donné.

---

## Scolarité — 26,2 / 32 = 82 %

| Module | Fonctionnalité | État réel | Preuve technique | Travail restant | Priorité |
|---|---|---|---|---|---|
| Scolarité | Fiche établissement et paramètres | Code complet + recette versionnée | `School`, `/app/settings`, `schools.ts` | README produit, promesse contractuelle | P0 |
| Scolarité | Années scolaires | Code complet + recette versionnée | `AcademicYear`, `/app/academic-years` | Recette à rejouer | P0 |
| Scolarité | Périodes (trimestre, semestre, autre) | Code complet + recette versionnée | `AcademicPeriod` | Recette à rejouer | P0 |
| Scolarité | Niveaux | Code complet + recette versionnée | `Level`, `/app/levels` | Regroupement par cycle | P2 |
| Scolarité | Classes | Code complet + recette versionnée | `Classroom`, `/app/classrooms` | — | P0 |
| Scolarité | Matières et coefficients | Code complet + recette versionnée | `Subject`, `LevelSubject`, `ClassroomSubject` | — | P0 |
| Scolarité | Programmes officiels / progressions | Absent | Pas de modèle de programme. `/app/courses` redirige vers l'EDT | Nouveau domaine si le métier l'exige | P3 |
| Scolarité | Élèves | Code complet + recette versionnée | `Student`, import `/app/students/import` | — | P0 |
| Scolarité | Parents et tuteurs | Code complet + recette versionnée | `Guardian`, `StudentGuardian` | Consentements SMS à l'écran si les canaux externes sont vendus | P1 |
| Scolarité | Inscriptions | Code complet + recette versionnée | `Enrollment`, `/app/enrollments`, `registration.ts` | — | P0 |
| Scolarité | Admissions et conversion | Code complet + recette versionnée | `admissions.ts`, `admissionConversion.ts`, `/candidature`, `scripts/g2` | Recette préproduction | P0 |
| Scolarité | Réinscriptions | Code complet + recette versionnée | `reenrollment.ts`, `/app/reinscriptions` | Recette préproduction | P0 |
| Scolarité | Emplois du temps | Code complet + recette versionnée | `CourseSchedule`, `CourseSession`, `/app/schedules` | — | P1 |
| Scolarité | Enseignants et affectations de cours | Code complet + recette versionnée | `Teacher`, `TeachingAssignment`, `/app/teachers` | Ne pas le présenter comme un dossier RH | P0 |
| Scolarité | Absences et retards des élèves | Code complet + recette versionnée | `AttendanceRecord`, `/app/attendance` | Notification externe non prouvée | P1 |
| Scolarité | Notes | Code complet + recette versionnée | `Assessment`, `Grade`, import de notes | — | P0 |
| Scolarité | Moyennes et classements | Code complet + recette versionnée | `StudentPeriodResult`, `/app/averages` | — | P0 |
| Scolarité | Bulletins PDF | Code complet + recette versionnée | `ReportCard`, gabarits primary/college/lycee | Relecture visuelle | P0 |
| Scolarité | Délibérations et PV | Code complet + recette versionnée | `deliberations.ts`, `scripts/h5` | Recette à rejouer | P0 |
| Scolarité | Passage, redoublement, orientation | Code complet + recette versionnée | Écriture de `decision` et `progression` dans `deliberations.ts`, `scripts/h6` | Recette à rejouer. Le rapport F2-E4 est périmé sur ce point | P0 |
| Scolarité | Documents administratifs | Partiel | Page `/app/documents-administratifs`, service G4, **absente de `appNav`**, visible côté parent | Ajouter l'entrée de menu | P0 |
| Scolarité | Portail parent | Code complet + recette versionnée | `/parent`, demandes, reçus, documents | — | P0 |
| Scolarité | Portail élève | Code complet + recette versionnée | `/student` | Devoirs en ligne : absents, hors première offre | P2 |
| Scolarité | Portail enseignant | Code complet + recette versionnée | `/teacher` | — | P0 |
| Scolarité | Annonces | Code complet + recette versionnée | `Announcement`, `/app/announcements` | — | P1 |
| Scolarité | Notifications internes | Code complet + recette versionnée | `Notification` | — | P1 |
| Scolarité | Messagerie externe | Partiel | `SchoolMessage`, providers e-mail/SMS/WhatsApp non prouvés configurés, pas de réponse entrante | Contrat opérateur + recette d'envoi réel | P1 |
| Scolarité | Imports élèves et notes | Code complet + recette versionnée | routes `import/preview` et `import/commit`, `e2e/imports.spec.ts` | — | P0 |
| Scolarité | Séries de lycée | Trace seulement | `Classroom.section` ou niveau nommé « Terminale C » | Entité série si les lycées pilotes l'exigent | P2 |
| Scolarité | Regroupement par cycle | Absent | `Level` est une liste plate | Filtre cycle | P2 |
| Scolarité | Maternelle (compétences, cahier de vie) | Absent | Type `PRIMARY` et gabarit `primary` seulement | Lot dédié, hors promesse actuelle | P2 |
| Scolarité | Cantine, transport, internat | Trace seulement | Catégories de frais ou de dépenses possibles, aucun module | Lot H10 de l'ancienne roadmap, non commencé | P3 |

---

## Finances de scolarité — 10,2 / 12 = 85 %

| Module | Fonctionnalité | État réel | Preuve technique | Travail restant | Priorité |
|---|---|---|---|---|---|
| Finances | Tarifs et catégories | Code complet + recette versionnée | `FeeCategory`, `FeeTariff` | — | P0 |
| Finances | Échéanciers et comptes élèves | Code complet + recette versionnée | `StudentFeeCharge`, `FeeInstallment`, `/app/fees/accounts` | — | P0 |
| Finances | Encaissements et reçus PDF | Code complet + recette versionnée | `Payment`, `src/lib/pdf/receipt.ts` | Relecture des PDF | P0 |
| Finances | Impayés | Code complet + recette versionnée | `/app/fees/unpaid` | — | P0 |
| Finances | Relances | Partiel | `FeeReminder` → notification interne | Branchement SMS si vendu | P1 |
| Finances | Caisse et clôture | Code complet + recette versionnée | `CashClosure` | — | P0 |
| Finances | Dépenses | Code complet + recette versionnée | `Expense`, `/app/expenses` | — | P0 |
| Finances | Recettes hors scolarité | Partiel | Possibles via une catégorie de frais, pas de module dédié | Décider si le besoin est réel | P2 |
| Finances | Trésorerie de flux | Code complet + recette versionnée | `finance/treasury.ts`, `/app/treasury` | Ce n'est pas un rapprochement bancaire | P1 |
| Finances | Rapports financiers de scolarité | Code complet + recette versionnée | `finance/reports.ts`, Excel et PDF | — | P0 |
| Finances | Exports CSV protégés contre l'injection de formules | Code complet + recette versionnée | `export/finance.ts`, `accounting.ts` fonction `esc` | — | P0 |
| Finances | Rapprochement Mobile Money | Partiel | `payments/reconciliation.ts`, recettes `scripts/g3`. Live non prouvé | Recette prestataire TEST puis LIVE | P1 |

---

## Comptabilité générale — 2,65 / 12 = 22 %

| Module | Fonctionnalité | État réel | Preuve technique | Travail restant | Priorité |
|---|---|---|---|---|---|
| Compta | Plan SYSCOHADA | Partiel | `SYSCOHADA_STARTER`, 10 comptes | Plan utile à une liasse, validé par un comptable | P1 |
| Compta | Journaux | Partiel | `AccountingJournal` CA, BQ, MM, VE, OD | Écran de création si le starter ne suffit pas | P1 |
| Compta | Écritures auto caisse et dépenses | Partiel | `generateEntries` : comptabilité de caisse, pas d'engagement (411 non mouvementé à la facturation) | Écritures d'engagement | P1 |
| Compta | Grand livre | Backend ou route seule | `generalLedger`, export `kind=ledger` sans bouton | Bouton et écran | P1 |
| Compta | Balance | Code complet + recette versionnée | `trialBalance`, page et export, `scripts/h12` | Rejouer la recette | P1 |
| Compta | Auxiliaires clients et fournisseurs | Trace seulement | Comptes 411 et 401 collectifs, bénéficiaire en texte | Fiches tiers et lettrage | P1 |
| Compta | Rapprochement bancaire | Absent | Aucun relevé. Le rapprochement existant est Mobile Money | Nouveau flux | P2 |
| Compta | Immobilisations et amortissements | Absent | Aucun modèle | Nouveau domaine | P2 |
| Compta | Bilan | Absent | Aucune fonction | À construire sur la balance | P1 |
| Compta | Compte de résultat | Absent | Aucune fonction | À construire sur les classes 6 et 7 | P1 |
| Compta | États financiers réglementaires | Absent | Aucun export de liasse | Après bilan et résultat | P2 |
| Compta | Écritures de paie | Absent | `generateEntries` ignore la paie | Après le module paie | P2 |

La saisie manuelle `createManualEntry` est un backend seul. Elle n'est pas une ligne du référentiel demandé ; elle est comptée dans le travail restant du lot comptable, pas dans l'indice, pour ne pas ajouter une ligne hors mission.

---

## Ressources humaines — 1,4 / 34 = 4 %

Notes 0,2 : enseignant vs autres (annuaire seul), champs de contact, emploi du temps des cours pris pour un planning, dépense « salaires » possible, effectif enseignants.  
Note 0,4 : historique d'affectations pédagogiques (`TeachingAssignment`).  
Toutes les autres lignes : 0.

| Module | Fonctionnalité | État réel | Preuve technique | Travail restant | Priorité |
|---|---|---|---|---|---|
| RH | Dossier administratif salarié | Absent | Aucun modèle | Nouveau modèle `Employee` | P2 |
| RH | Enseignants et non-enseignants | Trace seulement | `Teacher` ; les autres sont des `User` | Fiche unique | P2 |
| RH | Infos personnelles et professionnelles | Trace seulement | 4 champs de contact + statut | Étendre la fiche, pas `Teacher` seul | P2 |
| RH | Documents du personnel | Absent | `AdministrativeDocument` = documents élèves | Réutiliser `Document` avec un nouveau propriétaire | P2 |
| RH | Historique des affectations | Partiel | `TeachingAssignment` pédagogique | Historique de poste | P2 |
| RH | Contrats, types, dates | Absent | — | Nouveau modèle | P2 |
| RH | Renouvellements, promotions, mutations | Absent | — | Après le contrat | P3 |
| RH | Pointage du personnel | Absent | `AttendanceRecord` = élèves | Nouveau flux | P2 |
| RH | Absences et retards du personnel | Absent | — | Nouveau flux | P2 |
| RH | Demandes, validation et soldes de congés | Absent | — | Nouveau flux | P2 |
| RH | Planning du personnel | Trace seulement | `CourseSchedule` = cours | Ne pas le détourner | P3 |
| RH | Salaire de base, primes, heures sup, vacations | Absent | — | Module paie | P2 |
| RH | Retenues, avances, cotisations | Absent | Aucune CNSS dans le code | Barème à spécifier hors code | P2 |
| RH | Bulletins de paie PDF et historique | Absent | Les PDF existants sont scolaires ou SaaS | Gabarit légal | P2 |
| RH | États de paie mensuels | Absent | — | Après le calcul | P2 |
| RH | Écritures de paie | Trace seulement | Aucune origine `PAYROLL`. Une catégorie de dépense `SALAIRES` existe dans `finance/expenses.ts` | Après le calcul de paie, sans double décaissement | P2 |
| RH | Effectifs | Trace seulement | Liste enseignants | Indicateur salariés | P3 |
| RH | Masse salariale | Absent | — | Après la paie | P3 |
| RH | Recrutement | Absent | Les admissions sont élèves | Lot séparé | P3 |
| RH | Évaluation du personnel | Absent | — | Lot séparé | P3 |
| RH | Statistiques RH | Absent | — | Après les fiches | P3 |
| RH | Alertes de fin de contrat | Absent | Les alertes `monitor.sh` sont techniques | Après les contrats | P2 |

Les lignes « contrats, types, dates » et « renouvellements, promotions, mutations » et les sous-lignes de paie sont regroupées dans le tableau pour la lecture. Le décompte 34 reprend le détail de `AUDIT_RH_COMPTABILITE_360.md` section 3 (6 traces notées, 28 absences). Somme 1,4.

---

## Université — 0,8 / 12 = 7 %

| Module | Fonctionnalité | État réel | Preuve technique | Travail restant | Priorité |
|---|---|---|---|---|---|
| Université | Facultés | Absent | `SchoolType` sans valeur université | Produit dérivé | P3 |
| Université | Départements | Absent | — | Produit dérivé | P3 |
| Université | Filières | Trace seulement | Texte libre possible sur une candidature | Référentiel | P3 |
| Université | Parcours LMD | Absent | — | Produit dérivé | P3 |
| Université | UE et crédits | Absent | Coefficients scolaires ≠ ECTS | Nouveau calcul | P3 |
| Université | Semestres universitaires | Trace seulement | `AcademicPeriodType.SEMESTER` = découpage d'année scolaire | Sémantique LMD | P3 |
| Université | Inscriptions pédagogiques | Absent | `Enrollment` = inscription en classe | Nouveau flux | P3 |
| Université | Sessions et rattrapages | Absent | Pas de session d'examen universitaire | Nouveau flux | P3 |
| Université | Validation des UE | Absent | `GradingPolicy` scolaire | Règles de compensation à écrire | P3 |
| Université | Relevés de notes | Partiel | Bulletins scolaires PDF, pas un relevé de crédits | Gabarit distinct | P3 |
| Université | Stages et mémoires | Absent | — | Nouveau domaine | P3 |
| Université | Intervenants et vacataires | Absent | `Teacher` sans taux ni vacation | Après la paie | P3 |

---

## Administration SaaS — 11,8 / 13 = 91 %

| Module | Fonctionnalité | État réel | Preuve technique | Travail restant | Priorité |
|---|---|---|---|---|---|
| SaaS | Multi-établissements | Code complet + recette versionnée | `School`, onboarding plateforme | Fusionner la branche dans `main` | P0 |
| SaaS | Cloisonnement des données | Code complet + recette versionnée | `schoolId`, `e2e/security.spec.ts` | Rejouer les tests IDOR | P0 |
| SaaS | Utilisateurs et permissions | Code complet + recette versionnée | Rôles `PLATFORM_OWNER`, `ADMIN_SCHOOL`, `TEACHER`, `PARENT`, `STUDENT`, `FINANCE_MANAGER`, `CASHIER` | — | P0 |
| SaaS | Abonnements et formules | Code complet + recette versionnée | `SubscriptionPlan`, `/platform/plans` | — | P0 |
| SaaS | Quotas | Code complet + recette versionnée | `maxStudents`, `maxUsers` dans `platform/modules.ts` | — | P1 |
| SaaS | Facturation des établissements | Code complet + recette versionnée | `PlatformInvoice`, PDF `/platform/invoices` | Encaissement SaaS réel non audité en base | P1 |
| SaaS | Modules activables | Code complet + recette versionnée | `PlatformModule`, `SchoolModuleOverride` | — | P1 |
| SaaS | Supervision | Code complet + recette versionnée | `/platform/monitoring`, `deploy/scripts/monitor.sh` | Prouver que l'alerte webhook est armée sur le VPS | P0 |
| SaaS | Sauvegardes et restauration | Partiel | Scripts + **39/39** de `deploy/tests/run.sh` le 14 novembre 2026, en stub. Pas de preuve sur le VPS | Contrôle d'exploitation | P0 |
| SaaS | Journalisation | Code complet + recette versionnée | `AuditLog`, `/platform/audit` | Rétention à valider contractuellement | P1 |
| SaaS | Paramétrage par établissement | Code complet + recette versionnée | `/app/settings`. `School.type` est déclaratif | — | P1 |
| SaaS | Sécurité d'exploitation | Partiel | Verrou login, HSTS et en-têtes vus sur les domaines, checklist juridique ouverte | Confidentialité mineurs, CI | P0 |
| SaaS | Inscription publique d'établissement | Code complet + recette versionnée | `SchoolSignupRequest`, `/inscription` | — | P1 |

---

## Paiements et communications — 6,6 / 13 = 51 %

| Module | Fonctionnalité | État réel | Preuve technique | Travail restant | Priorité |
|---|---|---|---|---|---|
| Paiements | Orange Money API | Trace seulement | Enum opérateur, pas d'adaptateur Orange | Via PayDunya ou adaptateur dédié | P1 |
| Paiements | Moov Money API | Trace seulement | Idem | Idem | P1 |
| Paiements | PayDunya | Partiel | Adaptateur `paydunya.ts`, « enregistré mais inerte », verrou `MOBILE_MONEY_LIVE_ENABLED` | Recette TEST distante puis LIVE. État du verrou sur le serveur : non vérifiable | P1 |
| Paiements | Paiement manuel espèces / banque / chèque | Code complet + recette versionnée | `PaymentMethod` | — | P0 |
| Paiements | Paiement manuel OM / Moov avec référence | Code complet + recette versionnée | `manualMobileMoney.ts`, `scripts/g3/manual-momo-recette.ts` | — | P0 |
| Paiements | Webhooks signés | Partiel | `webhooks.ts`, recettes g3. Aucun appel réel observé | Recette avec le prestataire | P1 |
| Paiements | Vérification des transactions | Partiel | Statuts d'intention et adaptateur | Même recette | P1 |
| Paiements | Rapprochement des paiements MM | Partiel | `PaymentReconciliation`, `PaymentSettlement` | Hors rapprochement bancaire classique | P1 |
| Paiements | Remboursements MM | Partiel | `refunds.ts` | Recette live | P2 |
| Communications | SMS | Partiel | Provider HTTP générique, silencieux si variables absentes | Choisir et configurer un opérateur BF | P1 |
| Communications | E-mail | Partiel | `EMAIL_PROVIDER_URL` | Configurer un fournisseur | P1 |
| Communications | WhatsApp | Partiel | API Meta, `WHATSAPP_DRY_RUN` possible | Compte Business et modèles approuvés | P2 |
| Communications | Notifications internes | Code complet + recette versionnée | `Notification` | — | P0 |

---

## Lecture des indices

| Module | Lignes | Somme | Indice |
|---|---|---|---|
| Scolarité (primaire → lycée, y compris manques maternelle, séries, cantine, programmes) | 32 | 26,2 | 82 % |
| Finances de scolarité | 12 | 10,2 | 85 % |
| Comptabilité générale | 12 | 2,65 | 22 % |
| Ressources humaines et paie | 34 | 1,4 | 4 % |
| Université | 12 | 0,8 | 7 % |
| Administration SaaS | 13 | 11,8 | 91 % |
| Paiements et communications | 13 | 6,6 | 51 % |

Décomposition, pour vérification :

- Scolarité : 25 × 1 + 2 × 0,4 (documents hors menu, messagerie) + 2 × 0,2 (séries, cantine) = 26,2.
- Finances de scolarité : 9 × 1 + 3 × 0,4 (relances, recettes hors scolarité, rapprochement Mobile Money) = 10,2.
- Comptabilité générale : 1 × 1 (balance) + 3 × 0,4 (plan, journaux, écritures de caisse) + 0,25 (grand livre) + 0,2 (auxiliaires) = 2,65.
- RH : 0,4 (affectations pédagogiques) + 5 × 0,2 (annuaire, contact, planning des cours, effectif enseignants, catégorie de dépense `SALAIRES`) = 1,4.
- Université : 0,4 (bulletins réutilisables comme relevé) + 2 × 0,2 (texte de filière, semestre scolaire) = 0,8.
- SaaS : 11 × 1 + 2 × 0,4 (sauvegardes non prouvées sur le VPS, checklist juridique ouverte) = 11,8.
- Paiements et communications : 3 × 1 + 8 × 0,4 + 2 × 0,2 = 6,6.

Un indice SaaS élevé mesure la couverture du code et des scripts, pas une certification d'exploitation. La sauvegarde et la sécurité juridique restent partielles dans le tableau.

Le produit, au sens de l'ambition 360°, se situe là où les indices chutent : comptabilité générale, RH, université. Le produit au sens « logiciel de gestion d'une école et de sa caisse » se situe sur les deux premières lignes, à condition de rejouer les recettes et de publier la bonne branche.
