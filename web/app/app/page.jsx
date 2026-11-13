import { Dashboard } from "../../src/components/dashboard";
import { WorkspaceAccess } from "../../src/components/workspace-access";

export const dynamic = "force-dynamic";

export default function DashboardRoute() {
  return <WorkspaceAccess page="home"><Dashboard /></WorkspaceAccess>;
}
