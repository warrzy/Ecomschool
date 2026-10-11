"use server";

import { redirect } from "next/navigation";
import { acceptInvite } from "@/lib/services/portal/accounts";

export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) redirect("/login?error=invite" as never);
  if (password !== confirm) redirect(`/invite/${token}?error=mismatch` as never);

  const res = await acceptInvite(token, password);
  redirect(
    (res.ok
      ? "/login?ok=invite"
      : `/invite/${token}?error=${res.error}`) as never,
  );
}
