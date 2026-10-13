# Booking infrastructure — scaffold only

Target: Primary Subscription (`2a77b3d9-39da-4b42-8219-c6fd9b8a6165`), existing `PersonalRG`, new backend in `southeastasia`. Existing `SellerDevelopment` stays in `eastasia`; `sellerdevelopment` application Tables are unchanged.

No Azure resources have been created or modified. No deployment approval is implied by these files.

## Templates

- `main.bicep`: subscription-scoped entry referencing the existing group; creates only backend compute, runtime storage, telemetry and scoped roles inside it. No group recreation or parent SWA/storage updates.
- `modules/hosting-plan.bicep`, `function-app.bicep`, `application-insights.bicep`: pinned verified modules (`serverfarm:0.5.0`, `site:0.19.0`, `component:0.6.0`). Versions resolved from the saved verified repository commit `2e9bcda8e3c894f4fe24701112bb791df285478c` and restored by Bicep.
- Minimal local runtime/workspace modules avoid exporting access keys. Reviewed AVM storage/workspace modules export credentials unnecessary to this application; their exact discovery is recorded in the session.
- `function-settings.bicep`: required secure inputs remain secure at every deployment boundary. No application secrets enter the AVM site `configs` object. Platform app settings are encrypted at rest, but authorized operators can retrieve them; they are not a private network boundary.
- `backend-auth.bicep`: independent App Service Authentication v2 configuration requiring SWA-provided authentication before application code runs. Existing username/password and signed cookie remain unchanged. CORS alone is not authentication.
- `link-backend.bicep`: **separate, final routing cutover** of the existing SWA to the already deployed backend; do not execute alongside initial provisioning. Its parent resources are `existing`.
- `scripts/verify-scaffold.ps1`: compiles in memory and checks recursive ARM/security/topology. Default structural checks do not require any ignored session files. Supply `-PlanPath` explicitly for plan naming/cost checks; omission is reported as skipped, not passed. Compiler stderr is retained. The official conformance script is additionally required.
- `scripts/scaffold-checks.ps1`, `test-scaffold.ps1`: shared array/symbolic ARM checks and in-memory mutation regressions for nested parent writes, provider binding and four scoped role/principal tuples.
- `scripts/preflight-readonly.ps1`: reads the active subscription, provider registration, existing parents/link inventory and storage name availability. No resource changes, credentials, data-plane requests, login or subscription switching.
- `PACKAGING.md`: public allowlisted source-package procedure; no automatic publishing or secrets generation.

## Required unresolved inputs and constraints

Public parameters intentionally omit `adminPassword`, `sessionSecret` and the currently **unverified** `swaAuthClientId`. They have no insecure defaults. Therefore this scaffold cannot be provisioned from the public parameter file alone.

Keep SWA provider `registration.clientId` as a required verified binding input. Do not substitute a hostname/random GUID or assume that an ARM ID is either valid or forbidden without authoritative evidence. The [official CLI implementation](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/appservice/static_sites.py), `link_backend`, sends the backend resource ID/region to `begin_link_backend_to_build`; it does not derive the authentication identifier. The [authsettingsV2 schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites/config-authsettingsv2) describes a string client ID but supplies no derivation. The exact binding for this existing site remains unverified. Establish it before provisioning/code upload and preserve it on redeploy; do not treat source inspection as live security proof.

## API and role evidence (2026-10-13)

Live `az provider show` confirms Web sites `2025-03-01`, staticSites/linkedBackends `2025-03-01`, and Storage accounts/blobServices `2026-06-01` among supported versions. Newer advertised GA versions are sites `2026-08-01`, linkedBackends `2025-05-01`, and storage `2026-09-01`. Prefer current documented schemas supporting the authored properties: [sites](https://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites) and [linkedBackends](https://learn.microsoft.com/en-us/azure/templates/microsoft.web/staticsites/linkedbackends) `2025-03-01`; [storageAccounts](https://learn.microsoft.com/en-us/azure/templates/microsoft.storage/storageaccounts), [blobServices](https://learn.microsoft.com/en-us/azure/templates/microsoft.storage/storageaccounts/blobservices), and [containers](https://learn.microsoft.com/en-us/azure/templates/microsoft.storage/storageaccounts/blobservices/containers) `2026-06-01`. Provider metadata does not separately enumerate sites/config or blob containers; the discriminator/child schemas supply evidence, not a claim of independent live enumeration. Auth/settings retain documented `2022-09-01`. AVM pins remain unchanged.

Four assignments target the API's system identity: runtime **Blob Data Owner** and runtime **Table Data Contributor**, application account **Table Data Contributor**, Insights **Monitoring Metrics Publisher**. [Host storage guidance](https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections?tabs=host&pivots=functions-auth-identity) explicitly requires runtime Table permissions for diagnostic events even when startup fails. The application-account role cannot cover the separate runtime account. No live role assignment was changed; HTTP-only triggers do not require a queue role.

## Safe preflight and cutover order

Run the read-only preflight script and structural verifier locally; explicitly pass the active session's `prepare-plan.json` for additional plan checks. Review inherited policies/locks, deployment RBAC, planned-name collisions, Flex region/runtime support and FC1 quota independently. Name availability and advertised support are transient, not deployment/capacity guarantees. No private values or dummy secrets are needed for these checks. Full ARM validation/what-if waits for verified binding, protected private inputs and appropriate permission; neither command authorizes provisioning.

After separately approved provisioning, verify control-plane auth and **negative direct-endpoint tests before publishing**, then repeat negative tests after separately approved publishing and **before linking**. Direct `/api/health`, `/api/auth/me` and read-only admin routes, with no platform token and with forged `x-ms-client-principal`/admin headers, must reject 401/403; 404, redirects, 200 or 5xx do not establish rejection. Never weaken authentication to get health green.

Only then may a **separately approved link** execute `link-backend.bicep`. Re-read auth configuration and repeat direct negative probes. Positive same-origin SWA `/api/health` (`ok:true`, `storage:table`), legitimate private login and protected admin reads occur **after linking**, not as pre-link prerequisites. Check anonymous/forged headers cannot grant admin through SWA. Do not log cookies, credentials or record contents. If linking/provider/Flex compatibility or sanitization fails, stop; do not silently remap topology.

FC1 availability and Node22/2048-MB support are advertised for southeastasia. Exact FC1 quota/usages calls return `InvalidResourceName`; generic Web `usages` limit31 is **not FC1 quota**. Do not claim available capacity. Full provider validation/what-if and live access tests are deferred; do not pass fabricated values for secure inputs.

AVM site contains generic dormant credential/publishing branches in compiled ARM. The default `configs`, `slots`, publishing policies and hybrid relay inputs are null; loop counts are zero. No such resource is deployed for this Flex configuration. Do not enable these inputs or flow application secrets through ordinary AVM objects.

The new host account uses public endpoints with HTTPS and identity authorization, no shared-key or public blob access. No VNet, private endpoint or static IP allowlist is provisioned; SWA-linked Functions require public reachability. LRS, scale-to-zero and cold starts are deliberate cost choices, not a high-availability guarantee.

## Separate API packaging (instructions only; not executed)

Detailed inventory, ZIP validation and failure rules: `PACKAGING.md`.

Use an explicit allowlist, not an archive of the repository or the whole `api/` directory:

1. Create a fresh staging directory under the ignored active session (never in application source).
2. Copy `api/host.json`, `api/package.json`, `api/package-lock.json` and the complete `api/src/` tree, preserving paths. Verify the lockfile exists before proceeding.
3. Never include `local.settings.json`, any `local.settings*` example, `.migration/`, `.data/`, `test/`, `scripts/`, `.env*`, backups, `node_modules/`, browser records, infrastructure, private session artifacts or frontend files.
4. Build ZIP entries with forward slashes and `host.json` directly at ZIP root (not `api/host.json`). Inspect entry names, hash and byte size without displaying file contents. Reject reparse points/symlinks and anything outside the allowlist.
5. For Node22 Flex, publish the allowlisted package independently with the supported Flex remote-build/OneDeploy channel after explicit deployment approval. Do not use generic App Service startup scripts, SCM settings, package-run settings or basic publishing credentials.
6. Keep the frontend deployment's existing `api_location` empty. Do not copy the backend into `app/api` or convert it to SWA-managed Functions.

## Private deployment checklist

The ignored active session's `deploy-checklist.md` governs approval, private secret generation, backend rejection tests and final routing cutover. No scripts here automatically deploy, generate credentials or migrate data.

Revised illustrative gross incremental cost: **USD1.42545/month (~USD1.43)**, USD0.003 lower after removing the vault service. Existing SWA/storage bills, taxes, egress, queue operations and usage overruns excluded. No remaining shared free grants assumed; this is not a quote or cap.