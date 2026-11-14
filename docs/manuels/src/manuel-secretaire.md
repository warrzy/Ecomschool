<!-- title: Manuel Secrétariat et Scolarité -->
# Manuel secrétariat et scolarité

Votre périmètre : la vie administrative des élèves — fiches, parents,
inscriptions, admissions, absences, demandes des familles.
Vous n'avez **pas** accès aux finances ni à la comptabilité (cloisonnement
volontaire — les montants relèvent du responsable financier).

## 1. Votre espace

Après connexion, l'espace `/app` affiche uniquement vos sections :
Pilotage (notifications), Établissement (lecture), Pédagogie et
Administration (demandes).

![Liste des élèves](captures/secretaire-eleves.png)

## 2. Gérer les élèves

**Menu :** Pédagogie → Élèves (`/app/students`)
Permissions : `perm:student.read` · `perm:student.create` · `perm:student.manage`

**Créer une fiche élève :**

1. Cliquez sur **Nouvel élève**.
2. Renseignez nom, prénom, **matricule** (unique, ex. `E-015`), date de
   naissance, sexe.
3. Enregistrez : la fiche est consultable immédiatement ; l'élève n'est
   pas encore inscrit à une classe (voir §4).

**Import en masse** — `/app/students/import` :

1. Préparez un fichier CSV/Excel (colonnes indiquées à l'écran).
2. Chargez le fichier → l'assistant **analyse et affiche les erreurs**
   (doublons de matricule, colonnes manquantes).
3. Corrigez ou validez : **rien n'est enregistré avant votre
   confirmation** — un import peut être annulé sans dommage.

## 3. Gérer les responsables (parents)

**Menu :** Pédagogie → Parents (`/app/guardians`)
Permissions : `perm:guardian.read` · `perm:guardian.manage`

![Responsables](captures/secretaire-parents.png)

Une fiche responsable porte l'identité et les coordonnées. Deux points
clés :

- **Rattacher un élève** : lien élève ↔ responsable avec la relation
  (père, mère, tuteur). C'est ce lien qui alimente le portail parent.
- **Compte portail** : un responsable doté d'un compte utilisateur
  (rôle PARENT) suit ses enfants depuis `/parent` — le rattachement au
  compte se fait ici.

## 4. Inscrire les élèves

**Menu :** Pédagogie → Inscriptions scolaires (`/app/enrollments`)
Permissions : `perm:enrollment.read` · `perm:enrollment.create`

![Inscriptions](captures/secretaire-inscriptions.png)

1. Cliquez sur **Inscrire** : choisissez l'élève puis la classe.
2. Validez : l'inscription apparaît dans la liste avec le statut
   `ENROLLED`.
3. **Automatisme** : la créance de scolarité est générée par le système
   d'après la grille tarifaire — vous n'avez rien à saisir, le
   responsable financier la voit de son côté.

> [!WARN]
> Inscrire deux fois le même élève dans la même année est impossible :
> le système le refuse — c'est une protection, pas un bug.

## 5. Admissions et réinscriptions

**Menus :** Pédagogie → Admissions, Réinscriptions
Permissions : `perm:admissions.read` · `perm:admissions.review` · `perm:admissions.decide` · `perm:reenrollments.read` · `perm:reenrollments.review`

![Admissions](captures/secretaire-admissions.png)

- **Admissions** : candidatures reçues via le formulaire public de
  l'école. Examinez chaque dossier (pièces jointes vérifiées), passez en
  revue puis **décidez** ; un candidat admis se **convertit en élève**
  en un clic.
- **Réinscriptions** : demandes de réinscription soumises par les
  parents depuis leur portail. Examinez, validez ou refusez avec motif.

## 6. Absences et retards

**Menu :** Pédagogie → Absences & retards (`/app/attendance`)
Permissions : `perm:attendance.read` · `perm:attendance.manage`

![Absences](captures/secretaire-absences.png)

- **Vue journalière** : les absences/remarques du jour par classe.
- **Appel journalier** : marquez un élève absent ou en retard (motif,
  durée) — l'information remonte au portail parent en temps réel.
- **Justifier** : enregistrez le justificatif apporté par la famille —
  la justification est horodatée avec votre nom.

## 7. Demandes des familles

**Menu :** Administration → Demandes parents (`/app/demandes`)
Permission : `perm:administrative-requests.manage`

![Demandes](captures/secretaire-demandes.png)

File des demandes soumises par les parents (attestations, documents,
rendez-vous…). Chaque demande a un statut — prenez-la en charge,
répondez, clôturez. Le parent suit l'avancement depuis son portail.

## 8. Ce que vous ne pouvez pas faire (et c'est normal)

| Action tentée | Résultat | Qui peut |
|---|---|---|
| Ouvrir `/app/fees` | 403 | Responsable financier, caissier |
| Ouvrir `/app/comptabilite` | 403 | Comptable |
| Ouvrir `/app/rh` | 403 | RH |
| Publier des notes | 403 | Enseignant/admin selon règles |
