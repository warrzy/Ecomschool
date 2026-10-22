import path from "node:path";

/**
 * Abstraction du fournisseur de stockage (G2-A).
 * Implémentation actuelle : filesystem privé hors racine web
 * (`src/lib/storage/fs.ts`). Migration future vers un stockage objet
 * (S3/minio) = nouvelle implémentation de cette interface, aucun
 * changement dans les services métier.
 *
 * Les `key` sont des chemins RELATIFS générés côté serveur
 * (`{schoolId}/{fileName}`) — jamais fournis par le client.
 */
export interface StorageAdapter {
  /** Écrit `buffer` sous `key` — écrasement interdit, écriture atomique. */
  put(key: string, buffer: Buffer): Promise<void>;
  /** Lit le contenu de `key` ; null si absent. */
  get(key: string): Promise<Buffer | null>;
  /** Suppression physique — réservée à la purge des documents DELETED. */
  remove(key: string): Promise<void>;
  /** Taille totale des fichiers présents sous le préfixe (octets). */
  usage(prefix: string): Promise<number>;
}

/**
 * Racine de stockage des documents : DOCUMENTS_ROOT ou
 * `<cwd>/documents-private` en développement. Jamais sous `public/` —
 * les fichiers ne sont servis que par une route autorisée.
 */
export function documentsRoot(): string {
  return process.env.DOCUMENTS_ROOT
    ? path.resolve(process.env.DOCUMENTS_ROOT)
    : path.join(process.cwd(), "documents-private");
}

export { fsStorage } from "./fs";
import { fsStorage } from "./fs";

let _adapter: StorageAdapter | null = null;

/** Adaptateur unique — point d'extension pour un futur backend objet. */
export function getStorage(): StorageAdapter {
  if (!_adapter) {
    _adapter = fsStorage(documentsRoot());
  }
  return _adapter;
}

/** Tests uniquement : force un adaptateur (ou le réinitialise). */
export function setStorageForTests(adapter: StorageAdapter | null) {
  _adapter = adapter;
}
