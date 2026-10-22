"use client";

import { useState } from "react";
import { invitePortalAccountAction } from "@/app/app/(tenant)/admissions/actions";

/**
 * Prépare l'invitation portail (parent, ou élève si candidat majeur).
 * Le jeton est affiché une seule fois pour transmission manuelle à la
 * famille — aucun envoi SMS/WhatsApp/email n'est déclenché.
 */
export function InvitePortalButton(props: { applicationId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (
      !window.confirm(
        "Créer un compte portail (désactivé) et générer un jeton d'invitation ?",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await invitePortalAccountAction(props.applicationId);
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error === "ALREADY_LINKED"
          ? "Un compte est déjà associé."
          : res.error === "EMAIL_TAKEN"
            ? "Cet email est déjà utilisé par un compte."
            : "Échec — réessayez.",
      );
      return;
    }
    setToken(res.token);
  }

  if (token) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="font-semibold">
          Invitation créée — communiquez ce jeton à la famille (affiché une
          seule fois) :
        </div>
        <div className="mt-2 select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-sm">
          {token}
        </div>
      </div>
    );
  }

  return (
    <span>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
      >
        {busy ? "…" : "Préparer l'accès portail"}
      </button>
      {error ? (
        <span className="ml-2 text-xs text-red-700">{error}</span>
      ) : null}
    </span>
  );
}
