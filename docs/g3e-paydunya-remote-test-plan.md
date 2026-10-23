# G3-E Phase 3A — Plan de recette PayDunya TEST distant

**Statut** : protocole préparé — **aucun appel distant n'est autorisé
à ce stade**. Exécution uniquement après GO Phase 3B et implémentation
de la voie TEST distante (§5).

## 1. Séparation des modes — implémentée en Phase 3B

Quatre axes distincts, désormais orthogonaux :

| Axe | Valeurs | Implémentation |
|---|---|---|
| **Mode opérationnel interne** (`PaymentProvider.mode`) | `SANDBOX` / `LIVE` | inchangé — `code==="SANDBOX"` forcé en SANDBOX |
| **Environnement technique distant** (`PaymentProvider.remoteEnv`) | `TEST` / `LIVE` (défaut `LIVE`, jamais reclassé) | ✅ enum `RemoteEnv` — `liveCallContext` injecte `env:"test"\|"live"` côté serveur |
| **Autorisation d'appel réseau** | `MOBILE_MONEY_REMOTE_TEST_ENABLED` (TEST) / `MOBILE_MONEY_LIVE_ENABLED` + `liveEnabled` (LIVE) | ✅ `checkRemoteExecution` dispatche sur l'env figé |
| **Autorisation de comptabilisation** | `recordPayment` | ✅ `isSimulated` inclut `remoteEnv==="TEST"` → `POSTING_SANDBOX_FORBIDDEN` au point transactionnel |

**Environnement figé** (`PaymentIntent.remoteEnv`, immuable) : créée
sous `remoteEnv=TEST`, l'intention reste TEST même si le prestataire
bascule en LIVE — secrets TEST résolus selon l'env figé, appels
`sandbox-api` seuls, confirmation technique possible (`CONFIRMED`)
sans jamais créer Payment, reçu, écriture ni reversement.

**Secrets par environnement** : `testCredentialsRef` /
`testWebhookSecretRef` (TEST) distincts de `credentialsRef` /
`webhookSecretRef` (LIVE) — séparation garantie par la configuration
serveur, pas par le préfixe des clés (contrôle complémentaire).

**Webhooks** : chaque IPN est authentifiée par l'un des secrets
configurés → `verifiedEnv` persisté dans la charge ; au traitement,
`verifiedEnv ≠ remoteEnv` figé → `ANOMALY ENV_MISMATCH`, jamais
d'encaissement. La re-vérification `confirm/{token}` utilise l'env
figé (sandbox-api + secrets TEST pour une intention TEST).

**Verrous indépendants** : `REMOTE_TEST_DISABLED` (TEST) et
`LIVE_DISABLED` (LIVE) — activer l'un n'active jamais l'autre.
Garde réseau : HTTPS + `app.paydunya.com` uniquement, redirections
interdites, aucun hôte libre, aucun fallback TEST→production.

Recette : `scripts/g3/payments-g3e-remoteenv-recette.ts` — **51/51**.

## 3. Protocole de recette distant (scénarios)

| # | Scénario | Support sandbox officiel | Couverture si non supporté |
|---|---|---|---|
| 1 | Création facture TEST → `response_code 00` + `token` + URL de redirection | ✅ `POST sandbox-api/…/create` | — |
| 2 | Redirection vers la page de paiement | ✅ URL `response_text` | vérification manuelle |
| 3 | Paiement TEST réussi (numéro sandbox) | ✅ si sandbox BF actif — **À CONFIRMER** | mock si indisponible |
| 4 | Paiement TEST refusé | ⚠️ À CONFIRMER (sandbox génère-t-il `failed` ?) | mock |
| 5 | Paiement abandonné (`pending` résiduel → expiration) | ⚠️ À CONFIRMER (TTL documenté ?) | mock + observation |
| 6 | Consultation statut `confirm/{token}` | ✅ GET documenté | — |
| 7 | Réception IPN réelle sur `/api/webhooks/mobile-money/{providerId}` | ⚠️ sandbox émet-il des IPN ? — **À CONFIRMER** | IPN signée de la test MasterKey, postée manuellement |
| 8 | IPN dupliquée | ⚠️ dépend de #7 | rejeu manuel du même body |
| 9 | Confirmation tardive (cron rattrape une intention PENDING) | ✅ dérivable de #5+#6 | mock |
| 10 | Montant/devise : vérifier `invoice.total_amount` + devise réelle de la réponse | ✅ observable | — |
| 11 | Identification école : clés école B sur provider A → rejet | ✅ deux comptes/applications TEST | mock croisé |
| 12 | Absence de double encaissement (poll + IPN concurrents) | ✅ invariant déjà prouvé en mock (67/67) | rejeu concurrent distant |
| 13 | **Absence de comptabilisation réelle** : aucune écriture `Payment`/ledger pour une facture TEST | ✅ barrière §2 | assertion SQL |
| 14 | Champ exact `providerTxId` dans `confirm` réel | ✅ observable — trancher §8 spec | ajuster mapping si besoin |
| 15 | Nettoyage : fixtures école/intentions/webhooks supprimées | ✅ | recette cleanup |

Critère de sortie : chaque scénario distant documente la **réponse
réelle** (codes, champs, libellés) — les divergences alimentent la
matrice §4 avant tout ajustement de code.

## 4. Matrice des écarts documentation ↔ implémentation

| Élément | Documenté | Implémenté | Écart / incertitude |
|---|---|---|---|
| En-têtes auth | `PAYDUNYA-{MASTER,PRIVATE,PUBLIC}-KEY`, `PAYDUNYA-TOKEN` | idem | ✅ conforme |
| Base sandbox/live | `sandbox-api/v1` / `api/v1` | constantes codées, choix serveur | ✅ conforme — mais **aucune voie vers sandbox** (§1) |
| Create | `POST /checkout-invoice/create`, `invoice/store/custom_data/actions` | idem | ✅ ; `return_url`/`cancel_url` non envoyés — À CONFIRMER si nécessaires |
| Statut | `GET /checkout-invoice/confirm/{token}` | idem | ✅ conforme |
| Statuts | `completed/pending/cancelled/failed` | + tolérances `canceled/expired/processing` | ⚠️ tolérances non documentées — fail-safe (inconnu→PENDING), à aligner sur réponse réelle |
| `providerTxId` | champ transaction | `res.transaction_id ?? invoice.transaction_id` | ⚠️ **champ exact À CONFIRMER sur réponse réelle** |
| IPN | form-urlencoded `data[…]`, `hash=sha512(masterKey)` | idem + variante `data` JSON | ✅ conforme ; variante JSON tolérée (non documentée, inoffensive) |
| Champs IPN | `invoice.token`, `status`, `fail_reason`, `custom_data`… | lus | ⚠️ structure exacte à valider sur IPN réelle |
| Erreurs | `response_code != "00"` | `ProviderBusinessError(PAYDUNYA_XX)` | ✅ ; catalogue des codes non exhaustif dans la doc |
| Timeout | non spécifié | 15 s AbortController | choix interne — OK |
| Montant/devise | `invoice.total_amount`, devise du compte | lus + comparés à l'intention | ⚠️ champ devise exact À CONFIRMER (XOF attendu) |

**Jamais de convention inventée** : les champs ⚠️ restent des
incertitudes jusqu'à observation d'une réponse réelle ; les statuts
inconnus retombent sur PENDING, jamais SUCCESS.

## 5. Sécurité des tests distants (propositions à implémenter en 3B)

| Risque | Barrière |
|---|---|
| Appel vers `api` production | `remoteEnv=TEST` → base `sandbox-api` uniquement ; vérification de préfixe `test_` sur les clés ; assertion en recette qu'aucune URL `api/v1` n'est contactée |
| Activation LIVE globale | `MOBILE_MONEY_LIVE_ENABLED` reste absent — la voie TEST a son propre commutateur ; la recette vérifie le verrou OFF pendant l'exécution |
| Vrais moyens de paiement | clés `test_*` structurellement incapables d'encaisser ; numéros sandbox uniquement |
| Comptabilisation depuis TEST | marqueur figé à la création de l'intention → `recordPayment` refusé ; assertion SQL `0 Payment` sur les intentions TEST |
| Remboursement réel | `capabilities.refunds=false` + `REFUND_UNSUPPORTED` — inchangé |
| Mélange inter-écoles | provider scopé `schoolId`, résolution `(providerId, providerRef)`, clés distinctes par fixture |
| IPN forgée | hash vérifié (test MasterKey) + re-vérification `confirm/{token}` obligatoire — l'IPN ne confirme jamais seule |
| Secret en clair | valeurs en `shared/.env` 600 ; rapports = références seules ; `*Ref` exclus des listes ; hash `[redacted]` |

Aucune protection existante n'est désactivée : la voie TEST **ajoute**
une barrière, elle ne retire rien.

## 6. Prérequis manquants

| # | Prérequis | Type |
|---|---|---|
| 1 | Compte PayDunya Business TEST (clés `test_*`) — gratuit | action client |
| 2 | Voie TEST distante en code | ✅ **Phase 3B livrée** |
| 3 | Réponses contractuelles §8 spec (providerTxId, IPN sandbox, tarifs…) | en attente |
| 4 | École fixture dédiée (pas une vraie école) | création recette 3C |
| 5 | Secrets TEST posés dans `shared/.env` préprod (`PAYDUNYA_TEST_*`) | ops 3C |

## 7. Recommandation

**GO technique pour la Phase 3C** : la voie TEST distante existe
(`remoteEnv`, commutateur dédié, barrière comptabilisation, IPN
séparées — 51/51 en recette locale). Reste conditionné à : compte
PayDunya Business TEST ouvert, secrets `test_*` provisionnés dans
l'environnement, GO explicite pour les premiers appels `sandbox-api`
et le déploiement de cette évolution en préproduction.
