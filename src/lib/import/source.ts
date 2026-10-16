/**
 * Extraction sécurisée de la source d'import depuis un FormData :
 * fichier CSV/XLSX ou texte collé. Plafond de taille appliqué avant
 * toute lecture.
 */
import { MAX_FILE_BYTES } from "./students";

export type ImportSource =
  | { kind: "csv"; text: string }
  | { kind: "xlsx"; buffer: ArrayBuffer };

export async function sourceFromFormData(
  formData: FormData,
): Promise<
  { ok: true; source: ImportSource } | { ok: false; error: string }
> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, error: "Fichier trop volumineux (maximum 2 Mo)" };
    }
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx")) {
      return { ok: true, source: { kind: "xlsx", buffer: await file.arrayBuffer() } };
    }
    const text = await file.text();
    if (!text.trim()) return { ok: false, error: "Fichier vide" };
    return { ok: true, source: { kind: "csv", text } };
  }

  const csv = formData.get("csv");
  if (typeof csv === "string" && csv.trim()) {
    if (csv.length > MAX_FILE_BYTES) {
      return { ok: false, error: "Texte trop volumineux (maximum 2 Mo)" };
    }
    return { ok: true, source: { kind: "csv", text: csv } };
  }
  return { ok: false, error: "Aucun fichier ni contenu à analyser" };
}
