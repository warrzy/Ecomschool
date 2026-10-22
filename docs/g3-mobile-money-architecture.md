# G3 — Mobile Money : architecture cible et plan de réalisation

Document de cadrage — **aucun code métier G3 n'est développé dans ce lot**,
aucun paiement réel n'est activé, aucun prestataire n'a été contacté.
Base d'analyse : release `20261022_223122`, commit `4dc3128`.

## 1. Analyse des services existants (réutilisables)

### Ce qui existe déjà et doit être réutilisé

| Élément | Rôle | Réutilisation G3 |
|---|---|---|
| `Payment` | Encaissement **confirmé** uniquement : créé `VALIDATED`, reçu émis dans la même transaction | Point d'arrivée unique : un paiement MM n'existe qu'après confirmation prestataire |
| `Payment.idempotencyKey` | `@@unique([schoolId, idempotencyKey])` | Clé `mm:{intentId}` → dédup confirmation webhook/polling |
| `PaymentMethod.MOBILE_MONEY` | Déjà dans l'enum + libellé UI | Méthode des paiements confirmés MM |
| `recordPayment()` | Transaction `Serializable` + retry P2034, répartition FIFO sur échéances, garde `OVERPAYMENT`, `receiptNumber` `REC-YYYY-#####`, `receiptSnapshot` immuable, audit | Appelé tel quel à la confirmation — **aucune duplication du moteur** |
| `PaymentAllocation` | Paiement ↔ échéances | Géré par `recordPayment` |
| `cancelPayment()` | `CANCELLED` audité, garde `CLOSED_DAY` | Effet comptable d'un remboursement validé |
| `CashClosure` | Clôture journalière, blocage encaissements | Point d'attention : confirmation tardive après clôture (§6) |
| `FeeInstallment` / `listUnpaid()` | Échéances et soldes | Calcul du montant payable lors de l'initiation |
| `Job` + `enqueueJob`/`registerJobHandler`/`runDueJobs` + `dedupKey` | File de tâches avec retries | Polling de confirmation, balayage des expirations |
| `/api/cron` (`CRON_SECRET`, comparaison `timingSafeEqual`) | Exécution planifiée | Job `payments.poll` + `payments.expire` |
| `Notification` / `notifyUsers` | Notifications internes | Confirmation au parent/agent |
| `AuditLog` / `logAudit` | Journal | Toutes les transitions du cycle de paiement |
| `FeeDiscount` | Réductions | Soldes déjà nets dans `recordPayment` |

### Ce qui manque et doit être ajouté

- Aucun état « en cours » : `Payment` n'a que `VALIDATED/CANCELLED`
  → une couche `PaymentIntent` est nécessaire en amont.
- Aucune route webhook ni vérification de signature.
- Aucune traçabilité des échanges prestataire (réf. transaction,
  payload, erreurs).
- Pas de remboursement partiel ni de modèle refund.
- `receivedById` sur `Payment` attend un `User` → prévoir un compte
  technique `SYSTEM` par école (ou l'agent initiateur selon le canal).

## 2. Architecture cible

```
┌────────────┐   initiation    ┌──────────────────┐   appel API
│ Parent /   │ ──────────────▶ │  PaymentIntent   │ ──────────────▶ ProviderAdapter
│ Caissier   │ ◀────────────── │  (PENDING)       │  initiate()     (Orange/Moov/Agrég.)
└────────────┘   instructions  └────────┬─────────┘
                                        │                 ▲
              webhook signé             │  checkStatus()  │ polling (Job)
┌────────────┐  /api/payments/          │                 │
│ Prestataire│ ─webhooks/{provider}──▶ WebhookEvent       │
└────────────┘   (vérif. signature)     │                 │
                                        ▼                 │
                              confirmIntent() : dédup via
                              idempotencyKey + statut serveur
                                        │
                                        ▼
                              recordPayment()  ── moteur existant
                              (allocations, reçu REC-####,
                               audit, OVERPAYMENT)
                                        │
                                        ▼
                              Payment VALIDATED + Notification
                              + intent CONFIRMED + providerTxId
```

**Abstraction prestataire** — interface unique, un adaptateur par
prestataire, un adaptateur `sandbox` pour les recettes sans argent réel :

```ts
interface PaymentProviderAdapter {
  code: string;                       // ORANGE_MONEY | MOOV_MONEY | AGGREGATOR | SANDBOX
  initiate(i: IntentData): Promise<InitiateResult>;   // providerRef + instructions
  checkStatus(providerRef: string): Promise<ProviderStatus>; // SUCCESS|FAILED|PENDING
  refund(tx: RefundData): Promise<RefundResult>;
  verifyWebhook(req: RawRequest): { valid: boolean; eventId: string; txId: string; status: ProviderStatus };
}
```

L'agrégateur (CinetPay, PayDunya, etc.) est un **adaptateur comme les
autres** : il factorise contrat + intégration multi-opérateurs au prix
d'une commission. Le choix est une décision métier (§8), pas une
contrainte d'architecture.

## 3. Modèles de données proposés (additifs)

```prisma
model PaymentProvider {          // config par école
  id, schoolId, code,           // ORANGE_MONEY | MOOV_MONEY | AGGREGATOR
  label, mode (SANDBOX|LIVE), status,
  credentialsRef String,        // nom de variable d'env — JAMAIS le secret en base
  webhookSecretRef String,      // idem
  merchantRef String?,          // code marchand / msisdn
  @@unique([schoolId, code])
}

model PaymentIntent {
  id, schoolId, studentId, academicYearId,
  amount Int, currency @default("XOF"),
  payerPhone String,
  providerCode String,
  status IntentStatus,          // CREATED|PENDING|CONFIRMED|FAILED|EXPIRED|CANCELLED|CONFIRMED_PENDING_POSTING
  idempotencyKey String,        // @@unique([schoolId, idempotencyKey])
  expiresAt DateTime,
  initiatedById String?,        // parent (portail) ou agent (guichet)
  channel IntentChannel,        // PARENT_PORTAL | CASHIER_DESK
  providerRef String?,          // réf. de la session chez le prestataire
  paymentId String?,            // renseigné à la confirmation
  failureReason String?,
  transactions PaymentTransaction[]
  @@unique([schoolId, providerCode, providerRef])
}

model PaymentTransaction {      // chaque appel prestataire tracé
  id, schoolId, intentId,
  kind TxKind,                  // INITIATE|STATUS_CHECK|WEBHOOK|REFUND
  providerTxId String?,
  rawStatus String?, payload Json?,   // snapshots sans secrets
  createdAt
}

model WebhookEvent {            // réception brute, dédup
  id, providerCode, eventId,
  signatureValid Boolean,
  payload Json, receivedAt, processedAt?, processingError String?,
  @@unique([providerCode, eventId])
}

model PaymentReconciliation {   // rapprochement quotidien
  id, schoolId, providerCode, date,
  expected Int, confirmed Int, mismatches Json?,
  status ReconStatus,           // MATCHED|MISMATCH|PARTIAL
  @@unique([schoolId, providerCode, date])
}

model PaymentRefund {
  id, schoolId, paymentId, amount Int, reason String,
  status RefundStatus,          // REQUESTED|CONFIRMED|FAILED
  providerRefundId String?, initiatedById, processedAt?
}
```

`IdempotencyKey` n'est **pas** une table séparée : la clé vit sur
`PaymentIntent` (création) et `Payment` (encaissement), toutes deux en
`@@unique` par école — même stratégie que `recordPayment` actuel.
`WebhookEvent @@unique(providerCode, eventId)` couvre les notifications
rejouées.

## 4. Flux

### Initiation
1. Parent (portail) ou caissier choisit élève + échéance(s) → montant.
2. Validation : élève/année de l'école, montant > 0 ≤ solde dû
   (re-contrôlé à la confirmation par `OVERPAYMENT`).
3. `PaymentIntent PENDING` + `initiate()` → `providerRef` +
   instructions (push USSD / lien agrégateur). `expiresAt` = +15 min.
4. **Aucun `Payment` n'est créé à cette étape.**

### Confirmation (double canal, idempotent)
- **Webhook** `POST /api/payments/webhooks/{provider}` : signature
  vérifiée → `WebhookEvent` (dedup) → statut serveur → `confirmIntent()`.
- **Polling** : job `payments.poll` balaye les `PENDING` →
  `checkStatus()` → même `confirmIntent()`. Couvre les webhooks perdus.
- `confirmIntent()` : verrou sur l'intention → si déjà `CONFIRMED`,
  retour idempotent → sinon `recordPayment` avec
  `method: MOBILE_MONEY`, `reference: providerTxId`,
  `idempotencyKey: "mm:"+intentId` → intent `CONFIRMED` + `paymentId`
  + `Notification` au responsable + audit. Le reçu `REC-YYYY-#####`
  n'existe qu'à partir de là.

### Échec / expiration
- Statut prestataire FAILED → intent `FAILED` (+ motif, notification).
- `payments.expire` : `PENDING` dont `expiresAt` dépassé → `EXPIRED`.
- Annulation manuelle par l'agent → `CANCELLED`.

### Remboursement (v1 : intégral uniquement)
`PaymentRefund REQUESTED` → `refund()` prestataire → confirmation →
`cancelPayment()` sur le `Payment` (allocations libérées, audit) →
`CONFIRMED`. Remboursements partiels : lot ultérieur (réallocation
d'échéances à concevoir).

## 5. Règles de sécurité et finances

| Règle | Mécanisme |
|---|---|
| Jamais de double paiement | `idempotencyKey` unique (intent + payment) + verrou intention + `OVERPAYMENT` Serializable |
| Initié ≠ encaissé | `Payment` créé **uniquement** à la confirmation ; intentions sans `Payment` n'apparaissent ni en trésorerie ni sur les comptes élèves |
| Confirmation serveur | `checkStatus()` systématique, même quand le webhook dit « succès » |
| Webhooks sécurisés | HMAC signature (secret en env), `timingSafeEqual`, dedup `WebhookEvent`, rejet payload malformé, pas de GET mutatif |
| Notifications rejouées | `@@unique(providerCode, eventId)` + état idempotent |
| Rapprochement | `providerTxId` sur `Payment.reference` + `PaymentTransaction` + job `payments.reconcile` quotidien |
| Reçus après confirmation | `receiptNumber`/`receiptSnapshot` produits par `recordPayment` seul |
| Remboursements/annulations | `PaymentRefund` tracé + `cancelPayment` audité, motif obligatoire |
| Preuves conservées | `PaymentTransaction.payload` (sanitisé), `WebhookEvent.payload`, `AuditLog` complet |
| Préparation SYSCOHADA | `Payment` porte déjà élève/année/montant/méthode/référence ; `providerTxId` = pièce justificative externe ; les écritures futures se raccrochent à `payment.id` |
| Secrets | `credentialsRef/webhookSecretRef` = noms de variables d'env ; jamais de secret en base, en log ni en audit |

## 6. Point d'attention : clôture de caisse

`recordPayment` refuse un encaissement sur un jour clôturé
(`CLOSED_DAY`). Un paiement initié à 21 h confirmé à 23 h après
clôture échouerait → statut dédié `CONFIRMED_PENDING_POSTING` :
le job réessaie le lendemain (jour ouvert, `paidAt` = date de
comptabilisation) et la trésorerie reste cohérente. Décision à
valider : la date comptable est celle de l'imputation, pas de
l'initiation.

## 7. Plan de tests

Adaptateur `sandbox` simulant initiate/status/webhook — recette sans
argent réel, mêmes exigences que G2 :

- Initiation portail + guichet, permissions, isolation écoles.
- Webhook signé OK / signature invalide rejetée / eventId rejoué.
- Confirmation par webhook, par polling, par les deux (une seule fois).
- Deux confirmations concurrentes → un seul `Payment`, une seule
  série d'allocations, un seul reçu.
- Échec prestataire, expiration, annulation avant confirmation.
- `OVERPAYMENT` : intention > solde restant à la confirmation.
- `CLOSED_DAY` : confirmation post-clôture → `PENDING_POSTING` →
  imputation jour suivant.
- Remboursement intégral → `Payment` annulé, échéances libérées.
- Reçu émis uniquement après confirmation ; `recordPayment` non
  régressif (espèces/chèque/virement inchangés).
- Aucune donnée carte/secret dans logs, audit, payloads.

## 8. Découpage en sous-lots

| Lot | Contenu | Dépendances |
|---|---|---|
| G3-A | Migration additive (6 modèles), abstraction `PaymentProviderAdapter`, adaptateur `sandbox`, intentions guichet, jobs poll/expire | Aucune externe |
| G3-B | Routes webhook signées, `confirmIntent`, notification confirmation, `CONFIRMED_PENDING_POSTING` | G3-A |
| G3-C | Portail parent : « Payer en ligne » (intentions, instructions, suivi), reçu téléchargeable existant | G3-B |
| G3-D | Rapprochement quotidien, remboursements intégraux, écran admin intentions/transactions | G3-B |
| G3-E | Adaptateur réel (Orange Money **ou** agrégateur) en mode sandbox puis pilote | Contrat prestataire |

## 9. Dépendances externes et coûts (à confirmer, aucun engagement)

| Option | Couverture | Effort | Coût indicatif |
|---|---|---|---|
| Agrégateur UEMOA (CinetPay, PayDunya…) | OM + Moov + Wave en un contrat, webhooks normalisés | Faible | Commission par transaction (~2-3,5 %, à négocier) + éventuels frais fixes |
| Orange Money API directe | OM uniquement, meilleure marge | Moyen | Contrat marchand Orange, commission ~1-2 % |
| Moov Money API directe | Moov uniquement | Moyen | Contrat marchand Moov, commission à confirmer |

Recommandation : démarrer G3-A→D entièrement sur l'adaptateur
`sandbox` (zéro dépense, recette complète), puis décider agrégateur vs
direct selon pays cibles et volumes — l'interface prestataire rend le
choix réversible.

## 10. Recommandation de démarrage

**GO technique pour G3-A** dès validation métier du périmètre :
schéma additif, abstraction, sandbox, guichet — sans contact
prestataire. G3-B/C/D enchaînables sans dépendance externe. Le premier
contact commercial (agrégateur ou opérateur) n'est nécessaire qu'en
G3-E.

## 11. Durcissement G3-A — garanties d'atomicité et barrière sandbox

Durcissement appliqué avant déploiement préproduction (commit post-8e60720).

### Barrière SANDBOX / LIVE

- Une intention est « simulée » d'après un **marqueur serveur** :
  `provider.mode === "SANDBOX"`, `provider.code === "SANDBOX"`
  (l'adaptateur résolu reste le simulateur) ou `sandboxScript` figé à
  la création. Aucun paramètre client ni bascule rétroactive de mode
  ne peut requalifier une intention en LIVE.
- `confirmIntent` et `postConfirmedIntent` refusent toute
  comptabilisation d'une intention simulée
  (`POSTING_SANDBOX_FORBIDDEN`) sauf `__allowSandboxPosting` —
  indicateur **interne** jamais positionné par les actions serveur
  exposées, réservé aux recettes sur fixtures isolées et nettoyées.
- Un fournisseur LIVE sans adaptateur enregistré ni configuration
  sécurisée est refusé à la création (`PROVIDER_UNAVAILABLE`).

### Granularité des intentions

- L'unicité d'intention active porte sur l'**opération métier**
  `(schoolId, studentId, academicYearId, COALESCE(feeInstallmentId,''))`
  — index partiel `payment_intent_one_active_per_op` en base.
- Conséquences autorisées : échéances distinctes en parallèle,
  versements partiels successifs, nouvelle tentative après
  `FAILED`/`EXPIRED`/`CANCELLED`, opérations indépendantes.
- Protection conservée : doublon de la même opération (même cible,
  état actif) rejeté applicativement **et** par la contrainte.

### Garanties de reprise après incident

| Scénario | Garantie |
|---|---|
| 2 confirmations simultanées | Verrou `mm-confirm:{id}` — une seule passe, l'autre `already` |
| Timeout pendant la confirmation | Intention inchangée ou `PENDING_POSTING` — aucun encaissement perdu |
| Crash après confirmation prestataire, avant `recordPayment` | `CONFIRMED_PENDING_POSTING` persiste → `postConfirmedIntent` reprend |
| Crash après `recordPayment`, avant maj intention | Clé `mm:{intentId}` idempotente → le repost rattache le paiement existant, aucun doublon |
| Rejeu après redémarrage | Même clé + même contenu → même intention ; posting replays → `already` |
| Journée clôturée (`CLOSED_DAY`) | `CONFIRMED_PENDING_POSTING`, aucun `Payment` — repost après réouverture |
| Réouverture + repost | `recordPayment` rejoue la clé → rattachement, échéance soldée une fois |

### Dépendant de G3-B (non encore garanti)

- Fiabilité de la source de confirmation : aujourd'hui `pollPaymentIntent`
  (pull). En G3-B, webhooks signés + `WebhookEvent` dédupliqué.
- Repost automatique des `CONFIRMED_PENDING_POSTING` (job cron dédié).
- Notification famille/caisse après encaissement réel.
