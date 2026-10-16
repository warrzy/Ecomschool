export type NavItem = {
  label: string;
  href: string;
  /** Permission exigée par la page cible — l'entrée est masquée sans elle. */
  permission?: string;
  /** Regroupement du menu — sections affichées dans cet ordre. */
  section: NavSection;
};

export type NavSection =
  | "Pilotage"
  | "Établissement"
  | "Pédagogie"
  | "Finances"
  | "Administration";

export const NAV_SECTIONS: NavSection[] = [
  "Pilotage",
  "Établissement",
  "Pédagogie",
  "Finances",
  "Administration",
];

// Les clés reprennent exactement celles des gardes `requireSchoolPermission`
// des pages cibles : le menu reflète ce qui est réellement accessible.
export const appNav: NavItem[] = [
  { label: "Tableau de bord", href: "/app", section: "Pilotage" },
  { label: "Annonces", href: "/app/announcements", permission: "announcements.read", section: "Pilotage" },
  { label: "Messagerie", href: "/app/messages", permission: "messages.manage", section: "Pilotage" },
  // Centre personnel : chaque utilisateur ne voit que ses propres notifications.
  { label: "Notifications", href: "/app/notifications", section: "Pilotage" },

  { label: "Années scolaires", href: "/app/academic-years", permission: "academic.read", section: "Établissement" },
  { label: "Niveaux", href: "/app/levels", permission: "classroom.read", section: "Établissement" },
  { label: "Classes", href: "/app/classrooms", permission: "classroom.read", section: "Établissement" },
  { label: "Matières", href: "/app/subjects", permission: "subject.read", section: "Établissement" },
  { label: "Salles", href: "/app/rooms", permission: "rooms.read", section: "Établissement" },
  { label: "Emplois du temps", href: "/app/schedules", permission: "schedules.read", section: "Établissement" },
  { label: "Enseignants", href: "/app/teachers", permission: "teacher.read", section: "Établissement" },

  { label: "Élèves", href: "/app/students", permission: "student.read", section: "Pédagogie" },
  { label: "Parents", href: "/app/guardians", permission: "guardian.read", section: "Pédagogie" },
  { label: "Inscriptions", href: "/app/enrollments", permission: "enrollment.read", section: "Pédagogie" },
  { label: "Notes", href: "/app/grades", permission: "assessments.read", section: "Pédagogie" },
  { label: "Moyennes", href: "/app/averages", permission: "results.read", section: "Pédagogie" },
  { label: "Bulletins", href: "/app/report-cards", permission: "reportcards.read", section: "Pédagogie" },
  { label: "Règles de notation", href: "/app/grading-policy", permission: "gradingpolicy.manage", section: "Pédagogie" },
  { label: "Absences & retards", href: "/app/attendance", permission: "attendance.read", section: "Pédagogie" },

  { label: "Finances", href: "/app/fees", permission: "finance.read", section: "Finances" },

  { label: "Utilisateurs", href: "/app/users", permission: "user.read", section: "Administration" },
  { label: "Mon abonnement", href: "/app/subscription", permission: "school.read", section: "Administration" },
  { label: "Paramètres", href: "/app/settings", permission: "school.read", section: "Administration" },
];

/** Regroupe les entrées filtrées par permission dans l'ordre des sections. */
export function groupNav(items: NavItem[]) {
  return NAV_SECTIONS.map((title) => ({
    title,
    items: items.filter((i) => i.section === title),
  })).filter((s) => s.items.length > 0);
}
