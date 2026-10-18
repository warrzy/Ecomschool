# F2-E4 — Audit de compatibilité : primaire, collège et lycée (Burkina Faso)

**Date** : 18 octobre 2026 · **Périmètre** : structure scolaire, enseignants/matières, évaluations/bulletins, inscriptions/finances · **Méthode** : lecture seule du code, du schéma Prisma et de la base locale. Aucune modification, aucun test d'écriture nouveau.

**Principe de lecture de ce rapport** : une fonctionnalité n'est déclarée « opérationnelle » que si un service ou une action serveur l'écrit réellement en base. Un champ Prisma ou une page qui n'est jamais alimenté est classé « champ dormant ».

---

## 1. Matrice de compatibilité par cycle

| Capacité | Primaire CP1–CM2 | Collège 6e–3e | Lycée + séries | Groupe scolaire mixte |
|---|---|---|---|---|
| Niveaux du cycle | ✅ libres (Level.name + order) | ✅ | ✅ | ✅ |
| Périodes (trim./sem.) | ✅ TRIMESTER/SEMESTER par année | ✅ | ✅ | ✅ (un seul découpage par année) |
| Matières par niveau | ✅ LevelSubject | ✅ | ✅ | ✅ |
| Coefficients | ✅ par niveau + par classe | ✅ | ⚠️ par série via niveau éclaté | ✅ |
| Institut polyvalent | ✅ affectation wildcard | — | — | ✅ |
| Multi-enseignants par classe | ✅ | ✅ | ✅ | ✅ |
| Bulletin adapté | ✅ gabarit `primary` | ✅ gabarit `college` | ✅ gabarit `lycee` | ✅ par niveau |
| Règles de calcul par niveau | ✅ GradingPolicy | ✅ | ✅ | ✅ |
| Classement / mentions | ✅ (masqué au primaire) | ✅ | ✅ | ✅ |
| Décision du conseil | ✅ (texte, période) | ✅ | ✅ | ✅ |
| **Décision annuelle passage/redoublement** | ❌ champ jamais écrit | ❌ | ❌ | ❌ |
| **Entité « série » formalisée** | — | — | ⚠️ workaround seulement | ⚠️ |
| **Regroupement « cycle »** | — | — | — | ⚠️ absent (niveaux en liste plate) |
| **Passage d'année en masse** | ❌ | ❌ | ❌ | ❌ |
| Tarifs par classe/niveau | ✅ | ✅ | ✅ | ✅ |
| Import/export par classe | ✅ | ✅ | ✅ | ✅ |
| Réinscription multi-années | ✅ | ✅ | ✅ | ✅ |

**Verdict global : l'architecture est compatible avec les quatre profils.** Le cœur du modèle (niveaux libres, matières/coefficients par niveau, politiques de notation par année+niveau, gabarits de bulletins par niveau, tarifs par classe) est suffisamment générique pour couvrir les trois cycles sans nouvelle table. Deux vraies lacunes fonctionnelles : la **décision annuelle de passage/redoublement** (champ mort) et l'absence d'**outil de passage d'année en masse**.

---

## 2. Structure scolaire

### 2.1 Ce qui est implémenté

- **`School.type`** : `PRIMARY | MIDDLE | HIGH | MIXED | OTHER`, éditable dans Paramètres (`settings/page.tsx:10,89`). Champ purement déclaratif — il ne pilote aucun comportement (ni périodes, ni bulletins). **`MIXED` n'a donc pas besoin de logique spéciale : un même établissement contient tout.**
- **`School.schoolSystem`** : `TRIMESTER | SEMESTER | OTHER`, éditable en Paramètres (`schools.ts:278`) — valeur par défaut déclarative ; le découpage réel est choisi **à chaque création d'année**.
- **`Level`** : nom libre + `order` + statut ACTIVE/ARCHIVED (`classes.ts:24-34`). CP1…CM2, 6e…3e, 2nde…Tle : **aucun nom n'est codé en dur**. En base : niveaux démo « 6e », « 5e », « 4e » + nombreux niveaux de test créés librement — preuve de la généricité.
- **`Classroom`** : nom + `section` libre + `capacity` + `room` + headTeacher, rattachée à un `Level` et une `AcademicYear` (`classes.ts:77-150`).
- **`AcademicPeriodType` / `AcademicPeriod`** : à la création d'année, `SEMESTER` → 2 périodes auto, `TRIMESTER` → 3 périodes auto, `OTHER` → découpage manuel (`academic.ts:74-91`). Périodes verrouillables (`isLocked`), ordre `number` libre.
- **`School`** : `country="BF"`, `currency="XOF"`, `timezone="Africa/Ouagadougou"`, `locale="fr"` — déjà alignés sur le contexte burkinabè par défaut.

### 2.2 Ce qui n'existe pas

- **Pas d'entité `Cycle`** : les niveaux forment une liste plate triée par `order`. Pour un groupe scolaire mixte, l'écran `/app/levels` affichera CP1…Tle dans une seule liste — gérable par convention de nommage et par `order`, mais **aucun regroupement, filtre ou statistique par cycle**.
- **Pas d'entité `Serie`** : les séries de lycée (A, C, D…) ne sont pas modélisées. Deux workarounds :
  1. niveaux éclatés (« Terminale A », « Terminale C ») → coefficients de matières différenciés par série possibles via `LevelSubject` ;
  2. `Classroom.section` (texte libre) → la série est un libellé, sans coefficient propre.
- **`OTHER`** comme type de période accepte tout nombre de périodes mais n'a aucune logique de pondération particulière — les poids annuels restent configurables par `GradingPolicy.annualWeights`.

### 2.3 Éléments codés en dur

- **Aucun nom de niveau, de série ou de cycle n'est codé en dur** dans le modèle. Seuls les noms des **gabarits PDF** (`primary`/`college`/`lycee`/`standard`) et les deux découpages `SEMESTER`/`TRIMESTER` sont embarqués.
- Le gabarit PDF `lycee` active `showGroups` (regroupement de matières) — le libellé des groupes vient du payload, pas d'un enum.

---

## 3. Enseignants et matières

Tous les cas demandés sont couverts par deux tables complémentaires :

| Cas BF | Mécanisme | Preuve |
|---|---|---|
| **Instituteur polyvalent** (1 maître pour toute la classe) | `TeachingAssignment` avec `subjectId = NULL` → portée « toutes matières de la classe » + `Classroom.headTeacherId` | `schema.prisma:1312`, `teachers.ts:103-147` |
| **Professeur multi-classes** | plusieurs lignes `TeachingAssignment` (même teacher, classes différentes) | unique `[teacherId,classroomId,subjectId,academicYearId]` |
| **Plusieurs enseignants par classe** | `TeachingAssignment` multiples + `ClassroomSubject.teacherId` par matière | `schema.prisma:1278` |
| **Matières différentes par niveau** | `LevelSubject(levelId,subjectId,coefficient)` | `subjects.ts` |
| **Coefficients par niveau ou série** | coefficient sur `LevelSubject` **et** surcharge par classe sur `ClassroomSubject` | `subjects.ts:154-210` |
| **Coefficient par série de lycée** | via niveau éclaté (« Tle D » = Level) ou surcharge `ClassroomSubject` | workaround, pas d'entité série |
| **Emplois du temps** | `ScheduleEntry` par classe/enseignant — indépendant du cycle | `schedules.ts` |

**Point d'attention (rappel F2-E)** : les affectations de l'année précédente ne bloquent pas l'archivage d'un enseignant — l'historique reste affiché mais le décrochage n'est pas averti.

---

## 4. Évaluations et bulletins — le point le plus abouti du produit

### 4.1 Règles implémentées (vérifiables dans le code)

| Capacité | État | Preuve |
|---|---|---|
| Types d'évaluations | ✅ `AssessmentType` par école : code/nom/coefficient par défaut/ordre — totalement libres (Devoirs, Compositions, Oraux…) | `schema.prisma:1368`, `grading/assessments.ts` |
| Barèmes configurables | ✅ `Assessment.maxScore` par évaluation ; `GradingPolicy.maxScore/minScore` par année+niveau | `policy.ts:72-85` |
| Notes & statuts | ✅ ENTERED/MISSING/ABSENT/EXEMPT/CANCELLED avec politique par cas (`missingGradePolicy` etc.) | `calculation.ts` |
| Moyennes & coefficients | ✅ moyenne matière (somme pondérée des évaluations), moyenne générale (somme pondérée des matières), `annualWeights` par période | `results.ts` |
| Trimestres/semestres | ✅ découpage par année + `isLocked` (la saisie vérifie le verrou) | `grades.ts`, `academic.ts` |
| Classements | ✅ `computeRanks` avec `SHARED_RANK`/`DENSE_RANK`, rang général + `perSubjectRank` | `results.ts` |
| Mentions | ✅ seuils JSON libres par politique (« Bien:12;Très bien:14 »), versionnées | `policy.ts:32`, `grading-policy/page.tsx` |
| Politiques par niveau | ✅ `GradingPolicy(academicYearId, levelId?, version, DRAFT→ACTIVE→ARCHIVED)` — un lycée peut noter /20 avec seuil 10 pendant que le primaire de la même école utilise un autre barème | `policy.ts` entier |
| Appréciations | ✅ par matière (`updateSubjectAppreciation`) + générale + note prof principal + note direction + **signature horodatée** | `reportcards.ts:297-390` |
| Décision du conseil | ✅ `councilDecision` (texte libre, périodique) — correct pour le BF où la décision est collégiale | `reportcards.ts:369` |
| Bulletins PDF | ✅ génération, versioning (`ReportCardVersion`), publication, rectification | `reportcards.ts`, `pdf/report-card.ts` |
| **Gabarits PDF par cycle** | ✅ `primary` (sans rang ni coefficients, appréciations seules), `college` (+rang, coefficients, décision conseil), `lycee` (+points, groupes), `standard` | `pdf/report-card.ts:66-119,441-443` |
| **Gabarit par niveau** | ✅ `ReportCardTemplate.levelId` : `templateFor` résout niveau → défaut | `reportcards.ts:393-409` |

### 4.2 Champs dormants et règles manquantes

- ❌ **`StudentAnnualResult.decision` (passage/redoublement) : jamais écrit.** `computeAnnualResults` (`results.ts:485-506`) calcule moyenne/rang/mention mais laisse `decision` à `NULL` ; `/app/averages` affiche systématiquement « — » (ligne 346). Aucune action, aucun service ne renseigne le champ. **La fonction « décision de passage » du BF n'est pas livrée**, seule la décision de conseil **par période** existe.
- ❌ **Aucune régularisation automatique** : pas de règle « moyenne ≥ seuil → passage » suggérée — la décision serait à saisir manuellement, mais même la saisie n'existe pas.
- ⚠️ **`createAssessment` ne vérifie ni année `CLOSED` ni `period.isLocked`** (la saisie des notes, elle, vérifie le verrou) — incohérence déjà signalée en F2-E, particulièrement sensible au lycée où les compositions courent sur plusieurs semaines.
- ✅ **Bonne décision de design** : aucune règle burkinabè n'est inventée en dur (seuils, mentions, décisions : tout est en configuration ou en saisie manuelle).

### 4.3 Règles réglementaires BF — à confirmer avec le client, non implémentées (par conception)

Seuils officiels de passage par cycle, mentions réglementaires, coefficients officiels par série de lycée (Tle A vs Tle D), format officiel des bulletins, comptage des absences. **Tout est configurable manuellement** (politiques, gabarits), donc aucune évolution du code n'est bloquante — mais la fourniture de **préréglages par cycle** serait un vrai plus commercial (voir §7).

---

## 5. Inscriptions et finances

| Capacité | État | Mécanisme |
|---|---|---|
| Inscription par niveau/classe | ✅ | `enrollStudent` — la classe détermine le cycle automatiquement |
| Tarifs par classe | ✅ | `FeeTariff.levelId` **et** `FeeTariff.classroomId` (précision au niveau de la classe) + historisation |
| Tarifs par série | ⚠️ | via niveau éclaté ou `classroomId` — pas de notion de série |
| Import/export par classe | ✅ | `/app/enrollments/export`, `/app/students/export` + assistant d'import complet (F2-E) |
| Réinscriptions | ✅ | `transferStudent` + réinscription par année ; guichet F2-D |
| Créances par cycle | ✅ | `generateStudentCharges` cible les tarifs applicables (niveau/classe de l'inscription) — un groupe mixte applique automatiquement les bons tarifs |
| Multi-cycles simultanés | ✅ | rien dans le modèle ne restreint à un seul cycle ; `MIXED` est même un type explicite |

**Rappel F2-E non corrigé** : l'import+inscription ne génère pas les créances — valable pour tous les cycles.

---

## 6. Scénarios de recette — quatre établissements fictifs

### A. École primaire « Les Lauriers » — CP1 → CM2 (2 classes/niveau)

| Besoin | Réponse |
|---|---|
| 6 niveaux, 2 classes chacun | ✅ 12 Classroom sur 6 Level |
| Trimestres | ✅ `TRIMESTER` à la création d'année |
| Instituteur unique par classe | ✅ affectation wildcard + headTeacher |
| Matières primaires + coefficients | ✅ LevelSubject par niveau |
| Bulletin primaire sans rang | ✅ gabarit `primary` masquant rang/coefficients |
| Tarifs uniformes primaire | ✅ FeeTariff par niveau |
| Décision de passage en fin d'année | ❌ champ dormant — saisie impossible |
| **Verdict** | **~90 % couvert** ; fonctionnel dès aujourd'hui sauf la formalisation de la décision |

### B. Collège « Wend-Songré » — 6e → 3e

| Besoin | Réponse |
|---|---|
| 4 niveaux, professeurs par matière | ✅ TeachingAssignment par matière/classe |
| Trimestres | ✅ |
| Coefficients matières par niveau | ✅ |
| Bulletin avec rang + décision conseil | ✅ gabarit `college` |
| Plusieurs profs dans une classe | ✅ |
| **Verdict** | **~95 % couvert** — le cas le plus proche du périmètre actuel |

### C. Lycée « Naaba Koom » — 2nde A/C, 1re A/C/D, Tle A/C/D

| Besoin | Réponse |
|---|---|
| Séries | ⚠️ **workaround** : 7 niveaux éclatés (« Tle A »…) ou `Classroom.section` — fonctionnel mais pas de rapport « par série » ni de garde anti-typo sur le champ libre |
| Coefficients par série | ✅ si niveaux éclatés (Tle D ≠ Tle A) ; ⚠️ via section seule, impossible sans surcharge par classe |
| Bulletin lycée (points, groupes de matières) | ✅ gabarit `lycee` (`showGroups`, `showPoints`) |
| Moyenne pondérée annuelle par période | ✅ `annualWeights` |
| **Verdict** | **~80 % couvert** — réalisable mais la série reste informelle |

### D. Groupe scolaire « Wend-Panga » — primaire + collège + lycée (MIXED)

| Besoin | Réponse |
|---|---|
| Un seul établissement, 13 niveaux | ✅ `type=MIXED`, niveaux plats ordonnés |
| Barèmes différents par cycle | ✅ GradingPolicy par niveau (ex. /20 seuil 10 au collège, autre au primaire) |
| Bulletins différents par cycle | ✅ `ReportCardTemplate.levelId` — un gabarit par niveau |
| Périodicités différentes par cycle | ⚠️ **un seul découpage par année** : si le primaire veut des trimestres et le lycée des semestres, ce n'est **pas** possible dans la même `AcademicYear` — une seule périodicité par année |
| Tarifs différenciés par cycle | ✅ |
| **Verdict** | **~75 % couvert** — viable si tout le groupe adopte le même découpage ; sinon blocage fonctionnel |

---

## 7. Risques pour les notes et bulletins

1. **Décision annuelle jamais saisissable** → la clôture d'année produit des moyennes mais pas de « Admis/Redouble » — le passage se fait uniquement par réinscription manuelle, sans trace de la décision.
2. **Pas de passage d'année en masse** → en septembre, un groupe de 13 niveaux doit recréer classes + réinscrire ~500 élèves un par un (ou par import — qui lui ne génère pas les créances).
3. **Périodicité unique par année** → blocage réel pour un groupe scolaire mixte hétérogène (trimestres au primaire, semestres au lycée).
4. **`createAssessment` contourne le verrouillage** (année close / période verrouillée) → une composition peut encore être créée sur une période clôturée.
5. **Séries en champ libre** (`section` ou suffixe de niveau) → risque d'homonymes divergents (« Tle A », « Tle-A », « Terminale A ») cassant les filtres et regroupements.
6. **Archivage sans avertissement** (rappel F2-E) : niveau/classe/matière archivés alors qu'inscriptions, évaluations ou tarifs y sont rattachés.
7. **Pas de préréglages réglementaires** : chaque école reconfigure mentions, coefficients, gabarits — risque d'erreur de saisie à l'onboarding (ex. seuils de mention non conformes à l'usage local).

## 8. Paramétrage nécessaire à l'onboarding d'un établissement BF

Checklist qui **fonctionne dès aujourd'hui** (sans développement) :

1. Paramètres → `type` (PRIMARY/MIDDLE/HIGH/MIXED), `schoolSystem` par défaut.
2. Créer les `Level` du cycle avec `order` cohérent (CP1=1…Tle=13 pour un mixte).
3. Créer les `Classroom` par année (les classes **ne se reportent pas** d'une année à l'autre — à recréer).
4. `LevelSubject` : matières + coefficients par niveau.
5. `TeachingAssignment` : instituteur wildcard (primaire) ou par matière.
6. `GradingPolicy` par année+niveau : barème, seuil, mentions, poids annuels.
7. `AssessmentType` : types d'évaluations de l'école.
8. `ReportCardTemplate.levelId` : `primary`/`college`/`lycee` par niveau.
9. `FeeTariff` par niveau/classe → génération de créances correcte par cycle.
10. Année scolaire : `TRIMESTER` (usage le plus courant) + périodes verrouillées après conseil.

## 9. Corrections prioritaires avant commercialisation

| Priorité | Correction | Impact |
|---|---|---|
| **P0** | Rendre `StudentAnnualResult.decision` saisissable (action + UI, décision libre du conseil de fin d'année) | sans elle, la clôture d'année est incomplète sur les 4 scénarios |
| **P0** | Outil de « passage d'année » : recréation des classes de l'année N+1 + réinscription en masse guidée par la décision | indispensable à tout établissement multi-niveaux ; sinon ressaisie intégrale chaque septembre |
| **P1** | Entité `Series` (ou `level.series`) normalisée + coefficients par série | lycée correct sans workaround fragile |
| **P1** | Regroupement `cycle` sur `Level` (filtre + stats + template par cycle au lieu de par niveau) | groupe scolaire mixte lisible |
| **P1** | `createAssessment` : refuser année CLOSED + période verrouillée | cohérence avec la saisie des notes (F2-E) |
| **P1** | Import+inscription → génération des créances (F2-E/F3-A1) | le parcours « rentrée en masse » reste financièrement muet sinon |
| **P2** | Préréglages par cycle : jeux de `Level`, `AssessmentType`, `GradingPolicy`, gabarits et mentions types BF créés à l'onboarding | accélère le déploiement, réduit les erreurs — **à caler sur les usages réels clients, pas de règles inventées** |
| **P2** | `schoolSystem` par défaut repris dans le formulaire de création d'année | confort |

## 10. Lots minimaux proposés (sans implémentation)

- **F3-B1 — Décision de fin d'année** : action serveur + saisie sur `/app/averages` (Admis / Redouble / Exclu…, libre ou liste configurable) + affichage sur le bilan annuel. ~0,5 j.
- **F3-B2 — Passage d'année assisté** : assistant « Nouvelle année » : duplique niveaux/classes N → N+1, propose les réinscriptions selon `decision`, génère les créances. ~2-3 j.
- **F3-B3 — Séries de lycée** : champ structuré `Series` rattaché au niveau (ou `Level.parentId` pour niveaux éclatés propres) + coefficients/filtres par série. ~1-2 j.
- **F3-B4 — Cycles groupés** : `Level.cycle` (enum libre PRIMARY/MIDDLE/HIGH) pour filtrer listes, stats et gabarits par cycle. ~1 j.
- **F3-B5 — Verrous cohérents** : `createAssessment` respecte CLOSED/isLocked + avertissements d'archivage (mutualisé avec F3-A2). ~0,5 j.
- **F3-B6 — Kit d'onboarding par cycle** : script/assistant créant le référentiel type (niveaux, matières, types d'éval, politique, gabarit) pour le cycle choisi — préréglages **validés par le client**. ~1-2 j.

---

## Annexes — preuves techniques

| Affirmation | Fichier : ligne |
|---|---|
| Types d'établissements éditables | `settings/page.tsx:10,89` |
| Périodicité par année | `services/academic.ts:74-91` |
| Niveaux libres + ordre | `services/classes.ts:24-34` |
| Affectation wildcard (instituteur) | `schema.prisma:1312` (subjectId optionnel), `teachers.ts:103-147` |
| Coefficients niveau/classe | `schema.prisma:1227,1278`, `subjects.ts` |
| Politique de notation par année+niveau, versionnée | `services/grading/policy.ts` |
| Gabarits PDF par cycle | `lib/pdf/report-card.ts:66-119,441-443` |
| Gabarit par niveau | `reportcards.ts:393-409` |
| Appréciations + décision conseil + signature | `reportcards.ts:297-390` |
| Calcul annuel sans décision | `results.ts:470-510` (champ `decision` absent de l'upsert) |
| `decision` affichée, jamais écrite | `averages/page.tsx:346` ; `grep -rln "decision" src/` → 2 fichiers en lecture seule |
| Aucun passage d'année en masse | `grep -rln "promotion\|rollover" src/` → 0 résultat |
| `createAssessment` sans test CLOSED/isLocked | `grading/assessments.ts` (F2-E) |
| Tarifs par niveau et classe | `schema.prisma` `FeeTariff.levelId/classroomId` |

**Périmètre respecté** : aucune modification de code, de base, de permissions, aucun déploiement. En attente du GO pour la suite.
