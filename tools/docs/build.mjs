/**
 * Chaîne de génération documentaire ECOM-SCHOOL.
 * Sources : docs/manuels/src/*.md → HTML (marque ECOM-TOUCH) → PDF/DOCX
 * + PPTX de formation + archive ZIP des livrables.
 *
 * Usage : node tools/docs/build.mjs [filtre]
 * Dépendances locales : marked, docx, pptxgenjs, archiver (tools/docs/).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { marked } from "marked";
import { chromium } from "playwright";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  AlignmentType, Table, TableRow, TableCell, WidthType,
} from "docx";
import PptxGenJS from "pptxgenjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const archiver = require("archiver");
import { createWriteStream } from "node:fs";

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = join(ROOT, "docs/manuels/src");
const CAPTURES = join(ROOT, "docs/manuels/captures");
const OUT = join(ROOT, "docs/livrables-commerciaux");
const FILTRE = process.argv[2];

const BRAND = "#1e3a8a";
const ACCENT = "#e11d48";

// ---------- CSS professionnel ----------
const CSS = `
@page { size: A4; margin: 18mm 14mm 20mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 10.5pt; color: #1f2937; line-height: 1.55; margin: 0; }
h1 { font-size: 26pt; color: ${BRAND}; border-bottom: 3px solid ${BRAND}; padding-bottom: 8px; }
h2 { font-size: 16pt; color: ${BRAND}; margin-top: 1.6em; page-break-after: avoid; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px; }
h3 { font-size: 12.5pt; color: #334155; margin-top: 1.3em; page-break-after: avoid; }
h4 { font-size: 11pt; color: #475569; }
p { margin: .5em 0; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9.5pt; }
th { background: ${BRAND}; color: #fff; text-align: left; padding: 5px 8px; }
td { border: 1px solid #cbd5e1; padding: 4px 8px; }
tr:nth-child(even) td { background: #f8fafc; }
img { max-width: 100%; }
figure { margin: 1em 0 1.4em; page-break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
figure img { display: block; width: 100%; }
figcaption { background: #f1f5f9; padding: 6px 10px; font-size: 9pt; color: #475569; font-weight: 600; }
.cover { text-align: center; padding-top: 34mm; page-break-after: always; }
.cover .logo { font-size: 30pt; font-weight: 800; color: ${BRAND}; letter-spacing: 2px; }
.cover .sub { font-size: 13pt; color: #64748b; margin-top: 4px; }
.cover .title { font-size: 22pt; font-weight: 700; color: #0f172a; margin: 40px 0 10px; }
.cover .meta { color: #94a3b8; font-size: 10pt; margin-top: 60px; }
.toc { page-break-after: always; }
.toc a { color: #1f2937; text-decoration: none; }
.toc .l1 { font-weight: 700; margin: 8px 0 2px; }
.toc .l2 { margin-left: 16px; margin: 3px 0; font-size: 9.8pt; }
.badge { display: inline-block; background: ${ACCENT}; color: #fff; border-radius: 50%; width: 18px; height: 18px; text-align: center; font-weight: 700; font-size: 9pt; line-height: 18px; }
.note, .warn, .ok { border-radius: 8px; padding: 10px 14px; margin: .9em 0; font-size: 9.8pt; page-break-inside: avoid; }
.note { background: #eff6ff; border-left: 4px solid #3b82f6; }
.warn { background: #fff7ed; border-left: 4px solid #f59e0b; }
.ok   { background: #f0fdf4; border-left: 4px solid #22c55e; }
.perm { display: inline-block; background: #ede9fe; color: #5b21b6; border-radius: 5px; padding: 1px 7px; font-size: 8.5pt; font-family: Consolas, monospace; }
code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 9pt; }
.step { display: flex; gap: 10px; margin: 6px 0; }
.chap { page-break-before: always; }
.small { font-size: 8.8pt; color: #64748b; }
`;

// ---------- Renderer : images → figures, encadrés ----------
const renderer = new marked.Renderer();
let figNo = 0;
renderer.image = ({ href, title, text }) => {
  figNo++;
  const cap = title || text || `Figure ${figNo}`;
  const src = href.startsWith("http") ? href : `file:///${join(ROOT, "docs/manuels", href).replace(/\\/g, "/")}`;
  return `<figure><img src="${src}" alt=""/><figcaption>Figure ${String(figNo).padStart(2, "0")} — ${cap}</figcaption></figure>`;
};
// > [!NOTE] / > [!WARN] / > [!OK] → encadrés colorés
renderer.blockquote = (token) => {
  const raw = token.tokens?.map((t) => t.raw ?? "").join("") ?? "";
  const inner = marked.parser(token.tokens ?? []);
  if (raw.includes("[!WARN]")) return `<div class="warn">${inner}</div>`;
  if (raw.includes("[!OK]")) return `<div class="ok">${inner}</div>`;
  if (raw.includes("[!NOTE]")) return `<div class="note">${inner}</div>`;
  return `<blockquote>${inner}</blockquote>`;
};
// `perm:x.y` → pastille permission
marked.use({
  renderer,
  extensions: [{
    name: "perm", level: "inline",
    start: (s) => s.indexOf("`perm:"),
    tokenizer: (s) => {
      const m = s.match(/^`perm:([a-z.\-]+)`/);
      return m ? { type: "perm", raw: m[0], key: m[1] } : undefined;
    },
    renderer: (t) => `<span class="perm">${t.key}</span>`,
  }],
});

// ---------- MD → HTML ----------
function mdToHtml(md, title) {
  figNo = 0;
  const tokens = marked.lexer(md);
  let toc = "", body = "", hCount = 0;
  for (const tok of tokens) {
    if (tok.type === "heading" && tok.depth === 2) {
      hCount++;
      const id = `s${hCount}`;
      tok.text += ` <a name="${id}"></a>`;
      toc += `<div class="l1"><a href="#${id}">${tok.text}</a></div>`;
      body += `<div class="chap">${marked.parser([tok])}</div>`;
    } else if (tok.type === "heading" && tok.depth === 3) {
      const id = `s${hCount}-${Math.random().toString(36).slice(2, 6)}`;
      toc += `<div class="l2"><a href="#">${tok.text}</a></div>`;
      body += marked.parser([tok]);
    } else {
      body += marked.parser([tok]);
    }
  }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="cover"><div class="logo">ECOM-SCHOOL</div><div class="sub">ECOM-TOUCH — Gestion scolaire intégrée</div>
  <div class="title">${title}</div>
  <div class="meta">Environnement de démonstration — données 100 % fictives<br/>Édition novembre 2026 — Document confidentiel</div></div>
  <div class="toc"><h1 style="font-size:18pt">Sommaire</h1>${toc}</div>
  ${body}</body></html>`;
}

// ---------- MD tokens → DOCX ----------
function inlineRuns(text) {
  const runs = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  for (const p of parts) {
    if (p.startsWith("**")) runs.push(new TextRun({ text: p.slice(2, -2), bold: true }));
    else if (p.startsWith("*")) runs.push(new TextRun({ text: p.slice(1, -1), italics: true }));
    else if (p.startsWith("`")) runs.push(new TextRun({ text: p.slice(1, -1), font: "Consolas" }));
    else if (p) runs.push(new TextRun({ text: p }));
  }
  return runs.length ? runs : [new TextRun("")];
}

function tokensToDocx(tokens) {
  const els = [];
  const HL = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };
  for (const tok of tokens) {
    if (tok.type === "heading") {
      els.push(new Paragraph({ heading: HL[tok.depth] ?? HeadingLevel.HEADING_4, children: inlineRuns(tok.text.replace(/<[^>]+>/g, "")) }));
    } else if (tok.type === "paragraph") {
      const img = tok.tokens?.find((t) => t.type === "image");
      if (img) {
        const p = join(ROOT, "docs/manuels", img.href);
        if (existsSync(p)) {
          els.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data: readFileSync(p), transformation: { width: 620, height: 370 }, type: "png" })],
          }));
        }
      } else {
        els.push(new Paragraph({ children: inlineRuns(tok.text.replace(/<[^>]+>/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "")) }));
      }
    } else if (tok.type === "list") {
      for (const it of tok.items)
        els.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(it.text.replace(/<[^>]+>/g, "")) }));
    } else if (tok.type === "table") {
      els.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: tok.header.map((h) => new TableCell({ children: [new Paragraph({ children: inlineRuns(h.text) })] })) }),
          ...tok.rows.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph({ children: inlineRuns(c.text) })] })) })),
        ],
      }));
    } else if (tok.type === "blockquote") {
      for (const t of tok.tokens ?? [])
        if (t.type === "paragraph") els.push(new Paragraph({ children: inlineRuns(`▸ ${t.text.replace(/<[^>]+>/g, "")}`) }));
    }
  }
  return els;
}

// ---------- Builds ----------
async function buildPdf(htmlPath, pdfPath, title) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle" });
  await page.pdf({
    path: pdfPath, format: "A4", printBackground: true, displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8px;width:100%;padding:0 14mm;color:#94a3b8"><span>ECOM-SCHOOL / ECOM-TOUCH</span><span style="float:right">${title}</span></div>`,
    footerTemplate: `<div style="font-size:8px;width:100%;padding:0 14mm;color:#94a3b8;text-align:center">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    margin: { top: "16mm", bottom: "16mm", left: "0", right: "0" },
  });
  await browser.close();
}

function slugify(t) { return t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").toUpperCase().replace(/^-|-$/g, ""); }

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(join(OUT, "html"), { recursive: true });
  const files = readdirSync(SRC).filter((f) => f.endsWith(".md") && (!FILTRE || f.includes(FILTRE)));
  const browser = await chromium.launch();
  for (const f of files) {
    const md = readFileSync(join(SRC, f), "utf8");
    const m = md.match(/^<!--\s*title:\s*(.+?)\s*-->/m);
    const title = m ? m[1] : f.replace(/\.md$/, "");
    const html = mdToHtml(md, title);
    const htmlPath = join(OUT, "html", f.replace(/\.md$/, ".html"));
    writeFileSync(htmlPath, html);
    const slug = slugify(f.replace(/\.md$/, ""));
    await buildPdf(htmlPath, join(OUT, `${slug}.pdf`), title);
    // DOCX
    const tokens = marked.lexer(md);
    const doc = new Document({
      styles: { default: { document: { run: { font: "Segoe UI", size: 21 } } } },
      sections: [{ children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `ECOM-SCHOOL — ${title}`, bold: true, color: "1E3A8A", size: 44 })] }),
        ...tokensToDocx(tokens),
      ] }],
    });
    writeFileSync(join(OUT, `${slug}.docx`), await Packer.toBuffer(doc));
    console.log(`  ✔ ${slug}.pdf + .docx`);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
