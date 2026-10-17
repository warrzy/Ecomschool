"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUser, updateUser } from "@/app/app/(tenant)/users/actions";
import { errorMessage } from "@/lib/ui/errorLabels";

type Mode = "create" | "edit";

type RoleOption = {
  id: string;
  name: string;
  description: string | null;
};

export default function UserForm(props: {
  mode: Mode;
  roles: RoleOption[];
  initial?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    status: "ACTIVE" | "DISABLED";
    roleId: string | null;
  };
}) {
  const router = useRouter();
  const [email, setEmail] = useState(props.initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState(props.initial?.firstName ?? "");
  const [lastName, setLastName] = useState(props.initial?.lastName ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "DISABLED">(
    props.initial?.status ?? "ACTIVE",
  );
  const [roleId, setRoleId] = useState(props.initial?.roleId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (props.mode === "create") {
        const res = await createUser({
          email,
          password,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          status,
          roleId,
        });

        if (!res.ok) {
          setError(res.error);
          return;
        }

        router.push("/app/users");
        router.refresh();
        return;
      }

      const res = await updateUser({
        id: props.initial!.id,
        email,
        password: password || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        status,
        roleId: roleId || undefined,
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      router.push("/app/users");
      router.refresh();
    } catch {
      setError("UNKNOWN_ERROR");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="w-full text-xs text-zinc-500">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-users-ui-user-form-ts-1">Email</label>
        <input id="fld-src-app-app-tenant-users-ui-user-form-ts-1"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-users-ui-user-form-ts-2">
          Mot de passe{props.mode === "edit" ? " (optionnel)" : ""}
        </label>
        <input id="fld-src-app-app-tenant-users-ui-user-form-ts-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
          required={props.mode === "create"}
          minLength={8}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-users-ui-user-form-ts-3">Prénom</label>
          <input id="fld-src-app-app-tenant-users-ui-user-form-ts-3"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-users-ui-user-form-ts-4">Nom</label>
          <input id="fld-src-app-app-tenant-users-ui-user-form-ts-4"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-users-ui-user-form-ts-5">Statut</label>
          <select id="fld-src-app-app-tenant-users-ui-user-form-ts-5"
            value={status}
            onChange={(e) => setStatus(e.target.value as "ACTIVE" | "DISABLED")}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
          >
            <option value="ACTIVE">ACTIF</option>
            <option value="DISABLED">DÉSACTIVÉ</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-zinc-800" htmlFor="fld-src-app-app-tenant-users-ui-user-form-ts-6">Rôle</label>
          <select id="fld-src-app-app-tenant-users-ui-user-form-ts-6"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
            required={props.mode === "create"}
          >
            <option value="" disabled>
              Sélectionner un rôle
            </option>
            {props.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMessage(error)}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="h-11 w-full rounded-xl bg-brand-600 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {loading
          ? "Enregistrement..."
          : props.mode === "create"
            ? "Créer"
            : "Mettre à jour"}
      </button>
    </form>
  );
}
