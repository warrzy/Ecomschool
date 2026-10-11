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
  { label: "Absences & retards", href: "/app/attendance" },
  { label: "Finances", href: "/app/fees" },
  { label: "Utilisateurs", href: "/app/users" },
  { label: "Paramètres", href: "/app/settings" },
];
