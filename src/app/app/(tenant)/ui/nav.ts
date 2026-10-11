export type NavItem = {
  label: string;
  href: string;
};

export const appNav: NavItem[] = [
  { label: "Tableau de bord", href: "/app" },
  { label: "Années scolaires", href: "/app/academic-years" },
  { label: "Élèves", href: "/app/students" },
  { label: "Parents", href: "/app/guardians" },
  { label: "Inscriptions", href: "/app/enrollments" },
  { label: "Enseignants", href: "/app/teachers" },
  { label: "Niveaux", href: "/app/levels" },
  { label: "Classes", href: "/app/classrooms" },
  { label: "Matières", href: "/app/subjects" },
  { label: "Salles", href: "/app/rooms" },
  { label: "Emplois du temps", href: "/app/schedules" },
  { label: "Notes", href: "/app/grades" },
  { label: "Moyennes", href: "/app/averages" },
  { label: "Bulletins", href: "/app/report-cards" },
  { label: "Règles de notation", href: "/app/grading-policy" },
  { label: "Absences & retards", href: "/app/attendance" },
  { label: "Annonces", href: "/app/announcements" },
  { label: "Messagerie", href: "/app/messages" },
  { label: "Notifications", href: "/app/notifications" },
  { label: "Finances", href: "/app/fees" },
  { label: "Utilisateurs", href: "/app/users" },
  { label: "Mon abonnement", href: "/app/subscription" },
  { label: "Paramètres", href: "/app/settings" },
];
