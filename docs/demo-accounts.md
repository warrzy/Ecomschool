# Comptes de démonstration — ECOM-SCHOOL

Tous les comptes ci-dessous sont **fictifs** et rattachés à l'établissement
de démonstration `DEMO-ECOLE` (« Collège Démo ECOM — données fictives ») ou
à la plateforme ECOM-TOUCH. Ils ne doivent exister que sur les environnements
de test autorisés (local, préproduction après validation explicite).

## Profils disponibles

| Profil | Rôle | Identifiant | Portail | Objet lié |
|---|---|---|---|---|
| Administrateur d'établissement | `ADMIN_SCHOOL` | `admin@demo.local` | `/app` | — |
| Enseignant | `TEACHER` | `enseignant@demo.local` | `/teacher` | fiche enseignant (Awa Kaboré) |
| Responsable financier | `FINANCE_MANAGER` | `finance@demo.local` | `/app/fees` | — |
| Caissier | `CASHIER` | `caissier@demo.local` | `/app/fees` | — |
| Parent | `PARENT` | `parent@demo.local` | `/parent` | tuteur de DEMO-001 et DEMO-002 |
| Élève | `STUDENT` | `eleve@demo.local` | `/student` | élève DEMO-001 |
| Commercial plateforme | `PLATFORM_SALES` | `commercial@ecom-school.local` | `/platform` | — |

Comptes de test complémentaires (hors démo, préexistants) :
`admin@ecom-school.local` (`PLATFORM_OWNER`), `school-admin@ecom-school.local`
(`ADMIN_SCHOOL` de l'établissement WEND-PANGA — utilisé pour les tests
d'isolation multi-tenant).

## Mots de passe — procédure sécurisée

**Aucun mot de passe n'est inscrit dans le dépôt ni dans les rapports.**

- Le mot de passe commun des comptes `*@demo.local` et `commercial@ecom-school.local`
  est défini par la variable d'environnement **`SEED_DEMO_PASSWORD`**
  (locale : `.env`, jamais commitée).
- Pour les environnements partagés (préproduction), le mot de passe est
  fourni par le référent ECOM-TOUCH via un canal sécurisé et positionné dans
  l'environnement du VPS (`/etc/ecomschool/preprod.env` ou équivalent).
- Le script `scripts/demo/seed-demo.ts` **exige** `SEED_DEMO_PASSWORD` pour
  créer de nouveaux comptes et **ne modifie jamais** le mot de passe d'un
  compte existant.

## Mise en place (local uniquement)

```bash
# Pré-requis : DATABASE_URL pointe sur ecomschool_dev (localhost)
ALLOW_DEMO_SEED=1 npx tsx scripts/demo/seed-demo.ts
```

Verrous du script :
- `ALLOW_DEMO_SEED=1` obligatoire ;
- `DATABASE_URL` limitée à `localhost` et à une base autorisée
  (`DEMO_SEED_ALLOWED_DBS`, défaut `ecomschool_dev,ecomschool_demo,ecomschool_test`) ;
- idempotent : ré-exécutable sans doublons ; bilan créé/réutilisé/ignoré en
  fin d'exécution.

## Données de démonstration fournies

- 4 classes (6e A/B, 5e A, 4e A), 3 niveaux, 6 matières, 4 enseignants,
  2 salles, 10 créneaux d'emploi du temps et des séances passées avec appels.
- 20 élèves (`DEMO-001` → `DEMO-020`) inscrits, 9 parents rattachés.
- Évaluations, notes, moyennes et **bulletins T1 publiés** sur les 4 classes.
- Finance : 3 tarifs, créances générées (~60), 31 paiements, 1 clôture de
  caisse, impayés calculés.
- 3 annonces, notifications, abonnement **Premium annuel actif**.

## Limitations

- Pas de données de trimestre 2/3 (arrêt à la publication T1).
- Le portail élève/parent montre les données des seuls comptes rattachés.
- Le commercial plateforme n'a **pas** accès à la gestion des écoles, à
  l'onboarding ni aux demandes d'inscription (réservés à `PLATFORM_OWNER`).
