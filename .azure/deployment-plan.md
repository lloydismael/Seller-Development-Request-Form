# Production API route restoration

Status: Deployed

## 1. Scope and approval
User approved deployment of the current API to the existing Function App and creation of this checklist on 2026-10-14. Code-only update; no infrastructure provisioning, authentication changes, storage configuration changes, migrations, stored-form overwrite, or frontend deployment.

## 2. Azure context
Subscription: 2a77b3d9-39da-4b42-8219-c6fd9b8a6165 (Primary Subscription).
Resource group: PersonalRG. Function App: func-booking-prod-8941. Existing region: southeastasia.
Static Web App: SellerDevelopment. Production URL: https://sellerdevelopmentrf.clouditechsolution.com/.

## 3. Diagnosis
Production /api/health returns 200 with table storage. /api/form-config returns empty 404 on custom and default SWA domains. Azure trigger inventory lists only nine old routes, without formConfig. Latest frontend workflow succeeded for commit 68b0fc98b3ee9a06eb7af51978df8381589fe153; no current API deployment workflow exists. Backend link is Succeeded and targets the expected Function App.

## 4. Recipe and artifacts
recipe.type: azcli
Publish an independently verified API-only ZIP using the existing Flex Consumption deployment channel and remote build. Package host.json, package.json, package-lock.json, and complete src tree, with generated canonical form assets. Exclude local settings, node_modules, tests, scripts and all unrelated files. Stage package within the ignored active deployment session. Preserve existing configuration and authentication.

## 5. Preparation
Completed: live runtime node 22, Running; existing authentication enabled, requires authentication, Return401, SWA provider enabled. `npm run build` passed. Targeted form-routes/forms/frontend-transport/packaging/api-auth/auth/storage tests: 82 passed, zero failed. Dependency lock and engines match manifest (structural equality). API ZIP created inside active ignored session api-release-7a2be98bb296464885f8ef85f2809360: 13 entries, 30,473 bytes, SHA256 F743776895DD69651D7375DB94FDAB72E312BF8AD33DDEB1EBB4077109640DDD. All entry names/counts/hashes verified and source ancestor reparse points rejected. Supported command: az functionapp deployment source config-zip --build-remote true, explicit existing subscription/resource group/name. Pre-publish direct health and forged auth/me both returned 401.

## 6. Verification and safety
Before and after publish: direct backend requests without a platform token and with forged admin headers must return 401/403. Verify SWA health, published form JSON/schema, frontend/backend asset compatibility, and anonymous rejection of private routes. Do not submit bookings, sign in, expose credentials, or read private records. The form endpoint may initialize absent form-state defaults using the application's normal behavior, but must not overwrite existing published settings.

## 7. Validation Proof
All validation checks pass (API-only scope):
- Core validation: CLI authentication, existing node22 runtime, code build, targeted 82 tests, lockfile structural equality, and exact ZIP inventory/hash verification passed on 2026-10-14. No infrastructure changes: ARM validate/what-if are not applicable to this code-only release; do not run provisioning templates requiring private inputs.
- Docker build: not applicable (Node source ZIP, no container).
- Azure policy: no resource provisioning or configuration modifications; existing code deployment authorization will be enforced by Azure.
- Static roles: existing infrastructure documents runtime Blob Data Owner/Table Data Contributor, application Table Data Contributor and Insights Monitoring Metrics Publisher. No role modifications in this release; live application role verification required.
- Authentication: live authsettingsV2 enabled, requireAuthentication=true, Return401, SWA provider enabled. Direct unauthenticated health and forged admin auth/me both return 401. SWA backend link Succeeded.
- ZIP: 13 entries, 30,473 bytes; SHA256 F743776895DD69651D7375DB94FDAB72E312BF8AD33DDEB1EBB4077109640DDD, all entry hashes checked.
- Validation workflow: supplied workflow requires unavailable PowerShell Core enum overload. Session-only equivalent uses Enum.IsDefined/Parse for Windows PowerShell; all validation actions retained. No installed tooling files changed.

### Current anonymous history release proof (2026-10-14)
- `node --test test\history.test.js test\frontend-history.test.js test\frontend-transport.test.js test\packaging.test.js test\api-auth.test.js`: 52 passed, zero failed.
- `npm run build`: passed after correcting the repository build command to invoke the exported asset builder. Regression test now executes the actual manifest build command and verifies canonical asset refresh.
- Manifest/lockfile structural equality passed. Canonical form asset hashes match packaged copies.
- Independently verified API ZIP: api-history-release-0d62ea4ee9644118935091c5651dd48e/api.zip, 14 entries, 33,230 bytes, SHA256 9B654311BB694E36E1AAB20476E4081BC3ABFA50CF6CEA7F716DD213C51565B4. Exact allowlist, entry hashes and ordinary filesystem ancestors verified.
- Live target Running/node22; linked backend Succeeded. Platform authentication enabled, requires authentication, Return401, SWA provider enabled. Direct health and forged auth/me return 401.
- Static role declarations and live managed identity roles verified: runtime storage Blob Data Owner/Table Data Contributor, application Table Data Contributor, Insights Monitoring Metrics Publisher. No role/settings/resource changes.
- Infrastructure validation, Docker builds and provisioning-policy changes are not applicable to this API-only update. Azure enforces existing deployment authorization.

## 7a. Admin origin repair (2026-10-14)
User approved configuring ADMIN_ALLOWED_ORIGINS to the exact custom and default SWA HTTPS origins and deploying to the same existing subscription/Function App in southeastasia. All other settings, infrastructure, credentials, storage and platform authentication remain unchanged. Current deployed frontend sends the CSRF header, but browser Origin requests return 403 while no-Origin empty login requests reach credential validation (401). Fix uses an authoritative HTTPS origin allowlist, rejects malformed/unlisted origins, retains CSRF header and cross-site rejection, and preserves local host matching when unconfigured. Targeted auth/transport regression tests: 48 passed. Editor diagnostics clean. Deployment must verify both browser-style valid origins pass the guard, unlisted origins/missing headers/cross-site requests fail, direct backend remains protected, and public form remains available. No actual credentials are used for probes. Build and additional packaging/auth tests: 10 passed. Release ZIP api-origin-release-d6eadb34c61546a088c084b44e7450a5: 13 entries with verified hashes, SHA256 B9AF0B18DA23640331D334EE39522D091337481EB3DD1BE3A3CA632662B5FBE1. Approved environment setting applied and remote-build publish succeeded (exit 0). Live checks on both approved domains: browser Origin plus CSRF header reaches credential validation (empty credentials return 401 Invalid username or password); unlisted origins, missing CSRF headers and cross-site metadata return 403. Form returns 200 on both domains, health is 200/table, direct backend login remains 401 at platform boundary. No password changed and no authenticated production login attempted. Changes remain uncommitted.

## 8. Deployment result
Initial remote build failed before activation: Oryx runs npm run build but API-only package excludes scripts/build-form-assets.js. Fixed API build command to generate assets in the repository and validate existing assets in API-only packages. Added isolated remote-build positive/negative regression coverage and updated packaging instructions. Revalidation: npm run build and 12 packaging/form-route tests passed. New package api-release-73ca4c6b000b4cdfab21639db3b0e9e8, 13 entries, 30,559 bytes, SHA256 E9FABA590F1965394C86C13B1C59BAAEE03160B1F2E0EE6948EA2BC6B1FE67B5; all entry hashes verified. Retry succeeded (Azure CLI exit 0). Post-deploy verification on 2026-10-14: /api/form-config returns 200 with valid versioned schema on custom and default domains; SWA /api/health returns 200 with table storage. All 15 expected HTTP functions registered. Anonymous draft/activity/profile requests return 401; direct backend health/auth/me/draft requests with forged admin headers return 401. Deployed frontend data.js and form-schema.js match repository bytes after newline normalization. Existing storage identity roles confirmed live. No bookings submitted or private records read. Editor diagnostics clean and git diff --check passed. Source fixes remain uncommitted.

## 9. Anonymous history route restoration (2026-10-14)
User explicitly approved code-only publish to the existing target and subscription in Section 2. Production frontend is current, but both history triggers are absent. Preserve all infrastructure, authentication, app settings, roles and stored records. Never submit production bookings or read private records during verification.

All validation checks passed; code-only deployment completed:
- Core Validation: authenticated CLI, existing node22 runtime, targeted history/auth/transport/packaging tests, dependency lock comparison and exact API ZIP inventory/hash verification. ARM validate/what-if are not applicable: no infrastructure deployment or configuration changes are authorized.
- Docker Build: not applicable, Node source ZIP rather than container.
- Azure Policy Validation: no provisioning/configuration changes; existing code-upload authorization enforced by Azure.
- Build Verification: npm run build from api and canonical form-asset byte equality.
- Static Role Verification: inspect existing identity-based storage role declarations; do not modify roles. Confirm live Table Data Contributor for application storage.
- Pre/post checks: backend link, platform auth settings, direct-backend 401/403, same-origin health, empty synthetic history identity, cookie attributes, no-store and unknown detail 404. No secrets or cookie values printed.

Release result: verified ZIP SHA256 9B654311BB694E36E1AAB20476E4081BC3ABFA50CF6CEA7F716DD213C51565B4 (14 entries, 33,230 bytes) published with remote build; CLI exit 0, deployment ID aa7fe003-0e4c-45db-962d-4e3240551c3b. All 17 functions registered, including myRequests and myRequest. On the custom HTTPS domain, new identity history returned 200/empty, returning identity returned recognized:true, cookie Secure/HttpOnly/Strict/path/one-year flags and no-store passed, unknown detail returned 404, and health remained 200/table. Proxy-normalized cookie attribute casing is accepted. Direct backend health/auth-me remained protected even with forged admin headers. Frontend contains My Request and excludes the removed explanation. No bookings created, private records read, credentials exposed or settings/roles/resources changed.

Packaging regression fix: repository build now invokes the exported asset builder rather than only loading the module; actual manifest-build regression verifies canonical asset refresh. All 52 focused history/auth/transport/packaging tests passed. Persistent read-only smoke tooling added for future linked-API releases. Backend CI publication remains unconfigured pending approved deployment authorization; frontend api_location stays empty. Production submission-to-history testing was not performed because creating production records is outside approval.

## 10. Compatible schema repair (current release)

### Deployment and live verification
- User reconfirmed Primary Subscription (2a77b3d9-39da-4b42-8219-c6fd9b8a6165), existing func-booking-prod-8941 in southeastasia, code-only scope.
- Verified ZIP deployed through config-zip with remote build; CLI exit 0. Active deployment 079e1d14-1037-4703-995f-67f348756c91, status 4 (success), completed 2026-10-14T23:03:58.5778088Z.
- Both custom and default SWA origins: health 200/table; form-config 200 with current-schema validation; anonymous manage/form-draft 401.
- Saved draft/published aggregate ETag and SHA256 exactly match predeployment baseline; no saved form content changed.
- Direct backend health and forged-admin auth/me requests remain 401. Node22/Running/SystemAssigned and platform authentication enabled/required/Return401/SWA provider unchanged.
- Live role verification passed: runtime Storage Blob Data Owner and Table Data Contributor; application Storage Table Data Contributor; Insights Monitoring Metrics Publisher. No resources, roles, settings or authentication changed.
- Authenticated admin browser refresh remains a manual check; no production sign-in attempted. Draft loading with persisted glass properties passes packaged-backend regression.

User approved code-only deployment to the existing Function App, preserving all forms, settings, authentication and resources. Frontend glass schema was released after the active backend; saved draft/published state validates with current schema but fails the pre-glass schema. Health is 200/table while form-config is 503.
All validation checks pass checklist:
- Core: authenticated CLI, explicit subscription, Running/node22 target, manifest/lock consistency, build, targeted tests and verified source-only ZIP.
- ARM validate/what-if, Docker and provisioning policy: not applicable; no infrastructure or configuration changes.
- Static roles and platform authentication: verify unchanged existing managed identity assignments and auth boundary.
- Post-deploy: both SWA origins return validated published form; persisted form-state hash/ETag unchanged; anonymous private routes and direct backend remain protected.

### Section 7 current schema repair validation proof
- npm run build passed; forms/form-routes/packaging/glass-settings/api-auth: 35 tests passed, zero failures. API-only persisted glass draft/published regression passes.
- Manifest/lock structural equality and canonical asset equality passed. ZIP exact 14-entry inventory/hashes verified, 33,434 bytes, SHA256 996805217729596026C3E378DDD2320702C3D9866356A5B077FC555082AB0537; api-schema-release-b849c955edc74649bed9621d57730a24/api.zip.
- Explicit target Running/node22; authenticated Enabled subscription. Static role declarations match live four managed identity roles. Platform authentication enabled/required/Return401/SWA enabled; direct anonymous and forged-admin requests both 401.
- Existing saved draft/published validate; predeploy state hash/ETag recorded privately, no content copied. No settings/roles/resources or data changed. No infrastructure/Docker validation applicable to this approved code-only deployment. Bash authoritative workflow used for PowerShell 5 compatibility.
