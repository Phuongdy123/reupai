import { WorkspaceAccess } from "../../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { StudioPage } from "../../../src/components/studio-page";
export default function YoutubeStudioRoute() {
  return <WorkspaceAccess page="studio_youtube"><StudioPage mode="youtube" /></WorkspaceAccess>;
}
