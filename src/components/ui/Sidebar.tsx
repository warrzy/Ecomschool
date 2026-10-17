"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import { LogoMark } from "@/components/ui/brand";

export type SidebarItem = {
  label: string;
  href: string;
  icon?: string;
};

export type SidebarSection = {
  title?: string;
  items: SidebarItem[];
};

function NavIcon(props: { d?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
    >
      <path d={props.d ?? "M4 6h16M4 12h16M4 18h16"} />
    </svg>
  );
}

const isActive = (pathname: string, href: string) => {
  const path = href.split("?")[0];
  if (path === "/app" || path === "/platform" || path === "/teacher") {
    return pathname === path;
  }
  return pathname === path || pathname.startsWith(path + "/");
};

/**
 * Sidebar premium bleu nuit — développée ou compacte (icônes + tooltips).
 * - Préférence persistée dans localStorage (`storageKey`).
 * - État actif : barre dorée + fond renforcé.
 * - Desktop uniquement (`hidden md:flex`) : le mobile garde MobileNav.
 * - Transitions neutralisées sous prefers-reduced-motion (motion-safe:).
 */
export function Sidebar(props: {
  sections: SidebarSection[];
  brandTitle: string;
  brandSubtitle: string;
  storageKey: string;
}) {
  const pathname = usePathname();
  // Préférence persistée : snapshot serveur = développé ; lecture locale côté client.
  const [pulse, setPulse] = useState(0);
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("storage", notify);
    return () => window.removeEventListener("storage", notify);
  }, []);
  const getSnapshot = useCallback(() => {
    void pulse;
    try {
      return localStorage.getItem(props.storageKey) === "1";
    } catch {
      return false;
    }
  }, [pulse, props.storageKey]);
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, () => false);

  function toggle() {
    try {
      localStorage.setItem(props.storageKey, collapsed ? "0" : "1");
    } catch {
      /* non bloquant */
    }
    setPulse((p) => p + 1);
  }

  return (
    <aside
      aria-label="Navigation latérale"
      className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-brand-950 text-white motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out md:flex ${
        collapsed ? "w-[4.5rem]" : "w-64"
      }`}
    >
      {/* Marque */}
      <div
        className={`flex items-center gap-3 px-4 pb-5 pt-5 ${
          collapsed ? "justify-center px-2" : ""
        }`}
      >
        <LogoMark className="h-9 w-9 shrink-0" />
        {!collapsed ? (
          <div className="min-w-0">
            <div className="font-display truncate text-sm font-bold tracking-tight text-white">
              {props.brandTitle}
            </div>
            <div className="truncate text-xs text-brand-300">
              {props.brandSubtitle}
            </div>
          </div>
        ) : null}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 text-sm">
        {props.sections.map((section, i) => (
          <div key={section.title ?? i}>
            {section.title && !collapsed ? (
              <div className="px-3 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-widest text-brand-300/70">
                {section.title}
              </div>
            ) : null}
            {section.title && collapsed ? (
              <div aria-hidden="true" className="mx-3 mb-2 h-px bg-white/10" />
            ) : null}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sun-400 ${
                        collapsed ? "justify-center px-0" : ""
                      } ${
                        active
                          ? "bg-white/12 text-white"
                          : "text-white/65 hover:bg-white/6 hover:text-white"
                      }`}
                    >
                      {/* Indicateur actif — barre dorée */}
                      <span
                        aria-hidden="true"
                        className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sun-400 transition-all duration-200 ${
                          active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                        }`}
                      />
                      <NavIcon d={item.icon} />
                      {!collapsed ? (
                        <span className="truncate">{item.label}</span>
                      ) : null}
                      {/* Tooltip en mode compact */}
                      {collapsed ? (
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lift transition-all duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:group-hover:translate-x-1"
                        >
                          {item.label}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bascule développé / compact */}
      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Développer le menu" : "Réduire le menu"}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/65 outline-none transition-colors hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-sun-400 ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:duration-300 ${
              collapsed ? "rotate-180" : ""
            }`}
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {!collapsed ? <span>Réduire le menu</span> : null}
        </button>
      </div>
    </aside>
  );
}
