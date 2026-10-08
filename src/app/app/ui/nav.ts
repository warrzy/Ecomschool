export type NavItem = {
  label: string;
  href: string;
};

export const appNav: NavItem[] = [
  { label: "Tableau de bord", href: "/app" },
  { label: "Élèves", href: "/app/students" },
  { label: "Parents", href: "/app/guardians" },
  { label: "Enseignants", href: "/app/teachers" },
  { label: "Classes", href: "/app/classrooms" },
  { label: "Matières", href: "/app/subjects" },
  { label: "Évaluations", href: "/app/assessments" },
  { label: "Notes", href: "/app/grades" },
  { label: "Bulletins", href: "/app/report-cards" },
  { label: "Absences & retards", href: "/app/attendance" },
  { label: "Emploi du temps", href: "/app/timetable" },
  { label: "Scolarité", href: "/app/fees" },
  { label: "Paiements", href: "/app/payments" },
  { label: "Rapports", href: "/app/reports" },
  { label: "Notifications", href: "/app/notifications" },
  { label: "Utilisateurs", href: "/app/users" },
  { label: "Paramètres", href: "/app/settings" },
];
