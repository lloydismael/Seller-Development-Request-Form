# Azure DevOps implementation plan

## Scope and decisions

Prepared: 2026-10-21. Status: proposal; implementation and resource changes are not authorized.

- Keep `lloydismael/Seller-Development-Request-Form` in GitHub.
- Adopt Azure DevOps Services for Boards, Pipelines, release approvals, test reporting and delivery traceability.
- Use two environments: **development** and **production**. No staging environment.
- Retain the existing static frontend, independent Azure Functions API, Table Storage, authentication and notification architecture.
- Exclude application-to-Boards integration: bookings must not automatically become work items or expose customer data to DevOps.
- Do not migrate to Azure Repos, introduce containers, replace the application framework or use Azure Artifacts as a dependency feed without a separate need.

## Repository findings and constraints

| Evidence | Implication |
|---|---|
| `app/` is the deployed frontend; root-level frontend files also exist | Package `app/` only, not the repository root. |
| `api/package.json` uses Node >=22, Functions v4, `npm run build` and Node's test runner; a lockfile exists | Pin CI to Node 22 and restore with `npm ci` from `api/`. |
| `api/scripts/build-form-assets.js` copies four canonical assets from `app/` | Build before API packaging; include generated assets and verify their hashes. |
| Production GitHub workflow deploys only the frontend with empty `api_location` | Preserve independent backend deployment and backend-first ordering. |
| Production workflow uses a GitHub identity token; comments identify GitHub deployment authorization policy | Azure DevOps SWA task token deployment requires a reviewed deployment-policy cutover; ARM federation alone does not replace the SWA token. |
| API uses Flex Consumption (`FC1`) and Node 22 in existing Bicep | Validate a Flex-supported OneDeploy/remote-build path; do not assume classic ZIP deployment or deployment slots. |
| `check-production-compatibility.js` hardcodes the production custom domain | Parameterize the target URL with a production-safe default and test URL validation before reusing the checker for development. |
| Existing Bicep restricts production group, SWA and application storage names | Do not reuse production parameters to create development; add explicitly isolated development infrastructure. |
| `production-deploy.cjs` references ignored session dependencies and a fixed subscription | Not CI-portable. Create a reviewed portable automation path rather than invoking this helper unchanged. |
| Older readiness documents describe an outage; newer release evidence records successful deployments | Refresh the baseline before implementation. Do not treat either historical document as a live resource check. |

Source review only: no Azure inventory, pipeline execution, deployment, tests or production probes were performed for this plan. The existing modified `.azure/deployment-plan.md` was left unchanged.

## Target delivery model

GitHub pull request → credential-free CI → required status check → merge to protected `main` → build a versioned release bundle → deploy development API → verify API compatibility → deploy development frontend → acceptance checks → independent production approval → deploy production API → verify compatibility → deploy production frontend → read-only production verification.

Each release links an Azure Boards work item, GitHub PR/commit, pipeline run, artifact hashes and environment deployment record. Production consumes the exact release bundle that passed development, without checking out or rebuilding a newer commit. Functions remote build may restore dependencies server-side; record the lockfile and build evidence and do not describe the source ZIP as a byte-identical runtime image.

## Phase 1 — Baseline and project setup

**Owner:** application owner and DevOps administrator. **Estimate:** 1–2 working days.

1. Confirm Azure DevOps organization/project, tenant, production resource IDs, resource owners, approvers, budget and agent availability.
2. Inventory current SWA deployment policy, backend link, Function runtime/identity/authentication, storage roles and notification flags. Record redacted metadata only; never copy secrets, booking records or ignored session snapshots into artifacts.
3. Create a private Azure DevOps project, scoped groups and an initial delivery dashboard.
4. Connect GitHub through the Azure Pipelines GitHub App and Azure Boards GitHub App, restricted to this repository.
5. Configure Boards areas for Frontend, API, Infrastructure and Operations; establish iterations and a Definition of Done requiring tests and release evidence.
6. Link work with `AB#<work-item-id>` in PR descriptions. Document the behavior of closing keywords before adopting them.
7. Retain protected `main` with short-lived feature branches; require review, successful CI and code-owner review for pipeline/IaC changes. Do not add a permanent development branch by default.

**Exit:** connections work, access owners are identified, and a sample work item links to a GitHub PR without transferring booking data.

## Phase 2 — Credential-free continuous integration

**Owner:** application maintainer. **Estimate:** 2–3 working days. **Depends on:** Phase 1.

1. Add a root `azure-pipelines.yml` with explicit GitHub PR and `main` triggers. Use a hosted agent and pinned Node 22; the SWA deployment job requires a supported Linux/Docker-capable agent.
2. Run `npm ci`, `npm run build` and the existing Node tests from `api/`. For the integration baseline use `node --test --test-concurrency=1 test/*.test.js`, consistent with recorded serialized runs; optimize only after isolation is proven.
3. Ensure tests use isolated local data and no live storage, email provider, production credentials or inherited `local.settings.json`.
4. Publish test results in a format Azure Pipelines supports. Verify whether the chosen Node 22 JUnit reporter output is accepted; use a small conversion step only if required. Preserve the existing Node test runner.
5. Run existing packaging tests and existing infrastructure structural/regression checks when applicable. Distinguish locally compiled checks from provider validation; report skipped checks truthfully. Inspect script portability and dependencies before choosing Windows or Linux jobs.
6. Add packaging and compatibility-check regression tests; use mocked HTTP for PR CI rather than contacting production.
7. Keep secrets and deployment service connections unavailable to PR jobs, especially fork PRs. Disable secret access from fork builds and prohibit deployment stages for PR events.
8. Require the Azure Pipelines status check in GitHub branch protection after a successful pilot run. Initially leave current production publishing unchanged.

**Exit:** a failing test blocks merge, a fork PR cannot deploy/read secrets, and test results are visible in Azure DevOps.

## Phase 3 — Release packaging and isolated development

**Owner:** maintainer and Azure platform administrator. **Estimate:** 3–5 working days. **Depends on:** Phase 2.

1. Add a portable package builder and manifest verifier following `PACKAGING.md`; reject symlinks/reparse points, unsafe archive names and unexpected entries.
2. Produce a frontend artifact containing only `app/`, including route configuration, admin/CSAT assets and vendored QR license.
3. Produce an API source ZIP containing only `host.json`, `package.json`, `package-lock.json` and complete `src/`. Exclude settings, tests, scripts, dependencies, local data, infrastructure and session files. Require `host.json` at ZIP root and portable slash-separated entry names.
4. Reopen the ZIP and verify exact inventory and per-entry SHA256. Publish a release manifest with commit SHA, pipeline ID, Node version, lockfile hash, package hashes and test summary.
5. After explicit cost/resource approval, create a separate development resource group with its own Standard SWA, Flex Function App, runtime/application storage and telemetry. Use synthetic records only and a distinct authenticated backend binding.
6. Keep development notification creation and email delivery disabled by default; never reuse production storage credentials, identity permissions, accounts or sender configuration.
7. Create separate development/production ARM service connections using workload identity federation. Limit pipeline authorization and Azure RBAC to the required targets. Separate routine code deployment permissions from infrastructure and role-assignment administration.
8. Manage SWA deployment tokens as environment-scoped protected secrets. Use Key Vault-backed variable groups where appropriate and authorized; establish rotation and log-redaction procedures. Do not put runtime admin/session secrets into build jobs.
9. Add an explicitly isolated development Bicep entry/parameters. Reuse suitable modules without weakening production constraints or recreating existing production resources. Validate compilation, ARM validation and what-if before approved provisioning.
10. Validate linked API authentication: anonymous/direct and forged-principal requests must fail; legitimate same-origin authenticated requests must succeed. CORS is not an authentication control.

**Exit:** development works independently, API packages pass inventory checks, and pipeline identities cannot access production booking data through development.

## Phase 4 — Development deployment and acceptance

**Owner:** maintainer and QA. **Estimate:** 2–3 working days. **Depends on:** Phase 3.

1. On successful protected-main builds, publish one release bundle and deploy its API first using a verified Flex-compatible deployment mechanism with remote build and deployment-completion polling.
2. Run the environment-aware compatibility checker through the development SWA proxy after the linked backend is ready. Gate frontend publication on storage and protocol/capability compatibility, not HTTP 200 alone.
3. Deploy the prebuilt frontend artifact with `AzureStaticWebApp@0`, `skip_app_build: true`, empty `output_location`, and empty `api_location`. Supply the development token only inside the authorized deployment job.
4. Execute development acceptance tests for booking validation, pending-versus-confirmed reservations, conflicts, admin login/roles, form publication, CSAT/QR sharing and notification outbox behavior with delivery disabled.
5. Validate asset availability and protected-route negative tests. Store only sanitized summaries, not cookies, tokens, request details or sharing URLs.
6. Establish a repeatable rollback drill using the last known-good compatible API/frontend pair. Form publication and Table schema/data migrations require separate decisions; a code redeploy does not undo stored data.

**Exit:** the same release bundle passes development deployment, acceptance and rollback rehearsal; no real emails or production mutations occur.

## Phase 5 — Production governance and CI/CD cutover

**Owner:** release owner and Azure administrator. **Estimate:** 2–3 working days. **Depends on:** Phase 4.

1. Create Azure Pipelines `development` and `production` environments using deployment jobs. Configure production approvals/checks outside YAML so application authors cannot remove them in a PR.
2. Require independent approval, protected-main source, development success, explicit artifact/run identification and exclusive release locking. Restrict who can bypass checks; disable self-approval where supported.
3. Keep infrastructure, authentication/linking changes, notification activation and data migrations outside routine code-release stages. Require distinct approvals and reviewed what-if for those changes.
4. Test token-based SWA deployment in development. Confirm production is still using GitHub deployment authorization before changing anything.
5. Schedule cutover: freeze releases, retain a known-good bundle, quiesce GitHub publishing including in-flight runs, approve the SWA deployment-policy change, then enable Azure DevOps production deployment. Do not allow competing publishers.
6. Deploy the approved API artifact, verify deployment completion and compatibility, then deploy the matching frontend. Backend-first changes must remain compatible with the currently served frontend; use expand/contract changes for breaking contracts.
7. Run read-only production health/compatibility, asset hashes, anonymous/forged-principal rejection and approved protected reads. Do not create bookings, publish forms, mutate outbox rows or send email as automatic production smoke tests.
8. Compare redacted identity/authentication/link/settings metadata against the reviewed baseline. Preserve existing email flags and storage configuration.
9. After acceptance, disable production publishing in the existing GitHub workflow; replace its preview behavior with credential-free validation or an explicitly approved isolated preview design. Keep the legacy ambitious-sky target inactive.
10. Document emergency reversion, including restoring the appropriate SWA authorization policy before re-enabling GitHub publishing. Never treat a workflow toggle alone as rollback.

**Exit:** only Azure DevOps publishes production; an unapproved release cannot deploy; deployment evidence ties back to its work item, PR and immutable release bundle.

## Phase 6 — Operations and adoption

**Owner:** operations and product owner. **Estimate:** 1–2 working days, then ongoing. **Depends on:** Phase 5.

- Dashboard: test failures, release duration/frequency, deployment failure rate, approval wait time and recovery time.
- Connect operational alert handling to Boards manually initially; configure Application Insights/Monitor alerts with approved thresholds and cost limits.
- Use Azure Test Plans only if licensed manual test management is needed; existing automated test publication does not require adopting it.
- Review service-connection scopes, token rotation, artifact retention, environment bypass rights and hosted-agent concurrency regularly.
- Retain at least the previous known-good release pair; choose longer retention based on organizational policy and cost.
- Review the documented email-service lifecycle separately; this platform adoption does not replace the email provider.

## Planned implementation deliverables

These files do not exist yet and are not generated by this planning task:

- Root `azure-pipelines.yml` and reusable templates under `.azuredevops/pipelines/` for CI, packaging, development and production releases.
- Portable package/inventory verification scripts and targeted tests.
- Parameterized compatibility checker and mocked tests.
- Development-only Bicep/parameter files and reviewed environment configuration contract.
- GitHub publishing cutover changes and branch-protection setup.
- `infra/AZURE-DEVOPS-RUNBOOK.md`, onboarding instructions and directly related README/packaging updates.
- Azure DevOps project/Boards configuration, environments, approvals, service connections and protected variable groups.

## Acceptance criteria and approval boundary

- GitHub remains the source of truth; Boards links code and releases without storing booking data.
- PR failures block merges; PR/fork jobs cannot access deployment credentials.
- Development and production use separate resources, data, identities and secrets.
- Production requires an independent check outside YAML and consumes the release bundle tested in development.
- API is deployed and verified before frontend publication; shared assets and ZIP inventory are validated.
- Production authentication, backend linkage, storage and notification settings remain unchanged during code-only releases.
- A rollback drill proves recovery without assuming Function slots or automatic reversal of data/schema changes.
- No competing GitHub/Azure DevOps production publishers remain after cutover.

Estimated effort: **14–21 working days**, subject to access, licensing, hosted-agent capacity, development resource approvals and Flex deployment validation. Cost estimate is pending resource/usage sizing; include Azure DevOps users/optional Test Plans, pipeline concurrency, development SWA/Functions/storage/telemetry and artifact retention. No live prices or existing cloud state were verified.

Before implementation, confirm organization/project names, deployment approvers, development budget/location, production resource inventory and permission to create or modify infrastructure. This plan grants no deployment-policy, secret, infrastructure, application or production-data changes.

## Official references

- [Connect Azure Boards to GitHub](https://learn.microsoft.com/en-us/azure/devops/boards/github/connect-to-github?view=azure-devops)
- [Azure Pipelines GitHub repositories](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/github?view=azure-devops)
- [ARM service connections and workload identity federation](https://learn.microsoft.com/en-us/azure/devops/pipelines/library/connect-to-azure?view=azure-devops)
- [Environment approvals and checks](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops)
- [SWA build configuration and deployment authorization](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration)
- [AzureStaticWebApp task](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/azure-static-web-app-v0?view=azure-pipelines)
- [Functions deployment technologies](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies)
