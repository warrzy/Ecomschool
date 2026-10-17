import { requirePlatformContext } from "@/lib/tenant/context";
import {
  getPlatformProfile,
  userIsPlatformSales,
} from "@/lib/services/platform/profile";
import { updateWhatsappAction } from "./actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

export default async function PlatformProfilePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePlatformContext();
  const sp = (await props.searchParams) ?? {};
  const [profile, isSales] = await Promise.all([
    getPlatformProfile(ctx.userId),
    userIsPlatformSales(ctx.userId),
  ]);
  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Profil</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          {profile.firstName} {profile.lastName}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">{profile.email}</p>
        {sp.error ? (
          <p className="mt-2 text-sm text-red-600">
            {typeof sp.error === "string" ? errorMessage(sp.error) : null}
          </p>
        ) : null}
        {sp.ok ? (
          <p className="mt-2 text-sm text-emerald-600">Enregistré.</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-zinc-900">
          Alertes WhatsApp commerciales
        </h2>
        {isSales ? (
          <>
            <p className="mt-2 text-sm text-zinc-600">
              Recevez une alerte WhatsApp lorsqu&apos;un établissement soumet une
              demande d&apos;inscription. Format international attendu (ex.
              +226XXXXXXXX).
            </p>
            <form action={updateWhatsappAction} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="whatsappNumber"
                  className="block text-sm font-medium text-zinc-700"
                >
                  Numéro WhatsApp
                </label>
                <input
                  id="whatsappNumber"
                  name="whatsappNumber"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+226XXXXXXXX"
                  defaultValue={profile.whatsappNumber ?? ""}
                  className="mt-1 w-full max-w-xs rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="whatsappOptIn"
                  name="whatsappOptIn"
                  type="checkbox"
                  defaultChecked={profile.whatsappOptIn}
                  className="mt-1"
                />
                <label htmlFor="whatsappOptIn" className="text-sm text-zinc-700">
                  J&apos;accepte de recevoir des notifications WhatsApp
                  professionnelles (nouvelles demandes d&apos;inscription).
                  Désactivable à tout moment.
                </label>
              </div>
              <SubmitButton pendingLabel="Enregistrement…">
                Enregistrer
              </SubmitButton>
            </form>
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            Réservé aux commerciaux de la plateforme.
          </p>
        )}
      </div>
    </div>
  );
}
