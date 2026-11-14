<!-- title: FAQ — questions fréquentes -->
# FAQ — problèmes courants et solutions

## Accès et comptes

**Je n'arrive pas à me connecter.**
Vérifiez l'email exact (pas de faute), puis « Mot de passe oublié ».
Si le lien n'arrive pas : l'envoi dépend de la configuration email de
l'établissement — demandez à l'administrateur un lien de
réinitialisation (bouton « Réinit. MDP » dans Utilisateurs).

**Le lien d'invitation a expiré.**
Les invitations expirent — demandez-en une nouvelle à
l'administrateur.

**« Accès refusé / 403 » sur une page.**
Ce n'est pas un bug : votre rôle n'a pas cette permission. Le menu
montre uniquement vos droits — les URLs saisies à la main sont aussi
bloquées côté serveur.

## Paiements et finances

**J'ai cliqué deux fois — double encaissement ?**
Non. L'idempotence renvoie **le même reçu** : un paiement ne peut pas
être enregistré deux fois.

**Le montant est refusé alors que la famille veut payer d'avance.**
Le surpaiement au-delà du reste dû est bloqué. Options : ajuster les
échéances (responsable financier) ou encaisser seulement le dû.

**Un encaissement est erroné — comment l'effacer ?**
On n'efface pas : on **annule**, ce qui produit une contre-passation
tracée. Réservé au responsable financier.

## Notes et bulletins

**Les parents ne voient pas les notes saisies.**
Normal tant que l'évaluation n'est pas `PUBLISHED` — la publication
est une étape volontaire de l'administration.

**Une moyenne semble fausse.**
Vérifiez les **coefficients** des matières dans la classe, puis que
toutes les évaluations de la période sont prises en compte, puis
relancez le calcul (Moyennes).

## Paie

**Le bulletin ne contient pas de CNSS ni d'impôt.**
Normal : les composants réglementaires burkinabè sont **désactivés en
attente du barème officiel validé** — les bulletins actuels sont
indicatifs. Voir `PARAMETRES_PAIE_BF.md`.

**L'écriture de paie n'apparaît pas en comptabilité.**
La campagne doit être **comptabilisée** (bouton dédié) — la validation
seule ne poste pas d'écriture.

**Une avance ne se récupère plus.**
Vérifiez le **plafond** (% du net) : si le recouvrement calculé dépasse
le plafond, le reliquat est reporté au mois suivant — c'est voulu.

## Technique

**L'import refuse mon fichier.**
L'assistant affiche les erreurs ligne par ligne (matricules en double,
colonnes manquantes) — corrigez et rechargez : rien n'est écrit avant
validation.

**La page affiche « 0 » partout après un changement d'année.**
Vous êtes probablement sur l'ancienne année : les listes suivent
l'**année courante** — vérifiez-la dans Années scolaires.

**Une action semble « plantée » (chargement infini).**
Réessayez — les opérations sensibles sont conçues pour être rejouées
sans créer de doublon. Si le problème persiste, contactez le support
ECOM-TOUCH avec l'heure et l'écran.
