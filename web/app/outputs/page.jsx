import { WorkspaceAccess } from "../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { FilesPage } from "../../src/components/files-page";
export default function OutputsRoute() { return <WorkspaceAccess page="outputs"><FilesPage kind="outputs" /></WorkspaceAccess>; }
