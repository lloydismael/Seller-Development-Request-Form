# Azure email notification activation

Status: Deployed

## Styled-email + request-deep-link release — 2026-10-21
User approved code-only API deployment, related commit/push on existing main to trigger existing GitHub-authorized SellerDevelopment workflow, and local API restart. No infrastructure/configuration/auth/DNS/role changes or real test sends/data mutations.
All validation checks pass:
- [x] Core: authenticated exact subscription/targets; no IaC provisioning, Docker or what-if applicable. GitHub CLI authenticated; local main equals remote main 5ee47fe; production workflow push/main provides required identity token without bypassing GitHub deployment policy.
- [x] Production compatibility passes; direct Function health/auth/bookings and forged principal 401; anonymous SWA bookings 401.
- [x] Canonical and staged remote-build package builds pass; 310 serialized Node tests pass, zero failed/skipped. Syntax, diff and IDE diagnostics pass; IDE runner found zero tests, canonical Node fallback used.
- [x] Runtime/system identity, 19-setting encrypted baseline, auth, Function config, slot flags and SWA backend link captured privately. Existing resource-level storage, Insights and dedicated ACS-only role assignments verified; no new calls or grants.
- [x] Exact source ZIP: 22 allowlisted entries, 54653 bytes, portable slash names and each SHA256 verified; no tests/settings/scripts/node_modules/secrets/verifier. Manifest includes required ACS SDK. Header payload verified.

### 7. Styled-email/deep-link release actual validation proof
2026-10-20T17:12:49Z package SHA256 `150D1AEC57C3F5653901ED1A1FD418F8FF87A5B2FD1E122782DEA27B909ED680`. Actual `npm run build`, `node --test --test-concurrency=1 test/*.test.js` (310/310), production compatibility, syntax/diff/editor, source inventory and existing-role checks passed. Session-only existing Windows Enum.Parse compatibility workflow used; installed skill unchanged. Private DPAPI baseline retained in ignored styled-release-final directory. Source HTML includes audience-specific staff links and escaped details with plaintext fallback/high-importance headers. No live send authorized.
### Styled-email release deployed proof — 2026-10-20T17:20Z
API exact verified ZIP deployment `eb8cd2fd-6df2-4e7d-8fda-0c754384b374`: active/complete=true, status=4, end 2026-10-20T17:14:51.0056128Z. Source commit 33072ad290f8ee7e592e7a65bdb12951f42ef75b pushed main; GitHub frontend workflow https://github.com/lloydismael/Seller-Development-Request-Form/actions/runs/39464696456 completed/success. Live static files HTTP200 byte-identical to commit LF blobs: admin/admin.js SHA256 73d1f1a09c3dc961b8f6314037b1246019f69346772a131643daa9b9f6bc0338; admin/csat.js SHA256 5a802bcb0613dbac4d7e918f31c9f0bb4976e9c61204f2ede32b9970d91937aa. Working files CRLF; normalized contents identical, raw working hashes intentionally differ. API post-publish private comparison PASS for all 19 settings plus slot flags, identity, auth, Function config and linked backend. Email enabled retained; timer registered/verifier absent; compatibility/health pass; direct/forged protected routes and anonymous bookings 401. Resource-scoped live MI roles unchanged. SCM source download HTTP404, no credential fallback; exact payload proven by inspected accepted ZIP/deployment, not independent runtime download. No real sends/outbox or record/account mutations. Local listener 84672 stopped by exact ID; existing VS Code task restarted API PID105300. Local API and frontend health 200/table; frontend PID39996 untouched; creation=true/timerDisabled=true preserved. Preexisting host-storage warning not changed. Tests 310/310; IDE clean.
Necessary docs-only follow-up repairs accidental PowerShell Unicode mojibake and adds final proofs; no app changes/redeployment required for API. No .azure or ignored session secrets included in commits.
Final docs-only commit 75c069569ee88ac7ed33503192ba3dc9856db47b pushed; follow-up workflow https://github.com/lloydismael/Seller-Development-Request-Form/actions/runs/39465182916 completed/success. Final live static exact committed hashes and production compatibility reverified after this run. Only .azure/deployment-plan.md remains uncommitted intentionally; no secrets staged.

## Current bounded high-importance code-only release — 2026-10-21
Explicitly approved: publish existing API source with notification headers `Importance: high`, `X-Priority: 1`, `X-MSMail-Priority: High` to the same existing Function, subscription and region. All email flags/settings, identity/authentication, SWA link, storage, DNS and roles must remain unchanged. No provisioning, additional test emails, outbox rows, booking/account mutations or git commit.
All validation checks pass (current code-only validation):
- [x] Core: authenticated CLI, existing Running/node22 target, exact clean API ZIP and packaged remote-build command pass. ARM helper/validate/what-if not applicable: no IaC deployment; no provisioning template executed.
- [x] Docker not applicable: source ZIP.
- [x] Policy: no provisioning/configuration writes; existing effective deployment permissions include `*`, Azure enforces authorization.
- [x] Canonical build; 22 notification + 3 integration = 25 targeted tests pass; all 303 isolated tests pass, zero failures. Static dedicated ACS-only role/MI assignments unchanged. Editor diagnostics and diff check pass.
- [x] Baseline all settings/slot flags, auth, identity, Function config and SWA link captured with DPAPI encryption. Compatibility/health 200/table, direct and forged principal 401; anonymous booking 401. Timer registration checked after publish; no mail test authorized.

### 7. High-importance release validation proof
2026-10-20T16:23Z: exact API-only ZIP 22 files / 53154 bytes, SHA256 `C10DF5E1540E12F2F195AA7E6229E0B569B5E94BFE4B20742C1930BC31DF2463`; portable ZIP entry names and every entry hash compared with current source. Exact notification payload contains all three high-importance headers. No settings/tests/scripts/node_modules or verifier included. Repository and staged packaged `npm run build` pass. Actual validate workflow executed using existing session-only Windows enum compatibility copy after installed workflow failed TryParse overload; no installed skill modified. Additional local packaging portability issue fixed before publish, final ZIP independently verified. Gmail controls Important labeling; already delivered mail cannot be changed. No live email send or verification outbox rows authorized.



### High-importance release deployed proof
`az functionapp deployment source config-zip --build-remote true` explicit existing target, exit 0. `az webapp log deployment list` confirms active complete deployment `28e35d73-0a2d-4d62-8ffb-f842072fdab1`, status 4/success, completed `2026-10-20T16:25:41.5513123Z`. Uploaded SHA256 `C10DF5E1540E12F2F195AA7E6229E0B569B5E94BFE4B20742C1930BC31DF2463` with exact header payload verification. Post-publish script PASS: all 19 settings plus slot flags/identity/auth/Function config/SWA link unchanged; EMAIL enabled preserved. Production HTTPS health 200/table/compatible; direct and forged principal 401; anonymous bookings 401; timer registered, verifier absent. Live role list matches existing runtime/application storage, Insights and dedicated ACS-only MI role. No additional test send/verification row, booking/account mutation, configuration/IaC/DNS/role write or git commit. Actual proof retained in active-session deploy-result.json.highImportanceRelease; runbook updated. Gmail Important label is not guaranteed.

## Prior email activation state — 2026-10-20T16:09Z
Enabled=true. ECS ecs-booking-notifications-8941, verified domain bookingnotification.clouditechsolution.com, noreply sender, dedicated ACS acs-booking-notifications-8941, resource-scoped custom role/MI assignment deployed. Exact single hosted MI email operation/message ID 6bcb353f-3705-40ef-9fc7-fbf6d8811eca accepted and Succeeded in 5737 ms; recipient delivery/inbox not independently confirmed. Clean final API-only remote build deployed; temporary verifier/guard removed; isolated test entity deleted, throttle untouched. 302 tests passed. Required requesterEmail published; production HTTPS health/compatibility pass, direct forged requests 401, auth/link/storage/secrets preserved. Full resource IDs, timestamps, ZIP proofs and recommendations: infra/EMAIL-NOTIFICATIONS.md and active-session email-verification-result.json.

2026-10-20 retry explicitly approved: supported API fix, fresh azure-validate checks, phased resource/DNS/sender/scoped custom-role deployment, API-only remote build, exactly ONE verification email to lloydismael@gmail.com, then conditional activation. Consent includes residual ACS configuration-write privilege at the dedicated ACS only. Prior failed deployment retained as historical evidence. No production booking/staff mutation authorized.

## Current scope — 2026-10-20
- Recipe: azcli; standalone `infra/email-notifications.bicep`, incremental resource-group deployment. No azure.yaml or azd scaffolding.
- User approved execution in Primary Subscription `2a77b3d9-39da-4b42-8219-c6fd9b8a6165`, PersonalRG, existing Function `func-booking-prod-8941`; US email data geography, usage charges, retirement dependency and Azure DNS inspection/additive configuration. Sender: `noreply@bookingnotification.clouditechsolution.com`; origin: `https://sellerdevelopmentrf.clouditechsolution.com`.
- Existing system identity principal: `b6cba273-1a08-4d52-b276-929342469e8d`. Preserve existing Function/SWA auth, storage, credentials, linked backend and other settings. No production booking/account mutations or private-record inspection.
- Completed stages: dedicated ECS/domain create, additive DNS four-state verification, dedicated ACS/sender/link/scoped custom RBAC, independently verified API-only remote build, disabled-first settings merge, exactly one authorized hosted MI SDK verification, clean final ZIP and test cleanup, enable. Explicit role and single-recipient consent satisfied by current retry approval.
- Provider registration executed successfully. Official lifecycle guide rechecked: new Email onboarding currently allowed but subject to change; retirement 2028-09-30 remains. Public NS delegation matches existing Azure clouditechsolution.com zone. No existing subdomain records found; parent DMARC absent. No unrelated DNS record replacement authorized.

## Current validation checklist
All validation checks pass: corrected DOMAIN and SENDER stages, verified API package and actual hosted single-message MI verification; deployment/activation completed.
- [x] Core validation: mandatory validate-deployment.ps1 OVERALL PASS; CLI/auth, Bicep build, ARM validate and what-if pass. Independent ResourceIdOnly preview confirms exactly 2 creates (ECS and domain), no modify/delete; helper's 3 count includes a non-resource output line.
- [x] Docker: not applicable (Node source ZIP).
- [x] Policy: inherited audit default, West Europe deny (not applicable to global), MFA-write/delete reviewed. ARM domain validation passes; no RG-level assignments returned. No policy bypass.
- [x] API build and all 302 isolated tests pass; no live local API invoked.
- [x] Static/live RBAC: approved documented actions, existing MI, dedicated ACS-only assignment; actual hosted SDK send Succeeded without broader grants.
- [x] Section 7 current proof recorded; workflow completed after all real checks; domain and sender helper checks passed. Final clean API deployed and enabled.

## 7. Current email validation proof
- Retry validation 2026-10-20T15:43Z: exact Microsoft Learn 2025-09-01 ECS/domain/sender/ACS schemas reviewed; live case-insensitive provider metadata confirms all four stable versions supported. Surgical API-version-only fix; no properties or role actions broadened.
- Mandatory validate-deployment.ps1 corrected domain: CLI/auth/build/ARM validate/what-if OVERALL PASS. ResourceIdOnly independently shows exactly ECS/domain creates, no Modify/Delete; existing resources Ignore. Policy assignment SecurityCenterBuiltIn/audit reviewed, live ARM accepted. Docker not applicable.
- Fresh canonical `npm run build` and `npm test`: 302 passed, zero failed; VS Code test provider unavailable, Node test runner used. Bicep/notifications editor diagnostics clean.
- Live REST Function Running/node22, identity unchanged; authsettingsV2 enabled, SWA provider enabled, requireAuthentication true, Return401. CLI convenience wrapper gave null nested properties/incorrect auth resource path; authoritative REST proves expected state.
- Static RBAC: domain stage none; sender custom role retains only documented CommunicationServices Read/Write and EmailServices/write, no key/delete/RBAC actions; assignment only dedicated ACS, existing MI principal. User explicitly approved residual configuration-write privilege and exactly one lloydismael@gmail.com verification email. SDK permission sufficiency remains live-test gated.
- 2026-10-20: `npm run build`, `npm test` in api: 302 passed, 0 failed. Editor diagnostics clean for notifications and standalone Bicep.
- Live ARM inspection: Function Running, node22/Flex, existing SystemAssigned identity. authsettingsV2 enabled, requireAuthentication=true, Return401, SWA provider enabled. No settings changed.
- `Microsoft.Communication` registered by approved subscription operation. Resource-group/subscription permissions include `*`; policy includes audit default, West Europe restriction, MFA-write/delete enforcement. ARM validation still required; registration alone does not prove deployment eligibility.
- Domain deploy attempted: `az deployment group create --name email-domain-20261020 --mode Incremental` with approved explicit subscription/group and domain parameters. FAILED `NoRegisteredProviderFound`: ECS API 2025-05-01 not supported by live provider. Deployment operation confirms failure at ECS creation; resource inventory empty for dedicated names. Stable 2025-09-01/2026-03-18 supported; require corrected template and fresh validation before retry. Do not treat prior preflight pass as successful deployment.
- Historical first-attempt state ONLY: no DNS/settings/API/RBAC writes or sends, effective false, no timer. This is superseded by approved retry evidence below and final current state above.
- Retry/role/one-email approvals subsequently satisfied. Dedicated-subdomain DMARC policy remains an optional follow-up and was not changed.
- Retry domain deployment `email-domain-retry-20261020` Succeeded. Exact generated ownership TXT/SPF and both subdomain DKIM CNAMEs added only at previously absent labels. Existing parent DNS records untouched. Authoritative/1.1.1.1 probes passed; initial 8.8.8.8 selector2 NXDOMAIN recorded as propagation, not treated as failure proof. Azure Domain/SPF/DKIM/DKIM2 all Verified/errorCode None. DMARC absent parent/subdomain; policy left unchanged pending explicit policy choice; not a mandatory four-state domain link prerequisite.
- Fresh sender ARM validate Succeeded, error null; mandatory sender validate-deployment.ps1 OVERALL PASS; full-resource preview exactly 4 creates (custom role, ACS, resource-scoped assignment, noreply), ECS/domain NoChange; no Modify/Delete. Sender `email-sender-20261020` Succeeded. Live scoped MI assignment 81ee39b7-5a41-5f2b-9d4e-a50bef027df3 and role 7e8f0667-c654-58be-9f24-c0101730c573 match exact approved actions. ACS local auth disabled and linked domain correct. Sender PUT unexpectedly reset domain states despite NoChange preview; reinitiated exact verification and all four now Verified again.
- Source ZIP final 22 entries/53112 bytes/SHA256 C63F98A648387E0FF4328D0851FA150B8C8AB44619B2F4EF5975187FD5B579CD; temporary hosted verifier ZIP 23 entries/54537 bytes/SHA256 5FDCC1808C947C14F40D080886E089BB3AAC29C19698671B95EC244C927F6936. Exact inventory/uncompressed hashes/slash paths verified; generated assets packaged build passed; no settings/tests/node_modules included. Python unavailable; .NET verified ZIP method used.
- Email-only settings merge disabled; all 15 existing values and slot flags compared privately unchanged. Fixed verification operation 6bcb353f-3705-40ef-9fc7-fbf6d8811eca uses isolated email-verification partition, no fake booking or profile; ETag claim, no retries. Hosted SYSTEM MI SDK send accepted exactly once and provider Succeeded: started 2026-10-20T16:04:00.414Z, accepted 16:04:02.184Z, completed 16:04:06.151Z (5737 ms). Durable exact entity confirms providerId equals operation ID, accepted true. Role sufficient for actual SDK, no 403 or broadening needed. Recipient delivery/inbox NOT independently confirmed. Full public health compatibility passed and form config includes required requesterEmail migration. Verification guard disarmed; final ZIP deploy and cleanup/conditional enable next.

---

# Historical production API route restoration

Historical status: Deployed (not current email activation)

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
