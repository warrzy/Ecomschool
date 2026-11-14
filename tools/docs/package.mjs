import { createRequire } from "module";
import { mkdirSync, copyFileSync, existsSync, readdirSync, createWriteStream, writeFileSync, statSync } from "fs";
import { join } from "path";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");
const { ZipArchive } = require("archiver");

const ROOT = process.cwd();
const OUT = join(ROOT, "docs/livrables-commerciaux");
const ZIPDIR = join(OUT, "package");
mkdirSync(ZIPDIR, { recursive: true });

const now = new Date();
const VERSION = `v${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;

// ---------- 1. PPTX ----------
const pptx = new PptxGenJS();
pptx.defineLayout({ name: "W", width: 13.3, height: 7.5 });
pptx.layout = "W";
const NAVY = "1E3A8A", BLUE = "2563EB", GRAY = "6B7280", DARK = "111827";

const slide = (title, subtitle) => {
  const s = pptx.addSlide();
  s.addShape("rect", { x: 0, y: 0, w: 13.3, h: 7.5, fill: { color: "FFFFFF" } });
  s.addShape("rect", { x: 0, y: 0, w: 13.3, h: 0.12, fill: { color: BLUE } });
  if (title) s.addText(title, { x: 0.6, y: 0.5, w: 12, h: 0.9, fontSize: 30, bold: true, color: NAVY });
  if (subtitle) s.addText(subtitle, { x: 0.6, y: 1.35, w: 12, h: 0.5, fontSize: 15, color: GRAY });
  s.addText(`ECOM-SCHOOL — formation ${VERSION}`, { x: 0.6, y: 7.05, w: 8, h: 0.35, fontSize: 9, color: GRAY });
  return s;
};
const bullets = (s, items, y = 2.0) =>
  s.addText(items.map(t => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true, fontSize: 18, color: DARK, paraSpaceAfter: 10 } })), { x: 0.9, y, w: 11.5, h: 4.8 });

// Couverture
{
  const s = pptx.addSlide();
  s.addShape("rect", { x: 0, y: 0, w: 13.3, h: 7.5, fill: { color: NAVY } });
  s.addText("ECOM-SCHOOL", { x: 1, y: 2.2, w: 11, h: 1.4, fontSize: 54, bold: true, color: "FFFFFF" });
  s.addText("Formation des utilisateurs — support de présentation", { x: 1, y: 3.5, w: 11, h: 0.7, fontSize: 22, color: "BFDBFE" });
  s.addText("ECOM-TOUCH · Burkina Faso · " + VERSION, { x: 1, y: 4.4, w: 11, h: 0.5, fontSize: 14, color: "93C5FD" });
}

const S = (t, st, items) => bullets(slide(t, st), items);

S("Objectifs de la formation", "À l'issue, chaque profil maîtrise son périmètre", [
  "Comprendre l'organisation multi-profils et le cloisonnement des données",
  "Réaliser les opérations courantes de son rôle sans assistance",
  "Connaître les garde-fous : validation, publication, idempotence, contre-passation",
  "Savoir où trouver l'aide : manuels par profil, FAQ, glossaire",
]);
S("Les espaces et les profils", "Un espace dédié par fonction", [
  "/app — administration : direction, secrétariat, finances, comptabilité, RH, paie",
  "/teacher — enseignant : appels, cahier de textes, évaluations",
  "/parent — familles : suivi des enfants, finances, demandes",
  "/student — élève : notes, EDT, bulletins (lecture seule)",
  "/platform — ECOM-TOUCH : établissements, offres, abonnements, supervision",
]);
S("Principes transverses", "Les règles qui protègent vos données", [
  "Isolation stricte par établissement (tenant) — aucune fuite possible",
  "Draft → validation → publication : la famille ne voit que ce qui est publié",
  "Idempotence : une opération rejouée ne crée jamais de doublon",
  "Immutabilité comptable : on contre-passe, on ne supprime pas",
  "Auditabilité : chaque action sensible est tracée (auteur, date)",
]);
S("Cycle scolaire", "De la rentrée aux bulletins", [
  "Année + périodes → classes → matières (coefficients) → emplois du temps",
  "Élève → responsable → inscription → créance auto-générée",
  "Évaluation → saisie → validation → publication → moyennes → bulletins",
  "Délibérations : propositions calculées, décision humaine tracée",
]);
S("Cycle financier", "De la créance à l'écriture comptable", [
  "Grille tarifaire → créances → échéancier → encaissement → reçu REC-…",
  "Génération des écritures : équilibrées, clé unique, erreurs signalées",
  "États SYSCOHADA : balance, bilan, compte de résultat, balance âgée",
  "Clôture d'exercice refusée tant que des opérations restent non postées",
]);
S("Cycle RH et paie", "Personnes, congés, bulletins", [
  "Employé → contrat actif → dotation automatique de congés",
  "Demandes de congés : approbation, solde déduit, cas sans solde (UNPAID)",
  "Campagne : calcul → validation → comptabilisation atomique (OD D66/C422)",
  "Avances plafonnées (% du net), recouvrement FIFO",
  "⚠ Composants réglementaires BF désactivés — bulletins indicatifs",
]);
S("Portails familles et enseignants", "Ce que voient vos utilisateurs finaux", [
  "Parent : sélecteur d'enfant, onglets (notes, absences, finances, demandes)",
  "Parent : reçus téléchargeables, réinscription en ligne, annonces",
  "Enseignant : appels par séance, cahier de textes, emploi du temps",
  "Élève : consultation seule de son dossier publié",
]);
S("Sécurité au quotidien", "Réflexes à transmettre", [
  "Mot de passe personnel — un reçu ou une demande porte votre nom",
  "Déconnexion sur poste partagé ; invitations à usage unique",
  "403 sur une URL = périmètre de rôle, pas un bug",
  "Signaler toute anomalie à l'administrateur avec heure + écran",
]);
S("Aller plus loin", "Ressources fournies", [
  "10 manuels par profil (PDF + DOCX) — procédures illustrées pas à pas",
  "9 tutoriels métier de bout en bout",
  "FAQ, glossaire, exercices corrigés, checklists",
  "Environnement de démonstration : preprod.ecomschool.fr",
]);
{
  const s = pptx.addSlide();
  s.addShape("rect", { x: 0, y: 0, w: 13.3, h: 7.5, fill: { color: NAVY } });
  s.addText("Merci — ECOM-TOUCH", { x: 1, y: 3, w: 11, h: 1, fontSize: 36, bold: true, color: "FFFFFF" });
  s.addText("Documentation complète dans le package — version " + VERSION, { x: 1, y: 4, w: 11, h: 0.6, fontSize: 16, color: "BFDBFE" });
}
await pptx.writeFile({ fileName: join(ZIPDIR, "FORMATION-ECOM-SCHOOL.pptx") });
console.log("PPTX ok");

// ---------- 2. ZIP structuré ----------
const profils = {
  "01-administrateur-direction": ["manuel-administrateur"],
  "02-secretaire-scolarite": ["manuel-secretaire"],
  "03-comptable-financier": ["manuel-comptable"],
  "04-caissier": ["manuel-caissier"],
  "05-responsable-rh": ["manuel-rh"],
  "06-gestionnaire-paie": ["manuel-paie"],
  "07-enseignant": ["manuel-enseignant"],
  "08-parent": ["manuel-parent"],
  "09-eleve": ["manuel-eleve"],
  "10-plateforme-ecom-touch": ["manuel-plateforme"],
};
const communs = ["demarrage-rapide", "tutoriels-metier", "faq", "glossaire", "exercices", "checklist-prise-en-main", "guide-admin-technique"];
const commerciaux = {
  "docs/demo/PARCOURS_DEMONSTRATION.md": "PARCOURS_DEMONSTRATION.md",
  "docs/utilisateur/GUIDE_UTILISATEUR.md": "GUIDE_UTILISATEUR.md",
  "docs/recette/CHECKLIST_RECETTE_METIER.md": "CHECKLIST_RECETTE_METIER.md",
  "MATRICE_COMMERCIALISATION.md": "MATRICE_COMMERCIALISATION.md",
  "docs/commercial/DOSSIER_PRESENTATION.md": "DOSSIER_PRESENTATION.md",
  "docs/reglementaire/PARAMETRES_PAIE_BF.md": "PARAMETRES_PAIE_BF.md",
};

const pdf = s => join(OUT, `${s}.pdf`), docx = s => join(OUT, `${s}.docx`);
const manifest = [];
const stage = (src, dest) => { if (existsSync(src)) { mkdirSync(join(dest, ".."), { recursive: true }); copyFileSync(src, dest); manifest.push(dest); } };

// arborescence staging
const STAGE = join(OUT, "_stage");
for (const [dir, manuels] of Object.entries(profils))
  for (const m of manuels) {
    stage(pdf(m), join(STAGE, "manuels-par-profil", dir, `${m}.pdf`));
    stage(docx(m), join(STAGE, "manuels-par-profil", dir, "source-modifiable", `${m}.docx`));
  }
for (const c of communs) {
  stage(pdf(c), join(STAGE, "kit-de-formation", `${c}.pdf`));
  stage(docx(c), join(STAGE, "kit-de-formation", "source-modifiable", `${c}.docx`));
}
stage(join(ZIPDIR, "FORMATION-ECOM-SCHOOL.pptx"), join(STAGE, "kit-de-formation", "FORMATION-ECOM-SCHOOL.pptx"));
for (const [src, name] of Object.entries(commerciaux))
  stage(join(ROOT, src), join(STAGE, "documents-commerciaux", name));
const capdir = join(ROOT, "docs/manuels/captures");
if (existsSync(capdir))
  for (const f of readdirSync(capdir).filter(f => f.endsWith(".png")))
    stage(join(capdir, f), join(STAGE, "captures-ecran", f));

writeFileSync(join(STAGE, "README.md"),
`# Package documentation ECOM-SCHOOL — ${VERSION}

## Contenu
- manuels-par-profil/ : 10 manuels (PDF + sources DOCX modifiables)
- kit-de-formation/ : démarrage rapide, tutoriels métier, FAQ, glossaire,
  exercices corrigés, checklists, guide admin technique, support PPTX
- documents-commerciaux/ : parcours de démo, guide utilisateur, checklist
  de recette, matrice des fonctionnalités, dossier de présentation,
  paramètres paie BF
- captures-ecran/ : captures réelles annotées (preprod, données fictives)

## Rappels
- Environnement de démonstration : https://preprod.ecomschool.fr
- Données 100 % fictives — aucune donnée réelle n'apparaît
- Paie BF : composants réglementaires désactivés en attente du barème
  officiel — les bulletins produits sont indicatifs
- Généré le ${now.toISOString().slice(0, 10)} — ne pas redistribuer les
  identifiants de démonstration
`);

// zip
const zipPath = join(OUT, `ECOM-SCHOOL_DOCUMENTATION_${VERSION}.zip`);
await new Promise((res, rej) => {
  const out = createWriteStream(zipPath);
  const ar = new ZipArchive({ zlib: { level: 9 } });
  out.on("close", res); ar.on("error", rej);
  ar.pipe(out); ar.directory(STAGE, false); ar.finalize();
});
console.log(`ZIP ok → ${zipPath} (${(statSync(zipPath).size / 1048576).toFixed(1)} Mo, ${manifest.length + 1} fichiers)`);
