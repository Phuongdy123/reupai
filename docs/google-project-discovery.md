# Customer Gemini project discovery

Engine 0.2.37 reads the connected Google user's projects through
[Resource Manager projects.search](https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/search).
The existing cloud-platform OAuth scope is sufficient. Cloud Resource Manager
must be enabled for the application's OAuth project; enabling that lookup API
does not select that project as the customer's Gemini quota project.

The lookup never calls project creation, billing setup or IAM mutations. It
excludes inactive projects, malformed IDs and the application owner's project
from automatic candidates. Pagination must finish before a unique candidate can
be selected. One candidate is saved automatically; multiple candidates are
returned for an explicit choice. Existing manual selections are retained.
If Google denies the lookup or no project exists, the web keeps manual entry,
the Google Cloud link and a refresh button.

Selections are tagged with the Google subject/email that saved them. An account
switch does not silently reuse another account's project. Existing untagged
selections are bound before a reconnect replaces the old Google grant.
The lookup cache is scoped to the Google principal. Results from an interrupted
or replaced OAuth attempt are discarded before saving or returning a list.

The OAuth completion flow tries detection before its existing Gemini API check.
Settings can also trigger detection after updating an already-authorized Engine,
so a new Google consent is not necessary merely to discover a project. The
normal readiness/permission checks still run against the selected customer's
project. The web does not receive the Google access token.

## One-click creation (0.2.38)

When a complete search finds no customer project, Settings offers **Tự tạo
project và kết nối**. This is an explicit user action; finding no project by
itself does not create a resource. The existing cloud-platform scope authorizes
the [projects.create API](https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/create).
The account must also have permission to create projects and available Google
project quota. Workspace organization policy or Google's terms acceptance can
require action in Google Cloud; the UI explains that rather than claiming success.

POST /api/gemini/projects/setup requires the Engine session, trusted origin and
`confirmed: true`. A complete fresh discovery must still find no project before
the first POST to Google. It generates a random non-personal project ID, saves
an account-specific journal before sending, and persists the Google operation.
GET of the same route only resumes/checks; it never creates. No billing account,
IAM changes, API keys or automatic acceptance of legal terms are involved.

Duplicate clicks/tabs serialize. A lost response retries the same project ID;
returning to Settings or restarting the Engine resumes the journal. Account
changes cannot reuse another account's selection or credentials. Completion
requires an ACTIVE project with the exact ID and random attempt marker. A manual
selection in another tab wins over the pending creation. Normal Gemini checks
and API enablement run after the new project is saved; project creation alone
does not imply usable Gemini quota, available models or completed setup.

Automated tests use mocked Google HTTP only and do not create real cloud projects.
