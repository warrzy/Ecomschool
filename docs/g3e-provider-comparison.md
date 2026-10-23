# G3-E Phase 2A — Comparaison des prestataires Mobile Money (Burkina Faso)

**Statut du document** : préparation technique. Aucun paiement réel, aucun
secret, aucun appel API de paiement n'a été effectué. Toutes les
informations proviennent de documentations officielles publiquement
accessibles au 23/10/2026 ; chaque ligne est marquée
**CONFIRMÉ** (documenté publiquement), **NON CONFIRMÉ** (non trouvé dans
la documentation officielle consultée) ou **À DEMANDER AU PRESTATAIRE**
(information contractuelle/commerciale).

## 1. Prestataires examinés

| Prestataire | Type | Documentation officielle consultée |
|---|---|---|
| **PayDunya** | Agrégateur (Sénégal, couvre l'UEMOA) | developers.paydunya.com — CONFIRMÉ accessible |
| **Orange Money BF (direct)** | Opérateur | developer.orange.com + connect.orange.bf — CONFIRMÉ accessible |
| **Moov Money BF (direct)** | Opérateur | Aucune documentation API publique trouvée — NON CONFIRMÉ |
| **LigdiCash** | Agrégateur burkinabè | developers.ligdicash.com — CONFIRMÉ accessible |
| **CinetPay** | Agrégateur (CI, multi-pays) | docs.cinetpay.com — CONFIRMÉ accessible |
| **E-Pay BF** | Agrégateur burkinabè | epaybf.com/developer.html — CONFIRMÉ accessible (documentation sommaire) |
| **IntaSend** | Agrégateur (Kenya, multi-pays) | developers.intasend.com — CONFIRMÉ accessible |
| **PayPilot** | Agrégateur | docs.pilotpay.pro — CONFIRMÉ accessible (partiel) |

## 2. Fiche par prestataire

### 2.1 PayDunya

| Élément | Statut | Détail documenté |
|---|---|---|
| Pays couverts | CONFIRMÉ | SN, CI, BJ, **BF**, TG, ML, CM |
| Orange Money BF | CONFIRMÉ | Canal `orange-money-burkina` |
| Moov Money BF | CONFIRMÉ | Canal `moov-burkina-faso` |
| API création paiement | CONFIRMÉ | PAR (redirection) : `POST {base}/checkout-invoice/create` → `token` + URL de paiement ; SoftPay (direct) : `softpay/orange-money-burkina`, `softpay/moov-burkina-faso` |
| Consultation du statut | CONFIRMÉ | `checkout-invoice/confirm/{token}` → `response_code` + statut |
| Webhooks (IPN) | CONFIRMÉ | POST `application/x-www-form-urlencoded` vers `callback_url` configurée dans `actions.callback_url` ; charge `data` incluant `status`, `invoice.token`, `hash` |
| Vérification webhook | CONFIRMÉ | `data.hash` = **SHA-512 de la MasterKey** — comparaison en temps constant suffisante ; le hash est statique par compte (pas de nonce/horodatage : la protection anti-rejeu repose sur notre déduplication `externalId`/`token`) |
| Authentification API | CONFIRMÉ | En-têtes `PAYDUNYA-MASTER-KEY`, `PAYDUNYA-PRIVATE-KEY`, `PAYDUNYA-TOKEN` |
| Remboursements | NON CONFIRMÉ | Pas d'API de remboursement de paiement documentée ; l'**API PUSH (déboursement)** existe (`account_alias`, `amount`, `withdraw_mode`, `callback_url`) et pourrait servir de canal de remboursement — activation contractuelle requise |
| Reversements | NON CONFIRMÉ | Pas d'API de décompte documentée ; rapports Excel/PDF téléchargeables dans le back-office ; le solde se consulte via API `get_balance` |
| Frais/commissions | À DEMANDER | Non publiés dans la documentation ; grilles contractuelles |
| Sandbox | CONFIRMÉ | Mode TEST explicite (`sandbox-api/v1/…`, clés `test_*`) |
| Accès production | À DEMANDER | Activation « MODE PRODUCTION » après création d'application ; conditions KYB non détaillées publiquement |
| Idempotence | NON CONFIRMÉ | Pas d'en-tête d'idempotence documenté ; le `token` de facture sert de référence de rejeu |

### 2.2 Orange Money BF (direct)

| Élément | Statut | Détail documenté |
|---|---|---|
| Pays | CONFIRMÉ | BF listé sur le portail Orange Burkina (connect.orange.bf) |
| API création paiement | CONFIRMÉ | **Orange Money Webpay** : OAuth2 `client_credentials` (`/oauth/v3/token`) puis `POST /orange-money-webpay/{env}/v1/webpayment` → `pay_token` + `payment_url` (flux **par redirection**) ; Basic Auth sur le jeton, Bearer ensuite |
| Consultation du statut | CONFIRMÉ | Endpoint `transactionstatus` documenté dans l'API Webpay |
| Webhooks | CONFIRMÉ | `notif_url` fournie à l'initiation ; contenu/format détaillé dans l'espace partenaire après souscription |
| Signature webhook | NON CONFIRMÉ | Mécanisme de vérification non détaillé publiquement |
| Remboursements | NON CONFIRMÉ | Aucune API de remboursement Webpay publique |
| Reversements | À DEMANDER | Compte marchand Orange Money — modalités de reversement contractuelles |
| Sandbox | CONFIRMÉ | Environnement de test gratuit annoncé (connect.orange.bf) |
| Accès production | CONFIRMÉ (processus) | Dossier marchand lourd : RCCM, statuts, IFU, CNIB dirigeant, casier judiciaire, RIB, ordre de compensation, fiche descriptive — **par établissement** |
| Moov Money | NON APPLICABLE | Opérateur unique (Orange uniquement) |

### 2.3 Moov Money BF (direct)

| Élément | Statut | Détail |
|---|---|---|
| Documentation publique | NON CONFIRMÉ | Aucun portail développeur public trouvé ; SDK PHP communautaire (`garboko/moov-money-burkina-sdk`) — **non officiel** |
| Tout le reste | À DEMANDER | Contacter Moov Africa BF pour les conditions d'accès marchand |
| Via agrégateur | CONFIRMÉ | `moov-burkina-faso` (PayDunya), `MOOVBF` (CinetPay), Moov BF (LigdiCash, E-Pay, IntaSend) |

### 2.4 LigdiCash

| Élément | Statut | Détail documenté |
|---|---|---|
| Pays | CONFIRMÉ | BF natif (agrégateur burkinabè) + couverture régionale |
| Orange Money BF | CONFIRMÉ | `operator_id` documenté |
| Moov Money BF | CONFIRMÉ | `operator_id = 12`, USSD Push + repli USSD guidé |
| API création paiement | CONFIRMÉ | Payin direct `POST /pay/v01/straight/checkout-invoice/create` + payin hébergé (page LigdiCash) |
| Consultation du statut | CONFIRMÉ | Endpoint `confirm` : `…/checkout-invoice/confirm?invoiceToken=…` |
| Webhooks | CONFIRMÉ | `callback_url` par transaction ; **2 POST par événement** (form-urlencoded + JSON) → déduplication documentée et attendue |
| Vérification webhook | CONFIRMÉ | **Ré-vérification** : ne jamais faire confiance au payload ; appeler `confirm` avec le token stocké à la création — modèle fort |
| Authentification | CONFIRMÉ | `Apikey` + `Authorization: Bearer` ; projet API créé par LigdiCash **après signature du contrat** |
| Remboursements | CONFIRMÉ (canal) | Via **Payout Marchand** `POST /pay/v01/straight/payout` (cas d'usage « remboursement de commande » documenté) — les frais contractuels s'appliquent au payout |
| Reversements | À DEMANDER | Pas d'API de décompte publique identifiée |
| Sandbox | À DEMANDER | Environnement de test mentionné ; conditions d'accès liées au contrat |
| Multi-projets | CONFIRMÉ | Plusieurs projets API par compte, **un contrat par projet** → compatible avec un compte marchand par école |

### 2.5 CinetPay

| Élément | Statut | Détail documenté |
|---|---|---|
| Pays | CONFIRMÉ | Multi-pays dont **BF** |
| Orange Money BF | CONFIRMÉ | `OMBF` (préfixes 06/07/54-57/64-67/74-77) |
| Moov Money BF | CONFIRMÉ | `MOOVBF` (préfixes 01/02/51-53/60-63/70-73) |
| API création paiement | CONFIRMÉ | `POST https://api-checkout.cinetpay.com/v2/payment` (apikey + site_id + transaction_id) → lien de paiement (redirection) ; paiement direct « PUSH » disponible |
| Consultation du statut | CONFIRMÉ | `POST /v2/payment/check` (re-vérification par `transaction_id`) |
| Webhooks | CONFIRMÉ | `notify_url` ; vérification recommandée par appel `payment/check` |
| Codes d'erreur | CONFIRMÉ | Tableau documenté (00 succès, 600 échec, 602 solde insuffisant, 623/662/663 attente client, 627 annulé…) |
| Remboursements | CONFIRMÉ (canal) | API de Transfert (payouts vers mobile money) |
| Reversements | À DEMANDER | |
| Contrainte montant | CONFIRMÉ | **Montant multiple de 5** |
| Sandbox | CONFIRMÉ | Compte test/sandbox annoncé |
| Accès production | À DEMANDER | Abonnement service (« ABONNEMENT_OR_TRANSACTIONS_EXPIRED ») |

### 2.6 Autres

| Prestataire | BF | Note |
|---|---|---|
| **E-Pay BF** | CONFIRMÉ (OM + Moov) | `checkout-sessions` + Bearer `pk_live_*` + webhook ; page hébergée ; documentation publique sommaire — périmètre (reversements, remboursements) À DEMANDER |
| **IntaSend** | CONFIRMÉ (OM + Moov via `INTASEND-XB`) | Push mobile money + payouts + webhooks ; structure juridique hors BF — À DEMANDER (compte local, XOF natif) |
| **PayPilot** | CONFIRMÉ (`moov_money` BF) | Documentation direct API ; Orange BF non confirmé dans les extraits consultés |

## 3. Matrice de comparaison

| Critère | PayDunya | Orange Money direct | LigdiCash | CinetPay | Moov direct |
|---|---|---|---|---|---|
| Couverture BF (OM + Moov) | ✅ les deux | ❌ OM seul | ✅ les deux | ✅ les deux (+Wave) | ❌ Moov seul |
| Doc officielle accessible | ✅ complète | ✅ (compte requis pour détails) | ✅ complète | ✅ complète | ❌ |
| API création | ✅ redirect + direct | ✅ redirect | ✅ direct + hébergé | ✅ redirect + PUSH | ❌ |
| Statut | ✅ confirm | ✅ transactionstatus | ✅ confirm | ✅ payment/check | ❌ |
| Webhook vérifiable | ✅ hash SHA-512(MasterKey) | ⚠️ format non public | ✅ re-vérification confirm | ✅ re-vérification check | ❌ |
| Canal remboursement | ⚠️ déboursement (à activer) | ❌ non documenté | ✅ payout marchand | ✅ transfert | ❌ |
| Reversements API | ❌ | À DEMANDER | À DEMANDER | À DEMANDER | ❌ |
| Sandbox | ✅ mode TEST | ✅ | ⚠️ après contrat | ✅ | ❌ |
| Intégration sans redirection | ✅ SoftPay | ❌ (redirect) | ✅ | ✅ PUSH | ❌ |
| Contrat par école | ✅ compte Business par école | ✅ mais dossier lourd | ✅ 1 contrat/projet | ✅ site_id par école | À DEMANDER |
| Frais documentés | ❌ contractuels | ❌ | ❌ contractuels | ❌ contractuels | ❌ |

## 4. Modèle marchand — compatibilité ECOM-SCHOOL

Notre modèle (`PaymentProvider` scopé `schoolId`, `merchantRef`,
`credentialsRef` par école) suppose **un compte marchand par
établissement** :

| Modèle | Faisabilité | Avis |
|---|---|---|
| Compte marchand par école | ✅ tous les agrégateurs examinés (PayDunya Business, LigdiCash projet/contrat, CinetPay site_id) | **Recommandé** — fonds collectés directement au nom de l'école, aucun passage par le compte ECOM-TOUCH, isolation native |
| Compte central ECOM-SCHOOL + sous-comptes | ⚠️ PayDunya PER (Paiement Et Redistribution) permet des virements inter-comptes ; LigdiCash multi-projets | **À NE PAS choisir sans validation juridique** — collecter pour le compte de tiers relève d'une activité réglementée (agent/établissement de paiement) |
| Compte central + reversement interne | ⚠️ même risque réglementaire | Même réserve — les `PaymentSettlement` G3-D modélisent déjà le reversement prestataire→école, pas plateforme→école |

**Décision retenue** : compte marchand par école. La plateforme ne
collecte jamais les fonds ; chaque école signe son propre contrat et
renseigne ses propres références de secrets.

## 5. Compatibilité avec l'architecture existante

| Élément ECOM-SCHOOL | PayDunya | LigdiCash | CinetPay |
|---|---|---|---|
| `PaymentProviderAdapter.initiate` | ✅ `checkout-invoice/create` → `providerRef = token`, instructions = URL | ✅ `checkout-invoice/create` → `providerRef = token` | ✅ `/v2/payment` → `providerRef = transaction_id` |
| `checkStatus` | ✅ `confirm/{token}` | ✅ `confirm?invoiceToken` | ✅ `payment/check` |
| `verifyWebhook` | ✅ comparer `data.hash` à SHA-512(MasterKey) | ⚠️ payload non signé → pattern « ré-vérifier via confirm » dans le handler webhook | ⚠️ idem |
| `initiateRefund` | ⚠️ via API PUSH (déboursement) — capacité à déclarer `refunds: false` tant que non validée | ✅ payout marchand | ⚠️ API transfert (payout ≠ refund lié) |
| `fetchSettlements` | ❌ capacité `settlements: false` | ❌ | ❌ |
| `PaymentIntent` | ✅ | ✅ | ✅ |
| `WebhookEvent` (dédup `externalId`) | ✅ `token` + statut | ✅ `transaction_id` + dédup des 2 POST | ✅ `transaction_id` |
| `PaymentReconciliation` | ✅ frais contractuels saisis manuellement | ✅ | ✅ |
| `PaymentSettlement` (déclaré) | ✅ canal manuel documenté | ✅ | ✅ |
| `PaymentRefund` | ⚠️ attente réponse prestataire | ✅ workflow compatible | ⚠️ |
| Verrou LIVE (`checkLiveExecution`) | ✅ inchangé | ✅ | ✅ |

**Point d'attention webhooks** : PayDunya (hash statique), LigdiCash et
CinetPay (payload non signé + ré-vérification) nécessitent une adaptation
de `verifyWebhook` : pour les modèles sans signature cryptographique par
événement, `verifyWebhook` normalise l'événement puis `checkStatus`
re-vérifie avant comptabilisation — compatible avec notre chaîne
`WebhookEvent → confirmIntent` qui exige déjà une confirmation fiable.

## 6. Recommandation

**Premier prestataire recommandé : PayDunya**, suivi de **LigdiCash**.

Arguments pour PayDunya :
- Documentation officielle la plus complète et publiquement vérifiable
  (endpoints, en-têtes, IPN, codes réponse, sandbox).
- **Les deux opérateurs BF** (Orange + Moov) en un seul contrat.
- Mode TEST gratuit → recette de conformité possible sans contrat.
- Flux PAR (redirection) + SoftPay (direct) : on commence par PAR
  (simple), SoftPay reste une option UX ultérieure.
- Modèle un compte Business par école — zéro collecte centralisée.

Arguments pour LigdiCash (2ᵉ ou alternative) :
- Agrégateur **burkinabè** — support local, connaissance du terrain.
- Sécurité webhook forte (ré-vérification systématique documentée).
- Canal de remboursement explicite (payout marchand).
- Limite : projet API créé uniquement **après signature du contrat** —
  pas de sandbox libre pour la conformité préalable.

CinetPay est un bon 3ᵉ candidat (codes d'erreur très documentés, contrainte
« multiple de 5 » à gérer). Orange Money direct exige un dossier KYA lourd
**par école** et ne couvre que OM — pertinent seulement si une grande école
demande un raccordement direct. Moov direct n'a pas de documentation
publique.

**Incertitudes majeures** (voir §7 — questions) : tarifs contractuels,
API de décompte/reversement, remboursement lié vs payout, disponibilité
réelle du canal BF en production PayDunya, délais d'activation.

## 7. Questions contractuelles à transmettre au prestataire

### À PayDunya (et à poser à chaque candidat)

1. Le canal `orange-money-burkina` et `moov-burkina-faso` sont-ils
   **actifs en production** pour un compte BF ? Restrictions ?
2. Grille tarifaire par canal (fixe + %) ; qui supporte les frais
   (marchand/payeur) ; frais sur remboursement/payout ?
3. Montants min/max par transaction et par jour ?
4. L'IPN est-elle garantie au moins une fois ? Rejeu automatique en cas
   d'échec HTTP ? Délai typique après paiement ?
5. La signature IPN (`sha512(masterKey)`) est-elle le seul mécanisme ?
   Un secret par notification ou horodatage existe-t-il ?
6. L'API PUSH (déboursement) peut-elle rembourser vers le numéro payeur
   d'origine ? Activation, délai, plafond ?
7. Existe-t-il un identifiant d'opération prestataire stable
   (`providerTxId`) distinct du token de facture ?
8. Décomptes/reversements : fréquence, référence bancaire, format
   (CSV/API ?), détail par transaction (brut/frais/net) ?
9. Un solde peut-il rester bloqué (« reserve ») ? Conditions ?
10. Litiges/chargebacks : processus, délais, documentation ?
11. SLA, support technique (tech@paydunya.com), délai de réponse ?
12. Conditions exactes d'activation production (documents, délai) ?
13. Un compte Business par école est-il le modèle attendu ? Tarification
    groupe/plateforme possible ?
14. Durée de conservation des données de transaction consultables ?
15. Le montant d'un IPN peut-il différer du montant demandé (frais
    payeur) ? Champ exact du montant net encaissé ?

## 8. URLs officielles à vérifier manuellement

- PayDunya : https://developers.paydunya.com/doc/FR/introduction —
  sections http_json, api_softpay_index, api_deboursement, get_balance
- Orange BF : https://connect.orange.bf/guide-demarrage et
  https://developer.orange.com/apis/om-webpay
- LigdiCash : https://developers.ligdicash.com/en/payment-api/callback/security
- CinetPay : https://docs.cinetpay.com/api/1.0-fr/checkout/initialisation
- E-Pay BF : https://epaybf.com/developer.html
- Moov BF : aucun portail public identifié — contact commercial Moov
  Africa Burkina requis.
