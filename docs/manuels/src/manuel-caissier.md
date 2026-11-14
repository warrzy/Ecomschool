<!-- title: Manuel Caissier -->
# Manuel caissier

Votre périmètre : **l'encaissement** — guichet d'inscription, paiements,
reçus. Vous n'avez pas accès à la comptabilité ni aux autres modules :
la caisse est votre poste.

## 1. Votre espace

Menu Finances : **Guichet d'inscription**, **Finances**,
**Mes encaissements**, **Trésorerie** (consultation).

## 2. Guichet d'inscription

**Menu :** Finances → Guichet d'inscription (`/app/fees/registration`)
Permissions : `perm:enrollment.read` · `perm:enrollment.create` · `perm:finance.payments.create`

![Guichet d'inscription](captures/caissier-guichet.png)

Le guichet enchaîne en un seul écran l'**inscription administrative** et
le **premier encaissement** — le parcours complet du parent qui se
présente au comptoir :

1. Recherchez ou créez l'élève et son responsable.
2. Choisissez la classe → les créances obligatoires apparaissent.
3. Saisissez le montant encaissé et la méthode.
4. Validez : inscription créée + reçu émis **dans la même opération**.

## 3. Encaisser un paiement

**Depuis la fiche élève** (Finances → recherche élève → Paiement) :

1. Vérifiez l'identité de l'élève et le **solde dû** affiché.
2. Montant, méthode (espèces/virement), date effective.
3. Validez → le **reçu numéroté** `REC-…` s'édite.

![Finances](captures/caissier-finances.png)

**Règles à connaître :**

- **Surpaiement refusé** : un montant supérieur au reste dû est bloqué.
- **Idempotence** : si vous soumettez deux fois (double-clic, réseau
  lent), le système renvoie **le même reçu** — jamais deux encaissements.
- **Le reçu est immuable** : il fige élève, montant, caissier, horodatage.

> [!WARN]
> Remettez toujours le reçu au payeur — il porte le numéro qui fait foi
> en cas de contestation.

## 4. Votre journal personnel

**Menu :** Finances → Mes encaissements (`/app/fees/my-payments`)
Permission : `perm:finance.receipts.read`

![Mes encaissements](captures/caissier-encaissements.png)

Liste de **vos seuls** encaissements (filtre strict sur votre identité
serveur) : montants du jour, reçus émis, réimpression possible.
C'est votre outil de préparation de la clôture de caisse.

## 5. Trésorerie (consultation)

**Menu :** Finances → Trésorerie (`/app/treasury`)

Vue de la journée de caisse : total par méthode, ouverture/clôture —
la clôture elle-même relève du responsable financier.

## 6. Réflexes de sécurité

- **Ne communiquez jamais** votre mot de passe : chaque reçu porte
  votre identité — vous êtes responsable de vos encaissements.
- **Déconnectez-vous** en quittant le poste.
- Une erreur d'encaissement ne s'efface pas : signalez-la au
  responsable financier — l'**annulation** produit une contre-passation
  tracée, jamais une disparition.
