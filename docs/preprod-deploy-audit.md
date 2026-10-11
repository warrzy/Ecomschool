# Audit technique — déploiement préproduction ECOM-SCHOOL

Branche auditée : `phase-10-production-readiness` (`f6b3260`).
Cible : VPS Hostinger `147.79.118.212` · `preprod.ecomschool.fr` · port 3001.

## Compatibilité infrastructure

| Composant | Requis | VPS | Verdict |
|---|---|---|---|
| Node.js | ≥ 20 (Next 16, NextAuth 4) | 24.14.0 | OK — E2E validés sous Node 24 |
| PostgreSQL | ≥ 15 (Prisma 7) | 16.15 | OK |
| Prisma | CLI 7.10 + `prisma-client-js` | — | `prisma migrate deploy` + `generate` au déploiement |
| Mémoire | Next build ~1,5 Go, run ~0,5 Go | 8 Go | OK pour préprod (build parallèle à wendyam à surveiller) |
| Port | 3001 sur 127.0.0.1 | 3000 pris par wendyam | OK — 3001 à confirmer libre par check-prereqs |

## Points vérifiés dans le code

- **`npm start`** : `next start` standard — `-p 3001 -H 127.0.0.1` via PM2
  (`deploy/pm2/ecosystem.config.cjs`). Pas d'output standalone nécessaire.
- **Auth** : NextAuth v4 credentials, JWT 12 h. Cookies sécurisés
  automatiquement avec `NEXTAUTH_URL` https — pas de config custom à porter.
- **`prisma.config.ts`** charge `.env` via `dotenv/config` : le fichier
  d'environnement sur le serveur doit s'appeler `.env` (le nom
  `.env.preprod` n'est PAS lu automatiquement — c'est un modèle à copier).
- **`postinstall`** : `prisma skills sync || exit 0` — tolérant aux erreurs,
  sans impact sur `npm ci` en production.
- **Stockage fichiers** : aucun upload serveur actif. Les logos sont lus
  depuis `public/` (fichiers versionnés). Pas de répertoire inscriptible à
  prévoir hors `.next/` et logs PM2.
- **`/api/cron`** : secret Bearer obligatoire (503 sans `CRON_SECRET`,
  401 mauvais secret, comparaison `timingSafeEqual`). Ordonnancement externe
  requis — couvert par `/etc/cron.d/ecomschool-preprod`.
- **Base vide au premier déploiement** : `prisma migrate deploy` n'amène
  AUCUNE donnée de référence. Le bootstrap est obligatoire :
  `scripts/preprod/bootstrap.sh` enchaîne les bootstraps idempotents des
  phases 2–9 (permissions, rôles, modules, plans, gabarits) + création du
  compte plateforme via `PREPROD_PLATFORM_ADMIN_*`.
- **Providers externes** : email/SMS/WhatsApp tous optionnels — canal
  non configuré = indisponible affiché, jamais de simulation. Préprod peut
  tourner sans aucun.
- **Headers sécurité** : HSTS activé dans `next.config.ts` — déployer
  HTTPS rapidement ; en cas d'accès HTTP prolongé, HSTS force le navigateur
  en HTTPS une fois le certificat émis (comportement souhaité).

## Blocages / décisions avant déploiement

1. **Accès GitHub depuis le VPS** : dépôt `warrzy/Ecomschool` — si privé,
   créer une Deploy Key lecture seule sous l'utilisateur `deploy` (procédure
   dans `deploy/README.md` étape 1). À confirmer.
2. **Branche déployée** : le travail récent est sur
   `phase-10-production-readiness`, non fusionné dans `main`. Décider si la
   préprod suit cette branche (défaut dans `deploy.sh`) ou attend la fusion.
3. **Secrets à générer sur place** : `AUTH_SECRET`/`NEXTAUTH_SECRET`,
   `CRON_SECRET`, mot de passe `ecomschool_app`, mot de passe du compte
   plateforme — jamais dans le dépôt.
4. **`SEED_TEST_PASSWORD` / `SEED_DEMO_PASSWORD`** : ne PAS les renseigner en
   préprod — ils ne servent qu'aux seeds de développement. Le seed dev
   (`prisma/seed.ts`) ne doit PAS être exécuté en préproduction.
5. **Rétention des dumps** : 14 jours par défaut dans
   `/var/backups/ecomschool` — à copier hors VPS pour la production finale.
6. **Ressources partagées** : le `next build` (~1,5 Go) pendant que
   wendyam-finance tourne — planifier les déploiements hors pic ou accepter
   une contention temporaire.

## Fichiers livrés

```
deploy/
  README.md                        guide complet (étapes 0→9, exploitation)
  nginx/preprod.ecomschool.fr.conf vhost dédié 80 → proxy 127.0.0.1:3001
  pm2/ecosystem.config.cjs         processus ecomschool-preprod dédié
  cron/ecomschool-preprod.cron     /api/cron 10 min (flock) + backup quotidien
  scripts/
    lib.sh                         chemins + pg_url() (URL libpq sûre)
    check-prereqs.sh               audit serveur lecture seule
    setup-app-dir.sh               arborescence releases/shared + droits
    create-database.sh             rôle + base (privilèges minimaux, interactif)
    deploy.sh                      worktree → ci → generate → dump → migrate
                                   → build → bascule current → delete+start PM2
    healthcheck.sh                 PM2, port, release, csrf, nginx, cron
    backup.sh                      pg_dump -Fc + rotation 14 j (+ rsync optionnel)
    restore.sh                     arrêt → pré-dump → pg_restore --clean --role
    rollback.sh                    bascule de lien vers release antérieure
.env.preprod.example               gabarit d'environnement sans secrets
scripts/preprod/
  bootstrap.sh                     enchaîne les bootstraps idempotents P2→P9
  create-platform-admin.ts         compte plateforme (env PREPROD_*)
```

# Revue approfondie — tour 2 (validation finale)

Anomalies détectées lors de la revue finale des scripts, corrections
appliquées, tests locaux et risques résiduels.

## Anomalies et corrections appliquées

| # | Gravité | Anomalie | Correction |
|---|---|---|---|
| A1 | **HIGH** | `?schema=public` dans `DATABASE_URL` rejeté par libpq → `pg_dump`/`psql`/`pg_restore` échouaient (vérifié : `psql: paramètre de la requête URI invalide : « schema »`) | `lib.sh:pg_url()` supprime la query string avant tout appel libpq ; tous les scripts passent par cette fonction |
| A2 | **HIGH** | Build dans le répertoire actif : un échec de `npm ci`/`migrate`/`build` laissait une version cassée en production | Releases versionnées : `repo/` + `releases/<ts>` + lien `current` basculé **après** build réussi ; échec ⇒ version courante intacte |
| A3 | **HIGH** | `pm2 reload` avec cwd via lien symbolique : le chemin résolu au premier start pouvait rester figé sur l'ancienne release | `pm2 delete` + `pm2 start` déterministe (~2 s d'interruption, équivalent à un reload fork) |
| A4 | MEDIUM | `backup.sh` exigeait `sudo -u postgres` → échec silencieux en crontab user | `pg_dump` direct via les identifiants applicatifs de `shared/.env`, sans sudo |
| A5 | MEDIUM | `pg_restore --clean` recréait les objets sous `postgres` → l'application ne voyait plus ses tables | `pg_restore --clean --if-exists --no-owner --role=ecomschool_app` + `pg_terminate_backend` préalable |
| A6 | MEDIUM | Rollback = checkout git + rebuild (plusieurs minutes d'indisponibilité) | `rollback.sh` : bascule de lien instantanée + restart PM2 ; restauration BDD toujours manuelle et jamais automatique |
| A7 | MEDIUM | Worktree sur branche inexistante localement (clone frais, ref non-`main`) → échec du premier déploiement | résolution `origin/<ref>` de repli + `worktree add --detach` |
| A8 | LOW | `/api/cron` joignable depuis Internet (secret seul) | `location /api/cron` limitée à `127.0.0.1`/`::1` dans le vhost Nginx (le crontab local reste fonctionnel) |
| A9 | LOW | Pas de protection contre les exécutions cron concurrentes | `flock -n /tmp/ecomschool-cron.lock` dans la crontab |
| A10 | LOW | `healthcheck.sh` vérifiait uniquement `http://127.0.0.1` | ajout du contrôle HTTPS public + affichage de la release active + détection IPv6 `:::3001` |
| A11 | LOW | `check-prereqs.sh` exigeait `dig` et ignorait une écoute PG sur `::1` | repli `getent hosts` ; exclusion `::1` du contrôle d'exposition |
| A12 | LOW | `.env` versionné dans le clone → fuite possible dans les releases | `.env` stocké dans `shared/` (chmod 700/600), lié symboliquement — jamais copié |

## Points contrôlés — conformes

- **PM2** : seules les commandes `describe|stop|delete|start --only|save` sur
  `ecomschool-preprod` ; aucune autre application n'est référencée.
- **Nginx** : nouveau fichier `sites-available` uniquement ; aucun vhost
  existant modifié ; `nginx -t` obligatoire avant reload (documenté).
- **Écoute** : `next start -H 127.0.0.1 -p 3001` ; healthcheck vérifie
  l'absence d'écoute `0.0.0.0`/`::`.
- **PostgreSQL** : local uniquement (vérifié par check-prereqs) ; rôle
  applicatif propriétaire de sa seule base, sans superuser.
- **Secrets** : aucun dans le dépôt ; `.env*` ignoré (exception `.example`) ;
  mot de passe DB demandé interactivement.
- **Bootstrap** : idempotent (`upsert`/`createMany skipDuplicates`/`findFirst`
  gardés — vérifié dans les 9 scripts) ; aucune donnée de test/démo ; le seed
  dev n'est jamais appelé.
- **Cron** : secret Bearer obligatoire + comparaison `timingSafeEqual` (code),
  `flock` anti-recouvrement, journalisation `/var/log/ecomschool/`.
- **Isolation données** : base dédiée `ecomschool_preprod`, schéma `public`
  isolé des applications existantes.

## Tests exécutés (locaux uniquement)

| Test | Résultat |
|---|---|
| `psql` avec `?schema=public` | ÉCHEC reproductible → anomalie A1 confirmée |
| `bash -n` sur les 10 scripts shell | PASS |
| `node -e "require(ecosystem.config.cjs)"` | PASS |
| `deploy/scripts/lib.sh` (chargement) | PASS |
| Idempotence des 9 scripts bootstrap (revue statique) | PASS — upsert/skipDuplicates/findFirst |
| Présence des 9 fichiers bootstrap référencés | PASS |
| Variables `PREPROD_*` ↔ `.env.preprod.example` | PASS — cohérentes |
| `npm run typecheck` (tour 1) | PASS |

**Non testés** (impossibles sans VPS) : exécution réelle de `deploy.sh`,
`pg_dump`/`pg_restore` sur la base cible, `certbot`, bascule PM2 effective,
résolution DNS côté VPS. Ces points sont couverts par les vérifications
incrémentales du guide (étapes 0→9) et le healthcheck post-déploiement.

## Risques résiduels

1. **Premier déploiement** : la séquence n'a jamais été exécutée en conditions
   réelles — le guide prévoit `check-prereqs.sh` puis un déploiement pendant
   que rien ne tourne (risque nul sur l'existant : aucun process n'est touché
   avant l'étape PM2, et seul `ecomschool-preprod` l'est).
2. **Build sous charge** : `next build` ~1,5 Go pendant que wendyam-finance
   tourne — planifier hors pic.
3. **`mv -T`** : GNU coreutils requis (présent sur Ubuntu 24.04 ; non portable
   BSD — sans objet ici).
4. **Mot de passe DB avec `?`** : `pg_url` supprime tout ce qui suit le
   premier `?` — un mot de passe contenant `?` doit être URL-encodé dans
   `DATABASE_URL` (documenter dans le runbook opérateur).
5. **Copie hors VPS des sauvegardes** : prévue dans `backup.sh`
   (`BACKUP_REMOTE`/rsync) mais désactivée tant qu'aucune destination n'est
   définie — action opérateur requise.
6. **Certbot** réécrit le bloc `server {}` — re-vérifier `nginx -t` après.

## Séquence exacte de la première intervention

Commandes à exécuter dans l'ordre (impact et retour arrière entre parenthèses).
**Aucune ne touche wendyam-finance ni tme-machinery.**

```bash
# 0. Prérequis — lecture seule (impact : nul ; retour arrière : n/a)
sudo apt install -y certbot python3-certbot-nginx   # si absent
bash deploy/scripts/check-prereqs.sh                # depuis une copie locale

# 1. Arborescence (impact : mkdir + chown sous /var/www, /var/log, /var/backups
#    ; retour arrière : rm -rf des dossiers créés)
sudo bash deploy/scripts/setup-app-dir.sh

# 2. Code (impact : clone git dans repo/ ; retour arrière : rm -rf du dossier)
sudo -u deploy git clone --no-checkout \
  https://github.com/warrzy/Ecomschool.git /var/www/ecomschool-preprod/repo
# (ou Deploy Key si dépôt privé — voir README étape 1)

# 3. Base (impact : 1 rôle + 1 base PostgreSQL ; retour arrière :
#    sudo -u postgres dropdb ecomschool_preprod && dropuser ecomschool_app)
sudo bash deploy/scripts/create-database.sh

# 4. Secrets (impact : 1 fichier chmod 600 ; retour arrière : suppression)
sudo -u deploy cp .env.preprod.example /var/www/ecomschool-preprod/shared/.env
sudo -u deploy nano /var/www/ecomschool-preprod/shared/.env
sudo -u deploy chmod 600 /var/www/ecomschool-preprod/shared/.env

# 5. Premier déploiement (impact : releases/<ts> + lien current + process
#    ecomschool-preprod ; retour arrière : pm2 delete ecomschool-preprod,
#    rm -rf releases/<ts>)
cd /var/www/ecomschool-preprod/repo
sudo -u deploy git worktree add --detach ../releases/init \
  origin/phase-10-production-readiness
sudo -u deploy bash ../releases/init/deploy/scripts/deploy.sh \
  phase-10-production-readiness

# 6. Bootstrap (impact : données de référence + compte plateforme ;
#    retour arrière : restauration base ou TRUNCATE — réversible via
#    nouvelle exécution idempotente)
cd /var/www/ecomschool-preprod/current
sudo -u deploy bash scripts/preprod/bootstrap.sh

# 7. Nginx (impact : 1 vhost ajouté + reload ; retour arrière :
#    rm sites-enabled/preprod.ecomschool.fr.conf && nginx -t && reload)
sudo cp current/deploy/nginx/preprod.ecomschool.fr.conf \
  /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/preprod.ecomschool.fr.conf \
  /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 8. HTTPS (impact : certificat + réécriture du seul vhost ecomschool ;
#    retour arrière : certbot delete / réactivation du bloc port 80)
sudo certbot --nginx -d preprod.ecomschool.fr

# 9. Cron (impact : 2 entrées /etc/cron.d ; retour arrière : rm du fichier)
sudo cp current/deploy/cron/ecomschool-preprod.cron /etc/cron.d/ecomschool-preprod
sudo nano /etc/cron.d/ecomschool-preprod   # __CRON_SECRET__
sudo systemctl reload cron

# 10. Validation
bash /var/www/ecomschool-preprod/current/deploy/scripts/healthcheck.sh
```

## Verdict

**GO SOUS CONDITIONS** — conditions : (1) le port 3001 confirmé libre par
`check-prereqs.sh`, (2) dépôt GitHub accessible depuis le VPS (Deploy Key si
privé), (3) secrets générés sur place, (4) créneau calme pour le premier
build, (5) exécution séquentielle du guide avec arrêt à la première erreur.

Aucune commande distante exécutée. En attente d'autorisation explicite.
