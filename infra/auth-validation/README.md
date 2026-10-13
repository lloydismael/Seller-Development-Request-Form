# Isolated SWA authentication validation — scaffold only

Approved scope: a new `rg-booking-authcheck-8941` in Primary Subscription
`2a77b3d9-39da-4b42-8219-c6fd9b8a6165`, with Standard test SWA in East Asia,
empty Node22 FC1 Functions and keyless runtime storage in Southeast Asia.
Production templates, domain, data and permissions remain unchanged.

## Separate stages

1. Compile `main.bicep` and `link.bicep`; review full subscription what-if for
   `main.bicep` with `main.parameters.json`. Confirm subscription, names, policies,
   permissions and regional capacity. Obtain explicit provisioning approval.
2. Provision **only main**: no booking source, secrets or production Table role.
   Public host reachability is needed for supported linking. An empty host is not
   authentication proof. No automatic code publication, frontend deployment or link.
3. Review link what-if and separately approve **test-only** `link.bicep`.
   Read the service-created `authsettingsV2` SWA provider, required authentication,
   HTTPS, unauthenticated rejection and exclusions. Do not display tokens/settings
   unrelated to authentication metadata.
4. Require direct anonymous and forged `x-ms-client-principal` requests to reject
   401/403. A 404, redirect, 200 or 5xx does not pass. If rejected or incompatible,
   halt without disabling protections or moving production routing.
5. Only after protection proof and separate publication approval may a harmless,
   data-free probe be published. Verify positive access through the test SWA and
   negative direct access again. This scaffold includes no probe source/package.
6. Record the actual binding and its relationship to test site metadata. A binding
   is site-specific: do not copy it to production or infer authoritative derivation
   from one observation. Resolve production applicability before changing production.
7. Report ongoing costs. Cleanup requires explicit approval and ownership inventory;
   never delete `PersonalRG`, production storage or resources based only on tags.

## Cost and limitations

Illustrative retained-month estimate: USD9.1584 (~USD9.16): test Standard SWA9,
1000 on-demand calls at2GB/1second0.0744, runtime Blob allowance0.074, runtime Table
allowance0.01. No always-ready instances, grants assumed or Application Insights
resources; the test is an empty-host authentication observation, not production.
Taxes, bandwidth, extra storage, diagnostic transactions and overruns excluded;
not a cap, billing-proration guarantee or current capacity proof.

Pinned existing hosting/runtime storage modules are reused without editing them.
No account keys, SAS, app passwords, production endpoints, production data roles,
GitHub integration or backend authentication identifier are embedded.
Latest advertised site/Static Web App APIs are used; runtime storage retains its
existing documented API. Compilation alone does not establish provider validation,
Flex/SWA compatibility, binding correctness, security rejection or capacity.