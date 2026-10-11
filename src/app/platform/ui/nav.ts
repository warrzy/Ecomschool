export type NavItem = {
  label: string;
  href: string;
};

export const platformNav: NavItem[] = [
  { label: "Vue générale", href: "/platform" },
  { label: "Établissements", href: "/platform/schools" },
  { label: "Création établissement", href: "/platform/onboarding" },
  { label: "Administrateurs", href: "/platform/administrators" },
  { label: "Modules", href: "/platform/modules" },
  { label: "Offres", href: "/platform/plans" },
  { label: "Abonnements", href: "/platform/subscriptions" },
  { label: "Factures", href: "/platform/invoices" },
  { label: "Supervision", href: "/platform/monitoring" },
  { label: "Audit", href: "/platform/audit" },
  { label: "Assistance", href: "/platform/support" },
];
