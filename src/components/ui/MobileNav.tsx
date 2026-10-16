"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export type MobileNavSection = {
  title?: string;
  items: { label: string; href: string }[];
};

/**
 * Navigation mobile partagée : bouton « Menu » + panneau coulissant.
 * - Fermeture : Échap, clic sur l'overlay, sélection d'un lien.
 * - Focus : placé sur le premier lien à l'ouverture, rendu au bouton
 *   déclencheur à la fermeture ; Tab est capturé dans le panneau.
 * - Le défilement du contenu est bloqué tant que le panneau est ouvert.
 * - Les liens affichés proviennent des sections déjà filtrées par les
 *   permissions côté serveur — aucun filtrage n'est fait ici.
 */
export function MobileNav({
  sections,
  title = "ECOM-SCHOOL",
}: {
  sections: MobileNavSection[];
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Ferme le panneau après toute navigation (ajustement pendant le rendu).
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const triggerEl = buttonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const firstLink = panelRef.current?.querySelector<HTMLElement>("a");
    firstLink?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>("a, button"),
        ).filter((el) => !el.hasAttribute("disabled"));
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
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      triggerEl?.focus();
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {open ? (
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-zinc-900/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            id="mobile-nav-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation principale"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white p-4 shadow-xl"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between">
              <div className="text-lg font-semibold tracking-tight text-zinc-900">
                {title}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
              >
                <svg
                  aria-hidden="true"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <nav className="space-y-3 text-sm" aria-label="Menu principal">
              {sections.map((section, i) => (
                <div key={section.title ?? i}>
                  {section.title ? (
                    <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {section.title}
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    {section.items.map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        className="block rounded-lg px-3 py-2 text-zinc-900 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
