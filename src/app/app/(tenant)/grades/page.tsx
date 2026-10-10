import { requireSchoolContext } from "@/lib/tenant/context";
import ModulePlaceholder from "@/components/module-placeholder";

export const instant = false;

export default async function Page() {
  await requireSchoolContext();
  return <ModulePlaceholder title="Notes" section="Établissement" />;
}
