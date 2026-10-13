# Seller Development Request Form + Admin Portal

Azure Static Web App: public booking form (`/`) and an administrator portal (`/admin/`),
backed by a separately linked Azure Functions API (`/api`) and Azure Table Storage.

```
app/                       static site (deployed as app_location)
  index.html, app.js       public booking form (branching + live facilitator availability)
  form-config.js           questions, choices, branching – edit here
  data.js                  shared data layer (API mode / local-storage fallback)
  admin/                   admin portal (dashboard, calendar, availability, bookings, blocked dates)
  staticwebapp.config.json route protection (admin role), runtime
api/                       Azure Functions (Node 20, v4 model)
  src/functions/api.js     endpoints
  src/store.js             Table Storage or local JSON file
  src/rules.js             conflict / overlap rules
swa-cli.config.json        local run config
```

## Admin features
| Tab | What it does |
|---|---|
| Dashboard | Totals, pending approvals (one-click Approve/Reject), next 14 days, load per facilitator, requests per category, conflict list |
| Calendar | Month view, colour-coded by facilitator, pending shown dashed, blocked days shown. Filter by facilitator/status. Click a booking to edit it; click a day for that day's bookings + facilitator slot grid |
| Facilitator Availability | Weekly grid (facilitator × day, AM/PM): Free / Pending / Booked / Blocked, plus a "Find an available facilitator" tool |
| Bookings | Search + filters (status, category, facilitator, upcoming/past), edit/reschedule/approve/delete, CSV export |
| Blocked Dates | Mark facilitators unavailable (leave, holidays) for a date range |

Rules: a facilitator cannot have overlapping active bookings (Pending/Approved/Completed). Rejected/Cancelled
bookings free the slot. The public form disables booked slots and the API rejects conflicts (HTTP 409).
Admins can override a conflict with a confirmation.

## Admin login
Click **Admin Login** (top-right of the booking form) or open `/admin/`.

| | Default |
|---|---|
| Username | `admin` |
| Password | `Admin@123` |

When running in explicit local UI test mode, the login screen shows development defaults.
They are hidden on the deployed site.

**Change them before going live:** set these app settings on the linked **Function App**, or edit
`api/local.settings.json` for local runs:

| Setting | Purpose |
|---|---|
| `ADMIN_USERNAME` | Admin username |
| `ADMIN_PASSWORD` | Admin password |
| `SESSION_SECRET` | Long random string used to sign the login session cookie |

Sessions last 8 hours and are stored in an HttpOnly, SameSite=Strict cookie (Secure over HTTPS).

## Run locally

### Option A – quick UI test (no install)
```bash
npx serve app        # or: cd app && python -m http.server 8080
```
Open the URL shown with `?storage=local` → **Admin Login** → **Use default credentials** → **Log in**.
Add `?storage=local` to the admin page URL too. Local UI mode is only available on localhost/loopback.
Data is kept in browser storage; use **Load sample data** in the yellow bar to fill the calendar.

### Option B – full stack (same as Azure)
Prerequisites: supported Node.js 22+ runtime, Azure CLI, Functions Core Tools v4 and SWA CLI, then:
```bash
npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
cd api && npm install && cd ..
swa start
```
Open http://localhost:4280 → **Admin Login** → log in with the default credentials.
Configure `STORAGE_TABLE_ENDPOINT` in the ignored `api/local.settings.json` as
`https://sellerdevelopment.table.core.windows.net/`. A nonsecret template is in
`api/local.settings.example.json`. The local API uses `DefaultAzureCredential` and your Azure CLI
sign-in in the DreadOps tenant. The signed-in developer needs **Storage Table Data Contributor**
on the account; Owner/Contributor management roles alone do not grant Table data access.

The deployed API uses `ManagedIdentityCredential` only. For a user-assigned identity, set
`STORAGE_MANAGED_IDENTITY_CLIENT_ID`; otherwise use the Function App's system-assigned identity.
Grant that identity Storage Table Data Contributor on the account.

Endpoint configuration takes precedence over legacy `STORAGE_CONNECTION_STRING`. No key is needed
for this setup. The Functions host's `AzureWebJobsStorage` is separate runtime storage and must be
configured for the selected hosting plan; it is not the application's Table Storage setting.

If neither application storage setting exists, local-only API runs can use `api/.data/db.json`.
Cloud hosts refuse this file fallback. The deployed frontend refuses browser fallback and requires
healthy Table storage. On localhost, browser storage is available only with `?storage=local`.
`GET /api/health` actually checks storage access; failures return 503 without exposing storage details.
Do not use the plain static server at port 3000 for Azure-backed submission: use the full-stack
same-origin SWA endpoint at port 4280 instead.
If combined `swa start` stalls, use the VS Code **Run booking Functions API** task first, then
**Run Azure-backed booking application**. These separate tasks serve the Azure-backed frontend at
`http://localhost:4281/` and API at port 7071. An `AzureWebJobsStorage` host-health warning is separate
from application Table access and must be resolved before production deployment.

## Linked keyless backend deployment (recommended)

Existing target: **SellerDevelopment**, Standard Static Web App in **PersonalRG**, Primary Subscription
`2a77b3d9-39da-4b42-8219-c6fd9b8a6165`. Storage account: **sellerdevelopment**, Southeast Asia.

1. Provision a separately hosted Function App with managed identity after region, hosting costs,
   runtime-storage configuration and quota are approved. Managed SWA functions do not support managed identity.
2. Deploy the `api/` directory separately; retain the default `/api` route prefix.
3. Configure `STORAGE_TABLE_ENDPOINT`, strong private admin settings and runtime storage on the Function App.
4. Grant its identity Storage Table Data Contributor on sellerdevelopment. Verify table creation/read/write permissions.
5. Link the Function App through SellerDevelopment → APIs → Production. Retain the linking authentication
   protections; direct Function App access must not trust caller-supplied SWA identity headers.
6. Keep the frontend workflow's `api_location` **empty** for a linked backend. Deploy frontend and backend separately.
7. Verify the custom domain's `/api/health`, login and a temporary booking before cutover.

No hosting resources or storage-account keys are embedded in frontend files. An exposed account key must
still be rotated even when switching to managed identity.

## GitHub Actions branch routing

The active frontend workflow is
`.github/workflows/azure-static-web-apps-yellow-mushroom-07fa45d00.yml`, targeting
**SellerDevelopment** at `yellow-mushroom-07fa45d00.4.azurestaticapps.net`.
It tests the API and checks frontend JavaScript syntax with Node.js 22 before uploading
the already-static `app/` directory. `api_location` stays empty: it never deploys the linked API.
There are no path filters; every push to `main` or `dev` triggers the workflow.

| Event | Frontend destination | API workflow |
|---|---|---|
| Push to `main` | Existing production site (`production_branch: main`) | Tests, then production API deployment if OIDC prerequisites are configured |
| Push to `dev` | Stable **branch** preview for `dev` | Tests only; no API deployment |
| PR opened, synchronized or reopened against `main` | Separate PR-number preview | Tests only; no API deployment |
| PR closed against `main` | Authenticated cleanup of that PR preview only | No API deployment |

The existing preview `yellow-mushroom-07fa45d00-1.eastasia.4.azurestaticapps.net`
is **PR #1**, with environment name `1` and source branch `dev`; it is not the stable
`dev` branch environment. A successful `dev` push with this workflow creates/updates
the branch preview (expected URL:
`yellow-mushroom-07fa45d00-dev.eastasia.4.azurestaticapps.net`). Confirm the actual URL
in the deployment output or SellerDevelopment's Environments view after that push.
Concurrency separates PR previews from branch refs. PR cleanup uses the same
`AZURE_STATIC_WEB_APPS_API_TOKEN_YELLOW_MUSHROOM_07FA45D00` secret as uploads,
without checking out or executing PR code. Fork PRs do not receive this deployment secret.

**Dev shares the production API and data.** It is a frontend preview, not an isolated backend.
Preview API routing must use the existing production Function App; these workflows do not
create or change backend links. Once connected, submissions and admin edits from dev
affect production records. Do not use real production writes to test UI changes.
API changes on `dev` are tested but not published, so its frontend must remain compatible
with the currently deployed production API.

`.github/workflows/production-api.yml` publishes only after successful tests on a
**push to `main`**, to the existing Flex Consumption app **func-booking-prod-8941**.
It uses `azure/login@v2` OIDC and `Azure/functions-action@v1` with
`sku: flexconsumption` and `remote-build: true`. The package is staged in runner temp
from an allowlist: `api/host.json`, `api/package.json`, `api/package-lock.json`, and `api/src/`
only. Local settings, credentials, migration exports, tests, scripts, and local `node_modules`
are not included; the remote build installs dependencies. Production runs are not canceled
by newer pushes. No workflow provisions resources or modifies backend configuration.

### Production API OIDC prerequisites (operator setup required)

The following repository variables are not currently configured. The deployment job
fails explicitly **before Azure login** if any are missing; dev and PR tests still run:

- `AZURE_CLIENT_ID`: client ID of the deployment identity.
- `AZURE_TENANT_ID`: tenant ID containing that identity.
- `AZURE_SUBSCRIPTION_ID`: subscription ID containing the existing Function App.

Configure a deployment identity with **Website Contributor** scoped to
`func-booking-prod-8941` (not subscription-wide Owner), and a federated credential:

- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `api://AzureADTokenExchange`
- Subject: `repo:lloydismael/Seller-Development-Request-Form:ref:refs/heads/main`

Only the main deployment job receives `id-token: write`; tests do not authenticate to Azure.
The Function App's runtime identity separately needs **Storage Table Data Contributor**
on `sellerdevelopment`; the CI deployment identity does not need access to booking data.
No client secret, publish profile, or secret value should be added to the repository or logs.

These changes are initially on `dev`. Main production routing and API automation take effect
only once the **workflow/documentation changes are separately reviewed and promoted to `main`**.
Do not merge the dev form design merely to enable CI/CD. Committing alone does not deploy;
an explicit push triggers Actions. The legacy ambitious-sky workflow is manual-only and is
**not** the SellerDevelopment target, avoiding duplicate automatic deployments.

References: [SWA branch previews](https://learn.microsoft.com/azure/static-web-apps/branch-environments)
and [Functions action OIDC and Flex parameters](https://github.com/Azure/functions-action).

## Preserve and migrate existing browser responses

- Data belongs to each browser profile and origin. Export complete JSON from the origin where responses
  were submitted (for example localhost:3000 or the deployed domain), not CSV. CSV omits answers and audit fields.
- Snapshot format: an object containing `bookings` from localStorage `sdrf_bookings_v2` and `blocks`
  from `sdrf_blocks_v1`. Store snapshots under ignored `api/.migration/`; never commit personal response data.
- Pause source and destination writes during cutover. Do not clear localStorage or source JSON files.
- From `api/`, use `npm run migrate -- .migration/snapshot.json` for a **dry-run** with
  `STORAGE_TABLE_ENDPOINT` available in the terminal environment. The script does not load local.settings.json.
- Only after reviewing dry-run results, append `--apply`. The import preserves complete records, IDs,
  timestamps, statuses and notes. It rejects invalid/oversized records, source duplicates, scheduling conflicts
  and differing destination IDs. Identical destination records are skipped; new records use create-only inserts.
- Repeating the import is idempotent. A partial failure reports counts; rerun dry-run before resuming.
  Originals remain unchanged. Verify complete destination records and counts before enabling new writes.
- Rollback does not delete Azure records. Reconcile any post-cutover writes before switching destinations.

## Legacy managed-functions deployment (connection-string compatibility only)

The following is an alternative to the recommended linked keyless setup, not its deployment instructions.
1. Create a Storage Account (for Table Storage).
2. Create the Static Web App: App location `app`, Api location `api`, Output location empty.
3. Static Web App → **Environment variables**: add `STORAGE_CONNECTION_STRING`, `ADMIN_USERNAME`,
   `ADMIN_PASSWORD`, `SESSION_SECRET`.
4. Azure DevOps pipeline step:
```yaml
- task: AzureStaticWebApp@0
  inputs:
    app_location: 'app'
    api_location: 'api'
    output_location: ''
    azure_static_web_apps_api_token: $(SWA_DEPLOYMENT_TOKEN)
```

## Security notes
- Admin endpoints (`GET /api/bookings`, `/api/bookings/{id}`, `/api/blocks*`) check the signed session cookie
  inside each function; requests without a valid session get 401.
- Public endpoints: `POST /api/bookings`, `GET /api/availability` (no personal data), `POST /api/auth/login`.
- Explicit quick UI test mode checks development credentials in the browser on localhost only.
  Deployed logins require a healthy linked API; API outages never silently store responses locally.
