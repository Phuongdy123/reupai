import { WorkspaceAccess } from "../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { LibraryPage } from "../../src/components/library-page";
export default function HistoryRoute() { return <WorkspaceAccess page="history"><LibraryPage kind="history" /></WorkspaceAccess>; }
