import { WorkspaceAccess } from "../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { FilesPage } from "../../src/components/files-page";
export default function DownloadsRoute() { return <WorkspaceAccess page="downloads"><FilesPage kind="downloads" /></WorkspaceAccess>; }
