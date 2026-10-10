import { requirePlatformContext } from "@/lib/tenant/context";
import ModulePlaceholder from "@/components/module-placeholder";

export const instant = false;

export default async function Page() {
  await requirePlatformContext();
  return <ModulePlaceholder title="Assistance" section="Plateforme" />;
}
