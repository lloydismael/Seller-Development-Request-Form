# Production backend readiness — 2026-10-14

## Confirmed cause

Read-only checks against Primary Subscription
`2a77b3d9-39da-4b42-8219-c6fd9b8a6165` confirmed:

- `https://sellerdevelopmentrf.clouditechsolution.com/api/health` returns HTTP 404.
- Existing `SellerDevelopment` in `PersonalRG` is Standard, East Asia, with no linked backends.
- The subscription's Function App inventory is empty.
- Existing application storage `sellerdevelopment` exposes
  `https://sellerdevelopment.table.core.windows.net/` in Southeast Asia.
- Required resource providers are registered; planned runtime storage name
  `stbookingprod8941` was available at check time (not reserved).

The frontend's shared-storage error is therefore caused by the absent API.
Local API success does not establish deployed API availability or cloud identity access.
Keep the deployed browser-storage prohibition and frontend health check unchanged.

## Checks performed

| Check | Result |
| --- | --- |
| `infra/scripts/preflight-readonly.ps1` | Passed its limited read-only checks |
| `infra/scripts/verify-scaffold.ps1` | Main/link compilation and structural checks passed; private plan checks skipped |
| `infra/scripts/test-scaffold.ps1` | All 13 regression checks passed |
| `npm test` in `api/` | All 8 tests passed |
| Production health | Failed: HTTP 404 |
| AppLens | Static Web Apps resource type not supported by this diagnostic tool |

These results do not constitute full provider validation, security certification,
capacity confirmation, or approval to provision/publish/link resources.
No production resource changes or booking-data changes were made.

## Blocking authentication prerequisite

`main.bicep` requires `swaAuthClientId` so the new backend is protected before
application source is published. Public parameters intentionally omit it.

[Microsoft's linking guidance](https://learn.microsoft.com/azure/static-web-apps/functions-bring-your-own)
states that linking creates the **Azure Static Web Apps (Linked)** identity
provider and that linked authentication must use App Service Authentication v2.
The [AuthsettingsV2 schema](https://learn.microsoft.com/azure/templates/microsoft.web/sites/config-authsettingsv2#azurestaticwebappsregistration)
describes `clientId` as a string but does not establish its derivation.
The [link-backend REST operation](https://learn.microsoft.com/rest/api/appservice/static-sites/link-backend?view=rest-appservice-2025-03-01)
accepts backend resource ID and region, not the authentication binding identifier.

Do not substitute an ARM ID, GUID or hostname without verified evidence.
Do not disable authentication or link production simply to discover this value.

Resolve with Microsoft support confirmation, or obtain separate approval for an
isolated nonproduction linking validation that observes the service-created binding
and verifies anonymous/forged-principal rejection. Such a test introduces extra
resources/costs and must not serve existing booking data or change production routing.
Any test-derived binding for another site must still establish how to obtain the
correct binding for `SellerDevelopment`; do not reuse another site's value.

## Remaining gates

1. Verify the binding and chosen Flex Consumption linking/authentication support.
   Microsoft describes bring-your-own Functions as supporting any plan type, but
   its comparison table does not explicitly enumerate Flex. No live FC1 link test
   has been performed for this repair.
2. Refresh capacity, permissions, policy/lock checks and cost estimate.
3. Supply production app secrets through a protected local channel, never chat,
   repository, logs or command-line literals.
4. Pass full ARM validation/what-if with real protected inputs and review changes.
5. Obtain the staged provisioning, publishing and production-link approvals in
   `README.md` and the private deployment checklist.
6. Publish the allowlisted API package, preserve fail-closed backend authentication,
   then link production and verify health, authentication and protected reads.

The production outage remains unresolved until these gates complete and
same-origin health returns HTTP 200 JSON with `ok: true` and `storage: "table"`.

## Selected next step: isolated validation plan

The operator selected planning an isolated nonproduction validation. This does
not authorize creating test resources or changing production.

- Propose a separate disposable resource group with a Standard test Static Web
  App, empty Node22 Flex Function App, and separate identity-based runtime storage.
  Use no application source, production Table role or production app secrets.
- Validate names, regional capacity, permissions, secure bootstrap and the
  supported linking operation; obtain a current cost estimate and explicit
  resource-creation approval. An empty host must not be mistaken for a proven
  protected endpoint merely because it returns 404.
- Link only the test pair. Inspect the service-created AuthV2 provider and compare
  its binding with test SWA metadata without querying tokens or credentials.
  Before adding any synthetic probe function, verify required authentication,
  HTTPS and rejection behavior. Repeat anonymous/forged-header negative tests
  after publishing that harmless probe and verify access through the test SWA.
- The experiment may corroborate a derivation but must not automatically mark the
  production binding verified. Obtain authoritative confirmation or a separately
  reviewed fail-closed, empty-production-host verification procedure if necessary.
  Do not publish booking source or change production routing while unresolved.
- Record observed support and binding behavior. Seek separate approval to remove
  only the test resource group after evidence collection; do not assume cleanup
  permission or leave billable resources unreported.

No test resources have been created. Final test costs and secure bootstrap design
remain outstanding; production remains blocked until verification succeeds.

## Local implementation completed

The repair's admin-session changes are implemented locally, not deployed:

- Reject extra token segments and malformed SWA role collections without an
  authorization exception. These checks do not establish trust in identity headers;
  platform protection and header sanitization remain mandatory.
- Propagate session API outages instead of silently reporting a logged-out user.
- Keep the admin retry screen functional for session lookup failures; report failed
  logout without claiming the server session has been cleared.
- Add `Cache-Control: no-store` to JSON API responses, including login/logout.
- Add `api/test/auth.test.js` and `api/test/api-auth.test.js` covering credential
  guards, expiry/tampering, proxy cookie flags, auth contracts, protected routes,
  truthful transport errors and private-response caching.

The expanded API suite passes all **18 tests**. Infrastructure structural checks
and all **13 scaffold regression checks** were rerun successfully. Full provider
validation, production authentication, capacity and real Table persistence remain
unverified; these local checks do not resolve the missing production backend.