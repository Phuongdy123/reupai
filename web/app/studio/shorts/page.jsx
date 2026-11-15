import { WorkspaceAccess } from "../../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { StudioPage } from "../../../src/components/studio-page";
export default function ShortsStudioRoute() {
  return <WorkspaceAccess page="studio_shorts"><StudioPage mode="shorts" /></WorkspaceAccess>;
}
