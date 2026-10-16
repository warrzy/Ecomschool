import { requireSchoolPermission } from "@/lib/permissions/guard";
import { exportFile } from "@/lib/export/respond";
import { STUDENT_TEMPLATE_HEADERS } from "@/lib/import/students";

/** Modèle téléchargeable d'import élèves (CSV/XLSX). */
export async function GET(req: Request) {
  await requireSchoolPermission("student.read");
  const format =
    new URL(req.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  return exportFile({
    format,
    filename: "modele-import-eleves",
    sheets: [
      {
        name: "Élèves",
        headers: STUDENT_TEMPLATE_HEADERS,
        widths: [14, 18, 18, 8, 16, 18, 16, 26, 30, 14],
        rows: [
          [
            "MAT001",
            "Kaboré",
            "Awa",
            "F",
            "2012-04-15",
            "Ouagadougou",
            "70000000",
            "awa.kabore@example.com",
            "Secteur 12",
            "6e A",
          ],
          [
            "MAT002",
            "Sawadogo",
            "Moussa",
            "M",
            "2011-09-02",
            "",
            "",
            "",
            "",
            "",
          ],
        ],
      },
      {
        name: "Lisez-moi",
        headers: ["Règle"],
        widths: [90],
        rows: [
          ["Une ligne par élève ; la première ligne est l'en-tête."],
          ["matricule, nom et prenom sont obligatoires."],
          ["sexe : M ou F. date_naissance : AAAA-MM-JJ."],
          ["Cellule vide = valeur existante conservée lors d'une mise à jour."],
          [`${"`__EFFACER__`"} efface explicitement un champ facultatif.`],
          ["classe (facultatif) : nom exact d'une classe de l'année choisie."],
        ],
      },
    ],
  });
}
