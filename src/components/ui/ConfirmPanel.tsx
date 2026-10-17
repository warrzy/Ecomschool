"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Panneau de confirmation partagé pour les actions sensibles.
 * Rendu côté page via `?confirm=<kind>&id=<id>` : la page résout l'objet,
 * nomme précisément la cible dans `children`, puis monte ce panneau.
 * La permission reste vérifiée par la server action — ce composant ne
 * protège rien, il empêche seulement le déclenchement accidentel.
 *
 * `requireText` = confirmation renforcée : l'utilisateur doit saisir le
 * mot exact (ex. « SUPPRIMER ») pour activer le bouton.
 */
export type ConfirmInput = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
};

export function ConfirmPanel({
  title,
  tone = "warning",
  action,
  fields,
  inputs,
  confirmLabel = "Confirmer",
  cancelHref,
  requireText,
  children,
}: {
  /** Titre du panneau, ex. « Confirmer la clôture ». */
  title: string;
  /** warning (ambre) = action sensible ; danger (rouge) = irréversible. */
  tone?: "warning" | "danger";
  /** Server action exécutée à la confirmation. */
  action: (formData: FormData) => void | Promise<void>;
  /** Champs cachés repris par le formulaire (id, paramètres…). */
  fields: Record<string, string>;
  /** Champs visibles à remplir avant de confirmer (motif, date…). */
  inputs?: ConfirmInput[];
  confirmLabel?: string;
  /** Destination stable du bouton Annuler (page sans `?confirm=`). */
  cancelHref: string;
  /** Mot à retaper pour activer la confirmation (actions destructrices). */
  requireText?: string;
  children: React.ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const router = useRouter();
  const locked = !!requireText && typed.trim() !== requireText;

  // Focus visible dès l'ouverture : champ de frappe sinon bouton Annuler.
  // Au démontage (Escape ou Annuler), le focus revient à l'élément
  // déclencheur s'il est encore présent dans le document.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = panelRef.current?.querySelector<HTMLElement>(
      requireText ? "input[data-confirm-text]" : "a[data-cancel]",
    );
    el?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [requireText]);

  // Clavier : Escape annule (navigation vers l'URL sans ?confirm= —
  // aucune action n'est déclenchée) et Tab reste capturé dans le panneau.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(cancelHref);
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelHref, router]);

  const palette =
    tone === "danger"
      ? "border-red-300 bg-red-50 text-red-900"
      : "border-amber-300 bg-amber-50 text-amber-900";

  return (
    <div
      ref={panelRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className={`rounded-2xl border p-6 shadow-sm ${palette}`}
    >
      <div id={titleId} className="text-sm font-semibold">
        {title}
      </div>
      <div id={descId} className="mt-2 text-sm">{children}</div>
      <form action={action} className="mt-4">
        {inputs?.some((f) => f.required) || requireText ? (
          <p className="mb-3 w-full text-xs text-zinc-500">
            Les champs marqués d’un astérisque (*) sont obligatoires.
          </p>
        ) : null}
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {inputs?.map((f) => (
          <label key={f.name} className="mb-3 block text-sm">
            {f.label}
            {f.required ? (
              <span aria-hidden="true" className="text-red-600"> *</span>
            ) : null}
            <input
              name={f.name}
              type={f.type ?? "text"}
              required={f.required}
              defaultValue={f.defaultValue}
              placeholder={f.placeholder}
              className="ml-2 h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
            />
          </label>
        ))}
        {requireText ? (
          <label className="mb-3 block text-sm">
            Saisissez «{" "}
            <span className="font-mono font-semibold">{requireText}</span> »
            pour confirmer
            <span aria-hidden="true" className="text-red-600"> *</span> :
            <input
              data-confirm-text
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="ml-2 h-9 w-44 rounded-lg border border-zinc-300 bg-white px-2 font-mono text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
              autoComplete="off"
            />
          </label>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <ConfirmSubmit
            label={confirmLabel}
            tone={tone}
            locked={locked}
          />
          <Link
            data-cancel
            href={cancelHref}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
          >
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}

function ConfirmSubmit({
  label,
  tone,
  locked,
}: {
  label: string;
  tone: "warning" | "danger";
  locked: boolean;
}) {
  const { pending } = useFormStatus();
  const cls =
    tone === "danger"
      ? "rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
      : "rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700";
  return (
    <button
      type="submit"
      disabled={pending || locked}
      aria-busy={pending}
      className={`${cls} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? "En cours…" : label}
    </button>
  );
}
