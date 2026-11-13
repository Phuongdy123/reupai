import { WorkspaceAccess } from "../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { SourcesPage } from "../../src/components/sources-page";

export default function SourcesRoute() {
  return <WorkspaceAccess page="sources"><SourcesPage /></WorkspaceAccess>;
}
