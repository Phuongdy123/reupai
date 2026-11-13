import { WorkspaceAccess } from "../../src/components/workspace-access";
export const dynamic = "force-dynamic";
import { SeriesPage } from "../../src/components/series-page";
export default function SeriesRoute() { return <WorkspaceAccess page="series"><SeriesPage /></WorkspaceAccess>; }
