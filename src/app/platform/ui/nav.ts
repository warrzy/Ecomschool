export type NavItem = {
  label: string;
  href: string;
  /** Permission exigée par la page cible — l'entrée est masquée sans elle. */
  permission?: string;
  /** Tracé SVG (viewBox 24) affiché dans la sidebar. */
  icon?: string;
};

const I = {
  dashboard: "M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z",
  building: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18 M2 22h20 M6 12h4v4H6z M14 6h4v4h-4z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z",
  plus: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 8v8 M8 12h8",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  layers: "M12 2 2 7l10 5 10-5-10-5Z M2 17l10 5 10-5 M2 12l10 5 10-5",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z M7 7h.01",
  refresh: "M23 4v6h-6 M1 20v-6h6 M3.5 9a9 9 0 0 1 14.9-3.4L23 10 M1 14l4.6 4.4A9 9 0 0 0 20.5 15",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M16 13H8 M16 17H8",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8Z",
  search: "M21 21l-4.4-4.4 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M11 8v4 M11 14h.01",
  buoy: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z M4.9 4.9l4.3 4.3 M14.8 14.8l4.3 4.3 M19.1 4.9l-4.3 4.3 M9.2 14.8l-4.3 4.3",
  user: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
};

// Les clés reprennent exactement celles des gardes `requirePlatformPermission`
// des pages cibles : le menu reflète ce qui est réellement accessible.
export const platformNav: NavItem[] = [
  { label: "Vue générale", href: "/platform", icon: I.dashboard },
  { label: "Établissements", href: "/platform/schools", permission: "platform.schools.read", icon: I.building },
  { label: "Demandes", href: "/platform/signup-requests", permission: "platform.schools.manage", icon: I.inbox },
  { label: "Création établissement", href: "/platform/onboarding", permission: "platform.schools.manage", icon: I.plus },
  { label: "Administrateurs", href: "/platform/administrators", permission: "platform.users.manage", icon: I.shield },
  { label: "Modules", href: "/platform/modules", permission: "platform.plans.read", icon: I.layers },
  { label: "Offres", href: "/platform/plans", permission: "platform.plans.read", icon: I.tag },
  { label: "Abonnements", href: "/platform/subscriptions", permission: "platform.subscriptions.read", icon: I.refresh },
  { label: "Factures", href: "/platform/invoices", permission: "platform.invoices.read", icon: I.file },
  { label: "Supervision", href: "/platform/monitoring", permission: "platform.monitoring.read", icon: I.activity },
  { label: "Automatisations", href: "/platform/automations", permission: "platform.monitoring.read", icon: I.zap },
  { label: "Audit", href: "/platform/audit", permission: "platform.audit.read", icon: I.search },
  { label: "Assistance", href: "/platform/support", permission: "platform.support.access", icon: I.buoy },
  { label: "Profil", href: "/platform/profile", icon: I.user },
];
