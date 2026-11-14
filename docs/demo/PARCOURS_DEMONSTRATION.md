# Parcours de démonstration — ECOM-SCHOOL

Script de présentation commerciale (~45 min). Environnement :
**https://preprod.ecomschool.fr** — école fictive « ÉCOLE DÉMO VALIDATION »
(collège/lycée burkinabè : 4 niveaux, 5 classes, 13 élèves, 5 employés).

| Compte | Profil démontré |
|---|---|
| `demo-admin@demo.ecomschool.test` | Directeur / administrateur d'établissement |
| `demo-compta@demo.ecomschool.test` | Comptable |
| `demo-rh@demo.ecomschool.test` | Responsable RH |
| `demo-paie@demo.ecomschool.test` | Gestionnaire de paie |
| `demo-enseignant@demo.ecomschool.test` | Enseignant (portail /teacher) |
| `demo-parent@demo.ecomschool.test` | Parent d'élève (portail /parent) |

Mot de passe : communiqué séparément (variable `SEED_DEMO_PASSWORD` du
serveur — ne jamais l'inscrire dans un support).

---

## Acte 1 — Administrateur (`demo-admin`) — 15 min

**Message : « Toute la vie de l'école en un seul tableau de bord. »**

1. **Tableau de bord** `/app` — 13 élèves, effectifs par niveau,
   répartition filles/garçons, encaissé du jour (50 000 F), du mois
   (445 000 F), **solde restant dû 750 000 F**, 19 échéances en retard,
   dernière annonce. *(capture 02)*
2. **Élèves** `/app/students` — recherche « Ouédraogo », fiche élève :
   matricule, classe, responsables, situation financière. *(capture 03)*
3. **Encaissement en direct** — fiche élève → « Paiement » : saisir
   25 000 F espèces → reçu `REC-…` numéroté et téléchargeable.
   **Montrer l'idempotence** : rafraîchir/rejouer → même reçu, jamais de
   double encaissement. `/app/fees/payments` *(capture 04)*
4. **Impayés & relances** `/app/fees/unpaid` — liste des familles en
   retard, relance tracée. *(capture 05)*
5. **Pédagogie** — `/app/classrooms`, `/app/subjects` (5 matières,
   coefficients par classe), `/app/schedules` (emploi du temps 6e A).
6. **Communication** `/app/announcements` — l'annonce « Conseil d'école »
   publiée est **déjà visible côté parent** (le montrer à l'acte 6).

## Acte 2 — Comptable (`demo-compta`) — 8 min

**Message : « La comptabilité SYSCOHADA se remplit toute seule. »**

1. `/app/comptabilite` — plan de comptes, journaux, mappings automatiques
   (caisse 571, élèves 411, produits 706). *(capture 10)*
2. **« Générer les écritures »** — les paiements, dépenses et paie
   deviennent des écritures **équilibrées** D/C, sans ressaisie.
3. `/app/comptabilite/etats` — **bilan équilibré** (actif = passif) et
   **compte de résultat** en un clic. *(capture 11)*
4. `/app/treasury` — journée de caisse, clôture journalière. *(capture 12)*
5. **Punchline** : un refus 403 sur `/app/rh` → « le comptable ne voit
   pas les salaires ».

## Acte 3 — RH (`demo-rh`) — 5 min

**Message : « Personnel, contrats et congés sans tableur. »**

1. `/app/rh` — 7 employés, contrats CDI, fiches. *(capture 08)*
2. **Dotations de congés** — règles de l'établissement (ANNUAL 30 j,
   SICK 10 j) provisionnées automatiquement à l'activation du contrat.
3. **Demande en attente** (Prosper Some) → approuver → solde déduit.
4. **Punchline** : `/app/rh/paie` → **403** — « la RH gère les personnes,
   pas les montants ».

## Acte 4 — Paie (`demo-paie`) — 8 min

**Message : « Des bulletins calculés, tracés et comptabilisés. »**

1. `/app/rh/paie` — campagne **2026-11 POSTED**, 2 bulletins.
   *(capture 13)*
2. Ouvrir un **bulletin** : base, prime, brut, retenues, **net à payer**,
   coût patronal, snapshot de formule (calcul reproductible). *(capture 14)*
3. **Avances** : octroi → recouvrement automatique **plafonné** (% du net
   configurable — montrer l'encart, valeur indicative).
4. **Assiduité** : base mensuelle, congés sans solde et absences
   déductibles — paramètres de l'école, pas de règle légale présumée.
5. **Mention obligatoire** : « CNSS et impôt sur salaires s'activent dès
   validation du barème officiel — aucun taux n'est inventé. »

## Acte 5 — Enseignant (`demo-enseignant`) — 4 min

**Message : « Le prof ne gère que ses cours. »**

1. `/teacher` — Harmonie Kientega : **4 cours cette semaine**, 2 classes
   (6e A, 5e A), prochaines séances, appels à effectuer, cahier de
   textes. *(capture 15)*
2. Ouvrir une séance passée : chapitre, objectif, devoirs renseignés.
3. **Punchline** : `/app/rh` → 403 — « un enseignant n'accède jamais
   aux données RH ni financières ».

## Acte 6 — Parent (`demo-parent`) — 5 min

**Message : « Les parents suivent tout depuis leur téléphone. »**

1. Connexion → **redirection automatique `/parent`** (jamais `/app`).
2. Deux enfants : **Awa Ouédraogo** (6e A) et **Mariam Compaoré** (5e A).
3. Onglet **Aperçu** : classe, inscription. *(capture 16)*
4. Onglet **Notes** : le devoir publié — « Mathématiques, 14,5/20 ».
   *(capture 17)*
5. Onglet **Finances** : créances et reçu `REC-…` téléchargeable.
   *(capture 18)*
6. Onglet **Absences** : le retard de 15 min d'Awa est visible —
   transparence totale. *(capture 19)*
7. Bandeau : **annonce du conseil d'école** publiée à l'acte 1.
8. **Punchline** : saisir `/app/students` dans l'URL → retour `/parent` —
   « aucun parent ne voit l'enfant d'un autre ».

## Conclusion commerciale — 2 min

- **Sécurité** : chaque rôle ne voit que son périmètre (démontré en
  direct par les 403, pas par un PowerPoint).
- **Fiabilité** : aucune double écriture, aucun paiement perdu, tout est
  tracé (audit).
- **Conformité** : comptabilité SYSCOHADA ; paie prête pour le barème
  BF officiel dès sa validation.
- **Tarification** : abonnement par établissement — cf. dossier
  `docs/commercial/DOSSIER_PRESENTATION.md`.

> Les 19 captures de `docs/demo/screenshots/` peuvent servir de support
> projeté si la connexion est indisponible le jour J.
