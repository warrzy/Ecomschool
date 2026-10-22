# Préparation G2 — Admissions et inscriptions en ligne

> Document de cadrage technique — aucun code, aucune migration réalisée.
> Statut : en attente du GO développement.

## 1. Arbitrage G1 / G2 / G3 — classement argumenté

| Critère | G1 Notifications externes | **G2 Admissions en ligne** | G3 Mobile Money |
|---|---|---|---|
| Valeur commerciale | Forte (quotidien) | **Très forte** (porte d'entrée de la rentrée) | Forte |
| Avantage concurrentiel | Moyen (Major/EduX l'ont) | **Fort** (suivi parent en ligne rarement documenté chez les concurrents locaux) | Fort en BF |
| Réutilisation du code | Excellente (comm/ prête) | **Excellente** (registration.ts, enrollments, fees, permissions, audit, notifications internes) | Moyenne |
| Dépendances techniques | Provider SMS/WhatsApp payant pour l'effet réel | **Aucune externe** | Agrégateur payant + conformité |
| Coûts externes | Obligatoires dès la mise en prod | **Zéro** | Obligatoires |
| Démonstration sans service payant | Partielle (DRY_RUN = faux envois) | **Complète** | Dégradée (manuel ≠ automatisé) |
| Risques | Coûts, deliverability, consentement | Upload de fichiers (nouvelle brique) | Réconciliation, erreurs financières |
| Effort | M | **L** (mais découplable en sous-lots) | M-L |

### Verdict : **G2 d'abord** — hypothèse confirmée

- G2 est **entièrement livrable sans service payant** ; G1 et G3 ne réalisent leur valeur qu'avec des contrats externes.
- G2 touche **tous les établissements à chaque rentrée** et alimente directement le cœur de métier (élèves → créances → encaissements déjà livrés).
- G2 introduit deux briques fondatrices — **stockage documentaire** et **interaction parent** — dont G1 (reçus) et H1 (portail interactif) bénéficieront ensuite.
- G1 reste le lot n°2 : sa valeur réelle dépend du contrat provider, décision commerciale à paralléliser pendant le développement de G2.

## 2. Périmètre fonctionnel G2

### 2.1 Parcours public (sans compte)

```
/inscription/{schoolSlug} (ou code école)
  → formulaire candidature : enfant(s), année ciblée, niveau/classe souhaité,
    coordonnées du responsable, pièces justificatives
  → numéro de dossier unique + code de suivi
  → page publique de suivi : statut + demandes de compléments
```

- **Multi-enfants** : une demande « dossier famille » contenant N candidatures liées au même responsable.
- **Ciblage pédagogique** : année scolaire ouverte + niveau + classe souhaitée (ou filière pour instituts — champ texte libre si pas de classe adaptée).
- **Pièces** : extrait de naissance, carnet/bulletins antérieurs, photo — configuration par école (liste des pièces exigées optionnelles).
- **Anti-abus** : honeypot + throttle IP + anti-doublon (nom+naissance+année) — pattern `SchoolSignupRequest` éprouvé.
- **Frais de candidature** : si l'école configure une `FeeCategory` CANDIDATURE → affichée comme « à régler au dépôt/guichet » en v1 ; paiement en ligne = point d'extension G3 (pas de faux MoMo).

### 2.2 Instruction (back-office `/app/admissions`)

| Écran | Contenu |
|---|---|
| File de candidatures | filtres année/niveau/statut/recherche, pagination |
| Fiche dossier | candidature, pièces consultables en ligne, notes d'instruction |
| Actions | demander complément, convoquer test/entretien (date + note facultative), mettre en liste d'attente, **admettre / refuser motivé / admis sous condition** |
| Décisions | historique horodaté + acteur (AuditLog) — refus **exige un motif** |

### 2.3 Conversion

```
ADMITTED → conversion (transaction unique) :
  Student (ou rapprochement élève existant via findPotentialDuplicates)
  + Guardian (+ StudentGuardian) ou rattachement tuteur existant
  + Enrollment (classe confirmée par l'école, peut différer du souhait)
  + StudentFeeCharge via generateStudentCharges (existant, idempotent)
  → statut CONVERTED, lien d'invitation portail parent proposé
```

**Règle d'or** : la conversion réutilise `registration.ts` / `enrollments.ts` / `accounts.ts` — **aucune duplication** de création élève/inscription/créances.

### 2.4 Réinscription en ligne (phase 2 du lot)

- Depuis `/parent` : bouton « Réinscrire pour l'année N+1 » → déclaration d'intention (`REENROLLMENT_REQUEST`) → validation administrative (file `/app/admissions?type=reinscription`, validation unitaire **et en masse**) → `Enrollment` via services existants.
- Campagne : l'école ouvre/ferme une fenêtre de réinscription par année.

### 2.5 Adaptation par type d'établissement

- **Maternelle/primaire** : pièces simplifiées, pas de test d'admission typique.
- **Collège/lycée** : test/entretien optionnel, série/bac français pour lycée technique.
- **Institut** : champ « formation visée » libre ou lié au niveau.
- **Université** : le modèle `AdmissionApplication` reste compatible (programme texte) ; le LMD complet reste un lot ultérieur — l'architecture n'exclut pas le supérieur.

## 3. Stockage documentaire — architecture proposée

### 3.1 Choix : stockage privé filesystem VPS

```
/var/www/ecomschool-shared/uploads/{schoolId}/{documentId}.{ext}
```

- Hors racine web, servi **uniquement** via routes autorisées : `GET /app/documents/[id]` (permission + schoolId revérifiés) et `GET /candidatures/suivi?…` (preuve par code dossier+secret).
- Table `Document` : `schoolId, ownerType (ADMISSION|STUDENT|EXPENSE…), ownerId, kind, filename, mime, sizeBytes, sha256, storagePath, uploadedByIp|userId, status (ACTIVE/REPLACED/DELETED), replacedById, createdAt` — jamais de suppression physique v1 : `DELETED` = masqué + purge planifiée.

### 3.2 Sécurité

| Contrôle | Mesure |
|---|---|
| Types acceptés | `image/jpeg`, `image/png`, `application/pdf` — vérification **par magic bytes**, pas par extension |
| Taille | ≤ 5 Mo/fichier, ≤ 5 pièces/candidature, quota école configurable (défaut 500 Mo) |
| Isolation | `schoolId` sur le Document + dans le chemin ; route refuse si mismatch |
| Malveillant | magic bytes + scan de structure PDF/image simple ; exécution impossible (jamais servi en `inline` pour HTML/SVG — `Content-Disposition: attachment` par défaut, `inline` seulement pour images/PDF sains) |
| Remplacement | nouvelle version `Document`, ancien → REPLACED (traçabilité) |
| Sauvegarde | inclus dans le backup rsync quotidien + inventaire dans le dump DB |
| Conservation | candidatures rejetées : pièces purgées après N jours (config, défaut 90) |
| Migration objet | `storagePath` abstrait → futur `StorageAdapter` (fs | s3) ; aucun service payant requis v1 |

### 3.3 Dépendances VPS

- Aucune : pas de démon, pas de service tiers. Espace disque à surveiller via `monitor.sh` existant.
- Ne touche ni `wendyam-finance` ni `tme-machinery` (répertoire dédié, quotas par école).

## 4. Intégration progressive — sans service payant

| Étape G2 | Livrable sans service | Extension future |
|---|---|---|
| Notification « dossier reçu » | page de suivi + code | SMS/WhatsApp via `comm/` quand provider actif |
| Demande de complément | statut + page suivi | notification externe (G1) |
| Décision admission | page suivi + imprimé PDF | message externe (G1) |
| Frais de candidature | affiché, réglé au guichet → reçu existant | paiement en ligne (G3) |
| Invitation portail parent | lien `/invite/[token]` existant | envoi automatique (G1) |

**Point d'extension explicite** : un `AdmissionNotifier` interne émet des événements ; aujourd'hui → `Notification` interne + page de suivi, demain → canal externe sans refactor métier.

## 5. Modèle conceptuel (à implémenter au GO)

```
School (existant)
 └ AdmissionCampaign { schoolId, academicYearId, opensAt, closesAt, status }
    └ AdmissionApplication { schoolId, campaignId, trackingCode unique,
         applicantName/phone/email (responsable), status:
         SUBMITTED|UNDER_REVIEW|DOCS_REQUESTED|TEST_SCHEDULED|
         WAITLISTED|ADMITTED|ADMITTED_CONDITIONAL|REJECTED|CONVERTED|WITHDRAWN,
         decisionReason?, decidedById?, decidedAt?,
         studentId?, guardianId?, enrollmentId? (liens post-conversion) }
       ├ AdmissionItem { applicationId, childFirst/LastName, birthDate,
       │    targetLevelId?, targetClassroomId?, note }
       ├ AdmissionDocument → Document
       ├ AdmissionEvent { status transition, actor, note, at }  (timeline)
       └ AdmissionMessage (demande complément / note, visible au suivi)
```

Réutilise : `Student`, `Guardian`, `StudentGuardian`, `Enrollment`, `Level`, `Classroom`, `AcademicYear`, `FeeCategory` (CANDIDATURE), `Notification`, `AuditLog`.

Permissions proposées (à bootstrapper comme `expenses.*`/`treasury.read`) :
`admissions.read`, `admissions.review`, `admissions.decide`, `admissions.manage`, `documents.read` — `ADMIN_SCHOOL`+`FINANCE_MANAGER`? **Non** : admissions = scolarité → `ADMIN_SCHOOL` + nouveau profil possible ; CASHIER exclu. À arrêter au cadrage du lot.

## 6. Critères d'acceptation

1. Un parent anonyme dépose une candidature complète avec pièces et obtient un code de suivi fonctionnel.
2. L'admin instruit : complément → test → décision motivée tracée.
3. La conversion crée élève + tuteur + inscription + créances en **une seule transaction**, idempotente (double-clic = même résultat).
4. Rapprochement élève existant via détection doublons existante — jamais de Student en double.
5. Aucun accès inter-écoles aux dossiers ni aux fichiers (tests IDOR).
6. Fichiers : magic bytes vérifiés, > 5 Mo refusé, remplacement versionné.
7. Réinscription : parent déclare, école valide en masse, `Enrollment` via services existants.
8. Recettes : service + UI + isolation + volume ; non-régressions F2-D/F3.
9. Aucun envoi externe, aucun paiement simulé présenté comme réel.
10. Zéro impact sur wendyam-finance / tme-machinery.

## 7. Sous-lots proposés

| Sous-lot | Contenu | Effort |
|---|---|---|
| **G2-A** | Documents : modèle `Document`, stockage privé, routes autorisées, quotas, magic bytes — brique transversale | M |
| **G2-B** | Candidature publique : campagne, formulaire, dossier+suivi, pièces jointes via G2-A | M |
| **G2-C** | Instruction : file, fiche, compléments, tests, liste d'attente, décisions motivées | M |
| **G2-D** | Conversion : transaction complète + rapprochement + invitation portail | M |
| **G2-E** | Réinscription en ligne : déclaration parent + validation en masse | S-M |

Chaque sous-lot livrable et testable seul ; G2-A pose la fondation documentaire réutilisable (fiches élèves, pièces de dépenses, factures scannées).
