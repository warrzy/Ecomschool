export type NavItem = {
  label: string;
  href: string;
};

export const platformNav: NavItem[] = [
  { label: "Dashboard plateforme", href: "/platform" },
  { label: "Établissements", href: "/platform/schools" },
  { label: "Onboarding établissement", href: "/platform/onboarding" },
];
