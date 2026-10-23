# G3-E Phase 3A — Procédure de configuration du compte PayDunya TEST

**Statut** : procédure préparée — aucun compte créé, aucun secret réel,
aucun appel distant. À exécuter uniquement après GO Phase 3B.

> **Distinction fondamentale** (voir §2 du plan de recette distant) :
> le `mode` de `PaymentProvider` est un axe **opérationnel interne**
> (comptabilisation réelle autorisée ou non) ; l'environnement
> `sandbox-api`/`api` de PayDunya est un axe **technique distant**.
> Les deux sont indépendants et ne doivent jamais être confondus.

## 1. Prérequis PayDunya Business

| Élément | Détail | Source |
|---|---|---|
| Compte | PayDunya **Business** (un compte par école — voir §3) | `paydunya.com` |
| Application | créer une application dans le tableau de bord → génère les 4 clés | back-office marchand |
| Clés produites | `MASTER-KEY`, `PRIVATE-KEY`, `PUBLIC-KEY`, `TOKEN` — en double jeu : **TEST** et **LIVE** | onglet clés de l'application |
| IPN | URL de notification configurable dans l'application (on la passe aussi par facture via `actions.callback_url`) | back-office + API |
| Store | nom du magasin **requis** à chaque création de facture (`store.name`) | API `checkout-invoice/create` |

Noms des clés dans les en-têtes HTTP (documentés) :
`PAYDUNYA-MASTER-KEY`, `PAYDUNYA-PRIVATE-KEY`, `PAYDUNYA-TOKEN`,
`PAYDUNYA-PUBLIC-KEY` (optionnel).

## 2. Références d'environnement (aucune valeur en base)

La base ne stocke que des **noms de variables** — les valeurs vivent
dans `shared/.env` du serveur (mode 600, hors Git) :

| Champ `PaymentProvider` | Variable proposée (TEST) | Contenu |
|---|---|---|
| `testCredentialsRef` | `PAYDUNYA_TEST_CREDENTIALS_<ECOLE>` | JSON `{"masterKey":"test_…","privateKey":"test_…","publicKey":"test_…","token":"test_…"}` |
| `testWebhookSecretRef` | `PAYDUNYA_TEST_MASTERKEY_<ECOLE>` | la `test_*` MasterKey seule (vérification du hash IPN) |

`credentialsRef`/`webhookSecretRef` sont réservés aux futures clés
`live_*` — les deux jeux de références ne se croisent jamais.

Conventions obligatoires :

- Préfixe `PAYDUNYA_TEST_` pour les références TEST, `PAYDUNYA_LIVE_`
  pour les futures références LIVE — **jamais de réutilisation croisée**.
- Une clé `live_*` ne doit JAMAIS être collée dans une variable
  `PAYDUNYA_TEST_*` : le plan de recette distant (§5) impose une
  vérification de préfixe `test_` avant tout appel.
- Les valeurs ne figurent dans aucun rapport, log, export, payload
  persisté ni réponse navigateur — `listPaymentProviders` exclut déjà
  les champs `*Ref` ; la recette vérifie que le hash IPN est stocké
  `[redacted]`.

## 3. Configuration `PaymentProvider` (brouillon — nécessite 3B)

Ligne proposée pour l'école de test (école fixture dédiée, pas une
école réelle) :

```jsonc
{
  "code":            "PAYDUNYA",
  "mode":            "LIVE",            // adaptateur réel (≠ simulateur interne)
  "remoteEnv":       "TEST",            // Phase 3B — environnement distant sandbox-api
  "status":          "ACTIVE",
  "liveEnabled":     false,             // reste false : ce n'est pas du LIVE
  "label":           "PayDunya (TEST distant)",
  "merchantRef":     "<nom application PayDunya>",
  "testCredentialsRef":   "PAYDUNYA_TEST_CREDENTIALS_G3ETEST",
  "testWebhookSecretRef": "PAYDUNYA_TEST_MASTERKEY_G3ETEST",
  "config": {
    "store":    { "name": "ECOM-SCHOOL TEST", "website_url": "https://preprod.ecomschool.fr" },
    "channels": ["orange-money-burkina", "moov-burkina-faso"],
    "description": "TEST — frais scolaires"
  }
}
```

**Ne pas renseigner** : aucune URL dans `config` — `callback_url` est
calculée côté serveur (`liveCallContext` :
`{NEXTAUTH_URL}/api/webhooks/mobile-money/{providerId}`), `baseUrl`
est choisie par le service, `env` injecté côté serveur.

## 4. URLs

| URL | Valeur | Qui la fournit |
|---|---|---|
| IPN / callback | `https://preprod.ecomschool.fr/api/webhooks/mobile-money/<providerId>` | serveur (`actions.callback_url`) + à recopier dans le back-office si PayDunya l'exige en dur |
| Retour payeur | page `/parent` — **À CONFIRMER** : champ `actions.return_url` accepté ou configuration back-office | PayDunya ou adaptateur (3B) |
| Annulation | idem `actions.cancel_url` — **À CONFIRMER** | idem |

## 5. Pays et moyens de paiement

| Canal | Code documenté | Statut en sandbox PayDunya |
|---|---|---|
| Orange Money Burkina | `orange-money-burkina` | à valider sur réponse réelle |
| Moov Money Burkina | `moov-burkina-faso` | à valider sur réponse réelle |

Le PAR par redirection présente les canaux actifs du compte marchand ;
`invoice.channels` permet de les restreindre.

## 6. Conditions d'utilisation du mode TEST PayDunya

- Les clés `test_*` n'autorisent que `sandbox-api.paydunya.com…` —
  aucun paiement réel possible avec ces clés (garde-fou côté PayDunya).
- Les numéros de paiement TEST sont des numéros simulés fournis par la
  page de paiement sandbox — **aucun vrai wallet n'est débité**.
- **À CONFIRMER contractuellement** : périmètre exact du sandbox
  (canaux BF actifs, déclenchement réel des IPN, comportement des
  statuts `cancelled`/`failed`).

## 7. Interdits pendant la recette TEST

- Ne jamais saisir de clé `live_*` dans l'environnement préprod.
- Ne jamais activer `MOBILE_MONEY_LIVE_ENABLED` pour exécuter un test
  distant — la voie TEST distante utilise sa propre barrière (§5 du
  plan de recette).
- Ne jamais brancher un compte marchand réel d'école sur les fixtures.
- Ne jamais créer de `Payment`/écriture de ledger depuis une facture
  TEST — la barrière de comptabilisation TEST (§5) l'interdit.
