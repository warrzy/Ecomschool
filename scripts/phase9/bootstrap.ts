import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

const SCHOOL_KEYS = ["messages.read", "messages.manage", "preferences.read"];

const TEMPLATES: { code: string; name: string; subject: string; body: string }[] = [
  {
    code: "ACCOUNT_INVITE",
    name: "Invitation à créer un compte",
    subject: "Invitation — {{schoolName}}",
    body: "Bonjour {{firstName}},\n\nUn compte vous a été créé pour {{schoolName}}. Cliquez sur ce lien pour activer votre accès : {{inviteLink}}\n\nCe lien expire dans 7 jours.",
  },
  {
    code: "REPORT_CARD_PUBLISHED",
    name: "Publication des bulletins",
    subject: "Résultats disponibles — {{schoolName}}",
    body: "Bonjour {{firstName}},\n\nLes résultats de la période « {{periodName}} » sont publiés. Connectez-vous à votre espace pour consulter les bulletins.",
  },
  {
    code: "ANNOUNCEMENT",
    name: "Nouvelle annonce",
    subject: "Annonce — {{schoolName}}",
    body: "Bonjour {{firstName}},\n\n{{title}}\n\nConnectez-vous pour lire l'annonce complète.",
  },
  {
    code: "ABSENCE_UNJUSTIFIED",
    name: "Absence non justifiée",
    subject: "Absence signalée — {{schoolName}}",
    body: "Bonjour {{firstName}},\n\nUne absence non justifiée a été enregistrée le {{date}} pour {{studentName}}. Merci de contacter l'établissement.",
  },
  {
    code: "INSTALLMENT_DUE",
    name: "Échéance scolaire",
    subject: "Rappel d'échéance — {{schoolName}}",
    body: "Bonjour {{firstName}},\n\nUne échéance de {{amount}} FCFA arrive à échéance le {{dueDate}} pour {{studentName}}. Merci de régulariser.",
  },
  {
    code: "SAAS_INVOICE",
    name: "Facture SaaS",
    subject: "Facture {{invoiceNumber}} — ECOM-TOUCH",
    body: "Bonjour,\n\nLa facture {{invoiceNumber}} d'un montant de {{total}} FCFA a été émise, échéance le {{dueDate}}.",
  },
  {
    code: "SUBSCRIPTION_RENEWAL",
    name: "Renouvellement d'abonnement",
    subject: "Renouvellement de votre abonnement — ECOM-SCHOOL",
    body: "Bonjour,\n\nVotre abonnement {{planName}} arrive à échéance le {{date}}. Contactez ECOM-TOUCH pour le renouvellement.",
  },
  {
    code: "SUBSCRIPTION_SUSPENSION_SOON",
    name: "Suspension prochaine",
    subject: "Suspension prochaine — ECOM-SCHOOL",
    body: "Bonjour,\n\nVotre abonnement est en période de grâce jusqu'au {{date}}. Passé ce délai, votre accès sera suspendu (données conservées).",
  },
];

async function main() {
  await prisma.permission.createMany({
    data: SCHOOL_KEYS.map((key) => ({ key })),
    skipDuplicates: true,
  });
  const permissions = await prisma.permission.findMany({
    where: { key: { in: SCHOOL_KEYS } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const adminRoles = await prisma.role.findMany({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL" },
    select: { id: true },
  });
  for (const r of adminRoles) {
    await prisma.rolePermission.createMany({
      data: SCHOOL_KEYS.map((k) => ({ roleId: r.id, permissionId: idByKey.get(k)! })),
      skipDuplicates: true,
    });
  }

  for (const t of TEMPLATES) {
    await prisma.messageTemplate.upsert({
      where: { code: t.code },
      update: { name: t.name, subject: t.subject, body: t.body, channel: "EMAIL" },
      create: {
        code: t.code,
        name: t.name,
        channel: "EMAIL",
        subject: t.subject,
        body: t.body,
      },
    });
  }

  console.log(JSON.stringify({ permissions: SCHOOL_KEYS.length, templates: TEMPLATES.length }));
}

main()
  .catch((e) => {
    console.error("PHASE9_BOOTSTRAP_FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
