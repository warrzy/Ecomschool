export type NavItem = {
  label: string;
  href: string;
  /** Permission exigée par la page cible — l'entrée est masquée sans elle. */
  permission?: string;
};

// Les clés reprennent exactement celles des gardes `requirePlatformPermission`
// des pages cibles : le menu reflète ce qui est réellement accessible.
export const platformNav: NavItem[] = [
  { label: "Vue générale", href: "/platform" },
  { label: "Établissements", href: "/platform/schools", permission: "platform.schools.read" },
  { label: "Demandes", href: "/platform/signup-requests", permission: "platform.schools.manage" },
  { label: "Création établissement", href: "/platform/onboarding", permission: "platform.schools.manage" },
  { label: "Administrateurs", href: "/platform/administrators", permission: "platform.users.manage" },
  { label: "Modules", href: "/platform/modules", permission: "platform.plans.read" },
  { label: "Offres", href: "/platform/plans", permission: "platform.plans.read" },
  { label: "Abonnements", href: "/platform/subscriptions", permission: "platform.subscriptions.read" },
  { label: "Factures", href: "/platform/invoices", permission: "platform.invoices.read" },
  { label: "Supervision", href: "/platform/monitoring", permission: "platform.monitoring.read" },
  { label: "Automatisations", href: "/platform/automations", permission: "platform.monitoring.read" },
  { label: "Audit", href: "/platform/audit", permission: "platform.audit.read" },
  { label: "Assistance", href: "/platform/support", permission: "platform.support.access" },
];
