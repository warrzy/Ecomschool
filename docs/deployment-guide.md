# Guide de déploiement — ECOM-SCHOOL

Architecture cible documentée ; aucun fournisseur n'est présupposé.
Adapter selon les contraintes réelles (VPS, PaaS, conteneurs).

## Topologie

```
                 HTTPS
                   │
             Reverse proxy ── TLS, headers, limites de débit
                   │
        ┌──────────┴──────────┐
        │  Next.js (build)    │   × N instances / workers
        │  npm run start      │
        └──────────┬──────────┘
                   │
             PostgreSQL ≥ 15 ── sauvegardes quotidiennes + WAL si PITR
                   │
        Planificateur externe ──→ GET/POST /api/cron (Bearer CRON_SECRET)
        (cron système, GitHub Actions, etc.) — périodicité 5–15 min
```

- **Stockage documents** : les PDF sont générés à la volée ; aucun stockage
  objet n'est requis aujourd'hui. Si des pièces jointes arrivent, prévoir un
  bucket (S3-compatible) hors base.
- **Journaux** : stdout applicatif + `AuditLog` en base + `Job`/`TaskRun`
  pour les traitements. Collecter stdout via journald/PM2/Docker logs.
- **Supervision** : page `/platform/automations` (jobs, échecs, coûts SMS) +
  alerte externe recommandée sur jobs DEAD et échecs cron HTTP ≠ 200.

## Environnements

| Env | Rôle | Données |
|---|---|---|
| Développement | poste développeur | seeds de test |
| Préproduction | recette, tests de charge, restauration | copie anonymisée |
| Production | service réel | données réelles |

## Variables d'environnement

Voir `.env.example` — aucune valeur sensible commitée. En production :
secrets via le gestionnaire de secrets de l'hébergeur, `NEXTAUTH_URL` en
HTTPS, `CRON_SECRET` long et aléatoire.

## Procédure de déploiement

```bash
# 1) Sauvegarde préalable (voir docs/backup-restore.md)
pg_dump -Fc -f pre-deploy-$(date +%Y%m%d).dump ecomschool

# 2) Code + dépendances
git checkout <branche> && npm ci

# 3) Migrations (create-only, relecture SQL avant apply)
npx prisma migrate deploy
npx prisma generate

# 4) Build + démarrage
npm run build
npm run start

# 5) Vérifications post-déploiement
curl -fsS https://<host>/api/auth/csrf            # app répond
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
     "https://<host>/api/cron?scope=platform"     # cron opérationnel
```

## Ordonnanceur externe (obligatoire)

`/api/cron` exécute : file de jobs (envois, retry, absence différée),
automatisations scolaires et SaaS, purge de rétention. Sans appel périodique,
aucun traitement différé ne s'exécute.

```cron
# exemple crontab — toutes les 10 minutes
*/10 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron >> /var/log/ecomschool-cron.log 2>&1
```

Le traitement est idempotent et les exécutions concurrentes ne produisent pas
de doublons (verrou optimiste + clés de déduplication) — la fréquence peut être
resserrée sans risque fonctionnel.

## Checklist réseau

- HTTPS obligatoire (HSTS déjà émis par l'app ; TLS terminé au proxy).
- Ne pas exposer PostgreSQL publiquement.
- Limiter `/api/cron` par secret ; optionnellement restreindre par IP au proxy.
- En-têtes de sécurité déjà configurés (`next.config.ts`) — le proxy ne doit
  pas les supprimer.
