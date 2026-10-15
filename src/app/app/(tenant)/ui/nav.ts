export type NavItem = {
  label: string;
  href: string;
  /** Permission exigée par la page cible — l'entrée est masquée sans elle. */
  permission?: string;
};

// Les clés reprennent exactement celles des gardes `requireSchoolPermission`
// des pages cibles : le menu reflète ce qui est réellement accessible.
export const appNav: NavItem[] = [
  { label: "Tableau de bord", href: "/app" },
  { label: "Années scolaires", href: "/app/academic-years", permission: "academic.read" },
  { label: "Élèves", href: "/app/students", permission: "student.read" },
  { label: "Parents", href: "/app/guardians", permission: "guardian.read" },
  { label: "Inscriptions", href: "/app/enrollments", permission: "enrollment.read" },
  { label: "Enseignants", href: "/app/teachers", permission: "teacher.read" },
  { label: "Niveaux", href: "/app/levels", permission: "classroom.read" },
  { label: "Classes", href: "/app/classrooms", permission: "classroom.read" },
  { label: "Matières", href: "/app/subjects", permission: "subject.read" },
  { label: "Salles", href: "/app/rooms", permission: "rooms.read" },
  { label: "Emplois du temps", href: "/app/schedules", permission: "schedules.read" },
  { label: "Notes", href: "/app/grades", permission: "assessments.read" },
  { label: "Moyennes", href: "/app/averages", permission: "results.read" },
  { label: "Bulletins", href: "/app/report-cards", permission: "reportcards.read" },
  { label: "Règles de notation", href: "/app/grading-policy", permission: "gradingpolicy.manage" },
  { label: "Absences & retards", href: "/app/attendance", permission: "attendance.read" },
  { label: "Annonces", href: "/app/announcements", permission: "announcements.read" },
  { label: "Messagerie", href: "/app/messages", permission: "messages.manage" },
  // Centre personnel : chaque utilisateur ne voit que ses propres notifications.
  { label: "Notifications", href: "/app/notifications" },
  { label: "Finances", href: "/app/fees", permission: "finance.read" },
  { label: "Utilisateurs", href: "/app/users", permission: "user.read" },
  { label: "Mon abonnement", href: "/app/subscription", permission: "school.read" },
  { label: "Paramètres", href: "/app/settings", permission: "school.read" },
];
