# Sauvegarde et restauration — ECOM-SCHOOL

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

## Procédure de restauration

```bash
createdb ecomschool_restore
pg_restore -d ecomschool_restore backups/ecomschool_YYYYMMDD_HHMMSS.dump
```

Puis pointer `DATABASE_URL` d'un environnement isolé vers la base restaurée,
`prisma migrate deploy` si nécessaire, et vérifier les comptages.

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

## Automatisation suggérée

Tâche planifiée externe : dump quotidien + copie chiffrée + alerte en cas
d'échec + restauration de contrôle mensuelle sur environnement isolé.
