"use client";

import { useState } from "react";

export type FaqItem = { q: string; a: string };

/** Accordéon FAQ : bouton + région, aria-expanded, un seul ouvert à la fois. */
export default function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto max-w-3xl divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {items.map((item, i) => (
        <div key={item.q}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            aria-controls={`faq-panel-${i}`}
            className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left"
          >
            <span className="text-sm font-medium text-zinc-900 sm:text-base">
              {item.q}
            </span>
            <span
              aria-hidden="true"
              className={`shrink-0 text-zinc-400 transition-transform duration-300 ${
                open === i ? "rotate-45" : ""
              }`}
            >
              +
            </span>
          </button>
          <div
            id={`faq-panel-${i}`}
            role="region"
            className={`grid transition-all duration-300 ease-out ${
              open === i
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <p className="px-6 pb-5 text-sm leading-relaxed text-zinc-600">
                {item.a}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
