<!-- title: Manuel Administrateur et Direction -->
# Manuel administrateur et direction

Ce manuel couvre l'intégralité de l'espace `/app` pour un administrateur
d'établissement : paramétrage, scolarité, pédagogie, finances,
administration. Chaque chapitre indique le **chemin exact dans les
menus**, la **permission requise** et le **résultat attendu**.

> [!NOTE]
> L'administrateur d'établissement dispose de toutes les permissions de
> l'école. Les autres profils ne voient qu'une partie de ces écrans —
> chaque manuel par profil détaille son périmètre.

## 1. Tableau de bord

**Menu :** Pilotage → Tableau de bord (`/app`)

![Tableau de bord](captures/admin-dashboard.png)

Le tableau de bord est la page d'accueil. Il répond en un coup d'œil à :
combien d'élèves, combien encaissé, combien reste à percevoir.

| Zone | Information affichée |
|---|---|
| Élèves inscrits | Effectif actif de l'année courante (13) |
| Enseignants actifs | Nombre de fiches enseignant (1) |
| Classes | Classes de l'année en cours (6) |
| Effectifs par niveau | Répartition Sixième → Troisième |
| Filles / garçons | Diagramme de répartition |
| Encaissé aujourd'hui / ce mois | Totaux des paiements validés |
| Solde restant | Créances non soldées (750 000 F dû : 1 195 000 F) |
| Échéances en retard | Échéancier dépassé (19 échéances) |
| Dernières inscriptions | Historique des 6 derniers mouvements |

> [!WARN]
> Le **solde restant** et les **échéances en retard** sont vos deux
> indicateurs de pilotage quotidien : surveillez-les chaque matin.

## 2. Paramétrer l'année scolaire

**Menu :** Établissement → Années scolaires (`/app/academic-years`)
Permission : `perm:academic.read` (gestion : `perm:academic.manage`)

![Années scolaires](captures/admin-annees.png)

**Procédure :**

1. Cliquez sur **Nouvelle année** et saisissez le nom (ex. `2026-2027`),
   les dates de début et de fin.
2. Ouvrez la fiche de l'année → onglet **Périodes** : créez les
   trimestres ou semestres (ex. « Trimestre 1 »).
3. Cochez **Année courante** : toutes les listes (élèves, finances,
   notes) basculent sur cette année.

> [!WARN]
> Une seule année peut être « courante ». Les bulletins et moyennes se
> calculent **par période** : sans période créée, pas de résultats.

## 3. Structure : niveaux, classes, matières, salles

**Menus :** Établissement → Niveaux / Classes / Matières / Salles

![Classes](captures/admin-classes.png)

**Ordre obligatoire de création** (dépendances) :

1. **Niveaux** (`/app/levels`) : Sixième, Cinquième…
2. **Classes** (`/app/classrooms`) : rattachez chaque classe à un niveau
   et à l'année courante, indiquez la capacité.
3. **Matières** (`/app/subjects`) : créez puis affectez à chaque classe
   avec un **coefficient** (ex. Mathématiques coef 4).
4. **Salles** (`/app/rooms`) : nécessaires pour placer les cours dans
   l'emploi du temps.

> [!NOTE]
> Le coefficient pondère les moyennes : une note de Mathématiques (coef 4)
> pèse 4 fois une note d'Histoire (coef 2) dans le calcul.

## 4. Enseignants et emplois du temps

**Menus :** Établissement → Enseignants (`/app/teachers`),
Emplois du temps (`/app/schedules`)

![Emploi du temps](captures/admin-edt.png)

**Affecter un enseignant à une classe :**

1. **Classes → fiche classe → Matières** : ajoutez la matière, son
   coefficient et l'enseignant titulaire.
2. **Emplois du temps** : ajoutez les créneaux (jour, heure de début,
   heure de fin, classe, matière, salle).
3. Les séances se matérialisent automatiquement dans l'espace de
   l'enseignant (`/teacher`) pour l'appel et le cahier de textes.

> [!NOTE]
> Une fiche enseignant peut être reliée à un **compte utilisateur** :
> le titulaire accède alors au portail `/teacher`.

## 5. Élèves et parents

**Menus :** Pédagogie → Élèves (`/app/students`),
Parents (`/app/guardians`)

![Liste des élèves](captures/admin-eleves.png)

**Créer un élève :**

1. **Nouvel élève** : nom, prénom, matricule (obligatoire et unique),
   date de naissance, sexe.
2. Rattachez un **responsable** (parent) existant ou créez-le —
   c'est ce lien qui alimente le portail parent.
3. **Import en masse** : `/app/students/import` accepte CSV/Excel —
   l'assistant affiche un aperçu des erreurs **avant** toute
   écriture ; rien n'est enregistré sans votre validation.

![Assistant d'import](captures/admin-eleves-import.png)

## 6. Inscriptions et réinscriptions

**Menus :** Pédagogie → Inscriptions scolaires (`/app/enrollments`),
Réinscriptions (`/app/reinscriptions`)

![Inscriptions](captures/admin-inscriptions.png)

**Inscrire un élève :**

1. **Inscrire** : choisissez l'élève et la classe de l'année courante.
2. La **créance de scolarité est générée automatiquement** à partir de
   la grille tarifaire du niveau — vérifiable dans Finances.
3. La **réinscription** permet le passage d'une année à l'autre ;
   les demandes initiées par les parents depuis leur portail arrivent
   dans le file `/app/reinscriptions` pour décision.

## 7. Admissions

**Menu :** Pédagogie → Admissions (`/app/admissions`)

![Admissions](captures/admin-admissions.png)

Le module gère le pipeline complet : **campagne → candidature publique
→ pièces justificatives → décision → conversion en élève inscrit**.
Chaque pièce est vérifiée (type de fichier contrôlé) et la décision est
tracée. Permission : `perm:admissions.read` / `perm:admissions.decide`.

## 8. Notes, moyennes, bulletins, délibérations

**Menus :** Pédagogie → Notes, Moyennes, Bulletins, Délibérations,
Règles de notation

![Évaluations](captures/admin-notes.png)

**Cycle complet d'une évaluation :**

1. **Notes → Nouvelle évaluation** : classe, matière, type (devoir,
   composition), date, barème (sur 20), coefficient.
2. Saisie des notes par l'enseignant (ou import).
3. **Validation puis publication** : tant que l'évaluation n'est pas
   `PUBLISHED`, elle est invisible des parents.
4. **Moyennes** (`/app/averages`) : calcul par période selon les
   coefficients — recalcul possible après correction.
5. **Bulletins** (`/app/report-cards`) : générés par classe et période,
   puis publiés aux familles.
6. **Délibérations** (`/app/deliberations`) : propositions calculées
   soumises à la décision du conseil — les moyennes affichées sont des
   **propositions**, la décision reste humaine et tracée.

> [!WARN]
> La publication est le point de non-retour de la visibilité parent.
> Une erreur après publication se corrige par une **rectification
> motivée**, jamais par une modification silencieuse.

## 9. Absences et retards

**Menu :** Pédagogie → Absences & retards (`/app/attendance`)

![Absences](captures/admin-absences.png)

Deux modes coexistent : **appel par séance** (fait par l'enseignant dans
son portail) et **appel journalier** (saisie administration). Les absences
sont visibles des parents en temps réel ; les justificatifs se
enregistrent avec l'auteur de la justification.

## 10. Finances : tarifs, encaissements, impayés

**Menus :** Finances → Finances (`/app/fees`), Guichet d'inscription,
Mes encaissements, Rapports

![Finances](captures/admin-finances.png)

### 10.1 Grille tarifaire — `/app/fees/settings`

Créez les **catégories** (Scolarité, Inscription, Cantine…) puis les
**tarifs** par niveau ou par classe, avec le statut obligatoire/
optionnel. Ce sont ces tarifs qui génèrent les créances à l'inscription.

### 10.2 Encaisser — fiche élève ou guichet

![Paiements](captures/admin-paiements.png)

1. Saisissez le montant, la méthode (espèces, virement, Mobile Money),
   la date.
2. Le **reçu numéroté** `REC-AAAA-NNNN` est émis avec un instantané
   immuable de l'opération.
3. **Idempotence** : toute double soumission renvoie le même reçu —
   vérifiable en rafraîchissant la page.

### 10.3 Impayés et relances — `/app/fees/unpaid`

![Impayés](captures/admin-impayes.png)

Liste des soldes dus par élève. **Relancer** enregistre une relance
tracée (date, canal, auteur) — utile pour prouver la diligence.

## 11. Dépenses

**Menu :** Finances → Dépenses (`/app/expenses`)

![Dépenses](captures/admin-depenses.png)

Chaque dépense suit le cycle : **saisie → paiement → comptabilisation**.
L'annulation d'une dépense déjà comptabilisée produit une
**contre-passation automatique** — l'historique reste intègre.
Catégories paramétrables (`/app/expenses/categories`).

## 12. Comptabilité SYSCOHADA

**Menus :** Finances → Comptabilité, Tiers, États financiers,
Immobilisations, Rapprochement

![Comptabilité](captures/admin-comptabilite.png)

### 12.1 Installation initiale

1. **Installer le plan de démarrage** : comptes SYSCOHADA de base
   (411 élèves, 571 caisse, 706 produits, 66 personnel…).
2. **Ouvrir l'exercice** (dates de début/fin).
3. Vérifier les **mappings** : méthode de paiement → compte de trésorerie,
   catégorie de frais → compte de produit.

### 12.2 Générer les écritures

Le bouton **Générer les écritures** transforme chaque source non postée
(paiements, dépenses, remboursements, annulations, paie validée,
créances en mode engagement) en écriture **équilibrée** D/C :

- une écriture par source, clé unique → jamais de doublon ;
- une source en erreur est signalée (`stats.errors`) **sans bloquer**
  les autres ;
- en mode **caisse** : D571/C411 au paiement ; en mode **engagement** :
  D411/C706 à la créance puis D571/C411 à l'encaissement.

### 12.3 États et contrôles

![États financiers](captures/admin-etats.png)

- **Balance** par compte et **grand livre** ;
- **Bilan** — vérification actif = passif ;
- **Compte de résultat** — produits/charges ;
- **Tiers** (`/app/comptabilite/tiers`) : balance âgée des débiteurs ;
- **Immobilisations** : acquisition comptabilisée, dotations mensuelles
  automatiques, sortie par écriture de cession ;
- **Rapprochement** : pointage banque ↔ écritures.

### 12.4 Clôture d'exercice

La clôture est **refusée** tant qu'il existe des opérations non
comptabilisées (message `UNPOSTED_OPERATIONS`). Après clôture, le
**report à nouveau** crée les écritures d'à-nouveaux dans le nouvel
exercice de façon atomique.

## 13. Trésorerie

**Menu :** Finances → Trésorerie (`/app/treasury`)

![Trésorerie](captures/admin-tresorerie.png)

Suivi par journée : ouverture, encaissements par méthode, **clôture de
caisse** (contrôle du solde théorique vs physique). Permission :
`perm:treasury.read` / clôture : `perm:finance.cash.close`.

## 14. Mobile Money

**Menu :** Finances → Mobile Money (`/app/paiements-mobile`)

Module de suivi des intentions de paiement Mobile Money (PayDunya et
saisie manuelle). En environnement de démonstration, un **simulateur
sandbox** reproduit le cycle complet : intention → confirmation →
réconciliation avec la créance.

## 15. Communication

**Menus :** Pilotage → Annonces (`/app/announcements`),
Messagerie, Notifications

![Annonces](captures/admin-annonces.png)

- **Annonces** : publiez pour une audience (tous, parents, enseignants,
  classe) — visibles immédiatement dans les portails.
- **Notifications** : centre personnel par utilisateur (« tout marquer
  lu »).
- **Messagerie** (`/app/messages`) : échanges internes.
- **Demandes parents** (`/app/demandes`) : file des demandes
  administratives émises par les familles, à traiter et répondre.

## 16. Documents

**Menus :** Administration → Documents, Documents administratifs

![Documents](captures/admin-documents.png)

- **Documents** : bibliothèque de fichiers de l'établissement
  (contrôle du type de fichier, stockage hors webroot).
- **Documents administratifs** : certificats et attestations générés
  avec **code de vérification** — un tiers peut en contrôler
  l'authenticité.

## 17. Utilisateurs, rôles et permissions

**Menu :** Administration → Utilisateurs (`/app/users`)
Permission : `perm:user.read` / `perm:user.manage`

![Utilisateurs](captures/admin-users.png)

Chaque ligne : compte, rôle, statut, actions **Modifier / Réinit. MDP /
Supprimer**.

**Créer un utilisateur :**

![Nouvel utilisateur](captures/admin-user-new.png)

1. **Nouvel utilisateur** : email, nom, prénom.
2. Choisissez le **rôle** — c'est le rôle qui porte les permissions.
3. Envoyez l'**invitation** : lien à usage unique et expirant, le
   destinataire choisit son mot de passe.
4. Le bouton **Comprendre les rôles** affiche la matrice des
   permissions par rôle ; **Exporter** produit la liste CSV/Excel.

> [!WARN]
> Les rôles `TEACHER`, `PARENT` et `STUDENT` ouvrent les portails
> dédiés — un compte parent doit porter le rôle PARENT **et** être relié
> à sa fiche responsable pour voir ses enfants.

## 18. Paramètres et abonnement

**Menus :** Administration → Paramètres (`/app/settings`),
Mon abonnement (`/app/subscription`)

- **Paramètres** : identité de l'établissement, coordonnées, logo.
- **Mon abonnement** : plan souscrit auprès d'ECOM-TOUCH, modules
  couverts, échéance. Les modules hors plan disparaissent du menu —
  contactez ECOM-TOUCH pour faire évoluer l'offre.
