"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { createRoom, updateRoom } from "@/lib/services/rooms";
import { roomCreateSchema, roomUpdateSchema } from "@/lib/validations/rooms";

function back(params: string): never {
  redirect(`/app/rooms${params}` as never);
}

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const pick = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === null ? undefined : String(v) || undefined;
};

export async function createRoomAction(formData: FormData) {
  const tenant = await requireSchoolPermission("rooms.manage");

  const parsed = roomCreateSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    capacity: pick(formData, "capacity"),
    building: pick(formData, "building"),
    floor: pick(formData, "floor"),
    type: pick(formData, "type"),
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await createRoom(ctx(tenant), parsed.data);
  back(res.ok ? "?ok=created" : `?error=${res.error}`);
}

export async function updateRoomAction(formData: FormData) {
  const tenant = await requireSchoolPermission("rooms.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) back("?error=INVALID_INPUT");

  const parsed = roomUpdateSchema.safeParse({
    code: pick(formData, "code"),
    name: pick(formData, "name"),
    capacity:
      formData.get("capacity") === null
        ? undefined
        : String(formData.get("capacity") ?? "") === ""
          ? null
          : formData.get("capacity"),
    building: pick(formData, "building"),
    floor: pick(formData, "floor"),
    type: pick(formData, "type"),
    status: pick(formData, "status"),
  });
  if (!parsed.success) back(`/${id}?error=INVALID_INPUT`);

  const res = await updateRoom(ctx(tenant), id, parsed.data);
  back(res.ok ? `/${id}?ok=updated` : `/${id}?error=${res.error}`);
}
