# REVUE ARCHITECTURE — RH & Paie

Document revu : `docs/architecture/rh-paie.md`. Référence : `main` = `ec62b59`.

## Points validés

| Exigence | Constat | Preuve |
|---|---|---|
| Séparation Employee/Teacher | ✅ `teacherId @unique` 1:1 optionnel ; Teacher reste pédagogique | `Teacher` (:810) existe avec lien `User` — pas de duplication de personne |
| Multi-établissements | ✅ `schoolId` partout + `@@unique([schoolId,matricule])` | conforme pattern tenant |
| Historisation | ✅ contrats chaînés (`previousContractId`), barème versionné (`effectiveFrom/To`), bulletins snapshot | — |
| Pas de taux codés en dur | ✅ `SalaryComponent.formula Json` + source métier externe | conforme AUD-029 |
| Idempotence paie | ✅ `@@unique([schoolId,period])` + `@@unique([payrollRunId,employeeId])` + `entryId @unique` | double run = 1 bulletin (AUD-030) |
| Confidentialité | ✅ `payroll.*` jamais accordé aux enseignants | règle explicite doc §4 |
| Présences personnel ≠ élèves | ✅ `StaffAttendance` distinct de `AttendanceRecord` | AUD-028 |

## Anomalies identifiées

| # | Criticité | Anomalie | Correction |
|---|---|---|---|
| RH-A | **P1** | **Pas de flux d'annulation/rectification** : `PayrollStatus` s'arrête à `POSTED` ; un bulletin émis ne peut pas être corrigé | Ajouter `CORRECTED`/`CANCELLED` + run rectificatif `rectifiesRunId` (contre-passation OD, bulletin d'annulation) |
| RH-B | **P1** | `formula Json` non typé : `{percent_of:GROSS}` — quelles bases autorisées (BASE/GROSS/BRUT_IMP/NET) ? Quel ordre de calcul (primes → charges → avances) ? | Spécifier grammaire : `{"type":"fixed"|"percent"|"rate_x_qty", "base":"BASE|GROSS|TAXABLE", "rate":n}` + pipeline ordonné documenté |
| RH-C | **P1** | Vacations : `hourlyRate × CourseSession` — dépendance non vérifiée : les séances doivent avoir un statut « assurée/validée » | Confirmer champ de validation sur `CourseSession`/`TeachingAssignment` avant RH-7 |
| RH-D | P2 | Sortie salarié : `Employee.exited` ne désactive pas `SchoolMembership`/`User` | Règle : `status=EXITED` → révocation accès applicatif dans la même transaction |
| RH-E | P2 | Avenants non modélisés : un avenant = contrat lié ou simple nouveau `EmployeeContract` ? | Préciser : avenant = nouveau contrat `type` identique avec `previousContractId`, ou champ `amendsContractId` |
| RH-F | P2 | Avance : `AdvanceRecovery` mentionné, pas modélisé | Ajouter le modèle ou expliciter récupération via `PayslipLine ADVANCE_RECOVERY` |
| RH-G | P3 | `hr.manage` permet à un RH de voir les salaires — souhaité ? | Distinguer `hr.employees.manage` (dossiers) de `payroll.read` (rémunérations) — déjà séparé, préciser la matrice par rôle |

## DÉCISION : **GO SOUS RÉSERVES**

Spécifier RH-A (rectification), RH-B (grammaire formules), RH-D (sortie) dans le document avant RH-1. RH-C avant RH-7. Barème BF externe obligatoire — aucun taux inventé.
