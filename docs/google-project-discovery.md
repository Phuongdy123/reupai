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
