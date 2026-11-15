import { headers } from "next/headers";
import { WorkspaceHome } from "./workspace-home";
import { GuestBrowsePage } from "./guest-browse-page";
import { createServerSupabaseClient } from "../lib/supabase/server";
import { isSupabaseConfigured } from "../lib/supabase/config";

export async function WorkspaceAccess({ page, children }) {
  const headerList = headers();
  const verifiedUserId = headerList.get("x-reupai-user-id");
  const isMiddlewareGuest = headerList.get("x-reupai-guest") === "1";

  let guest = true;
  if (verifiedUserId) {
    guest = false;
  } else if (!isMiddlewareGuest && isSupabaseConfigured()) {
    try {
      const result = await createServerSupabaseClient().auth.getUser();
      guest = !result.data?.user;
    } catch {
      /* Browsing stays available while account services are unavailable. */
    }
  }
  return <WorkspaceHome guest={guest}>{guest && !["home", "help"].includes(page) ? <GuestBrowsePage page={page} /> : children}</WorkspaceHome>;
}
