import { WorkspaceAccess } from "../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { LibraryPage } from "../../src/components/library-page";
export default function FavoritesRoute() { return <WorkspaceAccess page="favorites"><LibraryPage kind="favorites" /></WorkspaceAccess>; }
