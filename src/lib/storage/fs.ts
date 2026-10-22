import fs from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./index";

/**
 * Stockage filesystem privé. Toutes les clés sont confinées sous `root` :
 * `resolve` + contrôle de préfixe sur chaque opération (anti-traversée,
 * même si une clé venait à être manipulée).
 */
export function fsStorage(root: string): StorageAdapter {
  const base = path.resolve(root);

  function safePath(key: string): string {
    if (key.includes("\0")) throw new Error("INVALID_KEY");
    const full = path.resolve(base, key);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error("INVALID_KEY");
    }
    return full;
  }

  return {
    async put(key, buffer) {
      const full = safePath(key);
      await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
      // Refus d'écrasement : les noms sont générés (UUID) et uniques.
      try {
        await fs.lstat(full);
        throw new Error("KEY_EXISTS");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      // Écriture atomique : fichier temporaire puis rename (même volume).
      const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
      try {
        await fs.writeFile(tmp, buffer, { flag: "wx", mode: 0o640 });
        await fs.rename(tmp, full);
        // Renforcer les droits du répertoire école si créé avec l'umask.
        await fs.chmod(path.dirname(full), 0o750).catch(() => {});
      } finally {
        await fs.rm(tmp, { force: true });
      }
    },

    async get(key) {
      try {
        return await fs.readFile(safePath(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },

    async remove(key) {
      await fs.rm(safePath(key), { force: true });
    },

    async usage(prefix) {
      const dir = safePath(prefix);
      let total = 0;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw e;
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.includes(".tmp-")) continue;
        const st = await fs.stat(path.join(dir, entry.name));
        total += st.size;
      }
      return total;
    },
  };
}
