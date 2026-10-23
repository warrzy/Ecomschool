# G3-E Phase 3A — Plan de recette PayDunya TEST distant

**Statut** : protocole préparé — **aucun appel distant n'est autorisé
à ce stade**. Exécution uniquement après GO Phase 3B et implémentation
de la voie TEST distante (§5).

## 1. Audit de la séparation des modes (constat Phase 3A)

Quatre axes distincts doivent rester orthogonaux :

| Axe | Valeurs | État actuel |
|---|---|---|
| **Mode opérationnel interne** (`PaymentProvider.mode`) | `SANDBOX` (simulateur interne, 0 réseau) / `LIVE` (adaptateur réel) | ✅ implémenté — `code==="SANDBOX"` forcé en SANDBOX |
| **Environnement technique distant** (`sandbox-api` vs `api`) | `test` / `live` | ⚠️ **conflété** : `liveCallContext` injecte `env:"live"` codé en dur pour tout provider `mode=LIVE` → toujours `api/v1` (production). **Aucune voie légitime vers `sandbox-api`.** |
| **Autorisation d'appel réseau** | verrou `MOBILE_MONEY_LIVE_ENABLED` + `liveEnabled` + `ACTIVE` + secrets | ✅ implémenté (`checkLiveExecution`) — mais binaire : appeler en TEST exigerait d'ouvrir le verrou LIVE, ce qui pointerait vers `api/v1` |
| **Autorisation de comptabilisation** | `recordPayment` via `confirmIntent`/`postConfirmedIntent` | ✅ verrouillée sur chemin LIVE — mais **pas de barrière « appel distant sans comptabilisation »** |

**Constat bloquant** : aujourd'hui, tout appel réseau PayDunya exige
`MOBILE_MONEY_LIVE_ENABLED=true` **et** aboutit à la base **production**
(`env:"live"` injecté, `provider.config.env` écrasé côté serveur —
volontairement). Il est donc **impossible** de tester `sandbox-api`
sans contourner des protections — ce qui est interdit.

## 2. Voie TEST distante proposée (à implémenter en 3B)

| Élément | Proposition |
|---|---|
| `PaymentProvider.remoteEnv` | `TEST` \| `LIVE` (défaut `LIVE` pour compatibilité ; champ figé à la création ou contrôlé ops). `config.remoteEnv:"test"` en alternative : la config ne peut que **descendre** vers TEST, jamais monter vers LIVE — direction sûre. |
| `liveCallContext` | `env = provider.remoteEnv === "TEST" ? "test" : "live"` — toujours choisi côté serveur. L'adaptateur retombe déjà sur `sandbox-api` quand `env ≠ "live"` (fail-safe existant). |
| Barrière réseau TEST | `MOBILE_MONEY_REMOTE_TEST_ENABLED === "true"` (nouvelle variable, distincte du verrou LIVE) + `mode=LIVE` + `remoteEnv=TEST` + `ACTIVE` + adaptateur enregistré + **clés préfixées `test_`** vérifiées avant tout appel. |
| Barrière de comptabilisation | intention créée sous `remoteEnv=TEST` marquée à la création (`sandboxScript`-like figé ou flag dédié) → `confirmIntent`/`postConfirmedIntent` refusent `recordPayment` pour elle : statut confirmable, **jamais d'écriture de ledger**. |
| Chemins async | webhooks IPN TEST : stockés + vérifiés localement (test MasterKey), re-vérifiés via `sandbox-api`, jamais comptabilisés ; cron `pollUncertainIntents` soumis à la même barrière. |
| Remboursements | `REFUND_UNSUPPORTED` inchangé — aucun remboursement même TEST. |

Règle absolue : **la voie TEST distante ne réutilise ni le verrou LIVE
ni `liveEnabled`**. Une intention TEST ne peut pas devenir opérationnelle
par rejeu, rotation ou bascule de configuration.

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
| 2 | Voie TEST distante en code (§2 : `remoteEnv`, commutateur, barrière comptabilisation) | **code — GO 3B requis** |
| 3 | Réponses contractuelles §8 spec (providerTxId, IPN sandbox, tarifs…) | en attente |
| 4 | École fixture dédiée (pas une vraie école) | création recette |
| 5 | Décision champ `remoteEnv` (colonne vs `config.remoteEnv`) | design 3B |

## 7. Recommandation

**NO GO pour les premiers appels distants aujourd'hui** : le build
actuel ne peut joindre que `api/v1` (production) — toute tentative
d'appel TEST passerait par le verrou LIVE vers le mauvais endpoint.
Les appels `sandbox-api` exigent l'implémentation de la voie TEST (§2)
en Phase 3B — travail local, mêmes recettes, puis GO séparé pour les
appels distants.
