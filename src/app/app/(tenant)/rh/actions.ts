"use server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { createEmployee, createContract, activateContract, departEmployee, addDocument } from "@/lib/services/hr/employees";
import { redirect } from "next/navigation";

const back = (id: string, p: string) => redirect(`/app/rh?id=${id}${p}`);

export async function createEmployeeAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const r = await createEmployee({ userId: t.userId, schoolId: t.schoolId }, {
    matricule: String(fd.get("matricule") ?? ""),
    firstName: String(fd.get("firstName") ?? ""),
    lastName: String(fd.get("lastName") ?? ""),
    category: fd.get("category") === "TEACHING" ? "TEACHING" : "NON_TEACHING",
    phone: String(fd.get("phone") ?? "") || undefined,
    hireDate: fd.get("hireDate") ? new Date(String(fd.get("hireDate"))) : undefined,
  });
  if (!r.ok) redirect(`/app/rh?err=${r.error}`);
  back(r.result.id, "&ok=Employé+créé");
}

export async function createContractAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const empId = String(fd.get("employeeId"));
  const r = await createContract({ userId: t.userId, schoolId: t.schoolId }, empId, {
    type: (["CDI", "CDD", "VACATION", "INTERN"].includes(String(fd.get("type"))) ? String(fd.get("type")) : "CDI") as never,
    position: String(fd.get("position") ?? ""),
    startDate: new Date(String(fd.get("startDate"))),
    endDate: fd.get("endDate") ? new Date(String(fd.get("endDate"))) : undefined,
    baseSalary: Number(fd.get("baseSalary") ?? 0),
    amendsContractId: String(fd.get("amendsContractId") ?? "") || undefined,
    activate: fd.get("activate") === "1",
  });
  back(empId, r.ok ? "&ok=Contrat+enregistré" : `&err=${r.error}`);
}

export async function activateContractAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  await activateContract({ userId: t.userId, schoolId: t.schoolId }, String(fd.get("id")));
  redirect("/app/rh?ok=Contrat+activé");
}

export async function departEmployeeAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const r = await departEmployee({ userId: t.userId, schoolId: t.schoolId },
    String(fd.get("id")), new Date(String(fd.get("departureDate"))));
  redirect(`/app/rh?${r.ok ? "ok=Sortie+enregistrée" : `err=${r.error}`}`);
}

export async function addDocumentAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const empId = String(fd.get("employeeId"));
  await addDocument({ userId: t.userId, schoolId: t.schoolId }, empId, {
    kind: String(fd.get("kind") ?? ""), label: String(fd.get("label") ?? ""),
    fileUrl: String(fd.get("fileUrl") ?? "") || undefined,
  });
  back(empId, "&ok=Document+ajouté");
}

export async function requestLeaveAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const { requestLeave } = await import("@/lib/services/hr/leaves");
  const r = await requestLeave({ userId: t.userId, schoolId: t.schoolId }, String(fd.get("employeeId")), {
    type: String(fd.get("type")) as never,
    startDate: new Date(String(fd.get("startDate"))),
    endDate: new Date(String(fd.get("endDate"))),
    reason: String(fd.get("reason") ?? "") || undefined,
  });
  back(String(fd.get("employeeId")), r.ok ? "&ok=Demande+enregistrée" : `&err=${r.error}`);
}

export async function decideLeaveAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const { decideLeave } = await import("@/lib/services/hr/leaves");
  const r = await decideLeave({ userId: t.userId, schoolId: t.schoolId }, String(fd.get("id")), fd.get("approve") === "1");
  redirect(`/app/rh?${r.ok ? "ok=Décision+enregistrée" : `err=${r.error}`}`);
}

export async function cancelLeaveAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const { cancelLeave } = await import("@/lib/services/hr/leaves");
  await cancelLeave({ userId: t.userId, schoolId: t.schoolId }, String(fd.get("id")));
  redirect("/app/rh?ok=Congé+annulé");
}

export async function setEntitlementAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const { setEntitlement } = await import("@/lib/services/hr/leaves");
  const empId = String(fd.get("employeeId"));
  await setEntitlement({ userId: t.userId, schoolId: t.schoolId }, empId,
    new Date().getFullYear(), String(fd.get("type")) as never, Number(fd.get("days")));
  back(empId, "&ok=Droit+défini");
}

export async function markAttendanceAction(fd: FormData) {
  const t = await requireSchoolPermission("hr.manage");
  const { markAttendance } = await import("@/lib/services/hr/leaves");
  const empId = String(fd.get("employeeId"));
  await markAttendance({ userId: t.userId, schoolId: t.schoolId }, empId,
    new Date(String(fd.get("date"))), String(fd.get("status")) as never,
    String(fd.get("note") ?? "") || undefined);
  back(empId, "&ok=Présence+pointée");
}
