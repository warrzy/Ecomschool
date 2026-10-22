# Documents privés — stockage, sauvegarde, restauration (G2-A)

## Architecture

| Élément | Détail |
|---|---|
| Modèle | `Document` (Prisma) : métadonnées + `storagePath` relatif |
| Binaire | filesystem privé `DOCUMENTS_ROOT` — **hors racine web** |
| Accès | uniquement `GET /app/documents/[id]/download` (autorisé + intégrité SHA-256) |
| Préprod | `DOCUMENTS_ROOT=/var/www/ecomschool-preprod/shared/uploads` — partagé entre releases, survit aux déploiements |
| Local | `./documents-private` (gitignoré) |

Nginx ne sert **jamais** ce répertoire — aucun `location` ne le mappe.
Les noms de fichiers sont générés (`{uuid}.{ext}`), le chemin serveur
n'apparaît jamais dans les réponses.

## Sauvegarde

Les dumps PostgreSQL (`backup.sh`) couvrent les **métadonnées** (table
`Document` : sha256, statut, lien objet). Les **fichiers** sont couverts
par `deploy/scripts/backup-uploads.sh` (script dédié, même conventions) :

```cron
# crontab user deploy — après le dump DB
30 2 * * * bash /var/www/ecomschool-preprod/repo/deploy/scripts/backup-uploads.sh
```

Produit dans `$BACKUP_DIR` :
- `uploads_<ts>.tar.gz` + `.sha256` + `.manifest.txt` (nb fichiers/octets)
- Rétention `RETENTION_DAYS` (14 j par défaut), copie distante si
  `BACKUP_REMOTE`/`RESTIC_*` configurés, sinon local seul.

## Restauration

```bash
# 1. Vérifier l'archive
cd /var/backups/ecomschool
sha256sum -c uploads_<ts>.tar.gz.sha256

# 2. Extraire dans la cible (droits préservés)
tar -C /var/www/ecomschool-preprod/shared -xzf uploads_<ts>.tar.gz

# 3. Permissions — les fichiers doivent appartenir à l'app, jamais lisibles par d'autres
chown -R deploy:deploy /var/www/ecomschool-preprod/shared/uploads
find /var/www/ecomschool-preprod/shared/uploads -type d -exec chmod 750 {} +
find /var/www/ecomschool-preprod/shared/uploads -type f -exec chmod 640 {} +

# 4. Cohérence métadonnées ↔ fichiers
#    Compter les fichiers attendus = lignes Document avec purgedAt IS NULL
#    (requête SQL) vs fichiers présents ; chaque readDocument revérifie
#    le SHA-256 au téléchargement.
```

## Rétention & purge

- `DELETED` = suppression logique (fichier conservé `DOCUMENTS_PURGE_AFTER_DAYS`, défaut 30 j).
- `purgeDeletedDocuments()` passe les lignes à `PURGED` et supprime le
  fichier — métadonnées et audit conservés.
- Rétention différenciée par catégorie : prévu via `Document.category` +
  paramètre de purge (à affiner avec G2-C instructions d'archivage).
- Candidatures rejetées : purge ciblée prévue avec G2-B (90 j par défaut
  dans le cadrage).

## Migration future vers un stockage objet

`StorageAdapter` (`src/lib/storage/index.ts`) isole tout l'I/O :
`put/get/remove/usage`. Un backend S3/minio = nouvelle implémentation +
`DOCUMENTS_ROOT` → config d'endpoint ; `storagePath` reste la clé.
Aucun changement métier nécessaire.
