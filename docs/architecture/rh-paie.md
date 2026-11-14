# ARCHITECTURE — Gestion RH & Paie (module nouveau)

Statut : conception pour revue Cursor — **aucune migration exécutée**. Réutilise : `Teacher` (lien pédagogique), `SchoolMembership` (identité/accès), `Expense` (avances/frais), `AccountingEntry` H12 (intégration comptable), `AuditLog`, permissions fines.

## 1. Principe

`Employee` = dossier RH de tout salarié (enseignant **et** non-enseignant). `Teacher` reste la fiche pédagogique et **référence** un `Employee` (1:1 optionnel). Jamais de données RH dans `Teacher` (AUD-026 : pas de doublon d'affectation).

## 2. Modèles Prisma proposés

```prisma
model Employee {
  id String @id @default(cuid())
  schoolId String
  matricule String                        // unique par école
  firstName / lastName / birthDate / nationalId? / phone / email
  address / emergencyContact Json?
  kind EmployeeKind                       // TEACHING | NON_TEACHING
  teacherId String? @unique               // lien Teacher si enseignant
  userId String?                          // compte applicatif optionnel
  status EmployeeStatus                   // ACTIVE | SUSPENDED | EXITED
  hireDate DateTime / exitDate?
  contracts EmployeeContract[]
  leaves LeaveRequest[] / attendances StaffAttendance[]
  payslips Payslip[] / advances Advance[]
  documents DocumentLink[]                // pièces (CNI, diplômes…)
  @@unique([schoolId, matricule])
}

model EmployeeContract {
  id / employeeId / schoolId
  type ContractType                       // CDI | CDD | VACATION | STAGE | CONSULTANT
  startDate / endDate? / trialEndDate?
  position String / grade String?
  baseSalary Int                          // XOF, barème référencé
  hourlyRate Int?                         // vacations (AUD-031)
  status ContractStatus                   // DRAFT | ACTIVE | ENDED | RENEWED
  previousContractId String?              // chaîne renouvellement/promotion
}

model LeaveRequest {
  id / employeeId / schoolId
  type LeaveType                          // ANNUAL | SICK | MATERNITY | UNPAID | OTHER
  startDate / endDate / days Decimal
  status LeaveStatus                      // REQUESTED | APPROVED | REJECTED | CANCELLED
  decidedById? / decidedAt? / reason?
}

model LeaveBalance { employeeId / year Int / type LeaveType / accrued / taken } // solde calculé, @@unique(employeeId,year,type)

model StaffAttendance { id / employeeId / schoolId / date / status / checkIn? / checkOut? / sessionId? }
// présence personnel DISTINCTE de AttendanceRecord (élèves) — AUD-028

model PayrollRun {
  id / schoolId / exerciseId?             // rattachement compta
  period String                           // "2026-11"
  status PayrollStatus                    // DRAFT | COMPUTED | VALIDATED | PAID | POSTED
  computedAt / validatedById / paidAt?
  payslips Payslip[]
  entryId String? @unique                 // OD paie H12 — idempotence
  @@unique([schoolId, period])
}

model Payslip {
  id / payrollRunId / employeeId
  base Int / grossTotal Int / netTotal Int
  employerCharges Int / employeeCharges Int
  lines PayslipLine[]                     // détail calculé
  pdfRef? / issuedAt?
  @@unique([payrollRunId, employeeId])    // même mois 2× = 1 bulletin (AUD-029)
}

model PayslipLine { id / payslipId / kind LineKind / code / label / amount Int / order Int }
// LineKind : BASE | ALLOWANCE | OVERTIME | VACATION_HOURS | DEDUCTION | CHARGE_EE | CHARGE_ER | ADVANCE_RECOVERY

model SalaryComponent {                   // barème versionné, JAMAIS de taux codés en dur
  id / schoolId? (null=global) / code / label / kind
  formula Json                            // {type:"percent_of",base:"GROSS",rate:0.036}
  effectiveFrom / effectiveTo?            // versioning barème CNSS etc.
}

model Advance { id / employeeId / amount / grantedAt / status / recoveries AdvanceRecovery[] }
```

## 3. Flux métier

1. **Paie mensuelle** : `createPayrollRun(period)` → `computeRun` : pour chaque `Employee` ACTIVE avec contrat couvrant la période → base + primes (`SalaryComponent` actifs) + vacations (`hourlyRate × CourseSession` validées, AUD-031) − retenues/avances → `Payslip` snapshot. `VALIDATED` fige. `PAID` → paiement trésorerie.
2. **Intégration comptable** : `postPayrollEntry(run)` → une OD par run : D 661/662/664 (charges) / C 422 personnel, 43x CNSS, 44x impôts — mappings `AccountingAccountMap` clés `PAYROLL:*`. `entryId @unique` = idempotence (AUD-030).
3. **Congés** : demande → validation `hr.manage` → `LeaveBalance` décrémenté. Une absence élève ne touche jamais un solde (AUD-028).
4. **Alertes** : cron quotidien signale contrat `endDate` ≤ 30 j — une notification unique par contrat (AUD-027).

## 4. Permissions (nouvelles)

`hr.employees.read/manage`, `hr.contracts.manage`, `hr.leaves.read/manage`, `hr.attendance.manage`, `payroll.read/compute/validate/pay`, `payroll.export`. Rôles : `HR_MANAGER` (nouveau), `ADMIN_SCHOOL` (tout), enseignant **aveugle aux salaires** (AUD-029 — jamais `payroll.*`).

## 5. Dépendances & risques

- **Bloquant** : barème CNSS/impôts BF fourni par référent métier — **jamais de taux inventés** (AUD-029). `SalaryComponent.formula` versionnée absorbe les changements légaux.
- Intégration H12 : nécessite journal PAIE + comptes 6/4 — lot CG-1 avant RH-5.
- Migration additive : 10 modèles, aucune donnée existante modifiée.

## 6. Lots

| Lot | Contenu | Charge | CA |
|---|---|---|---|
| RH-1 | `Employee` + contrats + documents + matricule | 4 j | CRUD + isolation + historique |
| RH-2 | Congés + soldes + présences personnel | 3 j | cycle complet + non-régression élèves |
| RH-3 | `SalaryComponent` + `PayrollRun`/`Payslip` + bulletin PDF | 6 j | double run = 1 bulletin |
| RH-4 | Avances + récupération sur paie | 2 j | retenue ≤ net |
| RH-5 | OD paie → compta (après CG-1) | 2 j | OD équilibrée idempotente |
| RH-6 | Pilotage : effectifs, masse salariale, alertes contrats | 2 j | dashboard + alerte J-30 |
| RH-7 | Vacations enseignants | 2 j | taux × séances validées |
