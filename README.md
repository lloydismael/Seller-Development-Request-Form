# Seller Development Request Form + Admin Portal

A public form where sellers request development training, and an admin portal where staff review and schedule those requests, run reporting, and collect Phone Videography training feedback (CSAT).

It runs as an **Azure Static Web App** (`app/`) with a **separately deployed Azure Functions API** (`api/`) that stores data in **Azure Table Storage**.

```
Browser ──► Static Web App (app/) ──linked──► Functions API (api/) ──► Azure Table Storage
            /        request form               /api/*                  SdrfBookings, SdrfBlocks,
            /admin/  staff portal               auth, rules, outbox     SdrfAccounts, SdrfSettings,
            /csat/   training survey                                    SdrfActivity
```

| Page | URL |
|---|---|
| Request form | https://sellerdevelopmentrf.clouditechsolution.com/ |
| Admin portal | https://sellerdevelopmentrf.clouditechsolution.com/admin/ |
| Training survey | https://sellerdevelopmentrf.clouditechsolution.com/csat/ |
| API health | https://sellerdevelopmentrf.clouditechsolution.com/api/health |

**Contents:** [Who uses it](#who-uses-it) · [Admin portal](#admin-portal) · [Booking process](#booking-process) · [Training survey process](#training-survey-csat-process) · [Run it locally](#run-it-locally) · [Development and release process](#development-and-release-process) · [Configuration](#configuration) · [Important things to know](#important-things-to-know) · [Security model](#security-model) · [Limits](#limits) · [Troubleshooting](#troubleshooting) · [Other procedures](#other-procedures) · [Repository layout](#repository-layout) · [Azure resources](#azure-resources)

## Who uses it

| Role | How they sign in | What they can do |
|---|---|---|
| **Requester** | No login. Uses the request form at `/`. | Submit requests. See their own submitted requests under **My Request** (browser-based history). |
| **Facilitator** | `/admin/` with an account mapped to their facilitator name | See only **CSAT / Training** and **My profile**. Accept or decline their assigned Pending bookings, register attendees, complete approved Phone Videography sessions, and read named responses for their own sessions. |
| **Supervisor** | `/admin/`, account created by an admin | Schedule and booking work: view all bookings, schedules and reporting; edit, approve, reject and complete bookings; override conflicts; manage blocked dates, facilitator accounts and CSAT links. Cannot delete bookings, publish forms, change shared settings, manage supervisor accounts or view the activity log. |
| **Admin** | `/admin/`, bootstrap account | Everything, including the form builder and publishing, settings, supervisor accounts, activity log and booking deletion. |

## Admin portal

| Area | Who | What it does |
|---|---|---|
| Dashboard | Admin, Supervisor | Totals, pending approvals, next 14 days, load per facilitator, conflict list |
| Calendar | Admin, Supervisor | Month view by facilitator and status; click a booking to edit it |
| Facilitator Availability | Admin, Supervisor | Weekly grid (Free / Pending / Booked / Blocked) and a "find an available facilitator" tool |
| Bookings | Admin, Supervisor | Search, filter, edit, approve / reject / complete. Deleting is admin-only. |
| Blocked Dates | Admin, Supervisor | Mark a facilitator unavailable for a date range (leave, holidays) |
| Reporting | Admin, Supervisor | Read-only training report. Filters apply to charts, records and CSV exports. |
| CSAT / Training | Admin, Supervisor, assigned Facilitator | Training sessions, attendees, survey link and QR, results |
| Facilitator accounts | Admin, Supervisor | Create accounts, map them to facilitators, reset passwords, enable or disable |
| Supervisor accounts | Admin | Create, update contacts, reset passwords, enable or disable supervisors |
| Form builder | Admin | Edit questions, sections, routing and theme. **Save draft → Preview → Publish.** |
| Settings | Admin | Appearance (glass, light/dark palettes, spacing, width, cards), scheduling safeguards, shortcuts |
| Activity log | Admin | Operational history with action and date filters |
| My profile | All staff | Display name, email, phone; local accounts can change their password |

**Form publishing:** saving a draft never changes the live form. Publishing makes the saved draft the form used for new requests and applies palette changes to every visitor. Required booking questions (requester name, Your Email, division, category, date, facilitator, time, venue) cannot be removed or made optional.

## Booking process

1. **Submit.** The requester completes the form. The request is saved as **Pending**. Pending requests do not reserve facilitator time.
2. **Review.** Admins and supervisors see it on the Dashboard and in Bookings. The assigned facilitator can accept or decline Pending bookings assigned to them in **CSAT / Training**.
3. **Decide.**
   - **Approve / Accept** → `Approved`. The API re-checks the facilitator's schedule. If the slot overlaps an Approved or Completed booking, the request is refused (HTTP 409) and stays Pending. Admins and supervisors can override with confirmation.
   - **Reject / Decline** → `Rejected`.
   - **Cancel** an approved booking → `Cancelled`.
4. **Complete.** After the training, mark the booking `Completed`. Closed requests can be reopened from booking details.

| Status | Holds facilitator time? | Shown as booked publicly? |
|---|---|---|
| Pending | No (several pending requests may overlap) | No |
| Approved | Yes | Yes |
| Completed | Yes | Yes |
| Rejected | No | No |
| Cancelled | No | No |

Blocked dates always make a facilitator unavailable.

- Approvals use a versioned scheduling guard, so two overlapping pending requests cannot both be approved at once. The losing request stays Pending.
- Admins see informational conflict warnings for overlapping Pending, Approved and Completed bookings. These warnings never change public availability.
- Changes are recorded in the admin-only **Activity log**.
- When email is enabled: new requests notify admins, supervisors and the assigned facilitator; reassignment notifies the new facilitator; approve and reject notify the requester. See [Email notifications](#enable-email-notifications).

## Training survey (CSAT) process

Used for Phone Videography sessions:

1. The request is **Approved** and the session takes place.
2. An admin or the assigned facilitator marks the booking **Completed**. The **Session CSAT link and QR** then opens. Bookings that were already Completed before this feature need an admin to activate CSAT explicitly.
3. Share the link, or download the QR as PNG. Attendees do not need to register. Requesters see a read-only link and QR in **My Request** while it is open.
4. Responses are stored per session. Named answers are visible only to admins and the assigned facilitator. Staff see total submissions, not a response rate.
5. Revoke or rotate the link at any time. Responses are kept. Reactivating or rotating creates a new URL and QR, which must be redistributed.

Legacy individual invitations still exist as a collapsed, optional workflow (maximum 2,000 attendees per session; one final response per invitation).

## Run it locally

### Prerequisites

- Node.js 22 or later
- Azure CLI signed in (`az login`) to the tenant that owns the `sellerdevelopment` storage account. Your account needs **Storage Table Data Contributor** on that account. Owner or Contributor roles alone do not grant table data access.
- Functions Core Tools v4 and the SWA CLI, then build the API:

```powershell
npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
cd api
npm install
npm run build
cd ..
```

`npm run build` must run from the full repository. It generates the ignored `api/src/form-assets/` copies of the shared form and CSAT assets.

### Start the app (recommended)

1. Open the repository folder in VS Code.
2. Go to **Run and Debug**, select **Booking application (full stack)**, and press **F5**.
3. The launcher starts the API on port 7071 and the frontend on port 4281, waits for both, and opens Edge at `http://localhost:4281/`. Breakpoints work in `app/` and `api/src/`.
4. Stop debugging to stop everything.

Without the debugger: **Terminal → Run Task → Run booking full stack**, then Ctrl+C to stop. Ports can be changed with `BOOKING_API_PORT`, `BOOKING_WEB_PORT` and `BOOKING_INSPECT_PORT` in the launch configuration's `env`. If a port is busy, the launcher stops and does not kill the process using it.

Alternatives:
- `swa start` → `http://localhost:4280`. If it stalls, run the **Run booking Functions API** task first, then **Run Azure-backed booking application** (serves `http://localhost:4281/`).

### Frontend-only UI check (no API, no Azure)

```powershell
npx serve app
```

Open the URL with `?storage=local`, click **Admin Login**, and use the browser demo credentials (`admin` / `Admin@123`). Data stays in the browser, works only on localhost, and is not a persistence mechanism. Demo mode cannot manage accounts, profiles, drafts, publishing or activity.

### Tests

```powershell
cd api
npm test
```

Tests use temporary local files and in-memory stores. They do not touch Azure storage or live data.

## Development and release process

### Branches

| Branch | Effect |
|---|---|
| `main` | Production. Every push deploys the frontend to the **SellerDevelopment** Static Web App. |
| Pull request → `main` | Creates a frontend preview. Closing the PR removes it. Previews never deploy the API. |
| `dev` | Local work only. Pushes here deploy nothing. |

### Making a change

1. Branch from `main`.
2. Change the code and run `npm test` in `api/`.
3. If you changed `app/form-config.js`, `app/form-schema.js`, `app/csat-config.js` or `app/csat-schema.js`, run `npm run build` in `api/`. Run `npm run build:qr` only if you change the QR library version.
4. Test locally. Remember that local runs use live data (see [Important things to know](#important-things-to-know)).
5. Open a PR into `main` and check the preview.
6. Merge. The frontend deploys automatically.

### What happens on a merge to main

Workflow: `.github/workflows/azure-static-web-apps-yellow-mushroom-07fa45d00.yml`

1. A compatibility gate runs `api/scripts/check-production-compatibility.js` against the live API. **If the live API is incompatible with this frontend, the upload is blocked.**
2. The `app/` folder is uploaded to the **SellerDevelopment** Static Web App.

### Backend (API) release: separate and approval-gated

GitHub Actions does **not** deploy the API. Any change under `api/` (routes, rules, schema, settings) needs a separate release:

1. **Build shared assets** in the full repository: `cd api` then `npm run build`.
2. **Package** an API-only zip following [infra/PACKAGING.md](infra/PACKAGING.md). Include only `host.json`, `package.json`, `package-lock.json` and the full `src/` tree, with forward-slash entry names. Exclude `local.settings*`, `.data/`, `.migration/`, `scripts/`, `test/` and `node_modules/`.
3. **Get publish approval**, then deploy to the Function App `func-booking-prod-8941` using Azure Functions remote build.
4. **Verify** (below).
5. **Order matters.** If a release adds schema fields or changes the protocol, deploy and verify the API **before** the frontend. An older API rejects unknown form properties and returns 503 when loading the form.

### Verify after a release

```powershell
curl.exe https://sellerdevelopmentrf.clouditechsolution.com/api/health
node api/scripts/check-production-compatibility.js
node api/scripts/smoke-history.js https://sellerdevelopmentrf.clouditechsolution.com
```

Health must return `ok: true` with table storage. The smoke test is read-only and prints no cookie values. Finish by signing in to `/admin/` and opening the Dashboard.

### Rollback

- **Frontend (preferred for UI problems):** revert the commit on `main` or redeploy an earlier build. The workflow redeploys it.
- **Backend:** redeploy a previous package only if it is compatible with data already written. Do not downgrade a storage-aware API after new data exists.
- Rollback never deletes Azure table records.

## Configuration

### Local: `api/local.settings.json` (git-ignored; template in `api/local.settings.example.json`)

| Setting | Purpose |
|---|---|
| `FUNCTIONS_WORKER_RUNTIME` | `node` |
| `STORAGE_TABLE_ENDPOINT` | `https://sellerdevelopment.table.core.windows.net/`. App data. If no storage setting is present, local-only runs use `api/.data/db.json`. |
| `AzureWebJobsStorage` | Functions host storage. Separate from app data and must suit the hosting plan. |

### Function App (linked API) app settings

| Setting | Required | Purpose |
|---|---|---|
| `STORAGE_TABLE_ENDPOINT` | Yes | Table endpoint. Accessed with managed identity; no keys. |
| `STORAGE_MANAGED_IDENTITY_CLIENT_ID` | Only for user-assigned identity | Otherwise the system-assigned identity is used. Grant it Storage Table Data Contributor. |
| `ADMIN_USERNAME` | No (default `admin`) | Bootstrap admin username. Used only when no account exists. |
| `ADMIN_PASSWORD` | Yes | Bootstrap admin password. Production refuses to start with a missing or demo value. |
| `SESSION_SECRET` | Yes | At least 32 characters in production. Signs login sessions and shared CSAT links. |
| `ADMIN_ALLOWED_ORIGINS` | Yes | Comma-separated exact HTTPS origins (no paths or trailing slashes): the custom domain and the default SWA host. |
| `CSAT_SIGNING_KEY` | Optional | At least 32 characters and different from `SESSION_SECRET`. Required in shared-production mode. |
| `EMAIL_NOTIFICATIONS_ENABLED` | To send email | `true` enables notification creation. Email is opt-in. |
| `EMAIL_ENDPOINT` | With email | Azure Communication Services Email endpoint (HTTPS). |
| `EMAIL_SENDER_ADDRESS` | With email | Verified sender address. |
| `EMAIL_PUBLIC_ORIGIN` | With email | Public origin used in email links (HTTPS). |
| `EMAIL_MANAGED_IDENTITY_CLIENT_ID` | Optional | User-assigned identity for email delivery. |
| `STORAGE_CONNECTION_STRING` | Legacy only | Used only when `STORAGE_TABLE_ENDPOINT` is not set. |

Do not place storage keys or connection strings in frontend files. Restart the local API after changing its settings.

## Important things to know

**Local runs use live data.** `api/local.settings.json` points at the production `sellerdevelopment` table. Creating, approving or editing bookings, accounts or the form while running locally **changes production data**. Use `?storage=local` for UI-only work and `npm test` for logic tests.

**Frontend and API deploy separately.** Merging to `main` never deploys the API. Keep them in step using the release order above. The compatibility gate blocks the frontend upload only when the live API is incompatible.

**Bootstrap settings do not overwrite accounts.** `ADMIN_USERNAME` and `ADMIN_PASSWORD` create the admin account only if none exists. Changing them later does nothing to the existing account. Use **My profile** to change the password, which requires the current password.

**Secret rotation has side effects.**
- Changing `SESSION_SECRET` signs everyone out and invalidates existing shared CSAT links. Redistribute the regenerated links and QR codes.
- Changing a password invalidates that account's earlier sessions.
- An exposed storage key must be rotated, even after moving to managed identity.

**Audit writes are not atomic.** A change and its activity record are saved separately. If a response includes `auditRecorded:false` (header `X-Audit-Recorded: false`), the change **was saved**. Show the warning and **do not repeat the operation**.

**Pending does not block time.** Only Approved and Completed bookings reserve a facilitator's slot. New requests that overlap a reserved slot are rejected with HTTP 409.

**Email is opt-in and asynchronous.** Notifications are written to a durable outbox with the booking change and delivered by a timer that runs every 15 seconds. A delivery failure never undoes a booking. Accounts without an email are recorded as skipped. Usernames are never treated as email addresses. Azure Communication Services Email retires on **30 September 2028**; plan a replacement before relying on it long term. See [infra/EMAIL-NOTIFICATIONS.md](infra/EMAIL-NOTIFICATIONS.md) for current status.

**Facilitator accounts are per environment.** Create real accounts through the live **Facilitator accounts** screen. Do not copy local databases or settings into production. Hand passwords over through an approved private channel. Disabling an account blocks sign-in but keeps its assignment and history. Password resets and assignment changes sign the user out. Contact-only edits do not. Profile email is contact information only: it is not verified and is not used for sign-in.

**Browser history is per browser.** **My Request** relies on a one-year HttpOnly cookie. Clearing cookies removes access, not the requests. Anyone using the same browser profile can see that history. There is no recovery code and no cross-device sync.

**Shared survey links are bearer links.** Anyone with the link can submit responses, up to 300 new responses per session per minute. A link does not prove identity. Do not post it publicly.

**Retention is manual.** There is no automatic CSAT purge. Apply your organization's retention policy to bookings and to attendee and response records. Deleting a booking makes its survey links inaccessible but keeps its records.

**Keep sensitive files out of git and out of zips.** Never commit or share `api/local.settings.json`, `api/.data/`, `api/.migration/` snapshots, CSAT key files, release zips, or response data. Do not use the Static Web App deployment token to deploy the Function App.

**The `ambitious-sky` workflow is manual-only and targets a different site.** Do not run it for SellerDevelopment.

## Security model

- Admin and staff endpoints check the signed session cookie (8 hours; HttpOnly; SameSite=Strict; Secure over HTTPS) or an authorized Static Web Apps identity inside the API. Requests without a valid identity get HTTP 401.
- Browser writes must send `X-Admin-Request: 1` from an allowed origin. Cross-site writes are rejected. No permissive CORS is enabled.
- Passwords must be 12–128 characters, are never trimmed, and are stored with salted scrypt hashes. Login attempts are bounded and persisted. Changing a password invalidates that account's earlier sessions; sign in again afterward.
- Activity records never contain passwords, tokens, cookies or full request bodies. IP addresses and geolocation are not collected.
- Public endpoints: `POST /api/bookings`, `GET /api/form-config`, `GET /api/availability` (no personal data), `GET /api/health`, `POST /api/auth/login`, the **My Request** endpoints, and the CSAT survey endpoints.

## Limits

| Item | Limit |
|---|---|
| Form questions / sections / choices per question | 60 / 20 / 50 |
| Form configuration JSON | 30 KiB (UTF-16). Draft and published configurations must both fit. |
| Question titles, choice labels, short answers | 200 characters |
| Help text and section descriptions | 1,000 characters |
| Textarea and CSAT evaluation answers | 2,000 characters |
| Passwords | 12–128 characters |
| Legacy individual attendees per session | 2,000 |
| Shared survey responses | 300 new responses per session per minute |
| Admin login session | 8 hours |
| Activity log page | 25 rows. Filtering runs in memory, so very large histories are slow. |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Launcher reports a port is in use | Stop the other API/frontend task or debug session, then press F5 again. |
| `/api/health` returns 503 "Storage is unavailable" | Check `STORAGE_TABLE_ENDPOINT` and the identity. Locally, run `az login` and confirm Storage Table Data Contributor. In production, grant the Function App identity that role. |
| Local API gets 403 reading tables | Add Storage Table Data Contributor on `sellerdevelopment`. Owner or Contributor is not enough. |
| `swa start` stalls | Use the two separate tasks: **Run booking Functions API**, then **Run Azure-backed booking application**. |
| Submissions fail on port 3000 | A plain static server has no API. Use the SWA endpoint on 4280 or 4281. |
| Public page shows "Backend update required" | The live API is older than the frontend. Deploy the API release. |
| Form fails to load (503) after publishing | The published configuration uses fields the live API does not know. Deploy a compatible API. Do not remove saved settings. |
| Submit returns 409 | The slot is now reserved by an Approved or Completed booking, or the form or draft changed. Refresh and retry. |
| Admin actions return 401 | The session expired (8 hours) or you are signed out. Sign in again. |
| Admin write is rejected | The origin is not listed in `ADMIN_ALLOWED_ORIGINS`, or the request lacks `X-Admin-Request: 1`. |
| Response includes `auditRecorded:false` | The change was saved. Do not repeat it. |
| Email not received | Check `EMAIL_NOTIFICATIONS_ENABLED`, the Function App settings and the email timer. Accounts without an email are skipped. Inbox delivery cannot be confirmed from the portal, and mail clients decide whether to show priority. |
| Host warning about `AzureWebJobsStorage` | Functions runtime storage, separate from app data. Resolve it before production use. |

## Other procedures

### Enable email notifications

Follow [infra/EMAIL-NOTIFICATIONS.md](infra/EMAIL-NOTIFICATIONS.md). It covers Azure Communication Services Email, the verified domain and sender, the Function App settings above, and the phased rollout.

For localhost connected to live storage, set `EMAIL_NOTIFICATIONS_ENABLED=true` to create notifications and `AzureWebJobs.emailNotifications.Disabled=true` to stop the local timer; the Azure worker then delivers the shared outbox. For ordinary development, keep notification creation disabled.

### Migrate browser responses (one-time)

1. Export **complete JSON** (not CSV) from the origin that holds the responses. Save it under `api/.migration/` as `{ "bookings": [...], "blocks": [...] }`, where `bookings` comes from the browser's `localStorage` key `sdrf_bookings_v2` and `blocks` from `sdrf_blocks_v1`.
2. Pause writes on the source and the destination. Do not clear the source data.
3. From `api/`, run a dry run. `STORAGE_TABLE_ENDPOINT` must be set in the terminal, because the script does not read `local.settings.json`:

   ```powershell
   npm run migrate -- .migration/snapshot.json
   ```

4. Review the results, then add `--apply`. The import preserves IDs, timestamps, statuses and notes. It rejects invalid records, duplicates and scheduling conflicts. It is idempotent. After a partial failure, run the dry run again before resuming.
5. Rollback does not delete Azure records. Reconcile post-cutover writes before switching destinations.

### Shared-production localhost (advanced)

```powershell
api\scripts\start-shared-production.ps1 -AcknowledgeLiveWrites -CsatKeyFile <encrypted-key.xml>
```

This runs the current workspace frontend and API on `localhost:4281` against the **exact production tables**. Every write is live.

- Requires Node 22 and Azure CLI sign-in to the production tenant, with table-scoped Storage Table Data Contributor access.
- The CSAT key file is an `Export-Clixml` SecureString protected for your Windows user. Never commit it.
- It never creates tables or bootstraps an admin. It fails if prerequisites are missing and displays **LOCAL CODE / LIVE DATA** warnings.
- Do not run destructive tests in this mode.

### Legacy managed-functions hosting (not for new setups)

Managed (Static Web Apps-hosted) functions do not support managed identity and rely on `STORAGE_CONNECTION_STRING`. The linked, separately hosted Function App is the supported path. Use this only for connection-string compatibility.

## Repository layout

```
app/                       Static frontend, deployed to the Static Web App
  index.html, app.js       Public request form (branching, live availability)
  admin/                   Admin and staff portal (/admin/)
  csat/                    Training survey (/csat/)
  form-schema.js,          Shared validation and configuration used by the browser and API
  form-config.js
api/                       Azure Functions API (Node 22+, v4 model), deployed separately
  src/functions/api.js     HTTP routes
  src/store.js             Table Storage access (or a local JSON file for isolated runs)
  src/rules.js             Scheduling and conflict rules
  src/csat.js              Training sessions, CSAT and sharing
  scripts/                 Build, migration, smoke-test and compatibility scripts
  test/                    node:test suite
infra/                     Bicep templates, packaging and operations notes (no secrets)
.github/workflows/         GitHub Actions for the production frontend
.vscode/                   Run and Debug launcher and tasks
```

## Azure resources

| Resource | Name |
|---|---|
| Subscription | Primary Subscription `2a77b3d9-39da-4b42-8219-c6fd9b8a6165` |
| Resource group | `PersonalRG` |
| Static Web App (frontend) | `SellerDevelopment` |
| Function App (API) | `func-booking-prod-8941` (Southeast Asia) |
| Application storage (Tables) | `sellerdevelopment` |
| Function runtime storage | `stbookingprod8941` |
| Monitoring | `appi-booking-prod-8941`, `log-booking-prod-8941` |
| Email (opt-in) | Azure Communication Services Email, United States geography |

## More documentation

- [infra/README.md](infra/README.md): infrastructure templates and safe deployment order
- [infra/PACKAGING.md](infra/PACKAGING.md): API package procedure
- [infra/EMAIL-NOTIFICATIONS.md](infra/EMAIL-NOTIFICATIONS.md): email setup, status and runbook

Earlier, longer feature notes are kept in this file's git history.
