export type NavItem = {
  label: string;
  href: string;
  /** Permission exigée par la page cible — l'entrée est masquée sans elle. */
  permission?: string;
  /** Regroupement du menu — sections affichées dans cet ordre. */
  section: NavSection;
  /** Tracé SVG (viewBox 24) affiché dans la sidebar. */
  icon?: string;
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

const I = {
  dashboard: "M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z",
  megaphone: "M3 11l18-7-2 16-6-3-4 1v-4l-6-3Z M9 18v3",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0",
  calendar: "M8 2v4 M16 2v4 M3 8h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  layers: "M12 2 2 7l10 5 10-5-10-5Z M2 17l10 5 10-5 M2 12l10 5 10-5",
  grid: "M3 3h8v8H3z M13 3h8v8h-8z M3 13h8v8H3z M13 13h8v8h-8z",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z",
  door: "M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14 M3 20h18 M15 12h.01",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2",
  user: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  gradcap: "M22 10 12 5 2 10l10 5 10-5Z M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5",
  clipboard: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z",
  pen: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z",
  chart: "M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M16 13H8 M16 17H8",
  sliders: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  alertClock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 8v4 M12 16h.01",
  wallet: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4Z",
  card: "M2 7h20v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Z M2 7V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2 M2 10h20",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
};

// Les clés reprennent exactement celles des gardes `requireSchoolPermission`
// des pages cibles : le menu reflète ce qui est réellement accessible.
export const appNav: NavItem[] = [
  { label: "Tableau de bord", href: "/app", section: "Pilotage", icon: I.dashboard },
  { label: "Annonces", href: "/app/announcements", permission: "announcements.read", section: "Pilotage", icon: I.megaphone },
  { label: "Messagerie", href: "/app/messages", permission: "messages.manage", section: "Pilotage", icon: I.chat },
  // Centre personnel : chaque utilisateur ne voit que ses propres notifications.
  { label: "Notifications", href: "/app/notifications", section: "Pilotage", icon: I.bell },

  { label: "Années scolaires", href: "/app/academic-years", permission: "academic.read", section: "Établissement", icon: I.calendar },
  { label: "Niveaux", href: "/app/levels", permission: "classroom.read", section: "Établissement", icon: I.layers },
  { label: "Classes", href: "/app/classrooms", permission: "classroom.read", section: "Établissement", icon: I.grid },
  { label: "Matières", href: "/app/subjects", permission: "subject.read", section: "Établissement", icon: I.book },
  { label: "Salles", href: "/app/rooms", permission: "rooms.read", section: "Établissement", icon: I.door },
  { label: "Emplois du temps", href: "/app/schedules", permission: "schedules.read", section: "Établissement", icon: I.clock },
  { label: "Enseignants", href: "/app/teachers", permission: "teacher.read", section: "Établissement", icon: I.users },

  { label: "Élèves", href: "/app/students", permission: "student.read", section: "Pédagogie", icon: I.gradcap },
  { label: "Parents", href: "/app/guardians", permission: "guardian.read", section: "Pédagogie", icon: I.users },
  { label: "Inscriptions scolaires", href: "/app/enrollments", permission: "enrollment.read", section: "Pédagogie", icon: I.clipboard },
  { label: "Admissions", href: "/app/admissions", permission: "admissions.read", section: "Pédagogie", icon: I.door },
  { label: "Réinscriptions", href: "/app/reinscriptions", permission: "reenrollments.read", section: "Pédagogie", icon: I.clipboard },
  { label: "Notes", href: "/app/grades", permission: "assessments.read", section: "Pédagogie", icon: I.pen },
  { label: "Moyennes", href: "/app/averages", permission: "results.read", section: "Pédagogie", icon: I.chart },
  { label: "Bulletins", href: "/app/report-cards", permission: "reportcards.read", section: "Pédagogie", icon: I.file },
  { label: "Règles de notation", href: "/app/grading-policy", permission: "gradingpolicy.manage", section: "Pédagogie", icon: I.sliders },
  { label: "Absences & retards", href: "/app/attendance", permission: "attendance.read", section: "Pédagogie", icon: I.alertClock },

  { label: "Finances", href: "/app/fees", permission: "finance.read", section: "Finances", icon: I.wallet },
  { label: "Dépenses", href: "/app/expenses", permission: "expenses.read", section: "Finances", icon: I.card },
  { label: "Trésorerie", href: "/app/treasury", permission: "treasury.read", section: "Finances", icon: I.wallet },
  { label: "Rapports", href: "/app/fees/reports", permission: "finance.reports.read", section: "Finances", icon: I.file },
  // Guichet d'inscription : permissions fines créées en F2-D2.
  { label: "Guichet d'inscription", href: "/app/fees/registration", permission: "enrollment.create", section: "Finances", icon: I.clipboard },
  // Journal personnel : filtrage strict sur receivedById côté serveur.
  { label: "Mes encaissements", href: "/app/fees/my-payments", permission: "finance.receipts.read", section: "Finances", icon: I.file },
  // Brique documentaire transversale (G2-A).
  { label: "Documents", href: "/app/documents", permission: "documents.read", section: "Administration", icon: I.file },

  { label: "Utilisateurs", href: "/app/users", permission: "user.read", section: "Administration", icon: I.users },
  { label: "Mon abonnement", href: "/app/subscription", permission: "school.read", section: "Administration", icon: I.card },
  { label: "Paramètres", href: "/app/settings", permission: "school.read", section: "Administration", icon: I.gear },
];

/** Regroupe les entrées filtrées par permission dans l'ordre des sections. */
export function groupNav(items: NavItem[]) {
  return NAV_SECTIONS.map((title) => ({
    title,
    items: items.filter((i) => i.section === title),
  })).filter((s) => s.items.length > 0);
}
