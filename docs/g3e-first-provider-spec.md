# G3-E Phase 2A — Spécification du premier connecteur : PayDunya

**Statut** : spécification technique prête-à-implémenter, conditionnée aux
réponses contractuelles (voir `g3e-provider-comparison.md` §7).
**Aucun code d'intégration réelle n'est écrit à ce stade.** L'adaptateur
ne sera codé qu'après un nouveau GO et vérification des prérequis §8.

Sources : documentation officielle `developers.paydunya.com` (HTTP/JSON,
SoftPay, API PUSH, vérification de statut) — aucun endpoint ni tarif
inventé ; chaque incertitude est marquée **À CONFIRMER**.

## 1. Périmètre du connecteur

| Composant | Décision |
|---|---|
| Code adaptateur | `PAYDUNYA` |
| Flux retenu | **PAR — Paiement Avec Redirection** (recommandé officiellement, couvre OM+Moov sans intégration par canal) |
| Pays | Burkina Faso (compte marchand par école) |
| Devise | `XOF` uniquement |
| `sandboxScript` | Ignoré — la simulation PayDunya passe par son propre MODE TEST |
| `capabilities` | `{ initiate: true, pollStatus: true, webhooks: true, refunds: false, settlements: false, payerFee: À CONFIRMER }` |

`refunds` reste `false` tant que le canal (API PUSH déboursement) n'est
pas validé contractuellement : le workflow `PaymentRefund` continue de
fonctionner en déclaratif (SIMREF impossible en LIVE — le refus explicite
`REFUND_UNSUPPORTED` s'applique, voir durcissement G3-E).

## 2. Correspondance de configuration

| Champ `PaymentProvider` | PayDunya |
|---|---|
| `code` | `PAYDUNYA` |
| `mode` | `SANDBOX` → endpoints `sandbox-api` + clés `test_*` ; `LIVE` → endpoints `api` + clés live |
| `merchantRef` | nom de l'application PayDunya du marchand |
| `credentialsRef` | variable d'env JSON : `{ "masterKey": "…", "privateKey": "…", "token": "…" }` (résolue en mémoire par `resolveProviderSecret`, jamais stockée ni exposée) |
| `webhookSecretRef` | variable contenant la **MasterKey** (elle sert à vérifier le hash IPN) |
| `providerConfig` | `{ "store": { name, tagline?, logo_url?, website_url? }, "channels": ["orange-money-burkina","moov-burkina-faso"], "callbackUrl": "https://<domaine>/api/webhooks/mobile-money/<providerId>" }` — **sans secret** |
| `minAmount`/`maxAmount` | bornes contractuelles de l'école |

Deux lignes `PaymentProvider` (SANDBOX / LIVE) peuvent coexister pour la
même école — chacune avec ses propres références de clés.

## 3. Mapping des opérations du contrat

### 3.1 `initiate(input)` → `InitiateResult`

```
POST {base}/checkout-invoice/create
  base sandbox : https://app.paydunya.com/sandbox-api/v1
  base live    : https://app.paydunya.com/api/v1
Headers : PAYDUNYA-MASTER-KEY / PAYDUNYA-PRIVATE-KEY / PAYDUNYA-TOKEN
Body    : {
  invoice: { total_amount, description: "Frais scolaires — {intentId}",
             customer: { phone: payerPhone? }, channels },
  store: providerConfig.store,
  custom_data: { intent_id: intentId },   // référence métier de rejeu
  actions: { callback_url, return_url?, cancel_url? }
}
Réponse attendue : response_code == "00" →
  providerRef = body.token
  instructions = body.response_text  (URL de la page de paiement)
```

Erreurs : `response_code != "00"` → `ProviderBusinessError(response_text)` ;
HTTP non-2xx/timeout → `ProviderUnavailableError`/`ProviderTimeoutError`.

**Idempotence** : PayDunya ne documente pas d'en-tête d'idempotence —
la création produit une nouvelle facture à chaque appel. Notre garde est
upstream : `PaymentIntent.providerRef` est posé une seule fois à la
transition `CREATED → PENDING`, et le rejeu de `createPaymentIntent`
renvoie l'intention existante par `idempotencyKey` avant tout appel
adaptateur. Un `intentId` qui aurait déjà un `providerRef` ne doit
jamais rappeler `initiate`.

### 3.2 `checkStatus(providerRef)` → `StatusResult`

```
GET {base}/checkout-invoice/confirm/{token}
Headers : mêmes clés
```

| Réponse PayDunya | `ProviderPaymentStatus` |
|---|---|
| `invoice.status == "completed"` | `SUCCESS` |
| `"pending"` / transaction non trouvée confirmable | `PENDING` |
| `"cancelled"` | `FAILED` (reason `"CANCELLED"`) |
| `"failed"` | `FAILED` (reason texte) |
| expiration côté opérateur | `EXPIRED` — **À CONFIRMER** : distinguer par `response_text` |

`providerTxId` : rechercher un identifiant d'opération dans la réponse
confirm (`receipt_url`, `customer`…). **À CONFIRMER** : champ exact du
numéro de transaction opérateur ; à défaut, `providerTxId = token`.

### 3.3 `verifyWebhook(input)` → `WebhookVerification`

Charge utile IPN : `POST application/x-www-form-urlencoded`, nœud `data`
(tableau) avec `data.status`, `data.invoice.token`, `data.hash`,
`data.invoice.total_amount`, `data.customer`…

Vérification :

1. `hash` présent et `timingSafeEqual(sha512hex(masterKey), hash)` —
   sinon `INVALID_SIGNATURE`.
2. `token` et `status` présents — sinon `MALFORMED`.
3. Pas d'horodatage dans l'IPN documentée → le contrôle de fraîcheur
   `EXPIRED` n'est pas applicable côté signature ; la déduplication
   repose sur `externalId` (voir §4).
4. Normalisation : `externalId = "{token}:{status}"`, `intentRef = token`,
   `status` mappé comme §3.2, `eventType = "ipn"`, `raw` = charge
   **sanitisée** (retirer les données client si présentes).

**Renfort obligatoire** : le hash étant statique par compte, la
vérification du hash ne prouve que la provenance PayDunya, pas la
fraîcheur ni le montant. La chaîne G3-B applique déjà la règle correcte :
l'événement est stocké (`WebhookEvent`), puis `checkStatus` re-vérifie
auprès de PayDunya avant `confirmIntent` — un webhook seul ne doit donc
jamais comptabiliser. **Règle d'implémentation : pour `PAYDUNYA`,
`handleWebhook` doit passer par `checkStatus` avant toute confirmation**
(comportement à garantir dans l'adaptateur/service au moment du codage).

### 3.4 `initiateRefund` — NON IMPLÉMENTÉ dans la V1

`capabilities.refunds = false` → `executeRefund` renvoie
`REFUND_UNSUPPORTED` pour tout remboursement sur ce prestataire.
Piste documentée pour une V2 : API PUSH
`POST {base}/per/disburses` (déboursement vers `account_alias`,
`withdraw_mode = orange-money-burkina`/`moov-burkina-faso`,
`callback_url`) — **soumis à activation contractuelle et validation
métier** (un déboursement n'est pas un remboursement lié : frais,
plafonds, et délai à confirmer).

### 3.5 `fetchSettlements` — NON IMPLÉMENTÉ

Aucune API de décompte documentée → `capabilities.settlements = false`.
Le canal reste la déclaration manuelle `PaymentSettlement` (G3-D) à
partir des rapports Excel/PDF du back-office PayDunya — marqués
`declared: true`, jamais présentés comme preuve bancaire.

## 4. Idempotence et identifiants

| Élément | Règle |
|---|---|
| `PaymentIntent.idempotencyKey` | inchangé (clé école-scopée existante) |
| `providerRef` | `token` de facture PayDunya — unique par intention |
| `WebhookEvent.externalId` | `{token}:{status}` — les IPN répétées (même statut) dédupliquent ; une transition de statut distincte est un événement distinct |
| `Payment.idempotencyKey` | `mm:{intentId}` — inchangé |
| `PaymentRefund.idempotencyKey` | `rf:{refundId}` à l'appel adaptateur — inchangé |
| Rejeu après crash | `postConfirmedIntent` rattache l'encaissement existant — inchangé |

## 5. Mapping des erreurs

| Condition | Erreur contrat |
|---|---|
| DNS/connexion/socket timeout > `ADAPTER_CALL_TIMEOUT_MS` | `ProviderTimeoutError` |
| HTTP 5xx / indisponibilité | `ProviderUnavailableError` |
| `response_code != "00"` (montant refusé, clés invalides…) | `ProviderBusinessError(response_text)` |
| Clé/env absente (`credentialsRef`/`webhookSecretRef` non résolue) | `ProviderConfigError` |
| `initiateRefund`/`fetchSettlements` invoqués | méthodes absentes — jamais appelées |

## 6. Timeouts et rejeux

- Chaque appel borné à `ADAPTER_CALL_TIMEOUT_MS` (15 s) via
  `AbortController` + `fetch` côté adaptateur.
- `checkStatus` : retry service existant (cron `runMobileMoneyMaintenance`
  + relance manuelle) — l'adaptateur ne boucle pas.
- `initiate` : aucun retry automatique — une intention échouée
  (`INITIATE_FAILED`) se recrée via une nouvelle clé métier.

## 7. Plan de tests de conformité (à exécuter avant tout LIVE)

Recette `scripts/g3/payments-g3e-paydunya-conformance.ts` (à écrire au
moment du codage) — contre le **mode TEST PayDunya** ou un mock HTTP
local si le compte test n'est pas encore créé :

1. `initiate` mock → `providerRef` + `instructions` URL — intention
   `PENDING`.
2. `checkStatus` pending → `PENDING` ; completed → `SUCCESS` +
   comptabilisation via chaîne existante.
3. IPN `hash` correct → `WebhookEvent` persisté + confirmation ;
   `hash` faux → `INVALID_SIGNATURE`, aucun encaissement.
4. IPN dupliquée → déduplication `externalId`.
5. IPN falsifiée (montant modifié, hash valide) → la re-vérification
   `checkStatus` fait foi ; écart → anomalie.
6. Timeout simulé → `PROVIDER_TIMEOUT`, intention `FAILED`, solde libéré.
7. Verrou global : `MOBILE_MONEY_LIVE_ENABLED` absent → tout appel refusé
   `LIVE_DISABLED` sans requête sortante (assertion sur compteur HTTP).
8. Isolation : clés d'une autre école jamais utilisées ; provider
   d'une autre école → rejet.
9. Remboursement → `REFUND_UNSUPPORTED` (capacité `false`).
10. Zéro appel réseau quand le fournisseur est en `SANDBOX` interne.
11. `credentialsRef`/`webhookSecretRef` jamais sélectionnés dans les
    listes/exports.
12. Réponse IPN sans `data.hash` → `MALFORMED`.

## 8. Prérequis bloquants avant codage de l'adaptateur réel

| # | Prérequis | Statut |
|---|---|---|
| 1 | Compte PayDunya Business de test créé (clés `test_*`) | À FAIRE — gratuit, non bloquant juridiquement |
| 2 | Confirmation que les canaux OM+Moov BF sont actifs en sandbox/production | À DEMANDER |
| 3 | Champ exact du `providerTxId` dans la réponse `confirm` | À CONFIRMER sur réponse réelle de test |
| 4 | Valeur exacte de `invoice.status` intermédiaire (`pending`/`notcompleted`…) | À CONFIRMER |
| 5 | Comportement IPN en cas d'échec (rejeu, délai) | À DEMANDER |
| 6 | Grille tarifaire contractuelle → saisie `feeFixed`/`feePercent`/`feeBearer` | À DEMANDER |
| 7 | Canal de remboursement (API PUSH) validé ou écarté | À DEMANDER — sinon `refunds:false` définitif |
| 8 | Format des décomptes/reversements | À DEMANDER — sinon `settlements:false` |
| 9 | Validation juridique du modèle « compte marchand par école » | À VALIDER par le client |

## 9. Ce que ce connecteur NE fera PAS

- Aucune collecte centralisée : chaque école encaisse sur son propre
  compte PayDunya Business.
- Aucune écriture comptable SYSCOHADA automatique (hors scope G3).
- Aucun remboursement tant que le canal n'est pas validé (refus
  explicite, jamais de SIMREF- en LIVE).
- Aucune notification payante externe.

## 10. Annexe — implémentation Phase 2B (locale)

Livrée sans activation LIVE ni appel réseau réel.

- **Adaptateur** : `src/lib/services/payments/providers/paydunya.ts`
  (`createPaydunyaAdapter(transport)` + `paydunyaAdapter` production
  sur transport fetch — inerte sans `MOBILE_MONEY_LIVE_ENABLED`,
  `liveEnabled`, secrets et adaptateur enregistré).
- **Transport injectable** : `src/lib/services/payments/providers/http.ts`
  (`HttpTransport`, `fetchTransport`, `createMockTransport` — la
  recette journalise chaque requête et interdit tout réseau réel).
- **Contrat étendu** (`types.ts`) : `AdapterCallContext`
  (`credentials` résolus en mémoire + `config` non-secrète +
  `env:"live"` injecté côté serveur), `StatusResult.amount/currency`,
  `PaymentProviderAdapter.webhookReverification` (`true` pour
  PAYDUNYA — l'IPN seule ne confirme jamais).
- **Chaîne de confirmation** : `applyEventToIntent` re-vérifie via
  `checkStatus` avant `confirmIntent` quand
  `webhookReverification` — contradiction → `ANOMALY`, divergence
  montant/devise → `AMOUNT_MISMATCH` + `PaymentDiscrepancy`, échec
  transport → `RETRY` (preuve conservée, `replayWebhookEvent`
  rejouable). `pollPaymentIntent` applique le même contrôle
  montant/devise.
- **Secrets** : `credentialsRef` → JSON `{masterKey, privateKey,
  publicKey?, token}` ; `webhookSecretRef` → MasterKey seule
  (vérification `sha512(masterKey)` en temps constant). Le hash IPN
  n'est jamais persisté (`"[redacted]"`).
- **`PaymentProvider.config` attendu** : `{store:{name,…},
  callbackUrl, returnUrl?, cancelUrl?, channels[], description?}` —
  `store.name` requis par l'API ; l'`env` (sandbox/live) est choisi
  par le service d'après `provider.mode`, jamais par l'admin.
- **Capacités déclarées** : `initiate`, `pollStatus`, `webhooks`
  (reverify ON) ; `refunds`, `settlements`, `payerFee` = `false`.
- **Recette** : `scripts/g3/payments-g3e-paydunya-recette.ts` —
  51/51 PASS (fixtures déterministes documentées, 0 appel réseau).
- **Questions contractuelles restantes** : inchangées (§8) —
  notamment champ `providerTxId` exact, comportement IPN en échec,
  tarifs, canal de remboursement et format des décomptes.
