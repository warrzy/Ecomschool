"use client";

import { useState, type ReactNode } from "react";
import { toCsv } from "@/lib/export/csv";

export interface WizardIssue {
  line: number;
  column: string | null;
  value: string | null;
  reason: string;
}

export interface WizardRow {
  line: number;
  action: string;
  errors: WizardIssue[];
}

export interface WizardPreview<T extends WizardRow> {
  summary: Record<string, number>;
  rows: T[];
  token: string;
  expiresAt: string;
}

interface Props<T extends WizardRow> {
  previewUrl: string;
  commitUrl: string;
  templateUrl: string;
  title: string;
  hint: string;
  /** Champ supplémentaire obligatoire (ex. année scolaire). */
  extraField?: {
    name: string;
    label: string;
    options: { value: string; label: string }[];
  };
  columns: string[];
  summaryLabels: { key: string; label: string }[];
  renderCells: (row: T) => ReactNode;
  /** true = la présence d'erreurs bloque la confirmation (import atomique). */
  blockingErrors?: boolean;
  resultMessage: (result: CommitResult) => string;
}

/** Résultat JSON du commit : compteurs + éventuelles erreurs de ligne. */
export type CommitResult = Record<string, number> & {
  errors?: WizardIssue[];
};

const inputCls =
  "w-full rounded-xl border border-zinc-200 p-3 text-sm outline-none focus:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400";

export function ImportWizard<T extends WizardRow>({
  previewUrl,
  commitUrl,
  templateUrl,
  title,
  hint,
  extraField,
  columns,
  summaryLabels,
  renderCells,
  blockingErrors = false,
  resultMessage,
}: Props<T>) {
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [extra, setExtra] = useState(extraField?.options[0]?.value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WizardPreview<T> | null>(null);
  const [done, setDone] = useState<CommitResult | null>(null);

  const buildForm = (withToken: boolean) => {
    const fd = new FormData();
    if (file) fd.set("file", file);
    else fd.set("csv", pasted);
    if (extraField) fd.set(extraField.name, extra);
    if (withToken && preview) fd.set("token", preview.token);
    return fd;
  };

  const post = async (url: string, fd: FormData) => {
    const res = await fetch(url, { method: "POST", body: fd });
    const text = await res.text();
    let json: { error?: string } & Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        res.redirected || res.status === 307
          ? "Session ou permission insuffisante — reconnectez-vous"
          : `Réponse inattendue (${res.status})`,
      );
    }
    if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`);
    return json;
  };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    setDone(null);
    try {
      const json = await post(previewUrl, buildForm(false));
      setPreview(json as unknown as WizardPreview<T>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse impossible");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const json = await post(commitUrl, buildForm(true));
      setDone(json as CommitResult);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmation impossible");
      setPreview(null); // aperçu obsolète → nouvelle analyse requise
    } finally {
      setBusy(false);
    }
  };

  const downloadErrors = (issues: WizardIssue[]) => {
    const csv = toCsv(
      ["ligne", "colonne", "valeur", "motif"],
      issues.map((i) => [i.line, i.column, i.value, i.reason]),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rapport-erreurs-import.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const allIssues = preview
    ? preview.rows.flatMap((r) => r.errors)
    : [];
  const hasErrors = (preview?.summary.errors ?? 0) > 0;
  const validRows = preview
    ? preview.rows.filter((r) => r.action !== "error").length
    : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-1 text-sm font-medium text-zinc-900">{title}</div>
        <p className="mb-4 text-xs text-zinc-500">{hint}</p>

        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <a
            href={`${templateUrl}?format=csv`}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50"
          >
            Modèle CSV
          </a>
          <a
            href={`${templateUrl}?format=xlsx`}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50"
          >
            Modèle Excel
          </a>
        </div>

        {extraField ? (
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-zinc-600">{extraField.label}</span>
            <select
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              className={inputCls}
            >
              {extraField.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <input
          type="file"
          accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="Fichier à importer (CSV ou Excel)"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setDone(null);
          }}
          className="mb-3 block w-full text-sm text-zinc-600"
        />
        <textarea
          rows={5}
          value={pasted}
          aria-label="Contenu CSV à coller"
          onChange={(e) => {
            setPasted(e.target.value);
            setFile(null);
            setPreview(null);
            setDone(null);
          }}
          placeholder="Ou coller le contenu CSV ici…"
          className={`${inputCls} font-mono text-xs`}
        />
        <button
          type="button"
          disabled={busy || (!file && !pasted.trim()) || (!!extraField && !extra)}
          onClick={analyze}
          className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? "Analyse…" : "Analyser le fichier"}
        </button>
        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      {preview ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap gap-2">
            {summaryLabels.map(({ key, label }) => (
              <span
                key={key}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  key === "errors" && (preview.summary[key] ?? 0) > 0
                    ? "bg-red-100 text-red-700"
                    : "bg-zinc-100 text-zinc-700"
                }`}
              >
                {label} : {preview.summary[key] ?? 0}
              </span>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table aria-label="Aperçu des données à importer" className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                  {columns.map((c) => (
                    <th scope="col" key={c} className="px-2 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr
                    key={r.line}
                    className={
                      r.action === "error"
                        ? "border-b border-zinc-100 bg-red-50/50"
                        : "border-b border-zinc-100"
                    }
                  >
                    {renderCells(r)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={
                busy ||
                validRows === 0 ||
                (blockingErrors && hasErrors)
              }
              onClick={confirm}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy
                ? "Importation…"
                : `Confirmer l'import (${validRows} ligne${validRows > 1 ? "s" : ""})`}
            </button>
            {blockingErrors && hasErrors ? (
              <span className="text-xs text-red-600">
                Import atomique : corrigez toutes les erreurs pour confirmer.
              </span>
            ) : null}
            {hasErrors ? (
              <button
                type="button"
                onClick={() => downloadErrors(allIssues)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
              >
                Rapport d’erreurs (CSV)
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Aperçu valable 15 minutes. Le fichier sera re-vérifié à la
            confirmation.
          </p>
        </div>
      ) : null}

      {done ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <div className="text-sm font-medium text-emerald-800">
            Import terminé
          </div>
          <p className="mt-1 text-sm text-emerald-700">{resultMessage(done)}</p>
          {Array.isArray(done.errors) && done.errors.length > 0 ? (
            <button
              type="button"
              onClick={() => downloadErrors(done.errors ?? [])}
              className="mt-3 rounded-lg border border-emerald-300 px-4 py-2 text-sm hover:bg-emerald-100"
            >
              Rapport d’erreurs (CSV)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
