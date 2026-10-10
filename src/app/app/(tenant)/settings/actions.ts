"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { updateMySchool } from "@/lib/services/schools";
import { schoolUpdateSchema } from "@/lib/validations/schools";

export async function updateSchoolSettingsAction(formData: FormData) {
  const tenant = await requireSchoolPermission("school.manage");

  const rawSettings = String(formData.get("settings") ?? "").trim();
  let settings: unknown;
  if (rawSettings) {
    try {
      settings = JSON.parse(rawSettings) as unknown;
      if (typeof settings !== "object" || settings === null) {
        redirect("/app/settings?error=SETTINGS_NOT_OBJECT" as never);
      }
    } catch {
      redirect("/app/settings?error=INVALID_JSON" as never);
    }
  }

  const parsed = schoolUpdateSchema.safeParse({
    name: String(formData.get("name") ?? "") || undefined,
    address: formData.get("address"),
    city: formData.get("city"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    website: formData.get("website"),
    logoUrl: formData.get("logoUrl"),
    type: String(formData.get("type") ?? "") || null,
    schoolSystem: String(formData.get("schoolSystem") ?? "") || null,
    ...(settings !== undefined ? { settings } : {}),
  });

  if (!parsed.success) {
    redirect("/app/settings?error=INVALID_INPUT" as never);
  }

  const res = await updateMySchool(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data,
  );

  redirect(
    res.ok ? "/app/settings?ok=updated" : `/app/settings?error=${res.error}`,
  );
}
