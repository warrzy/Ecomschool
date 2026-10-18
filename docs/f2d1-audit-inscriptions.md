# F2-D1 — Audit du parcours d'inscription (lecture seule)

Date : 2026-10-18 — Aucune modification de code, de données ou de permissions.

## 1. Fonctionnement actuel

### 1.1 Fiche élève

| Élément | État |
|---|---|
| Écran | `/app/students` — garde `student.read` |
| Recherche | `q` serveur : matricule, prénom, nom — insensible casse, paginée (20/page) |
| Création | `createStudentAction` → `student.manage` ; champs : matricule*, nom*, prénom*, sexe, naissance, lieu, téléphone, email, adresse, photo |
| Fiche | `/app/students/[id]` — identité, tuteurs, historique des inscriptions |
| Matricule | **saisi manuellement**, obligatoire, unique par école (`@@unique(schoolId, matricule)` → `MATRICULE_TAKEN`). Aucune génération automatique |
| Doublon identité | **aucun contrôle nom+naissance** — deux fiches du même enfant possibles si matricules différents |

### 1.2 Inscription (Enrollment)

| Élément | État |
|---|---|
| Écran | `/app/enrollments` — garde `enrollment.read` ; liste filtrable (année, classe, statut, recherche `q`), pagination |
| Action | `enrollStudentAction` → `enrollment.manage` |
| Règles `enrollStudent` | école bornée partout · `NO_CURRENT_YEAR` · `YEAR_CLOSED` · `CROSS_YEAR` · `ALREADY_ENROLLED` · quota `LIMIT_REACHED` · audit |
| Anti double-inscription | vérification applicative **+ index unique partiel en base** (un seul `ENROLLED` par élève/année — commentaire migration) |
| Réinscription | même action : un élève `ACTIVE` d'une année passée se réinscrit à l'année courante |
| Transfert / retrait | `transferStudent`, `closeEnrollment` — **même permission** `enrollment.manage`, avec `ConfirmPanel` |
| Gap | `student.status` lu mais **non contrôlé** : un élève `ARCHIVED` peut être inscrit |

### 1.3 Dossier financier et encaissement

| Élément | État |
|---|---|
| « Dossier » | **pas d'entité dédiée** — `getStudentAccount(studentId, yearId)` calcule charges + échéances + remises + paiements ; fonctionne même à zéro |
| Créances | `generateCharges` (action `finance.fees.manage`, page `/app/fees`) : tarifs obligatoires actifs × inscriptions `ENROLLED` ; **idempotent** via `@@unique(studentId, yearId, categoryId)` + P2002 ; garantit aussi les échéances manquantes |
| Déclenchement | **manuel, en masse** (année ou classe). Une inscription post-génération ne reçoit ses créances qu'à la relance — aucune génération par élève n'existe |
| Encaissement | `recordPayment` (`finance.payments.create`) : FIFO, sérialisable, idempotent, reçu immuable + numéro auto, **surpaiement bloqué** (F2-C) |
| Conséquence F2-C | un élève **sans créance** (solde 0) ne peut rien encaisser → `OVERPAYMENT` |
| Paiement facultatif | aucune obligation de paiement à l'inscription — conforme au besoin |

### 1.4 Parents

`/app/guardians` + `guardian.*` (module `STUDENTS`) — création et rattachement existent (`StudentGuardian`, unique élève+tuteur+relation).

## 2. Capacités réutilisables (aucun développement métier nécessaire)

- `listStudents`/`createStudent`/`getStudent`, `listEnrollments`/`enrollStudent`/`transferStudent`
- `generateCharges` idempotent (ré-exécutable sans doublon), `getStudentAccount`, `recordPayment`, reçu PDF
- Recherche `q` déjà disponible sur élèves **et** inscriptions
- Audit natif sur toutes les actions

## 3. Ce qui bloque FINANCE_MANAGER et CASHIER

| Permission | ADMIN | FM | CASHIER | Action couverte |
|---|---|---|---|---|
| `student.read` | ✅ | ❌ | ❌ | liste + fiche élève |
| `student.manage` | ✅ | ❌ | ❌ | créer **+ modifier + archiver** |
| `enrollment.read` | ✅ | ❌ | ❌ | liste inscriptions |
| `enrollment.manage` | ✅ | ❌ | ❌ | inscrire **+ transférer + retirer** |
| `guardian.read/manage` | ✅ | ❌ | ❌ | parents |
| `classroom.read` | ✅ | ❌ | ❌ | lister les classes (nécessaire aux formulaires) |

Les pages existent déjà — seules les permissions rôle manquent.
**Côté abonnement** : `STUDENTS` est dans les 3 plans (Essentiel/Pro/Premium) → aucun blocage module ; `student.*`, `enrollment.*`, `guardian.*` → module `STUDENTS` dans la matrice V2.

## 4. Écarts entre l'existant et la matrice cible

| Besoin | Existant | Écart |
|---|---|---|
| Rechercher élève | `q` sur `/app/students` | FM/CASHIER sans `student.read` |
| Créer fiche élève | `student.manage` | permission trop large pour caissier (permet modifier/**archiver** = supprimer logiquement) |
| Inscrire/réinscrire | `enrollment.manage` | idem : permet aussi **transfert et retrait**, exclus de la cible caissier |
| Rattacher dossier financier | `getStudentAccount` auto | rien à faire — le dossier est virtuel |
| Générer les créances de l'élève | `generateCharges` **en masse** seulement | pas de génération par élève ; caissier hors `finance.fees.manage` (MGMT) ; **bloquant avant encaissement** (F2-C) |
| Encaisser + reçu | `recordPayment` + PDF | OK dès que des créances existent |
| Ne pas supprimer / pas de tarifs / pas d'annulation (caissier) | rôle CASHIER propre côté finance | à préserver en choisissant des permissions ciblées |

## 5. Risques de sécurité et de doublons

1. **Sur-attribution** : donner `student.manage`/`enrollment.manage` bruts aux profils financiers ouvre modification, archivage d'élève, transfert et retrait d'inscription — hors cible.
2. **Doublon élève** : seul le matricule est protégé ; même enfant, matricules différents → doublon silencieux (recherche `q` en amont + avertissement nom/date de naissance recommandé).
3. **Chaîne fonctionnelle** : encaisser exige des créances (solde > 0) ; le parcours « inscrire puis encaisser » impose une étape de génération par élève, sinon `OVERPAYMENT`.
4. **Données sensibles** : la fiche élève expose adresse/téléphone/naissance — limiter l'affichage aux données utiles au guichet financier.
5. **Élève archivé inscriptible** : absence de contrôle `status` dans `enrollStudent`.
6. **Concurrence** : création d'élève hors transaction avec l'inscription → orchestration à séquencer proprement.

## 6. Modifications minimales recommandées (F2-D2)

A. **Permissions** — deux options, à arbitrer :
   - *O1 (recommandée)* : nouvelles clés fines `student.create` et `enrollment.create` (+ `student.read`, `enrollment.read`, `classroom.read`) accordées à CASHIER et FINANCE_MANAGER. Aucune migration Prisma (table `Permission`), script bootstrap idempotent. Impact : zéro sur ADMIN.
   - *O2* : réutiliser `student.manage`/`enrollment.manage` — plus simple mais sur-attribue (archivage, retrait) → déconseillé pour CASHIER.
B. **Action d'orchestration** : `registerStudentAction` — transaction : créer/retrouver l'élève → inscrire (année courante, classe) → générer ses créances (réutilisation du code de `generateCharges` au périmètre élève, idempotent) → renvoyer vers le compte pour encaissement facultatif.
C. **Écran guichet** : entrée « Inscriptions » dans l'espace Finances (recherche → fiche allégée → inscription → compte → encaisser) ; avertissement de doublon potentiel (même nom+naissance).
D. **Durcissements** : contrôle `status=ACTIVE` dans `enrollStudent` ; champs affichés réduits pour les profils financiers.
E. **Optionnel** : rattachement tuteur (`guardian.*`) au parcours A.

## 7. Scénarios de recette F2-D2 (à préparer)

Caissier : recherche → création fiche → inscription → encaissement partiel + reçu · inscription sans paiement · tentative archivage/retrait refusée · FM idem + supervision · réinscription élève ancien · doublon matricule · doublon nom signalé · quotas · isolation écoles · Essentiel/Pro/Premium.
