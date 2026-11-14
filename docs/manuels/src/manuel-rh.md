<!-- title: Manuel Responsable RH -->
# Manuel responsable RH

Votre périmètre : **les personnes** — employés, contrats, congés,
présences, départs. Vous n'avez **pas** accès à la paie (`/app/rh/paie`
renvoie 403) : la confidentialité des salaires est un cloisonnement
voulu entre la gestion RH et la gestion des montants.

## 1. Votre espace

**Menu :** Finances → Personnel (`/app/rh`)
Permissions : `perm:hr.read` · `perm:hr.manage`

![Personnel](captures/rh-employes.png)

La page liste les employés : matricule, nom, catégorie
(enseignant/non-enseignant), contrat actif, statut. Les filtres
permettent de retrouver un employé par nom ou par statut.

## 2. Créer un employé et son contrat

1. **Nouvel employé** : matricule, identité, catégorie, date d'embauche.
2. Ouvrez la fiche → **Nouveau contrat** : type (CDI/CDD), poste,
   salaire de base, dates.
3. **Activer le contrat** — c'est l'activation qui déclenche la
   **dotation automatique des congés** selon les règles de
   l'établissement (voir §4).

> [!NOTE]
> La dotation est idempotente : réactiver ou reprovisionner ne crée
> jamais de doublon de solde. Une correction manuelle du solde est
> possible et reste tracée.

## 3. Règles de dotation des congés

Sur la page Personnel, la carte **Dotations de congés** permet de définir,
pour l'établissement, les jours attribués par type et par an :

- **ANNUAL** — congés annuels (ex. 30 jours, valeur de l'école) ;
- **SICK** — congés maladie (ex. 10 jours) ;
- autres types selon vos usages.

Le bouton **« Provisionner [année] »** applique les règles à tous les
contrats actifs. **Aucun droit légal n'est présumé** : les valeurs sont
celles que votre établissement décide — les obligations du code du
travail restent de votre responsabilité.

## 4. Traiter les demandes de congés

![Personnel — demandes](captures/rh-employes.png)

Le cycle d'une demande :

1. L'employé (ou vous pour lui) crée une demande : type, dates, motif —
   statut `PENDING`.
2. **Approuver** : le solde est déduit automatiquement ; si le solde est
   insuffisant, la demande peut être marquée **sans solde (UNPAID)** —
   ces jours impacteront la paie si l'option est activée côté paie.
3. **Refuser** : motif obligatoire, le demandeur est informé.

## 5. Présences du personnel

Le pointage des présences non enseignantes (secrétariat, personnel de
service) se fait par journée : présent, absent, retard, absence
justifiée. Les absences non justifiées peuvent alimenter la
proratisation de paie si l'établissement l'active.

## 6. Départs

Un départ se saisit sur la fiche employé : date, motif. Le contrat est
clôturé, les dotations cessent de courir — l'historique (contrats,
congés, bulletins) est **conservé**, jamais effacé.

## 7. Ce que vous ne voyez pas — et pourquoi

| Écran | Accès | Raison |
|---|---|---|
| `/app/rh/paie` | **403** | Montants réservés au gestionnaire de paie |
| `/app/comptabilite` | 403 | Comptabilité réservée au comptable |
| `/app/fees` | 403 | Finances élèves hors périmètre RH |
