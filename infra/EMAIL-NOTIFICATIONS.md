# Opt-in transactional email: deployment plan and runbook

**Deployed and enabled — verified 2026-10-21 00:09 +08:00 (2026-10-20 UTC).** Domain: `bookingnotification.clouditechsolution.com`; sender: `noreply@bookingnotification.clouditechsolution.com`. Target: Primary Subscription `2a77b3d9-39da-4b42-8219-c6fd9b8a6165` / PersonalRG / existing `func-booking-prod-8941`. One authorized verification email accepted; provider operation Succeeded; recipient delivery/inbox not independently confirmed. No production booking/staff profile mutations. Never test mutations against localhost: it may use live Table data.

## High-importance code-only update — 2026-10-21 00:25 +08:00

Successfully deployed=true to existing `func-booking-prod-8941` using API-only ZIP/remote build. Active deployment `28e35d73-0a2d-4d62-8ffb-f842072fdab1`, status 4/success, complete=true; completed `2026-10-20T16:25:41.5513123Z`. ZIP SHA256 `C10DF5E1540E12F2F195AA7E6229E0B569B5E94BFE4B20742C1930BC31DF2463` (22 files, 53154 bytes). Every ZIP entry matched source; exact notification payload includes `Importance: high`, `X-Priority: 1`, `X-MSMail-Priority: High` for future notifications. Canonical/staged build passed; 22 notification + 3 integration = 25 targeted tests and all 303 isolated tests passed.

Post-publish: HTTPS health 200/table and compatibility pass; direct/forged principal and anonymous booking requests 401; 15-second timer registered; verifier absent. All 19 app settings, enabled EMAIL flag, slot flags, identity, Function config, authsettingsV2 and SWA link privately compared unchanged. Existing storage/Insights/dedicated ACS-scoped roles verified; no settings/RBAC/DNS/infrastructure writes, test sends, verification rows or production booking/account mutations performed. No commit. Gmail controls Important labeling; these headers do not guarantee a Gmail label or modify previously delivered email. Proof: active-session `deploy-result.json` highImportanceRelease and `high-importance-release/package-proof.json`.

## Current deployed result — supersedes earlier failed attempt

- User explicitly approved retry, API-version fix/revalidation, scoped residual ACS configuration-write role, exactly one email to `lloydismael@gmail.com`; earlier US/cost/lifecycle/DNS approvals preserved. Exact Microsoft Learn schemas and live provider metadata validated all four Communication resource APIs at stable `2025-09-01`. Only API-version strings changed in Bicep.
- Fresh azure-validate workflow completed with actual helper/build/ARM validation/preview/policy/static role proof. Both domain and sender helper runs OVERALL PASS; 302 tests passed, zero failures; editor diagnostics clean. Domain preview exactly two creates; sender full preview four creates and ECS/domain NoChange; no existing resource modify/delete.
- ARM deployments `email-domain-retry-20261020` and `email-sender-20261020` Succeeded. Dedicated ECS resource ID: `/subscriptions/2a77b3d9-39da-4b42-8219-c6fd9b8a6165/resourceGroups/PersonalRG/providers/Microsoft.Communication/emailServices/ecs-booking-notifications-8941`. Domain: ECS ID + `/domains/bookingnotification.clouditechsolution.com`; sender: domain ID + `/senderUsernames/noreply` (display name Booking notifications).
- Dedicated ACS resource ID: `/subscriptions/2a77b3d9-39da-4b42-8219-c6fd9b8a6165/resourceGroups/PersonalRG/providers/Microsoft.Communication/communicationServices/acs-booking-notifications-8941`. Endpoint `https://acs-booking-notifications-8941.unitedstates.communication.azure.com`; United States geography; local auth disabled; exact domain linked.
- Role definition `7e8f0667-c654-58be-9f24-c0101730c573`; live canonical ID `/subscriptions/2a77b3d9-39da-4b42-8219-c6fd9b8a6165/providers/Microsoft.Authorization/roleDefinitions/7e8f0667-c654-58be-9f24-c0101730c573`. Assignment `81ee39b7-5a41-5f2b-9d4e-a50bef027df3` scoped only to dedicated ACS, existing system identity `b6cba273-1a08-4d52-b276-929342469e8d`. Exact approved actions: CommunicationServices Read/Write and EmailServices/write; no keys/delete/RBAC actions. Actual hosted SDK/MI succeeded without 403 or privilege broadening.
- Azure DNS existing zone preserved. Only absent notification labels added: TXT `bookingnotification` ownership `ms-domain-verification=a69dc544-eed9-4fc0-b282-02e373eaef7e` and single SPF `v=spf1 include:spf.protection.outlook.com -all`; CNAME `selector1-azurecomm-prod-net._domainkey.bookingnotification` → `selector1-azurecomm-prod-net._domainkey.azurecomm.net`, selector2 analogously; TTL 3600. Authoritative/1.1.1.1 probes passed; initial 8.8.8.8 selector2 NXDOMAIN resolved by final actual probe. Sender-stage domain PUT reset verification despite preview NoChange: all four verification actions rerun, live Domain/SPF/DKIM/DKIM2 Verified/errorCode None. DMARC absent at parent/subdomain and left unchanged; no enforcement/reporting policy invented. DMARC remains optional follow-up, not claimed verified.
- Final API-only remote-build ZIP: 22 entries, 53112 bytes, SHA256 `C63F98A648387E0FF4328D0851FA150B8C8AB44619B2F4EF5975187FD5B579CD`. Temporary verifier package: 23 entries/54537 bytes/SHA256 `5FDCC1808C947C14F40D080886E089BB3AAC29C19698671B95EC244C927F6936`. ZIP paths, inventory and uncompressed hashes independently verified; canonical generated assets included and packaged build passed; no local settings/tests/node_modules packaged. Final deployment removed temporary verifier.
- Settings merged, never wholesale replaced: all 15 pre-existing secret/settings values and slot flags privately compared unchanged; activation preserved all 18 other current settings. Final EMAIL_NOTIFICATIONS_ENABLED=`true`, EMAIL_ENDPOINT=`https://acs-booking-notifications-8941.unitedstates.communication.azure.com`, EMAIL_SENDER_ADDRESS=`noreply@bookingnotification.clouditechsolution.com`, EMAIL_PUBLIC_ORIGIN=`https://sellerdevelopmentrf.clouditechsolution.com`. Verification guard setting removed. System MI used; no email credentials added.
- **Exactly one authorized verification message**: hosted EmailClient/ManagedIdentityCredential, SDK retries disabled, durable ETag claim in isolated SdrfBookings partition `email-verification` (not a fake production booking). Message/provider operation ID `6bcb353f-3705-40ef-9fc7-fbf6d8811eca`; accepted=true, provider Succeeded. Started `2026-10-20T16:04:00.414Z`, accepted `16:04:02.184Z`, completed `16:04:06.151Z`; 5737 ms. Provider completion is NOT recipient/inbox delivery confirmation. No repeat send on deployment or test retries.
- Verification guard disarmed before final publish; verifier absent from final trigger inventory; exact isolated test entity deleted and absence verified. No throttle row wiped, no booking/account reads or mutations. Proof retained in active-session `email-verification-result.json`.
- Production `https://sellerdevelopmentrf.clouditechsolution.com/api/health` 200/table and capability contract passed. Published form config has one required `requesterEmail` of type email; normal API CAS migration applied without overwriting unrelated form configuration. Existing frontend app.js email support confirmed; no frontend publish. Direct backend and forged admin-principal health/auth requests 401; anonymous booking route 401. Existing authsettingsV2 and SWA backend link remain enabled/required/Return401/Succeeded.
- Live `emailNotifications` timer registered (15-second schedule). App Insights recorded 16 executions, zero failed, latest `2026-10-20T16:08:45Z`; after enable no matching worker-failed traces in bounded query (telemetry can lag; no production notification event exercised). No commit made.
- Remaining recommendations: select dedicated DMARC policy, monitor recipient delivery events/bounces and costs, validate real enabled staff profiles through normal admin UI, and plan replacement before approved 2028-09-30 retirement. No fixed monthly estimate or inbox-delivery claim.

## Historical first failed activation attempt — 2026-10-20 (superseded; not current state)

- User approved new resources, usage charges, United States email geography, ACS Email retirement dependency and additive Azure DNS configuration. Explicit consent to residual ACS configuration-write privilege and one-email test recipient remains outstanding.
- Registered `Microsoft.Communication` in the approved subscription; registration state `Registered`. Provider metadata confirms global ECS/ACS availability. Official retirement FAQ rechecked: new ACS Email onboarding currently allowed, subject to change; retirement remains 2028-09-30.
- API canonical asset build and all 302 isolated tests passed; editor diagnostics clean. Mandatory validation helper reported OVERALL PASS for domain stage. Actual what-if showed only ECS/domain creates, no modification or deletion. Windows PowerShell enum incompatibility handled by a session-only workflow copy preserving every validation step; installed skills unchanged.
- **Deployment failed:** `/subscriptions/2a77b3d9-39da-4b42-8219-c6fd9b8a6165/resourceGroups/PersonalRG/providers/Microsoft.Resources/deployments/email-domain-20261020` reports `Failed`, `NoRegisteredProviderFound`: ECS `2025-05-01` is not accepted by the live resource provider despite ARM preflight success. Provider supports stable `2025-09-01` and `2026-03-18` for ECS, domains and senderUsernames. Revalidate corrected template before a user-authorized retry. No ECS/domain/ACS/custom role/assignment exists from this attempt; no cleanup deletion needed.
- Intended resource IDs (NOT CREATED): `/subscriptions/2a77b3d9-39da-4b42-8219-c6fd9b8a6165/resourceGroups/PersonalRG/providers/Microsoft.Communication/emailServices/ecs-booking-notifications-8941`; proposed domain is that ID plus `/domains/bookingnotification.clouditechsolution.com`; dedicated ACS proposed as same RG `/providers/Microsoft.Communication/communicationServices/acs-booking-notifications-8941`.
- Public NS delegation matches existing Azure zone `/subscriptions/2a77b3d9-39da-4b42-8219-c6fd9b8a6165/resourceGroups/personalrg/providers/Microsoft.Network/dnszones/clouditechsolution.com`. No delegated notification subzone, notification records, parent SPF or parent DMARC found. Existing TXT verification records preserved. No DNS writes performed. Choose dedicated subdomain DMARC policy explicitly before creating one; no reporting mailbox assumed.
- Function remains Running/node22/Flex with system identity `b6cba273-1a08-4d52-b276-929342469e8d`; auth enabled/required, Return401, SWA provider enabled and linked backend Succeeded. Direct health and forged-principal auth probe both 401; SWA health 200 at `https://sellerdevelopmentrf.clouditechsolution.com/api/health`. No credential login attempted.
- Email settings read selectively only: ENABLED, ENDPOINT, SENDER_ADDRESS and PUBLIC_ORIGIN all absent. Effective notifications enabled = **false**. API ZIP not published; timer `emailNotifications` is not live. Endpoint not provisioned; provider acceptance and inbox delivery **not tested**. No helper services started. No commit made.
- Remaining: retry supported API after fresh validation; domain/DNS verification; explicit residual RBAC-write consent; sender/link/role stage; API-only verified ZIP publish and disabled-only settings merge; approved single-recipient managed-identity SDK test; then enable. Usage pricing and expected fan-out still need recorded actual meter evidence; no unsupported fixed monthly estimate claimed.


## Blocking approvals and lifecycle warning (checked 20 October 2026)

- **Lifecycle:** the current [ACS retirement and breaking changes guide](https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide) explicitly lists **ACS Email as retiring on 30 September 2028**, announced September 2026. It is not just a calling SDK breaking change. Onboarding/expansion restrictions for retiring services begin 23 October 2026; the guide initially specifies number acquisition/PSTN/SMS restrictions and says additional expansion restrictions may follow. Do not infer email onboarding is guaranteed. Recheck subscription eligibility with Azure before approval, obtain explicit acceptance of this temporary dependency, name a migration owner, and plan replacement well before retirement. The guide lists Exchange Online and Microsoft 365 HVE (internal only) alternatives; assess external-recipient suitability separately. Do not send customer data to another provider during evaluation.
- **Data geography:** the official [ECS creation guide](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/create-email-communication-resource) uses `location: global`, `dataLocation: United States`. This template deliberately permits only that documented geography. It does **not** promise Southeast Asia residency because the existing Function/Storage may run there. Obtain explicit approval for recipient addresses and notification contents to traverse/process in this service geography, review [ACS privacy/data residency](https://learn.microsoft.com/en-us/azure/communication-services/concepts/privacy), and confirm current availability/subscription policy before deployment. ACS and ECS must use the **same geography** to link domains. Global resource location is not proof of local data residency.
- **Costs:** approve the budget, expected recipient fan-out, existing Table/Function/telemetry incremental charges, and monitoring retention separately. No spending approval is implied by adding these files.
- **Domain:** supply a real DNS domain or dedicated notification subdomain that the operator controls, with authority to add authentication records. No placeholder domain should be deployed. A dedicated subdomain avoids disrupting existing mail policies.

The template defaults `enabled=false`. Explicit `unitedStatesDataConsent=true`, `costApproved=true`, and `retirementRiskAccepted=true` are required parameters, constrained to true. These are deliberate operator attestations, not automated policy/compliance assessments. `enabled=false` in incremental mode does not delete previously deployed resources or disable the runtime worker.

## Scope and prerequisites

Existing infrastructure remains authoritative:

- A **separately deployed and separately linked Azure Function app**, not Static Web Apps managed functions, with its existing timer-capable Functions host, storage, deployment pipeline, and Application Insights. Maintain the existing SWA-to-Function linking/authentication configuration unchanged.
- Enable/use an existing system-assigned managed identity, or a user-assigned identity already attached to that Function. Supply its **principal/object ID**, not application/client ID, to Bicep. Verify identity ownership/tenant in the Function portal. The template neither enables nor changes Function identity.
- Reuse the existing Azure Table booking storage and existing storage authorization for a durable transactional outbox. No new queue, storage account, database, Function plan, or App Insights resource is required at initial scale. Ensure the Function host's existing storage and the booking Table remain available to the timer.
- Deployer permissions: resource-group deployment write/read, ECS/domain/sender and dedicated ACS write/read; domain verification action; `Microsoft.Authorization/roleDefinitions/write` at the target group and `roleAssignments/write` at the ACS scope. Contributor alone cannot create role definitions/assignments. An authorized Owner or equivalent scoped combination of resource management and access administration must approve; respect any delegated-role conditions/policies. Provider registration, if needed, requires subscription permission for `Microsoft.Communication/register/action`. DNS changes require separate DNS-zone authority. Configuration merge requires Function configuration write permission.
- Use an existing resource group and distinct, unused ECS/ACS names. **Do not point this template at an existing shared ACS resource**: `linkedDomains` and `disableLocalAuth` are managed as a complete desired configuration for this new dedicated resource.

### Resources and supported authorization limits

| Resource | Purpose |
| --- | --- |
| `Microsoft.Communication/emailServices` | ECS holding the approved geography |
| `emailServices/domains` | Customer-managed DNS domain; engagement tracking disabled |
| `domains/senderUsernames` | `noreply` sender identity, after DNS verification |
| `Microsoft.Communication/communicationServices` | Dedicated email SDK endpoint, linked only to this domain; access-key authentication disabled |
| `Microsoft.Authorization/roleDefinitions` / `roleAssignments` | Custom documented email permissions, assigned only to this dedicated ACS resource and existing Function identity |

**RBAC caveat:** no built-in role named “Communication Services Email Sender” or `Email/Send/action` permission was verified in the current official [provider action catalog](https://learn.microsoft.com/en-us/azure/role-based-access-control/permissions/integration#microsoftcommunication). Do not invent a GUID or data action. The [official SMTP authorization guide](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email-smtp/smtp-authentication) documents the custom action set `Microsoft.Communication/CommunicationServices/Read`, `Microsoft.Communication/CommunicationServices/Write`, and `Microsoft.Communication/EmailServices/write` at the ACS scope. Bicep uses exactly that set and deterministic `guid(...)` for this **new custom role**, not an alleged built-in role ID. It excludes key listing/regeneration, delete, and RBAC administration. Assignable scope is the group; effective assignment is only the dedicated ACS resource, not ECS or the Function.

This is the narrow documented email role rather than Owner/Contributor, but **not a pure send-only role**: ACS write still permits ACS configuration changes. Accept that residual privilege explicitly; isolate the resource. The cited custom-role walkthrough is SMTP-specific, while this worker uses SDK Microsoft Entra authentication supported by the [authentication guide](https://learn.microsoft.com/en-us/azure/communication-services/concepts/authentication) and [email SDK quickstart](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email). Perform an authorized non-production SDK/managed-identity permission smoke test before enabling; if a 403 persists after propagation, investigate the precise required action with Microsoft support. Do not silently broaden to Owner, introduce credentials, or claim live authorization has been verified.

## Deployment phases (operator only)

### Phase 0 — prepare, price, and approve

1. Choose actual resource names, DNS domain/subdomain, subscription/group, existing Function identity, production HTTPS origin, retirement migration plan, and geography/cost consent.
2. Review the domain's current SPF/DMARC policies and DNS ownership. Verify subscription eligibility and current regional availability without provisioning.
3. Compile only this file locally; no login or Azure deployment is needed:

```powershell
az bicep build --file infra\email-notifications.bicep --stdout | Out-Null
```

4. After approval, use group **incremental** mode. Never use complete mode against the shared application group. Keep names/identity stable across stages. Example below is a parameter pattern, **not an executed deployment**; replace all angle-bracket values with approved real values:

```powershell
$subscription = '<approved-subscription-id>'
$group = '<existing-resource-group>'
$params = @(
  'enabled=true'
  'unitedStatesDataConsent=true'
  'costApproved=true'
  'retirementRiskAccepted=true'
  'provisioningStage=domain'
  'emailServiceName=<new-ecs-name>'
  'communicationServiceName=<new-dedicated-acs-name>'
  'senderDomain=<actual-owned-dns-domain>'
  'functionManagedIdentityPrincipalId=<existing-function-identity-object-id>'
)
az deployment group what-if --subscription $subscription --resource-group $group --mode Incremental --template-file infra\email-notifications.bicep --parameters $params
# Only after reviewing the preview and obtaining deployment approval:
az deployment group create --subscription $subscription --resource-group $group --name email-domain --mode Incremental --template-file infra\email-notifications.bicep --parameters $params
```

### Phase 1 — provision ECS and domain only

`provisioningStage=domain` creates only ECS and the customer-managed domain. Outputs expose the actual service-generated DNS verification records and current states. ARM provisioning success **does not mean DNS is verified**. Bicep cannot set read-only verification states or manufacture domain ownership. It intentionally does not create/link ACS or grant sender access in this stage.

### Phase 2 — publish and verify DNS outside Bicep

Follow [custom domain verification](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/add-custom-verified-domains) in ECS **Provision domains**:

| Record | Operator action |
| --- | --- |
| Ownership TXT | Copy the exact generated Domain record name/value/TTL; add to the correct zone and initiate ownership verification. |
| SPF TXT | Use the exact generated SPF record. Merge authorized sources into the existing **single** `v=spf1` record at that label; do not add a second SPF record or overwrite existing senders. Check SPF lookup limits. |
| DKIM and DKIM2 CNAME | Publish both exact generated selectors and targets in the correct subdomain; do not copy another domain's selectors or guess targets. |
| DMARC TXT | Review/create the applicable `_dmarc` policy with the DNS/mail owner; use the service-provided guidance/record if present, check SPF/DKIM alignment, and stage enforcement safely (monitor before quarantine/reject). Do not weaken a parent's existing policy. Only configure reporting addresses backed by a real monitored mailbox. |

DNS providers differ on relative names, apex `@`, trailing dots, and automatic zone suffixes. Verify public resolution and avoid doubled subdomain names. The guide suggests 15–30 minutes; actual propagation can take longer. Initiate the portal verification actions and wait until **Domain, SPF, DKIM, DKIM2 all show `Verified`**. DMARC policy review is additionally required; do not treat an ownership TXT check alone as sender authentication. No DNS zones, records, verification scripts, or credentials are provisioned by this template.

### Phase 3 — sender, domain link, scoped RBAC

1. Recheck DNS verification and retirement/availability constraints. Only now replace the stage parameter while retaining every other parameter:

```powershell
$params = $params | Where-Object { $_ -notlike 'provisioningStage=*' }
$params += 'provisioningStage=sender'
az deployment group what-if --subscription $subscription --resource-group $group --mode Incremental --template-file infra\email-notifications.bicep --parameters $params
# After separate approval of this preview:
az deployment group create --subscription $subscription --resource-group $group --name email-sender --mode Incremental --template-file infra\email-notifications.bicep --parameters $params
```

2. Creates `noreply`, dedicated ACS with `linkedDomains`, the custom role and Function identity assignment. Azure must accept the verified link; the stage parameter is an operator checkpoint, not a substitute for DNS verification. See [linking requirements](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/connect-email-communication-resource). Both services use United States geography.
3. Read `emailEndpoint` and `emailSenderAddress` outputs, check the linked domain and sender in the portal, allow RBAC propagation, and verify managed-identity SDK authorization in an approved non-production environment.

**Sending identity is not a mailbox.** `noreply@<owned-domain>` can send only. ECS/ACS does not host incoming email or create MX/mailbox service. Replies cannot be received at that address unless a separate mailbox/mail service and appropriate MX routing are configured. Use a real separately provisioned mailbox for any future Reply-To feature; never imply the sender username provides reply handling.

### Phase 4 — deploy runtime and merge configuration

Deploy the related Function/API and SDK dependency changes through the existing pipeline, separately from this template. The existing requester form automatically migrates existing published/draft form versions by CAS on the next real API load **after that API is deployed**; there is no infrastructure-triggered migration or legacy email backfill.

In the existing Function portal, **Settings → Environment variables / Application settings**, add/edit only the following entries and retain all existing values, secrets, slot flags, host storage, Table settings, auth, and Application Insights settings. Review before Save; configuration saves may restart the app. No `Microsoft.Web/sites/config` resource is included: writing `appsettings` as a partial ARM dictionary can replace the entire dictionary. Do not use a wholesale settings replacement or print existing secret values into logs.

| Setting | Value |
| --- | --- |
| `EMAIL_NOTIFICATIONS_ENABLED` | Initially `false`; set `true` only after all approved tests/gates pass |
| `EMAIL_ENDPOINT` | `emailEndpoint` output: dedicated **ACS**, not ECS, HTTPS endpoint |
| `EMAIL_SENDER_ADDRESS` | Exact `emailSenderAddress` output |
| `EMAIL_PUBLIC_ORIGIN` | Approved public HTTPS booking application origin, never an arbitrary request Host or localhost |
| `EMAIL_MANAGED_IDENTITY_CLIENT_ID` | Optional client ID for the existing attached user-assigned identity; omit for system-assigned identity (distinct from Bicep principal ID) |
| `EMAIL_MAX_PER_MINUTE` / `EMAIL_MAX_PER_HOUR` | Optional; worker defaults **10 / 50**, below default custom-domain quotas |

No connection string, access key, client secret, or SMTP password is needed for email. The worker authenticates using managed identity. Existing Table/host credentials, if any, remain under their existing configuration; this template does not migrate them.

### Phase 5 — enable only approved transactional events

| Event | Recipients |
| --- | --- |
| New request | All enabled admin and supervisor accounts with valid profile email addresses |
| Request approved/rejected | Requester's required **Your Email** (`requesterEmail`) |
| New facilitator assignment | Assigned enabled facilitator with a valid profile email |
| Management approval | Assigned enabled facilitator with a valid profile email |

Validate requester email server-side as well as in the form. Verify **every enabled account needing notifications** has a valid email under the existing management account profile UI. Skip unavailable/invalid recipient addresses; do not infer email from a username, fabricate recipients, or backfill existing requests. Legacy requests without requester email are skipped. Send individual recipient notifications to avoid exposing other addresses; deduplicate event/recipient work, keep sensitive request detail minimal, and link to the existing authenticated application. Notifications never change booking authorization or bypass login.

## Durable worker, retry, and observability plan

The existing Table booking partition holds both bookings and outbox entities. Persist the booking transition and its notification intents transactionally in the same partition; deduplicate event/recipient intents and use Table ETags for concurrency. The runtime caps notification entities at 90 per transition (including an optional skipped-recipient operational summary), reserving 10 Table transaction slots for booking/schedule/invitation guards. Exceeding capacity returns `503` without a partial booking/outbox commit; do not silently drop recipients or split the transaction unsafely. No in-memory-only queue or queue service is required. Mixed entity queries must filter `recordType=email-notification`; `email-throttle` is a separate shared control row, never a booking.

The existing Function timer `emailNotifications` runs every **15 seconds**. Actionable outbox states are `pending`, `retry`, `sending`, `accepted`; filter due times/expired leases **before limiting** a batch so future or terminal rows cannot starve due work. Claim/renew work via CAS; recheck versions when sending. Terminal states are `sent`, `failed`, `ambiguous`, `skipped`.

- Shared persisted sliding-window throttle/spacing spans instances: default sends 10/minute and 50/hour, operation status polls 20/minute and 100/hour. Confirm final worker settings before increasing any limits; other apps share subscription quotas.
- Automatically retry a send only for a definite pre-acceptance `429` rejection, honoring `Retry-After` and bounded exponential backoff/jitter. Network errors, `5xx`, or lost send responses become `ambiguous`, not automatically resent. Recoverable accepted-operation polling failures retry polling without another send POST. Explicit `400`/`401`/`403`/`404`/`413`/`422` failures are terminal `failed` and require correction. Retain attempts/next-due/lease/provider operation correlation for diagnosis.
- Persist accepted operation/poller information and **resume polling**, not resending. A lost response, crash after a possibly accepted send before persistence, expired sending lease without a recoverable operation ID, or uncertain provider outcome becomes **`ambiguous`** for manual investigation. Do not automatically resend ambiguous messages. SDK hidden retries must not turn uncertain sends into duplicates.
- No exactly-once promise across Table and an external email API. CAS/event IDs avoid known duplicate work, but the external send/persist gap still exists. Operators correlate operation IDs and telemetry before authorizing any new send; an intentional replay may duplicate a delivered message.
- `accepted` means ACS accepted work; `sent` means ACS **send operation `Succeeded`**, not inbox delivery. Neither proves recipient delivery or reading. Bounce/suppression/spam filtering can still occur. Use [email delivery status/diagnostic logs](https://learn.microsoft.com/en-us/azure/communication-services/concepts/analytics/enable-logging) or approved delivery-event integration to distinguish recipient delivery. There is no Event Grid subscription or ACS diagnostic setting created here. Add those separately only after cost/privacy approval; do not report delivery evidence until configured.
- Use existing Application Insights for timer failures, pending age/backlog, retries, throttling, accepted-operation age, failed/skipped counts, and **ambiguous** alerts. Correlate sanitized notification IDs/provider operation IDs without logging message bodies, secrets, full recipient lists, or requester PII. Review Table retention/cleanup and telemetry access. App Insights runtime logs alone are not provider delivery receipts.

## Verification checklist (no live mutation performed here)

Before enabling, run existing fake-provider/in-memory tests and locally compile this standalone Bicep. Do not start a live-data browser or invoke a live booking mutation merely to validate notifications.

- [ ] Disabled mode sends nothing and preserves booking behavior; invalid configuration fails safely.
- [ ] New-request fan-out covers all enabled admins/supervisors with valid emails; inactive/missing/invalid accounts are skipped.
- [ ] Approved/rejected targets required requester email; legacy missing requester email is skipped with no invented backfill.
- [ ] Facilitator assignment and management approval target the assigned enabled facilitator only; repeated no-op transitions do not duplicate intents.
- [ ] Atomic booking/outbox persistence and CAS conflicts preserve bookings; mixed Table queries exclude notification/throttle rows from booking listings.
- [ ] Multiple timer instances/restarts respect claims, leases, due-time selection and shared send/poll quotas; accepted work resumes polling.
- [ ] Fake 429, transient poll failures, permanent failures, lost send responses, and post-send persistence crashes exercise bounded retry vs manual ambiguity; success is not mislabeled delivered.
- [ ] An explicitly approved **non-production** Azure smoke test verifies DNS/link/sender/managed identity using controlled recipients, records operation status and independently checks delivery/bounce evidence. This incurs cost and is not performed by this runbook author.
- [ ] Pause by setting `EMAIL_NOTIFICATIONS_ENABLED=false` via configuration merge; retain outbox for investigation. Check the worker's disabled handling before re-enabling: skipped events are not assumed to replay.
- [ ] Roll back runtime through existing pipeline if needed. Never delete the application resource group. Retire the dedicated ACS/ECS/custom role/assignment only after reviewing dependencies and separately approving cleanup; retain required audit data.

## Quotas and verified pricing

The [official service limits](https://learn.microsoft.com/en-us/azure/communication-services/concepts/service-limits#email) list initial **custom domain, per-subscription** limits: send 30/minute and 100/hour; get status 60/minute and 200/hour. They are not per Function or per resource. Azure-managed domains have lower non-increasable limits, so this plan intentionally uses a verified custom domain. Current limits include 50 recipients/message and 10 MB request size. Request [quota increases](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email/email-quota-increase) only after reviewing eligibility, warming domain reputation over 2–4 weeks, monitoring failure rates, and obtaining approval. Higher limits are not automatically granted.

Official [email pricing](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing) documents base rates **USD $0.00025 per email recipient send + $0.00012 per MB transferred to each recipient**, including headers/content/attachments. Its examples warn prices may change. These base rates were also verified on 20 October 2026 against the public Microsoft [Azure Retail Prices API](https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Email%27%20and%20armRegionName%20eq%20%27westus%27%20and%20priceType%20eq%20%27Consumption%27): `Email / Basic Sent Email`, unit `1`, $0.00025; `Email / Basic Data Transferred`, unit `1 MB`, $0.00012, both USD. `westus` is the retrieved meter reference, **not a claim of ECS West US residency or availability**. Recheck the actual subscription/offer, tax, currency, retirement pricing, and [pricing page](https://azure.microsoft.com/en-us/pricing/details/communication-services/) before spending approval.

Budget estimate: recipient sends × $0.00025 + total recipient-transferred MB × $0.00012, plus existing Table operations/capacity, Function executions/hosting, telemetry ingestion/retention, and any DNS/domain/mailbox fees. Fan-out counts each recipient and retries can add cost. These are verified public base rates, not a binding quote or a total deployment cost. Set an approved Azure budget/alerts separately; budget alerts do not enforce a hard spend cap.

## Schema provenance and validation

Exact schemas fetched through Azure MCP `bicepschema_get` before generation:

- [ECS `2025-05-01`](https://learn.microsoft.com/en-us/azure/templates/microsoft.communication/2025-05-01/emailservices): `location`, `properties.dataLocation`.
- [Domains `2025-05-01`](https://learn.microsoft.com/en-us/azure/templates/microsoft.communication/2025-05-01/emailservices/domains): customer management/tracking writable; verification records/states and sender domain names read-only.
- [Sender usernames `2025-05-01`](https://learn.microsoft.com/en-us/azure/templates/microsoft.communication/2025-05-01/emailservices/domains/senderusernames): `properties.username`, `displayName`.
- [ACS `2025-05-01`](https://learn.microsoft.com/en-us/azure/templates/microsoft.communication/2025-05-01/communicationservices): `dataLocation`, `linkedDomains`, `disableLocalAuth`, `publicNetworkAccess`; `hostName` read-only.
- [Role definitions `2022-04-01`](https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/2022-04-01/roledefinitions) and [assignments `2022-04-01`](https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/2022-04-01/roleassignments): custom action set, group assignable scope, ACS assignment, `ServicePrincipal`.

Local validation uses installed Bicep CLI 0.48.1: `az bicep build --file infra\email-notifications.bicep --stdout`. No Azure what-if/deployment, DNS update, Function setting update, HTTP mutation, or actual send is part of this validation. Compilation checks syntax/type schema only; it does not establish provider availability, DNS ownership, effective RBAC, delivery, or production readiness.
