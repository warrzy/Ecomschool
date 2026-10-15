"use client";

import { useState, type ReactNode } from "react";
import BrowserFrame from "@/components/marketing/browser-frame";

export type Persona = {
  id: string;
  label: string;
  icon?: ReactNode;
  title: string;
  points: string[];
  image?: string;
  imageAlt?: string;
  url?: string;
};

/**
 * Onglets par profil utilisateur — navigation clavier native (boutons,
 * tablist/aria-selected, flèches gauche/droite).
 */
export default function PersonaTabs({ personas }: { personas: Persona[] }) {
  const [active, setActive] = useState(0);
  const current = personas[active];

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") setActive((a) => (a + 1) % personas.length);
    if (e.key === "ArrowLeft")
      setActive((a) => (a - 1 + personas.length) % personas.length);
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Profils utilisateurs"
        onKeyDown={onKeyDown}
        className="flex flex-wrap justify-center gap-2"
      >
        {personas.map((p, i) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={i === active}
            aria-controls={`persona-panel-${p.id}`}
            id={`persona-tab-${p.id}`}
            onClick={() => setActive(i)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
              i === active
                ? "border-zinc-900 bg-zinc-900 text-white shadow-md"
                : "border-zinc-200 bg-white text-zinc-700 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-sm"
            }`}
          >
            {p.icon ? <span aria-hidden="true">{p.icon}</span> : null}
            {p.label}
          </button>
        ))}
      </div>

      <div
        key={current.id}
        role="tabpanel"
        id={`persona-panel-${current.id}`}
        aria-labelledby={`persona-tab-${current.id}`}
        className="persona-panel mt-8 grid items-center gap-8 lg:grid-cols-2"
      >
        <div>
          <h3 className="text-xl font-semibold tracking-tight text-zinc-900">
            {current.title}
          </h3>
          <ul className="mt-4 space-y-2.5">
            {current.points.map((pt) => (
              <li key={pt} className="flex gap-2.5 text-sm text-zinc-600">
                <span className="mt-0.5 text-emerald-600" aria-hidden="true">
                  ✓
                </span>
                {pt}
              </li>
            ))}
          </ul>
        </div>
        {current.image ? (
          <BrowserFrame
            src={current.image}
            alt={current.imageAlt ?? `Interface ${current.label}`}
            url={current.url}
          />
        ) : null}
      </div>
    </div>
  );
}
