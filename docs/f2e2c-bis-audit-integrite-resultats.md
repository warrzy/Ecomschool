# F2-E2-C bis — Audit intégrité des résultats et bulletins après verrouillage

**Date :** 2026-10-21 · **Périmètre :** audit technique + reproduction locale (données de test uniquement) · **Aucune correction appliquée**

Release de référence : `20261021_195257` (commits `46454d1` + `8243aee`).

Script de reproduction : `scripts/f2e/integrite-resultats-audit.ts`
Résultat : **16 comportements à risque observés, 0 refus** sur le scénario cible.

---

## 1. Chaîne fonctionnelle auditée

```
saveGrades ──► computeAndStore ──► setValidationStatus ──► generateReportCard ──► PDF
 (notes)        (StudentPeriodResult    (ResultStatus          (ReportCardVersion      (snapshot
                 + SubjectPeriodResult   workflow)               .payload figé)          figé)
                 + ResultValidation)
computeAnnualResults ──► StudentAnnualResult
```

| Composant | Fichier | Verrou période | Année CLOSED |
|---|---|---|---|
| `saveGrades` | `src/lib/services/grading/grades.ts` | ✅ `LOCKED` | ❌ **absent** |
| `setAssessmentStatus` | `…/grading/assessments.ts` | ✅ (E2-C corrigé) | ✅ `YEAR_CLOSED` |
| `createAssessment` | `…/grading/assessments.ts` | ✅ | ✅ |
| **`computeAndStore`** | `…/grading/results.ts` | ❌ **absent** | ❌ **absent** |
| **`setValidationStatus`** | `…/grading/results.ts` | ❌ **absent** | ❌ **absent** |
| **`computeAnnualResults`** | `…/grading/results.ts` | n/a | ❌ **absent** |
| **`generateReportCard` / class** | `…/grading/reportcards.ts` | ❌ **absent** | ❌ **absent** |
| `updateResultAnnotations` / `updateSubjectAppreciation` | `…/grading/reportcards.ts` | ❌ absent | ❌ absent |
| `updatePeriod` (verrou) | `…/services/academic.ts` | — | ✅ `YEAR_CLOSED` |
| `closeYear` | `…/services/academic.ts` | ne verrouille **pas** les périodes | — |
| `setLevelCoefficient` / `setClassroomSubject` | `…/services/subjects.ts` | ❌ absent | ❌ absent |
| `enrollStudent` / `transferStudent` | `…/services/enrollments.ts` | ❌ absent | ✅ `YEAR_CLOSED` |

### Points d'entrée identifiés

- **UI `/app/averages`** → `computeResultsAction` (`grades.calculate`), `setValidationStatusAction` (`results.validate` / `results.publish`), `computeAnnualAction` (`grades.calculate`).
- **UI `/app/report-cards`** → génération/rectification (`reportcards.generate`, `reportcards.validate`), annotations (`results.validate`).
- **UI `/app/grades/[id]`** → `saveGradesAction`, `setAssessmentStatusAction` ; **route d'import de notes** `grades/[id]/import/commit` → `saveGrades` (mêmes gardes).
- **UI `/app/academic-years/…/periods`** → `updatePeriodAction` (verrouillage/déverrouillage).
- **Portails élève/parent** : routes PDF en lecture seule, filtrées `PUBLISHED`/`RECTIFIED`.
- **Aucun appel automatisé** (cron) au moteur de calcul — `src/app/api/cron` ne touche pas aux résultats.

### Architecture des bulletins (point positif)

Les bulletins sont **des documents figés** : `ReportCardVersion.payload` stocke le
snapshot complet ; chaque régénération crée une **nouvelle version historisée**
(motif, auteur, horodatage) ; un bulletin `PUBLISHED` régénéré passe `RECTIFIED`.
Les PDF (admin + portails) rendent **la dernière version du payload**, jamais les
données live. La traçabilité des versions est saine — le risque porte sur la
divergence silencieuse entre versions et entre résultats stockés et payload émis.

---

## 2. Risques reproduits localement

### P0 — Recalcul non protégé sur période verrouillée (R1, R1b)

- **Fonction :** `computeAndStore` — `src/lib/services/grading/results.ts`
- **Entrée :** `/app/averages` → `computeResultsAction` (permission `grades.calculate`)
- **Protection :** aucune — ni `isLocked`, ni statut d'année.
- **Reproduction :** période T1 calculée → validée → publiée → bulletins v1 →
  `updatePeriod isLocked:true` → `computeAndStore` **réussit**.
- **Impact :** chaque `StudentPeriodResult` est upserté **et rétrogradé
  `PUBLISHED → CALCULATED`** (results.ts:309) alors que `ReportCard.status` reste
  `PUBLISHED`. Résultat : le parent voit le bulletin publié figé (v1) tandis que
  l'administrateur voit des résultats « recalculés » potentiellement différents —
  **désynchronisation silencieuse**. Les valeurs précédentes sont écrasées sans
  versionning (seul `computedAt`/`computedById` + audit `results.compute`
  subsistent ; aucun historique des anciennes moyennes).

### P0 — Saisie de notes sur année `CLOSED` (R7)

- **Fonction :** `saveGrades` — `src/lib/services/grading/grades.ts`
- **Entrée :** `/app/grades/[id]` + route d'import de notes.
- **Protection :** `isLocked` seulement — **pas de contrôle `academicYear.status`**.
- **Reproduction :** année CLOSED + évaluation `OPEN` + période non verrouillée →
  `saveGrades` **écrit la note**.
- **Impact :** des notes d'une année historique sont modifiables ; combiné à R8,
  les moyennes de l'année close peuvent diverger des bulletins émis. La faille
  est structurelle : `closeYear` ne verrouille pas les périodes et `updatePeriod`
  refuse toute modification post-clôture — **une période oubliée non verrouillée
  le reste définitivement**.

### P1 — Workflow de validation réversible sur période verrouillée (R3, R3b)

- **Fonction :** `setValidationStatus` — `results.ts`
- **Entrée :** `/app/averages` (`results.validate`, `grades.calculate`).
- **Reproduction :** `VALIDATED → CALCULATED` et `CALCULATED → DRAFT`
  **acceptés** sur période verrouillée ; `updateMany` rétrograde aussi tous les
  `StudentPeriodResult` et `ReportCard` associés.
- **Impact :** dé-validation administrative sur période figée ; combiné à R1,
  permet de réécrire complètement une période « verrouillée ».
- **Note :** `VALIDATED → PUBLISHED` doit rester permise (diffusion, même
  sémantique que `VALIDATED → PUBLISHED` sur évaluation — décision E2-C).

### P1 — Recalculs sur année `CLOSED` (R6, R8)

- **Fonctions :** `computeAnnualResults`, `computeAndStore` — `results.ts`
- **Reproduction :** les deux réussissent sur année `CLOSED` et upsertent
  `StudentAnnualResult` / `StudentPeriodResult` en écrasant les valeurs.
- **Impact :** historique annuel réécrivable après clôture.

### P1 — Régénération de bulletin avec valeurs divergentes (R2b)

- **Fonction :** `generateReportCard` — `reportcards.ts`
- **Reproduction :** après verrouillage + modification de coefficient + recalcul,
  la régénération produit **v2 = 10,67 vs v1 = 11,33** sur la même période.
- **Impact :** mitigé par le versionning (v1 conservée, statut → RECTIFIED,
  motif obligatoire pour `rectify`) — mais `generateReportCardAction` accepte un
  `reason` **optionnel** et aucune garde n'empêche la régénération post-verrou.
  Le bulletin émis aux parents reste v1 tant que le statut n'est pas republié —
  divergence silencieuse entre v1 servie et résultats stockés.

### P2 — Coefficients modifiables post-verrouillage (R2)

- **Fonctions :** `setLevelCoefficient`, `setClassroomSubject`,
  `removeLevelCoefficient` — `subjects.ts` ; règles de notation — `policy.ts`
- **Constat :** aucune conscience des périodes. En soi légitime (référentiel
  transversal), mais **amplificateur** de R1 : un recalcul post-verrouillage
  absorbe silencieusement les nouveaux coefficients/règles.
- **Impact :** nul si le recalcul est bloqué ; pas de correctif dédié requis.

### P2 — Annotations modifiables post-verrouillage (R4)

- **Fonctions :** `updateResultAnnotations`, `updateSubjectAppreciation`.
- **Reproduction :** appréciation générale modifiée sur résultat de période
  verrouillée.
- **Impact :** ne touche pas les moyennes ; la signature de direction
  (`sign:true`) reste horodatée. Risque faible — les annotations apparaîtraient
  dans une éventuelle version suivante du bulletin.

### P2 — Inscription dans une classe à période verrouillée (R5, R5b)

- **Fonction :** `enrollStudent` — `enrollments.ts`
- **Reproduction :** nouvel élève inscrit → le recalcul post-verrouillage
  **injecte** une ligne de résultat dans la période figée.
- **Impact :** amplifier de R1 ; bloquer l'inscription serait métier-faux
  (un élève peut rejoindre une classe en cours d'année) — le verrou doit
  porter sur le recalcul.

### Constat annexe (R9) — état de verrou figé à la clôture

`updatePeriod` refuse toute modification sur année `CLOSED` (contrôle sain),
mais `closeYear` ne verrouille pas les périodes : **une période non verrouillée
au moment de la clôture reste déverrouillée à jamais**, laissant R7/R8 ouverts.
Le bilan de pré-clôture (E2-C) la signale déjà en avertissement — non bloquant.

---

## 3. Cohérence des bulletins — synthèse

| Question | Réponse |
|---|---|
| Documents figés ? | ✅ Oui — `ReportCardVersion.payload` snapshot complet, versionné |
| Un bulletin émis peut-il afficher d'autres valeurs ? | ⚠️ Seulement via une **nouvelle version** (historisée + statut RECTIFIED) — la v1 publiée reste servie aux portails |
| Date/version/trace ? | ✅ `version`, `createdById`, `reason`, audit `reportcard.generate/.rectify` |
| Recalcul remplace-t-il les données ? | ❌ **Oui, silencieusement** — `StudentPeriodResult`/`SubjectPeriodResult` écrasés sans versionning ni historique des anciennes valeurs |
| Bulletins publiés cohérents avec résultats stockés ? | ❌ **Non garanti** — R1b : résultat rétrogradé CALCULATED pendant que le bulletin reste PUBLISHED |

---

## 4. Correctif minimal proposé (non implémenté — en attente de GO)

Principe : **un seul garde-fou réutilisé**, sans refonte du moteur de calcul —
le verrou de période fige les *données calculées*, pas la diffusion ni la
consultation.

### Gardes à ajouter dans `results.ts` / `grades.ts` / `reportcards.ts`

| Fonction | Règle proposée |
|---|---|
| `computeAndStore` | période `isLocked` → `PERIOD_LOCKED` ; année `CLOSED` → `YEAR_CLOSED` |
| `setValidationStatus` | période verrouillée → **seul `VALIDATED → PUBLISHED` permis** (miroir de la règle `setAssessmentStatus` corrigée en E2-C) ; année `CLOSED` → `YEAR_CLOSED` pour toute transition |
| `computeAnnualResults` | année `CLOSED` → `YEAR_CLOSED` |
| `saveGrades` | année `CLOSED` → `YEAR_CLOSED` (complète le contrôle `isLocked` existant) |
| `generateReportCard` / `generateClassReportCards` | période verrouillée ou année close → exiger le passage par `rectifyReportCard` avec motif obligatoire (la régénération reste possible, tracée, en nouvelle version) |

### Explicitement hors correctif

- Coefficients, règles de notation, inscriptions : inchangés — l'effet indirect
  disparaît dès que le recalcul est verrouillé.
- Annotations/appréciations : inchangées (P2, documenté ; une éventuelle durcissement
  pourrait exiger la rectification — à trancher).
- `closeYear` : inchangé ; le bilan de pré-clôture signale déjà les périodes
  non verrouillées (option future : verrouiller les périodes à la clôture — à
  décider séparément, modifie le workflow).
- Aucun changement Prisma, aucune migration, aucun recalcul préprod.

### Codes d'erreur

Réutiliser `PERIOD_LOCKED` et `YEAR_CLOSED` (déjà dans `errorLabels` — aucun
changement UI requis, les actions affichent `?error=`).

### Tests de non-régression à ajouter à la recette

- Recalcul sur période ouverte : OK (inchangé).
- Recalcul sur période verrouillée : `PERIOD_LOCKED`, résultats inchangés.
- `VALIDATED → PUBLISHED` sur verrouillée : OK ; `VALIDATED → CALCULATED` /
  `CALCULATED → DRAFT` : `PERIOD_LOCKED`, statuts inchangés.
- `computeAnnualResults` et `computeAndStore` sur année close : `YEAR_CLOSED`.
- `saveGrades` sur année close : `YEAR_CLOSED`.
- Génération de bulletin sur période ouverte : OK ; rectification avec motif
  sur verrouillée : OK (nouvelle version).
- Replay complet de la recette référentiels (54 PASS actuels) + F2-E1 + F2-D.
