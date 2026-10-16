import { prisma } from "@/lib/db/prisma";
import { acceptInviteAction } from "@/app/invite/actions";

export const instant = false;

export default async function InvitePage(props: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const invite = await prisma.accountInvite.findFirst({
    where: { token, usedAt: null, expiresAt: { gt: new Date() } },
    select: { email: true, school: { select: { name: true } } },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold tracking-wide text-zinc-500">ECOM-SCHOOL</div>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900">Activation de votre compte</h1>
        {invite ? (
          <>
            <p className="mt-2 text-sm text-zinc-600">
              {invite.school?.name ?? "ECOM-TOUCH"} — {invite.email}
            </p>
            <form action={acceptInviteAction} className="mt-4 space-y-3">
              <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
              <input type="hidden" name="token" value={token} />
              <label className="block space-y-1 text-sm text-zinc-700">
                Nouveau mot de passe (10 caractères min., lettres et chiffres)
                <input
                  type="password"
                  autoComplete="new-password" name="password"
                  required
                  minLength={10}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1 text-sm text-zinc-700">
                Confirmation
                <input
                  type="password"
                  name="confirm"
                  required
                  minLength={10}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>
              {error ? (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {error === "mismatch"
                    ? "Les mots de passe ne correspondent pas."
                    : error === "INVALID_INPUT"
                      ? "Mot de passe trop faible (10 caractères min., lettres et chiffres)."
                      : "Lien invalide ou expiré."}
                </div>
              ) : null}
              <button
                type="submit"
                className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Activer mon compte
              </button>
            </form>
          </>
        ) : (
          <p className="mt-4 text-sm text-red-700">
            Ce lien d&apos;invitation est invalide ou expiré. Contactez votre établissement.
          </p>
        )}
      </div>
    </div>
  );
}
