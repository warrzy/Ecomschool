# Parcours utilisateurs — état réel ECOM-SCHOOL

> ✅ = parcours complet de bout en bout · 🟡 = partiel · ❌ = absent.
> Chaque parcours est évalué sur sa chaîne réelle (pas les modèles).

## 1. Cycle de vie de l'élève

### 1.1 Candidature → admission → inscription ❌
```
AUJOURD'HUI : contact direct → guichet interne /app/fees/registration
             → élève + inscription + créances (1 tx) → comptes invités manuellement
MANQUANT    : candidature publique en ligne, pièces, test d'admission,
              décision motivée, conversion automatique candidat→inscrit,
              paiement frais de candidature, liste d'attente, notifications.
```
Le guichet interne est **très solide** (transaction unique, doublons, créances idempotentes) — le chaînon manquant est entièrement **en amont** : la porte d'entrée publique.

### 1.2 Réinscription annuelle 🟡
```
POSSIBLE : import CSV colonne "classe" (masse) OU guichet individuel idempotent
MANQUANT : campagne de réinscription en ligne (parent déclare "mon enfant
           revient", école valide en masse) — Le Major automatise ce parcours.
```

### 1.3 Vie financière de l'élève ✅
```
créances auto → échéancier → encaissement FIFO → reçu PDF figé
→ impayés → relance (interne) → [MANQUANT : relance SMS/WhatsApp,
  paiement en ligne par le parent]
```

## 2. Parcours enseignant

```
login /teacher → dashboard (séances jour, appels, contenus manquants)
→ appel par séance ✅ → cahier de textes ✅ → saisie notes ✅
→ [FIN : pas de messagerie parent, pas de RDV, pas de devoirs rendus]
```
Couverture : **bonne** pour le cœur pédagogique, aucune communication.

## 3. Parcours parent

```
invitation par admin → activation /invite/[token] (7 j)
→ /parent : enfant → EDT, notes publiées, bulletins PDF, absences,
  finances détaillées, reçus PDF, annonces ✅
→ [FIN : aucune action possible — pas de justification d'absence,
  pas de paiement en ligne, pas de message, pas de RDV,
  pas de réinscription, pas de dépôt de pièce]
```
**Le portail parent est un excellent « consulteur » — zéro interaction.**

## 4. Parcours financier (école)

```
caissier : /app/fees/accounts/[id] → encaisser → reçu A5 ✅
         → /app/fees/my-payments (journal personnel) ✅
finance  : config frais/échéanciers/remises ✅ → impayés + relances ✅
         → clôture caisse ✅ → dépenses ✅ → trésorerie ✅
         → rapports CSV/XLSX/PDF ✅
MANQUANT : validation à deux niveaux (payments naissent VALIDATED),
           multi-caisses, remboursements, compta générale,
           encaissement mobile money automatisé.
```

## 5. Parcours direction / pilote

```
/app dashboard KPI ✅ → trésorerie + rapports ✅ → audit log ✅
MANQUANT : vue consolidée pédagogie+finance+RH par classe/cycle,
           prévisions, alertes pilotage (taux de recouvrement,
           abandon, effectif vs capacité).
```

## 6. Parcours plateforme ECOM-TOUCH

```
/tarifs → /inscription (demande) → /platform/signup-requests
→ revue → /platform/onboarding (école+admin+abo atomique) ✅
→ facturation SaaS + relances + suspension ✅ → support sessions ✅
```
**Solide** — chaîne commerciale B2B complète et testée.

## 7. Parcours par type d'établissement

| Type | Couverture actuelle | Manques spécifiques |
|---|---|---|
| **Maternelle** | 🟡 bulletin template « primary », présences, finances | cahier de vie, photos, suivi compétences (pas de notes), communication forte parents |
| **Primaire** | ✅ bon | attestations, cartes scolaires |
| **Collège/Lycée** | ✅ **cœur du produit** | délibérations collégiales, rattrapages, examens blancs CEP/BEPC/Bac |
| **Institut de formation** | 🟡 adaptable | sessions courtes, certificats, conventions |
| **Université** | ❌ | LMD/UE/crédits/stages/mémoires — produit distinct nécessaire |
| **Groupe multisite** | ❌ | hiérarchie d'écoles + consolidation — concurrents le proposent |

## Lecture stratégique des parcours

Les chaînons **opérationnels** (enregistrer, encaisser, noter, publier) sont éprouvés — souvent mieux finis que chez les concurrents (idempotence, snapshots, révisions, verrous de période). Les chaînons **relationnels** (famille ↔ école) et **d'acquisition** (candidature publique, paiement en ligne, relances externes, RDV) sont absents — c'est exactement ce que les concurrents mettent en avant commercialement (PERIS : « école dans la poche », chat, notifications ; EduX : contrat signé au mobile ; Major : 4 apps).
