import { requestResetAction } from "./actions";

export const instant = false;

export default async function ResetPasswordPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await props.searchParams) ?? {};

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-soft">
        <div className="text-xs font-semibold tracking-wide text-zinc-500">
          ECOM-TOUCH
        </div>
        <h1 className="mt-2 text-2xl font-display font-bold tracking-tight text-ink">
          Mot de passe oublié
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Saisissez votre email. Si un compte y est rattaché, un lien de
          réinitialisation (valable 24 h) vous sera envoyé.
        </p>
        {sp.ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Si ce compte existe, un lien de réinitialisation vient d&apos;être
            envoyé. Pensez à vérifier vos courriers indésirables.
          </div>
        ) : null}
        <form action={requestResetAction} className="mt-5 space-y-4">
          <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-reset-password-page-tsx-1">Email</label>
            <input id="fld-src-app-reset-password-page-tsx-1"
              type="email"
              autoComplete="email" name="email"
              required
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
              placeholder="vous@ecole.bf"
            />
          </div>
          <button
            type="submit"
            className="h-11 w-full rounded-xl bg-brand-600 text-sm font-medium text-white hover:bg-brand-700"
          >
            Recevoir le lien
          </button>
        </form>
        <div className="mt-4 text-center">
          <a
            href={"/login" as never}
            className="text-xs text-zinc-500 underline hover:text-zinc-700"
          >
            Retour à la connexion
          </a>
        </div>
      </div>
    </div>
  );
}
