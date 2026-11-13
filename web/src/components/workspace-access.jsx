import { WorkspaceHome } from "./workspace-home";
import { GuestBrowsePage } from "./guest-browse-page";
import { createServerSupabaseClient } from "../lib/supabase/server";
import { isSupabaseConfigured } from "../lib/supabase/config";

export async function WorkspaceAccess({ page, children }) {
  let user = null;
  if (isSupabaseConfigured()) {
    try { const result = await createServerSupabaseClient().auth.getUser(); user = result.data?.user || null; }
    catch { /* Browsing stays available while account services are unavailable. */ }
  }
  const guest = !user;
  return <WorkspaceHome guest={guest}>{guest && !["home", "help"].includes(page) ? <GuestBrowsePage page={page} /> : children}</WorkspaceHome>;
}
