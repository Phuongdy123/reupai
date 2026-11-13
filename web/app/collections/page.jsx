import { WorkspaceAccess } from "../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { LibraryPage } from "../../src/components/library-page";
export default function CollectionsRoute() { return <WorkspaceAccess page="collections"><LibraryPage kind="collections" /></WorkspaceAccess>; }
