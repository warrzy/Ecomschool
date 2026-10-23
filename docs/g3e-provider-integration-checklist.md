# G3-E — Dossier d'intégration des prestataires Mobile Money

> **Statut : Phase 1 — préparation technique uniquement.**
> Aucun appel réseau vers un opérateur réel n'existe dans le code.
> Aucun secret réel n'a été demandé ni stocké. Les informations
> « CONFIRMÉ » ci-dessous décrivent uniquement ce que **le code
> ECOM-SCHOOL garantit** — jamais une supposition sur une API
> prestataire. Tout ce qui relève du contrat opérateur est
> « À OBTENIR » tant qu'aucune documentation officielle vérifiée
> n'a été reçue.

Statuts utilisés : **CONFIRMÉ** (vérifié dans le code ou le contrat) ·
**À OBTENIR** (documentation/information officielle manquante) ·
**NON DISPONIBLE** (le prestataire ne le fournit pas — à confirmer) ·
**NON APPLICABLE** (hors périmètre).

---

## 1. Matrice des capacités déclarées (contrat `PaymentProviderAdapter`)

| Capacité du contrat | Description | SANDBOX (simulateur) | Orange Money BF | Moov Money BF | Agrégateur |
|---|---|---|---|---|---|
| `initiate` | Initiation d'un paiement | CONFIRMÉ | À OBTENIR | À OBTENIR | À OBTENIR |
| `pollStatus` | Consultation du statut (polling de secours) | CONFIRMÉ | À OBTENIR | À OBTENIR | À OBTENIR |
| `webhooks` | Réception + vérification de signature | CONFIRMÉ | À OBTENIR | À OBTENIR | À OBTENIR |
| `refunds` | Remboursement via API (`initiateRefund`) | CONFIRMÉ (simulé) | À OBTENIR | À OBTENIR | À OBTENIR |
| `settlements` | Consultation des décomptes (`fetchSettlements`) | CONFIRMÉ (simulé) | À OBTENIR | À OBTENIR | À OBTENIR |
| `payerFee` | Commission facturable au payeur | CONFIRMÉ (modèle) | À OBTENIR | À OBTENIR | À OBTENIR |

Une capacité non déclarée par l'adaptateur = **non disponible** : le
service n'appelle jamais une méthode absente. Si un prestataire ne
fournit pas d'API de décompte, la déclaration manuelle
(`PaymentSettlement.declared`) reste le seul canal — sans prétendre
à une preuve bancaire.

## 2. Checklist d'intégration — par prestataire

Renseigner chaque ligne à partir de la **documentation officielle**
fournie par l'opérateur. Ne jamais renseigner un endpoint, un tarif
ou un format « de mémoire ».

### 2.1 Identité et cadre contractuel

| Élément | Orange Money BF | Moov Money BF | Agrégateur |
|---|---|---|---|
| Nom juridique de l'entité contractante | À OBTENIR | À OBTENIR | À OBTENIR |
| Pays / régulateur (BCEAO, ARCEP) | À OBTENIR | À OBTENIR | À OBTENIR |
| Contrat marchand signé (référence, date) | À OBTENIR | À OBTENIR | À OBTENIR |
| Documentation officielle (version, URL, date) | À OBTENIR | À OBTENIR | À OBTENIR |
| Compte marchand par établissement possible | À OBTENIR | À OBTENIR | À OBTENIR |
| Contrat mutualisé multi-établissements | À OBTENIR | À OBTENIR | À OBTENIR |

### 2.2 Environnement et authentification

| Élément | Orange Money BF | Moov Money BF | Agrégateur |
|---|---|---|---|
| Environnement de test (sandbox prestataire) | À OBTENIR | À OBTENIR | À OBTENIR |
| Méthode d'authentification (OAuth2, clé API, certificat) | À OBTENIR | À OBTENIR | À OBTENIR |
| Format et rotation des secrets | À OBTENIR | À OBTENIR | À OBTENIR |
| Secrets stockés : **variables d'environnement uniquement** — jamais en base, jamais côté navigateur | CONFIRMÉ (code) | CONFIRMÉ (code) | CONFIRMÉ (code) |
| Rotation tracée (`credentialsRotatedAt`, audit) | CONFIRMÉ (code) | CONFIRMÉ (code) | CONFIRMÉ (code) |
| Liste d'IP/hosts autorisés côté prestataire | À OBTENIR | À OBTENIR | À OBTENIR |

### 2.3 API de paiement

| Élément | Orange Money BF | Moov Money BF | Agrégateur |
|---|---|---|---|
| Endpoint d'initiation + méthode + version | À OBTENIR | À OBTENIR | À OBTENIR |
| Endpoint de consultation du statut | À OBTENIR | À OBTENIR | À OBTENIR |
| Référence de session renvoyée (`providerRef`) | À OBTENIR | À OBTENIR | À OBTENIR |
| Identifiant de transaction définitif (`providerTxId`) | À OBTENIR | À OBTENIR | À OBTENIR |
| Idempotence native de l'initiation (clé / dédup) | À OBTENIR | À OBTENIR | À OBTENIR |
| Limites de montants (min/max par opération, par jour) | À OBTENIR | À OBTENIR | À OBTENIR |
| Devises supportées (XOF attendu) | À OBTENIR | À OBTENIR | À OBTENIR |
| Timeout documenté de la session de paiement | À OBTENIR | À OBTENIR | À OBTENIR |
| Normalisation des statuts → `PENDING/SUCCESS/FAILED/EXPIRED` | CONFIRMÉ (code) | CONFIRMÉ (code) | CONFIRMÉ (code) |
| Bornage applicatif des appels (≤ 15 s, `ADAPTER_CALL_TIMEOUT_MS`) | CONFIRMÉ (code) | CONFIRMÉ (code) | CONFIRMÉ (code) |
| Taxonomie d'erreurs : timeout / indisponible / métier / config | CONFIRMÉ (code) | CONFIRMÉ (code) | CONFIRMÉ (code) |

### 2.4 Webhooks

| Élément | Orange Money BF | Moov Money BF | Agrégateur |
|---|---|---|---|
| Format du payload (JSON, champs) | À OBTENIR | À OBTENIR | À OBTENIR |
| Méthode de signature (HMAC, certificat) + algorithme | À OBTENIR | À OBTENIR | À OBTENIR |
| Secret webhook dédié (rotation) | À OBTENIR | À OBTENIR | À OBTENIR |
| Identifiant unique d'événement (`externalId`) | À OBTENIR | À OBTENIR | À OBTENIR |
| Horodatage métier (`occurredAt`) pour l'ordonnancement | À OBTENIR | À OBTENIR | À OBTENIR |
| Rejeu de webhooks en doublon (dédup base) | CONFIRMÉ (G3-B) | CONFIRMÉ (G3-B) | CONFIRMÉ (G3-B) |
| Traitement hors-ordre (statuts antidatés) | CONFIRMÉ (G3-B) | CONFIRMÉ (G3-B) | CONFIRMÉ (G3-B) |
| Confirmation tardive après expiration | CONFIRMÉ (G3-B) | CONFIRMÉ (G3-B) | CONFIRMÉ (G3-B) |
| Tolérance de fraîcheur de signature (± fenêtre) | CONFIRMÉ (code, ±5 min sandbox) | À OBTENIR | À OBTENIR |
| Polling de secours si webhook absent | CONFIRMÉ (G3-B) | CONFIRMÉ (G3-B) | CONFIRMÉ (G3-B) |

### 2.5 Commissions et reversements

| Élément | Orange Money BF | Moov Money BF | Agrégateur |
|---|---|---|---|
| Grille tarifaire contractuelle (fixe, %, mixte) | À OBTENIR | À OBTENIR | À OBTENIR |
| Portée de la commission (école / payeur) | À OBTENIR | À OBTENIR | À OBTENIR |
| Paramétrage par contrat dans l'ERP (`feeFixed`/`feePercent`/`feeBearer`) | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) |
| API de décompte/reversement | À OBTENIR | À OBTENIR | À OBTENIR |
| Fréquence et format des décomptes (référence, lignes) | À OBTENIR | À OBTENIR | À OBTENIR |
| Reversements groupés / partiels — modèle supporté | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) |
| Rapprochement sur références stables (jamais sur montants) | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) |

### 2.6 Remboursements et litiges

| Élément | Orange Money BF | Moov Money BF | Agrégateur |
|---|---|---|---|
| API de remboursement | À OBTENIR | À OBTENIR | À OBTENIR |
| Remboursement partiel supporté | À OBTENIR | À OBTENIR | À OBTENIR |
| Idempotence des remboursements | À OBTENIR | À OBTENIR | À OBTENIR |
| Délai d'exécution documenté | À OBTENIR | À OBTENIR | À OBTENIR |
| Gestion des litiges / chargebacks | À OBTENIR | À OBTENIR | À OBTENIR |
| Workflow interne (demande→approbation→exécution→confirmation) | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) |
| Séparation demandeur/approbateur + exception mono-admin auditée | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) | CONFIRMÉ (G3-D) |

### 2.7 Exploitation

| Élément | Orange Money BF | Moov Money BF | Agrégateur |
|---|---|---|---|
| SLA de disponibilité contractuel | À OBTENIR | À OBTENIR | À OBTENIR |
| Contact support / escalade | À OBTENIR | À OBTENIR | À OBTENIR |
| Environnement de pré-production opérateur | À OBTENIR | À OBTENIR | À OBTENIR |
| Conditions de bascule LIVE (validation contractuelle, tests) | À OBTENIR | À OBTENIR | À OBTENIR |

## 3. Configuration par établissement — CONFIRMÉ (code)

- `PaymentProvider` est scopé `schoolId` (`@@unique([schoolId, code])`) :
  un même opérateur peut exister sous plusieurs écoles avec des
  comptes marchands, bornes et frais différents.
- Plusieurs opérateurs par école : lignes distinctes par `code`.
- Compte marchand propre : `merchantRef` + `credentialsRef` par école.
- Configuration mutualisée : une ligne par école peut partager la
  même variable d'environnement si le contrat agrégateur le permet
  (décision ops — l'ERP n'impose rien).
- Frais distincts par contrat : `feeFixed` + `feePercent` (points de
  base) + `feeBearer` (SCHOOL/PAYER) par fournisseur.
- `credentialsRef` / `webhookSecretRef` ne sont jamais renvoyés au
  navigateur (`listPaymentProviders` les exclut du select).
- Activation contrôlée : `mode = LIVE` **et** `liveEnabled = true`
  requis — `liveEnabled` ne se pose que par l'action dédiée
  (`mobilepayments.manage` + saisie « LIVE ») et est audité.
- **Verrou global serveur** : `MOBILE_MONEY_LIVE_ENABLED` doit valoir
  explicitement `"true"` pour tout appel susceptible de contacter un
  prestataire réel (initiation, statut, remboursement). Indépendant
  de `liveEnabled` : vérifié dans les services (`checkLiveExecution`
  dans `providers/live.ts`), pas seulement dans les actions admin.
  Toute autre valeur ou absence = `LIVE_DISABLED`. Les prestataires
  SANDBOX n'y sont jamais soumis ; les webhooks entrants ne passent
  pas par ce verrou (preuve financière conservée — la vérification
  de signature est locale, pas un appel externe).
- Conditions cumulatives d'appel externe réel : verrou global +
  prestataire ACTIVE + `mode LIVE` + `liveEnabled` + adaptateur
  enregistré + secrets présents + capacité déclarée.
- Désactivation d'urgence : `liveEnabled = false` (immédiat) ou
  `status = ARCHIVED` — voir §5. Coupure totale plateforme :
  `MOBILE_MONEY_LIVE_ENABLED=false` (redémarrage PM2).

## 4. Prérequis d'exploitation avant activation commerciale

| Prérequis | Statut |
|---|---|
| Restauration PostgreSQL testée en conditions réelles | **À OBTENIR** — bloquée par privilège `CREATEDB` sur le VPS (risque ouvert documenté) |
| Sauvegardes hors serveur (copie distante chiffrée) | À OBTENIR — `BACKUP_LOCAL_ONLY=1` aujourd'hui |
| Supervision des webhooks (échecs, anomalie, latence) | CONFIRMÉ (cron + statuts `WebhookEvent` + file d'anomalies) |
| Alertes financières (anomalies ouvertes, reversements manquants, remboursements non confirmés) | CONFIRMÉ (cron G3-D, notifications internes) |
| Procédure d'incident documentée (prestataire indisponible, webhook en masse) | À RÉDIGER avant activation |
| Rapprochement quotidien (revue des `PENDING`/`TO_VERIFY`) | Procédure à formaliser — outillage G3-D prêt |
| Gestion des remboursements (délai, suivi, confirmation) | CONFIRMÉ (workflow G3-D) |
| Gestion des secrets (rotation tracée, accès env restreint) | CONFIRMÉ (code) — procédure ops à rédiger |
| Procédure de désactivation d'urgence d'un prestataire | §5 ci-dessous — CONFIRMÉ (code) |
| Permissions `mobilepayments.*` attribuées par rôle | CONFIRMÉ (bootstrap idempotent) |

## 5. Procédure de désactivation d'urgence et rollback

1. **Désactivation douce** : `/app/paiements-mobile` → « Désactiver
   LIVE » (`liveEnabled=false`). Effet immédiat : toute nouvelle
   initiation renvoie `PROVIDER_NOT_LIVE`. Les intentions déjà
   confirmées continuent leur cycle (posting, rapprochement,
   anomalies) — aucune preuve n'est perdue.
1b. **Coupure plateforme** : `MOBILE_MONEY_LIVE_ENABLED=false` +
   redémarrage PM2 — refuse toute opération LIVE (`LIVE_DISABLED`)
   pour TOUS les prestataires et TOUTES les écoles, sans toucher au
   SANDBOX. C'est le kill-switch global, indépendant des réglages
   par école.
2. **Blocage total** : « Archiver » (`status=ARCHIVED`) — refuse
   initiation, webhooks (`NOT_FOUND`) et simulations.
3. **Réactivation** : inverse des étapes — la réactivation LIVE exige
   à nouveau la saisie « LIVE » (pas de réactivation silencieuse).
4. **Rollback applicatif** : bascule de release PM2 (`releases/` —
   procédure standard) ; le schéma G3-E est additif et reste
   compatible avec les versions antérieures.
5. **Incident prestataire** : les confirmations déjà reçues restent
   en file (reposts idempotents, anomalies visibles) ; reprendre après
   rétablissement via le cron ou la relance manuelle.

## 6. Plan d'activation progressive (préconisation)

1. **Phase 1 (ce lot)** : contrat d'adaptateur, simulateur de
   conformité, checklist, gates LIVE — aucun appel réel.
2. **Phase 2** : intégration d'UN prestataire en environnement de
   test opérateur (pas en production ECOM-SCHOOL) — checklist §2
   complétée depuis la documentation officielle.
3. **Phase 3** : recette de conformité adaptateur (jeu de tests
   contractuels) + tests de charge webhooks.
4. **Phase 4** : pilote LIVE sur UNE école, montants plafonnés,
   rapprochement quotidien obligatoire, alerte de tout écart.
5. **Phase 5** : généralisation progressive après 2 cycles de
   rapprochement conformes ; second prestataire.
6. À chaque étape : prérequis §4 vérifiés — notamment la
   **restauration PostgreSQL testée** avant tout pilote commercial.

## 7. Ce qui n'existe pas encore (honnêteté)

- Aucun adaptateur réel (Orange, Moov, agrégateur) n'est implémenté —
  le registre ne contient que `SANDBOX`.
- Aucune documentation officielle opérateur n'a été reçue — toutes
  les lignes « À OBTENIR » le restent jusqu'à réception.
- Aucune notification externe (SMS/email/WhatsApp) n'est envoyée.
- `payerPhone` est un champ libre — le formatage international sera
  à valider contre la doc du prestataire choisi.
- La consultation des reversements n'est implémentée que côté
  simulateur — les APIs réelles de décompte sont rares chez les
  opérateurs (la déclaration déclarée restera probablement le canal
  principal, marquée `declared`, jamais présentée comme preuve
  bancaire).
