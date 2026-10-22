import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { getPrivacyText } from "@/lib/services/admissions";

export const instant = false;

export default async function ConfidentialitePage(props: {
  params: Promise<{ schoolSlug: string }>;
}) {
  const { schoolSlug } = await props.params;
  const school = await prisma.school.findFirst({
    where: { slug: schoolSlug, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!school) notFound();
  const text = await getPrivacyText(school.id);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {school.name}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-zinc-900">
        Politique de confidentialité — admissions
      </h1>
      <div className="mt-6 whitespace-pre-line rounded-2xl border border-zinc-200 bg-white p-6 text-sm leading-relaxed text-zinc-700 shadow-soft">
        {text}
      </div>
      <p className="mt-6">
        <Link
          href={`/candidature/${schoolSlug}`}
          className="text-sm font-medium text-brand-700 underline"
        >
          ← Retour au portail de candidature
        </Link>
      </p>
    </main>
  );
}
