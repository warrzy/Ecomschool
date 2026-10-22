"use client";

import { useState } from "react";
import { rotateSecretAction } from "@/app/app/(tenant)/admissions/actions";

/**
 * Régénération du code de suivi : le nouveau code est affiché une seule
 * fois dans l'interface — jamais dans l'URL ni dans les logs.
 */
export function RotateSecretButton(props: { applicationId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (
      !window.confirm(
        "Régénérer le code de suivi ? L'ancien code cessera immédiatement de fonctionner.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(false);
    const res = await rotateSecretAction(props.applicationId);
    setBusy(false);
    if (!res.ok) {
      setError(true);
      return;
    }
    setSecret(res.secret);
  }

  if (secret) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <div className="font-semibold">
          Nouveau code de suivi — à communiquer au déposant, affiché une
          seule fois :
        </div>
        <div className="mt-2 select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-sm">
          {secret}
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
        {busy ? "…" : "Régénérer le code de suivi"}
      </button>
      {error ? (
        <span className="ml-2 text-xs text-red-700">Échec — réessayez.</span>
      ) : null}
    </span>
  );
}
