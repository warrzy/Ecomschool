"use server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { createAsset, runDepreciation, disposeAsset } from "@/lib/services/accounting/assets";
import { redirect } from "next/navigation";

const back = (p: string) => redirect(`/app/comptabilite/immobilisations${p}`);

export async function createAssetAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  const r = await createAsset({ userId: t.userId, schoolId: t.schoolId }, {
    label: String(fd.get("label") ?? ""),
    acquisitionDate: new Date(String(fd.get("acquisitionDate"))),
    acquisitionCost: Number(fd.get("acquisitionCost")),
    durationMonths: Number(fd.get("durationMonths")),
    accountAssetId: String(fd.get("accountAssetId")),
    accountDepreciationId: String(fd.get("accountDepreciationId")),
    accountChargeId: String(fd.get("accountChargeId")),
  });
  back(r.ok ? "?ok=Immobilisation+créée" : `?err=${r.error}`);
}

export async function runDepreciationAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  const [y, m] = String(fd.get("month") ?? "").split("-").map(Number);
  const r = await runDepreciation({ userId: t.userId, schoolId: t.schoolId }, y, m);
  back(r.ok ? `?ok=${r.result.posted}+dotation(s)+postée(s),+${r.result.skipped}+ignorée(s)` : `?err=${r.error}`);
}

export async function disposeAssetAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  const r = await disposeAsset({ userId: t.userId, schoolId: t.schoolId },
    String(fd.get("id")), fd.get("status") === "SOLD" ? "SOLD" : "SCRAPPED");
  back(r.ok ? "?ok=Sortie+enregistrée" : `?err=${r.error}`);
}
