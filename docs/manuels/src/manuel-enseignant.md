<!-- title: Manuel Enseignant -->
# Manuel enseignant

Votre espace `/teacher` est un portail dédié : vos cours, vos appels,
votre cahier de textes, vos évaluations. Vous n'accédez ni aux données
RH, ni aux finances, ni aux fiches des autres classes.

## 1. Votre tableau de bord

![Tableau de bord enseignant](captures/enseignant-dashboard.png)

Dès la connexion, votre journée :

| Carte | Contenu |
|---|---|
| Cours aujourd'hui | Séances du jour avec horaires |
| Cours cette semaine | Vue hebdo de vos créneaux |
| Classes attribuées | Vos classes (6e A, 5e A…) |
| Appels à effectuer | Séances passées sans appel — **action requise** |
| Prochaines séances | Anticipation |
| Évaluations | Évaluations en cours de saisie |
| Cahier de textes | Séances à compléter |

## 2. Faire l'appel

1. Carte **Appels à effectuer** → **Faire l'appel** sur la séance.
2. Marquez chaque élève : présent, **absent**, **retard** (durée).
3. Validez : l'absence remonte immédiatement au portail des parents et
   au suivi administration.

> [!NOTE]
> Les absences saisies ici sont celles visibles par les familles —
> vérifiez avant de valider.

## 3. Cahier de textes

Carte **Cahier de textes à compléter** → **Compléter** : thème,
chapitre, objectif, contenu de la séance, devoirs donnés.
C'est la trace pédagogique officielle de votre progression.

## 4. Emploi du temps

Menu **Mon emploi du temps** : la grille hebdomadaire de vos créneaux,
par classe, matière et salle.

![Emploi du temps enseignant](captures/enseignant-edt.png)

## 5. Évaluations et notes

1. Créez ou ouvrez une **évaluation** de votre classe (devoir,
   composition — type, barème, coefficient définis par
   l'administration).
2. Saisissez les notes de vos élèves (ou absence d'un élève à
   l'épreuve).
3. **Soumettez** pour validation : les notes ne deviennent visibles des
   parents qu'après **publication** par l'administration — vous voyez
   l'état d'avancement (DRAFT → SUBMITTED → VALIDATED → PUBLISHED).

## 6. Retour à l'école

Le lien **« Retour à l'école »** ramène vers `/app` si votre rôle y a
des droits complémentaires — sinon, l'accès reste refusé : normal.

| Écran tenté | Résultat |
|---|---|
| `/app/rh` | 403 |
| `/app/rh/paie` | 403 |
| `/app/comptabilite` | 403 |
| `/app/students` | 403 (liste complète hors périmètre) |
