# Sauvegarde et restauration — ECOM-SCHOOL

## Chaîne mise en place (P7a)

```
crontab 02:30 → backup.sh
   ├─ pg_dump -Fc → /var/backups/ecomschool/<db>_<ts>.dump (+ .sha256)
   ├─ contrôle d'intégrité : pg_restore -l
   ├─ copie distante : restic (chiffré, dédupliqué) OU rsync/SSH
   ├─ rotation : 14 j locaux · restic keep-daily14/weekly8/monthly12
   └─ statut → /var/log/ecomschool/backup-status.env

crontab */15 → monitor.sh
   └─ alertes dédupliquées : dump KO/stale, distant KO/absent, échecs
      cron, jobs DEAD, app/HTTPS KO, disque ≥ 90 %
```

Restauration applicative : `restore.sh` (destructive, confirmation requise,
sans sudo). Exercice de preuve : `restore-verify.sh` (base témoin, jamais la
base active — refus explicite).

## Procédure de sauvegarde (PostgreSQL)

```bash
# Dump compressé (format custom, restaurable partiellement)
pg_dump -Fc -f backups/ecomschool_$(date +%Y%m%d_%H%M%S).dump "$DATABASE_NAME"
```

Recommandations production :

| Aspect | Recommandation |
|---|---|
| Fréquence | Quotidienne minimum ; envisager WAL archiving (PITR) pour RPO < 24 h |
| Rétention | 7 quotidiennes + 4 hebdomadaires + 12 mensuelles |
| Chiffrement | Chiffrer les dumps au repos (volume chiffré ou GPG) — ils contiennent des données de mineurs |
| Stockage externe | Copier hors du serveur applicatif (bucket objet, NAS, région différente) |
| Contrôle d'accès | Compte de service dédié, pas d'accès au dump depuis l'app |
| Test | **Une sauvegarde n'est valide que si sa restauration a été testée** |

## Copie distante — options (aucune n'est activée par défaut)

| Option | Chiffrement | Protection suppression | Droits | Coût estimé (~1 Go/mois) | Contraintes |
|---|---|---|---|---|---|
| **restic → S3/B2** (recommandé) | AES-256 côté client | Versioning/object-lock du bucket | clé API en lecture/écriture limitée au bucket | < 0,10 €/mois | installer restic (binaire statique), compte provider |
| rsync/SSH vers second hôte | SSH (transport) ; chiffrer au repos côté cible via GPG si requis | compte restreint `rrsync`/`internal-sftp`, ou `--append-only` | clé SSH dédiée, commande forcée | 3-6 €/mois (mini-VPS) | gérer un second hôte |
| gpg + rsync | chiffrement avant transfert | idem rsync | idem | idem +0 | rotation de clé GPG à documenter |
| Snapshot provider du VPS | dépend provider | dépend provider | console provider | selon offre | non portable, snapshot machine complète |

Les dumps étant ~0,4 Mo, le coût dominant est nul — le choix se fait sur la
facilité d'exploitation et l'indépendance vis-à-vis du VPS.

Configuration (shared/.env, jamais dans le dépôt) :

```bash
# restic (recommandé)
RESTIC_REPOSITORY="s3:https://s3.<region>.<provider>/<bucket>/ecomschool"
RESTIC_PASSWORD="<clé de chiffrement du dépôt>"
AWS_ACCESS_KEY_ID="…" ; AWS_SECRET_ACCESS_KEY="…"   # si cible S3
# ou rsync/SSH
BACKUP_REMOTE="backupuser@<hote>:/backups/ecomschool"
BACKUP_REMOTE_SSH="backupuser@<hote>"   # vérifie l'empreinte distante
```

## Procédure de restauration

### Exercice de vérification (non destructif)

```bash
# Une fois, en admin postgres, si le rôle n'a pas CREATEDB :
CREATE DATABASE ecomschool_verify OWNER ecomschool_app;

bash deploy/scripts/restore-verify.sh /var/backups/ecomschool/<fichier>.dump
```

Vérifie : empreinte SHA256, catalogue pg_restore, restauration dans la base
témoin, nombre de tables, migration la plus récente, comptages métiers,
durée — puis nettoie la base témoin (`--keep` pour la conserver).

### Restauration réelle (destructive)

```bash
bash deploy/scripts/restore.sh /var/backups/ecomschool/<fichier>.dump
```

Sans sudo : arrêt PM2, dump de sécurité pré-restore, terminaison des
connexions (le rôle termine les siennes), `pg_restore --clean --no-owner`
sous `ecomschool_app`, redémarrage, healthcheck.

## Test de restauration exécuté (Phase 10)

Script : `scripts/phase10/backup-restore-test.ts`
(`npx tsx scripts/phase10/backup-restore-test.ts`, binaires PostgreSQL requis,
surcharge possible via `PG_BIN`).

Déroulé : `pg_dump -Fc` → `createdb ecomschool_restore_test` → `pg_restore`
→ comparaison des comptages sur 12 tables critiques → `dropdb`.

**Résultat : PASS** — comptages identiques source / restauration :

```
School=17  User=71  SchoolMembership=69  Student=2112  Enrollment=112
Grade=220  ReportCard=51  Payment=44  Notification=134  Job=8
MessageDelivery=17  AuditLog=1537
```

Taille du dump : ~0,5 Mo (jeu de données dev/test).

## RPO / RTO cibles (à contractualiser)

- **RPO** : 24 h avec dumps quotidiens ; < 1 h si PITR/WAL.
- **RTO** : < 4 h (restauration ~minutes à cette volumétrie ; dominé par le
  provisionnement et la bascule DNS/env).

## Supervision

`monitor.sh` (crontab `deploy`, toutes les 15 min) contrôle sauvegardes
(locales et distantes), échecs cron, jobs DEAD, disponibilité locale/HTTPS
et disque. Alertes dédupliquées (24 h) vers `ALERT_WEBHOOK_URL` (POST JSON)
ou `EMAIL_PROVIDER_URL` ; `--dry-run` pour les tests. Fichier d'état :
`/var/log/ecomschool/alerts/`.

## Automatisation suggérée

Tâche planifiée externe : dump quotidien + copie chiffrée + alerte en cas
d'échec + restauration de contrôle mensuelle (`restore-verify.sh`) sur
environnement isolé — désormais automatisée via les scripts ci-dessus.

