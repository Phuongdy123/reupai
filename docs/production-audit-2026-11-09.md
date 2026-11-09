# ReupAI production audit — 2026-11-09

This audit covers the current Windows Engine and web workspace. It reduces
specific failures found in code and fault tests; it does not establish that
every customer machine or third-party service will work without errors.

## Changes

| Scenario | Behavior after this patch | Evidence |
| --- | --- | --- |
| One feedback object is corrupt or temporarily unreadable | Other feedback stays readable; the affected item is marked for retry and cannot be marked resolved | Fault-injection tests for malformed JSON and a mixed valid/invalid inbox |
| Non-ticket files appear in the feedback bucket | Pagination advances using the raw storage cursor and does not skip valid feedback | Two-page test with a provisioning file mixed into 22 records |
| An older inbox request finishes after a newer action | Results from obsolete requests are ignored; refresh is disabled during status changes | Request sequence guard and rendered inbox tests |
| Google returns malformed project labels or an unexpected operation error | Setup returns an actionable verification/retry state instead of crashing or selecting an unverified project | Mocked Google responses; no real resources created |
| Project creation gets HTTP 401 mid-request | Refresh the credential once, retry the same project ID, and stop if the account changed | Tests for same-body retry and account replacement during the request |
| Google refuses project creation because OAuth scope is missing | Request renewed consent rather than claiming IAM permission is absent | Structured Google ErrorInfo fixture |
| An explicitly requested replacement follows a completed project-creation journal | Archive the completed receipt and track the new creation durably; repeated clicks resume it | Completed-journal replacement test |
| Bilibili returns 401/403/404/410/412/429 | Close the fallback browser, stop stream transfer and explain the source-specific next step | Fixture browser tests; no Bilibili requests made |
| Anonymous extractor modes produce identical commands | Execute each distinct command once; retain the cookie attempt and browser fallback | Command-deduplication regression with failing extractor fixtures |
| Windows temporary storage is on a different drive | Put fallback media temporary files on the job volume; preserve existing source and clean staging on transfer failure | Successful and interrupted transfer tests |

## Validation and rollout

- Run the complete Python unit suite and Node test suite after the patch.
- Build the web and run the rendered feedback and Gemini project fixtures.
- Build Engine 0.2.40; check required bundle files and run the packaged config
  check in an isolated data directory before publishing the signed manifest.
- Production feedback provisioning must still verify write/read access and
  deny anonymous reads. Unauthenticated feedback/admin APIs must return 401.
- Existing unrelated workspace changes are not treated as newly audited work.

## Remaining operational limits

| Risk | Response / remaining validation |
| --- | --- |
| Bilibili challenges a customer session, blocks requests, removes a video, or requires access | Do not promise an IP bypass or keep retrying a rejected request. Ask the customer to check the exact video in their browser and complete any required verification. Validate successful downloads on that customer's network. |
| Google requires terms, project-creation quota, organization approval or billing | Show the applicable action. Do not silently accept terms, grant IAM roles or link a billing account. |
| Feedback retry crosses the per-minute submission boundary | The existing atomic slot prevents duplicates within a minute; it is not permanent idempotency across arbitrarily delayed retries. A transactional receipt ledger would be needed for that stronger guarantee. |
| A new feedback arrives while the admin paginates | Cursor offsets refer to a changing object list; refresh the inbox to obtain the newest view. A database keyset cursor would provide snapshot-style pagination at larger volumes. |
| Native GPU/OCR/TTS failure on hardware not available here | Unit/import checks do not prove behavior on every driver or clean Windows installation. Keep the CPU fallback and collect customer feedback with the relevant error. |
| Antivirus, power loss, port conflict, full disks or interrupted updates | Preserve source data, retain installation integrity checks and show recovery instructions. Test installation/update on a clean Windows VM and a customer machine before a broad rollout. |

No real customer Google project, payment, video download or customer feedback
is created by the unit/browser fixtures. Packaged checks use a separate data
directory; production storage checks use disposable non-ticket objects.
