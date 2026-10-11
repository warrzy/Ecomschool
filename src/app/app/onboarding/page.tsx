import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/tenant/context";

export const instant = false;

export default async function OnboardingPage() {
  const user = await requireSessionUser();

  if (user.schoolId) {
    // `user.schoolId` est déjà dérivé de la membership ACTIVE.
    redirect("/app" as never);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold tracking-wide text-zinc-500">
          ECOM-TOUCH
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Compte en attente
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Votre compte n&apos;est rattaché à aucun établissement actif.
          Contactez l&apos;administrateur de votre établissement ou le support
          ECOM-TOUCH pour obtenir un accès.
        </p>
        <form action="/api/auth/signout" method="post" className="mt-6">
          <input type="hidden" name="callbackUrl" value="/login" />
          <button className="h-11 w-full rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800">
            Déconnexion
          </button>
        </form>
      </div>
    </div>
  );
}
