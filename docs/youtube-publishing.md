# YouTube publishing — local review

The YouTube integration is separate from the Google/Gemini connection. A customer
must sign in to ReupAI and explicitly connect their own YouTube channel. No video
is posted by connecting a channel or by completing a render.

## Implemented flow

- Profile → Connected channels → Connect YouTube opens Google consent with PKCE
  and the `youtube.upload` and `youtube.readonly` scopes.
- The Engine verifies the ReupAI session through `/api/social/session` before
  reading/writing a channel connection. Credentials are stored under the verified
  ReupAI user ID and encrypted with Windows DPAPI, separately from Gemini.
- Completed videos show **Đăng nhanh** after a channel has been connected.
- The publishing dialog supports manual title, description, tags, audience,
  thumbnail and an optional publication schedule. Private is the default.
- Gemini can draft title/description/tags and suggest one of the actual video
  frames the user has loaded. Its suggestions never change audience or privacy.
- The user must confirm before upload. Video bytes stream from Local Engine
  directly to YouTube with a resumable upload. The website does not relay media
  or store YouTube credentials.
- Requests have a stable upload ID to prevent double posting. A lost response
  checks that same ID; it never automatically creates another video. Thumbnail
  failures do not cause the video itself to be uploaded again.
- Refresh tokens renew access. Revoked consent prompts reconnection. Network
  failures do not delete the user's stored connection.

## Local test prerequisites

1. Use a local web build and the new source Engine. The already packaged Store
   0.2.46 artifact does not contain these endpoints or standalone SRT export.
2. Enable **YouTube Data API v3** in the Google project associated with the bundled
   desktop OAuth client. This project owns the YouTube API quota; it is distinct
   from the customer's Gemini quota project.
3. The account owner completes Google consent. Testing-mode consent may require
   adding the account as a test user in Google Auth Platform.
4. The Engine verifies the cloud account through `REUP_SOCIAL_SITE_URL`; point
   this environment variable at the local web server when testing routes that
   have not been deployed. Keep the production default for released builds.
5. Select a video the owner chooses to test. Leave visibility private, review the
   generated/manual metadata and confirm the actual upload in the UI.

Local unit tests use fake HTTP responses and never publish a real video. Passing
them is not evidence of an end-to-end upload to a real channel. That test still
needs the owner's consent and an enabled YouTube API project.

## Remaining delivery work

- Live channel connection/private upload test with the owner.
- Build a new Engine release after the live test; do not relabel the Store
  0.2.46 package as containing new source features.
- YouTube OAuth verification and API compliance review before assuming public
  uploads work for all customers. Unreviewed projects may be restricted to
  private uploads.
- Saved series and ordered batch rendering remain a separate requested feature.
  Optional per-batch auto-posting requires its own explicit opt-in; it is not
  enabled in this first YouTube test flow.
- Facebook and TikTok are deferred at the owner's request until their developer
  applications are created. Do not show them as connected or working providers.

Official references:

- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/data/reference/rest/v3/thumbnails/set
