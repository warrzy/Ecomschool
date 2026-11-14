# Feuille de route de finalisation — ECOM-SCHOOL

**Point de départ obligatoire :** `origin/phase-10-production-readiness` @ `ec62b59`, plus la PR #1 (manuel) si elle est acceptée.  
**Interdit :** reconstruire le produit depuis `main` @ `9811e0a`. Cette branche est le socle du 9 octobre 2026.

Les charges sont des **tailles de chantier**, pas des délais calendaires. Un agent ou une équipe ne doit pas les lire comme des semaines.

| Taille | Sens |
|---|---|
| S | Un correctif localisé : un fichier de menu, un bouton, un libellé, une vérification d'exploitation |
| M | Un parcours : service existant à compléter, écran, recette |
| L | Un sous-domaine nouveau : plusieurs modèles, écrans, écritures, recette |
| XL | Un domaine métier nouveau (paie complète, LMD) avec règles externes à figer |

Aucun lot ne se déploie en production depuis cet audit. Chaque lot se recette d'abord sur la préproduction déjà en place (`https://preprod.ecomschool.fr`), après identification du SHA servi.

---

## Lot 1 — Anomalies bloquantes et sécurisation de l'existant

**Objectif :** le code que les établissements toucheraient est celui qui est dans git, testé, sauvegardé, et décrit sans ambiguïté.

### Fonctionnalités

1. Faire de `phase-10-production-readiness` la branche de référence et aligner `main` (merge ou bascule documentée). Intégrer ou non la PR #1.
2. Lire sur le VPS le SHA de la release `current` (préproduction et production). Aligner le git si le serveur est en retard ou en avance.
3. Relancer typecheck, lint, build, puis les recettes `scripts/phase7`, `g2`, `g3`, `g4`, `h1`, `h5`, `h6`, `h12` et un sous-ensemble Playwright (`e2e/security.spec.ts`, `e2e/nav-rbac.spec.ts`) sur une base **jetable**.
4. Vérifier sur le serveur, sans restaurer la base active : dernier dump, cron `/api/cron`, `restore-verify` sur base témoin, présence ou absence de `ALERT_WEBHOOK_URL`.
5. Ajouter au menu l'entrée Documents administratifs (`administrative-docs.read`).
6. Poser un CI minimal (il n'existe aucun `.github/workflows`).
7. Remplacer le README `create-next-app`.
8. Écarter les cases ouvertes de `docs/production-checklist.md` qui concernent les mineurs avant tout élève réel : politique de confidentialité, registre des traitements, durées de rétention.

### Dépendances

Aucune dépendance métier. Dépendance d'accès : SSH au VPS déjà décrit dans `deploy/README.md`. Cet audit n'a pas ouvert de session serveur.

### Fichiers et modules

- Branches git, pas un module.
- `src/app/app/(tenant)/ui/nav.ts`
- `deploy/scripts/healthcheck.sh`, `backup.sh`, `restore-verify.sh`, `monitor.sh`
- `docs/production-checklist.md`, `README.md`
- Nouveau `.github/workflows/` (à créer au moment du développement, pas dans cet audit)

### Risques

- Merger `main` sans comprendre qu'il est **derrière** de 202 commits : un merge ordinaire depuis `main` vers la phase 10 est trivial (ancêtre commun = `main`). L'inverse, écraser la phase 10 avec `main`, détruirait le produit.
- `prisma migrate deploy` est déjà dans `deploy/scripts/deploy.sh`. Le relancer sur une base réelle hors procédure de release est hors sujet de ce lot.
- Les recettes historiques supposent des mots de passe de seed. Ne pas les poser sur la production.

### Charge

L pour l'ensemble (la recette et le CI dominent), dont S pour le menu et le README.

### Critères d'acceptation

- `main` et la préproduction pointent vers un SHA identifié, ancêtre ou égal de la phase 10.
- Typecheck, lint et build verts sur ce SHA.
- Les recettes listées sont vertes sur base jetable, ou chaque échec a un ticket.
- Un dump daté et un exercice de restauration témoin sont consignés.
- Le menu affiche Documents administratifs pour le rôle autorisé, et le masque sinon.
- Le README décrit le produit, les limites (pas de RH, pas de bilan, pas de LMD) et la branche de release.

### Tests

Ceux du point 3, plus `deploy/tests/run.sh` (déjà 39/39 le 14 novembre 2026 en stub).

### Livrables

Branche de release, journal de recette, SHA serveur, CI, README, menu corrigé.

---

## Lot 2 — Parcours scolaires et financiers déjà développés

**Objectif :** fermer les écarts des modules dont le code existe, sans ouvrir la paie ni le LMD.

### Fonctionnalités

1. Parcours démo complet sur la préproduction vide de données réelles : année → niveaux → classes → élèves → affectations → emploi du temps → notes → moyennes → bulletin → délibération → passage → frais → encaissement → impayé → dépense → trésorerie.
2. Bouton grand livre sur `/app/comptabilite` (la route `kind=ledger` existe).
3. Décision explicite sur la messagerie : soit les variables SMS / e-mail sont configurées et une recette d'envoi part sur un numéro de test, soit l'interface continue d'afficher le canal comme indisponible et le contrat ne le promet pas.
4. Séries de lycée : tant qu'aucune entité n'existe, documenter le contournement (niveau « Terminale C » ou section) dans le manuel. Ne pas coder une série si les pilotes n'en ont pas besoin.
5. Maternelle : rester sur le gabarit `primary` et le dire. Le cahier de compétences n'est pas dans ce lot.
6. Relances d'impayés : rester internes, ou brancher le canal choisi au point 3 sur `FeeReminder`.

### Dépendances

Lot 1 (SHA et recette de base).

### Fichiers

- `src/app/app/(tenant)/comptabilite/page.tsx`
- `src/lib/services/accounting.ts` (`exportCsv` kind `ledger`)
- `src/lib/services/comm/providers.ts`
- `src/lib/services/finance/` (relances)
- `docs/manuel-utilisateur/` (PR #1) à compléter, pas à contredire

### Risques

- Brancher un SMS réel pendant la recette vers de vrais parents. La recette doit viser un numéro de test et le dry-run WhatsApp.
- Modifier `generateEntries` dans ce lot. Ce n'est pas le sujet : le grand livre se contente d'un lien.

### Charge

M.

### Critères d'acceptation

- Le parcours démo est exécuté de bout en bout par une personne, avec captures, sur la préproduction.
- Le grand livre CSV se télécharge depuis l'écran, pour un compte choisi.
- L'état configuré / non configuré de chaque canal est visible et conforme aux variables du serveur.
- Aucune régression des permissions caissier / responsable financier (`docs/f1-matrice-actions-financieres.md` à revalider contre le code, car ce document peut être antérieur).

### Tests

Recette manuelle du parcours, `scripts/h5`, `scripts/h6`, `scripts/h12`, `e2e/exports-finance-reportcards.spec.ts`.

### Livrables

Journal de recette préproduction, correctif grand livre, décision écrite sur les canaux.

---

## Lot 3 — Comptabilité 360°

**Objectif :** passer de la comptabilité de caisse de démarrage à une comptabilité d'engagement exploitable, puis aux états. Pas une liasse fiscale signée : les états doivent être contrôlables par un expert-comptable. Le logiciel ne se substitue pas à cette validation.

### Fonctionnalités, dans l'ordre

1. Engagement : à la validation d'une créance, débit 411 / crédit 706 (ou compte de catégorie). À l'encaissement, débit trésorerie / crédit 411. Reprendre l'historique par une opération explicitement lancée, idempotente, pour ne pas doubler les écritures déjà générées en comptabilité de caisse.
2. Écran d'OD branché sur `createManualEntry`, équilibre obligatoire, contre-passation seule pour corriger.
3. Grand livre à l'écran, pas seulement en CSV.
4. Fiches auxiliaires : élève (lettrage créance / règlement), fournisseur (aujourd'hui simple texte `beneficiary`).
5. Compte de résultat (classes 6 et 7) et bilan simplifié (classes 1 à 5) filtrés sur l'exercice, exports CSV puis PDF.
6. Relevés bancaires et rapprochement, distincts de `PaymentReconciliation` (Mobile Money).
7. Immobilisations : fiche, valeur, durée, dotation, écriture périodique.
8. Budgets : prévision par compte ou par catégorie, comparé au réalisé.
9. Écritures de paie : **dépendent du lot 4**. Les préparer par un point d'extension `sourceType = PAYROLL`, sans les simuler.

### Dépendances

Lot 1. Le point 9 dépend du lot 4. Les points 6 à 8 peuvent suivre les points 1 à 5.

### Fichiers

- `prisma/schema.prisma` (nouveaux modèles tiers, relevés, immobilisations, budgets — migrations **nouvelles**, create-only, jamais `migrate reset`)
- `src/lib/services/accounting.ts`
- `src/app/app/(tenant)/comptabilite/`
- `src/lib/services/finance/fees.ts` et `payments.ts` pour l'engagement
- `scripts/h12/` à étendre

### Risques

- Double comptage si l'on génère des écritures d'engagement sans isoler les écritures de caisse déjà postées (`sourceType = PAYMENT`).
- Le plan de 11 comptes est insuffisant pour un bilan (pas de classe 1, 2, 3). Le starter devra être étendu sans écraser les comptes déjà personnalisés par une école (`installStarterPlan` fait des upserts qui **ne mettent pas à jour** l'existant : le conserver).
- Montants entiers XOF : pas de décimal. Les taux d'amortissement doivent tomber sur des entiers ou documenter l'arrondi.
- Multi-instance : non concerné tant que PM2 reste mono-processus.

### Charge

L pour les points 1 à 5. L supplémentaire pour 6 à 8. Le point 9 est dans le lot 4.

### Critères d'acceptation

- Un jeu d'essai figé (créance, encaissement partiel, remise, annulation, dépense, OD) produit une balance équilibrée et un résultat égal au cumul des classes 6 et 7.
- Rejouer la génération ne crée pas de doublon.
- Une école qui a déjà le starter ne perd pas ses comptes.
- Un comptable externe peut pointer les écarts restants (TVA, impôts, à-nouveaux) : ils sont listés, pas cachés.

### Tests

Extension de `scripts/h12/comptabilite-recette.ts` : équilibre, idempotence, contre-passation, exercice clos refusé, export sans injection de formule.

### Livrables

Migrations, service, écrans, jeu d'essai, note de périmètre « ce que la liasse ne couvre pas encore ».

---

## Lot 4 — RH et paie

**Objectif :** créer le module. Il n'y a rien à « finir ».

### Fonctionnalités

1. `Employee` rattaché à `School`, lien optionnel vers `User` et vers `Teacher`.
2. Contrat : type, date de début, date de fin, statut, document via la brique `Document`.
3. Alerte de fin de contrat (job cron déjà présent).
4. Congés : demande, validation, solde. Présence personnel distincte de `AttendanceRecord` élève.
5. Paie forfaitaire mensuelle : brut, primes saisies, retenues saisies, net. Les taux CNSS / IUTS **ne sont pas dans le code** : ils doivent être fournis par un référent paie burkinabè et stockés comme barème versionné, pas en dur au milieu d'un service.
6. Bulletin PDF et état récapitulatif mensuel.
7. Écriture comptable : charges (compte 66 et comptes de charges sociales), dettes de personnel, trésorerie au paiement. `sourceType = PAYROLL`. Ne pas réencoder le net comme une simple `Expense` une fois la paie active, sinon double décaissement comptable.
8. Vacations : après le forfait. Taux × séances (`CourseSession`) validées. Hors premier incrément si le pilote paie au mois.

### Dépendances

Lot 1. Le point 7 dépend du lot 3 point 1 (le générateur sait ajouter une origine sans casser l'idempotence). Les vacations dépendent des séances, déjà en place.

### Fichiers

Nouveaux : `prisma` modèles RH, `src/lib/services/hr/`, `src/lib/services/payroll/`, `src/app/app/(tenant)/personnel/`, `src/lib/pdf/payslip.ts`, permissions dans un bootstrap idempotent sur le modèle de `scripts/h12/bootstrap-accounting-permissions.ts`, entrée de `appNav`.

Ne pas étendre `Teacher` avec des colonnes de paie.

### Risques

- Barème légal faux : le logiciel calculerait des bulletins illégaux. Le barème doit être une donnée versionnée, revue, pas une constante inventée.
- Données plus sensibles que les notes (identité, rémunération). Permissions dédiées, absentes du rôle enseignant.
- Enseignant dans deux établissements : le modèle actuel est mono-`schoolId`. Le premier incrément reste mono-établissement, comme le reste du produit.

### Charge

XL pour la fiche + contrat + paie forfaitaire + écriture + PDF.  
L additionnel pour congés, pointage et vacations.

### Critères d'acceptation

- Un salarié non enseignant a une fiche, un contrat, un bulletin PDF, une écriture équilibrée, et n'apparaît pas comme enseignant.
- Un enseignant peut être lié aux deux fiches sans dupliquer son nom dans les affectations de cours.
- Relancer la paie du même mois ne crée ni second bulletin ni seconde écriture.
- Le rôle `TEACHER` ne lit pas les salaires des collègues.
- Aucune route `/app/paie` ne renvoie 404 pour un utilisateur autorisé.

### Tests

Recette nouvelle : création, renouvellement de calcul, permission, équilibre comptable, contrat expiré signalé.

### Livrables

Module, barème externalisé (fichier de paramètres, pas de taux en dur), recette, extrait du manuel.

---

## Lot 5 — Gestion universitaire

**Objectif :** ne pas l'entamer tant que les lots 1 et 2 ne sont pas acceptés, et ne pas la présenter comme incluse.

Le code actuel (niveaux libres, périodes, notes, coefficients) **ne devient pas** un LMD par renommage. Il manque faculté, département, filière, maquette d'UE, crédits, inscription pédagogique, session, compensation, relevé, stage, mémoire, vacataire.

### Fonctionnalités

1. Décision produit : module dans le même tenant, ou produit dérivé (l'ancienne roadmap penche pour un dérivé, sans code).
2. Si oui : référentiel structure, maquette, inscription aux UE, calcul de crédits, relevé, puis stages.
3. Les vacataires réutilisent le lot 4.

### Dépendances

Lot 1. Vacataires : lot 4. Ne dépend pas de la comptabilité générale.

### Fichiers

Nouveau domaine. Réutilisation possible de `Student`, `Assessment`, `Grade`, portails, `schoolId`.

### Risques

- Tordre `Classroom` en « groupe de TD » et `Level` en « semestre L2 » rendrait les bulletins scolaires faux pour les écoles déjà modélisées. Les règles LMD doivent être un moteur séparé, activé par le type d'établissement — aujourd'hui `School.type` ne pilote aucun comportement (`docs/f2e4-audit-cycles-scolaires.md`, toujours exact sur ce point précis).

### Charge

XL.

### Critères d'acceptation

- Une école `HIGH` existante ne change pas de calcul de moyenne.
- Un institut pilote valide une UE, un crédit, un relevé, sans classe unique obligatoire.
- Les séries de lycée du lot 2 ne sont pas cassées.

### Tests

Jeu d'essai L1 : UE validée, UE compensée, UE ajournée, relevé PDF, isolation avec une école secondaire du même serveur.

### Livrables

Spécification signée avant le code, puis le domaine, puis la recette. Pas de code tant que la spécification n'est pas acceptée : le dépôt n'a aucune amorce à préserver.

---

## Lot 6 — Paiements, communications, services complémentaires

**Objectif :** rendre vrais les canaux déjà écrits, ou les laisser éteints visiblement.

### Fonctionnalités

1. PayDunya : suivre `docs/g3e-paydunya-remote-test-plan.md` en environnement TEST (`MOBILE_MONEY_REMOTE_TEST_ENABLED`), puis LIVE derrière le verrou. Orange Money et Moov Money passent par l'agrégateur tant qu'il n'y a pas d'adaptateur direct (c'est le cas dans `providers/index.ts` : sandbox + PayDunya seulement).
2. Conserver l'encaissement manuel à référence, déjà codé, comme mode dégradé.
3. SMS et e-mail : un fournisseur nommé, secrets hors dépôt, recette sur destinataire de test, coût journalisé (`SMS_COST_PER_SEGMENT` existe déjà).
4. WhatsApp : modèles Meta approuvés, dry-run jusqu'à la recette.
5. Cantine, transport, bibliothèque, internat : hors de ce lot tant qu'un établissement pilote ne les paie pas. Les catégories de frais suffisent pour encaisser.

### Dépendances

Lot 1. Contrats commerciaux avec PayDunya et un opérateur SMS. Le code d'adaptateur est déjà là.

### Fichiers

- `src/lib/services/payments/providers/`
- `src/lib/services/comm/providers.ts`
- `src/lib/services/comm/deliver.ts`
- Variables d'environnement du serveur, jamais commitées

### Risques

- Lever `MOBILE_MONEY_LIVE_ENABLED` sur la production avant la recette TEST.
- Webhook exposé : la vérification de signature est dans `webhooks.ts` ; la recette doit inclure un payload invalide rejeté.
- Double encaissement : intention Mobile Money confirmée **et** saisie manuelle de la même référence. Les contrôles d'unicité de référence existent côté manuel ; les étendre au croisement intention / paiement manuel fait partie du lot.

### Charge

M pour la recette et la configuration, si les contrats sont prêts. L si un second agrégateur direct est exigé.

### Critères d'acceptation

- Un paiement TEST crée une intention, un webhook signé, un `Payment` validé, un reçu, une écriture après génération, sans doublon.
- Un webhook à mauvaise signature ne crée rien.
- Avec le verrou live à faux, aucun appel vers `https://app.paydunya.com/api/v1`.
- Un SMS de test arrive, ou le canal reste « non configuré » dans l'interface. Pas de faux succès.

### Tests

`scripts/g3/` existants, plus une recette distante TEST décrite dans `docs/g3e-paydunya-remote-test-plan.md`. Ne pas utiliser de secrets dans les arguments de commande.

### Livrables

Compte-rendu de recette TEST, décision go / no-go LIVE, canaux soit opérants soit assumés indisponibles.

---

## Lot 7 — Recette finale et préparation commerciale

**Objectif :** un périmètre vendable, écrit, démontrable.

### Fonctionnalités

1. Périmètre contractuel = lots 1 et 2 acceptés. Comptabilité limitée à ce que le lot 3 a réellement livré au moment de la signature. RH et LMD exclus tant que les lots 4 et 5 ne sont pas acceptés.
2. Jeu de démonstration distinct des données réelles (`scripts/demo/`), jamais sur la base de production.
3. Manuel utilisateur : fusionner la PR #1 après relecture contre le menu réel (elle a été rédigée sur la phase 10 ; l'écart du menu documents administratifs doit y figurer une fois corrigé).
4. Mesure de charge sur le VPS (`docs/phase10-performance.md` est un banc antérieur).
5. Parcours mobile 320 px sur les écrans du pilote (des captures P6 existent déjà dans `docs/recette/`, à refaire si le CSS a bougé).
6. Sauvegarde hors du VPS et RPO/RTO écrits.
7. Politique de confidentialité publiée.

### Dépendances

Lots 1 et 2 obligatoires. Lots 3 à 6 seulement pour les clauses qui les mentionnent.

### Fichiers

Documentation commerciale et checklist. Pas de nouvelle fonctionnalité dans ce lot.

### Risques

- Vendre la production actuelle pendant que `main` ne contient pas le produit : un nouveau développeur redéploierait le socle d'octobre.
- Les captures du manuel montrent « Collège Démo ECOM ». Les vérifier avant de les joindre à une offre.

### Charge

M.

### Critères d'acceptation

- Un établissement pilote du primaire ou du collège réalise une semaine d'usage sur la préproduction sans contournement non documenté.
- La page d'offre et le contrat citent les mêmes limites que ce rapport.
- `main`, la préproduction et la production sont au même SHA, ou l'écart est assumé et daté.
- Restauration témoin réussie dans les 30 derniers jours (date à consigner).

### Tests

Rejeu du parcours du lot 2, plus sécurité (compte d'une école A ne lit pas l'école B), plus export PDF/Excel ouverts dans LibreOffice.

### Livrables

Dossier de recette, offre, manuel fusionné, SHA unique, preuve de sauvegarde.

---

## Ordre

```
Lot 1  →  Lot 2  →  Lot 7 (offre scolaire + caisse)
              ↘
               Lot 3 (comptabilité)  →  complète l'offre si signée
               Lot 6 (paiements et SMS) en parallèle du lot 3, dès que les contrats existent
Lot 4 (RH / paie) après le point d'extension comptable
Lot 5 (université) seulement sur décision produit, après le lot 2
```

Le lot 7 peut commercialiser **sans** les lots 3, 4, 5 et 6, à condition que le contrat ne les promette pas. Le lot 3 sans le lot 4 ne doit pas être appelé « comptabilité 360° » : la paie en sera absente. Le lot 4 sans le point d'écriture du lot 3 produirait des bulletins non comptabilisés : acceptable seulement si c'est écrit.
