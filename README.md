# Seller Development Request Form + Admin Portal

Azure Static Web App: public booking form (`/`) and an administrator portal (`/admin/`),
backed by a separately linked Azure Functions API (`/api`) and Azure Table Storage.

```
app/                       static site (deployed as app_location)
  index.html, app.js       public booking form (branching + live facilitator availability)
  form-config.js           canonical bootstrap defaults (not a live form override)
  form-schema.js           shared browser/API validation and typed answer contract
  data.js                  shared data layer (API mode / local-storage fallback)
  admin/                   admin portal (dashboard, calendar, availability, bookings, blocked dates)
  staticwebapp.config.json route protection (admin role), runtime
api/                       Azure Functions (Node 22+, v4 model)
  src/functions/api.js     endpoints
  src/store.js             Table Storage or local JSON file
  src/rules.js             conflict / overlap rules
  scripts/build-form-assets.js copies canonical assets for independent API packaging
swa-cli.config.json        local run config
```

## Booking form experience

Question cards use consistent heading/helper-text spacing, readable option labels,
48px text inputs, and uniform option tiles: two equal-width columns on desktop and
one on mobile, with equal-height rows within each question. Long labels and helper
text wrap without clipping. Training Venue uses smaller tiles, icons, and spacing,
with an inline Other field. Its options scroll internally on shorter screens so the
active zoomed card stays compact without hiding choices. Compact form settings remain supported.

The required requestor name section is centered in the available page space on first
load, reset, or when the name is cleared. Sales Division and subsequent questions
appear after a valid name is completed by pressing Enter or leaving the name field;
the second question becomes active and scrolls into view. Typing alone does not
advance or show the Submit request button. Clearing the name hides downstream
questions and clears their answers. The current question has a persistent, theme-aware
focus glow and centered animated zoom (6% on desktop, 3% on mobile), with
responsive side gutters to keep enlarged cards within the page, including in draft
preview. Cards ease back to normal size when deselected. Surrounding cards use quieter
slate surfaces and a slight blur; hover or keyboard focus clears the blur, and clicking
a question selects it. Invalid cards remain sharp. Reduced-motion mode disables both
zoom and background blur.
Keyboard focus is preserved while typing. The header centers the title and logo,
with an icon-only Dark mode switch at the far right. The switch retains its accessible
label and uses an animated sun/moon toggle and smooth color transitions. It initially follows the
system appearance and remembers an explicit choice locally when storage is available.
All animations respect reduced-motion preferences. The progress bar remains visible
without a count label, and required fields retain individual indicators and validation
without a standalone required legend. Submit request is hidden until every required
answer on the selected route is valid and scheduling availability is ready. Optional
questions may remain blank; invalid optional answers must be corrected. Clearing or
invalidating an answer hides the button again. Draft previews never enable submission.

## Application design and appearance

Public and admin screens share a slate-and-teal design system in `app/design-tokens.css`
and accessible theme controls in `app/ui-controls.css`. Semantic light/dark colors cover
surfaces, text, focus, status feedback, tables, calendars, and dialogs. The shared
`app/theme.js` applies the saved preference before page rendering and synchronizes
changes across same-origin pages, including draft previews. If storage is unavailable,
the switch still works for the current page.

The admin portal uses a desktop sidebar and expandable mobile navigation, retaining
all eight destinations and unsaved-draft protections. The theme switch is available
both at login and within the portal. Published form accent/background choices remain
unchanged; light mode respects those settings, while dark mode uses accessible viewer
colors without saving changes to the form. The teal bootstrap default applies only to
configurations without an explicit theme, not existing saved drafts or published forms.
No external fonts, UI framework, or additional runtime dependency is needed.

## Admin features
| Tab | What it does |
|---|---|
| Dashboard | Totals, pending approvals (one-click Approve/Reject), next 14 days, load per facilitator, requests per category, conflict list |
| Calendar | Month view, colour-coded by facilitator, pending shown dashed, blocked days shown. Filter by facilitator/status. Click a booking to edit it; click a day for that day's bookings + facilitator slot grid |
| Facilitator Availability | Weekly grid (facilitator × day, AM/PM): Free / Pending / Booked / Blocked, plus a "Find an available facilitator" tool |
| Bookings | Search + filters (status, category, facilitator, upcoming/past), edit/reschedule/approve/delete, CSV export |
| Blocked Dates | Mark facilitators unavailable (leave, holidays) for a date range |
| My profile | Update your display name, email and phone; local accounts can change their password |
| Form builder | Edit validated questions, sections, choices, routing and theme; save draft, read-only preview and publish |
| Activity log | Admin-only operational history with action/date filters and paginated results |

Rules: a facilitator cannot have overlapping active bookings (Pending/Approved/Completed). Rejected/Cancelled
bookings free the slot. The public form disables booked slots and the API rejects conflicts (HTTP 409).
Admins can override a conflict with a confirmation.

## Admin login
Click **Admin Login** (top-right of the booking form) or open `/admin/`.

| | Browser demo only |
|---|---|
| Username | `admin` |
| Password | `Admin@123` |

When running in explicit local UI test mode, the login screen shows development defaults.
They are hidden on the deployed site.

**Configure private bootstrap credentials before API use:** set these app settings on the linked **Function App**, or edit
`api/local.settings.json` for local runs:

| Setting | Purpose |
|---|---|
| `ADMIN_USERNAME` | Initial local admin username (not editable in the profile UI) |
| `ADMIN_PASSWORD` | Initial local admin password; production rejects missing/demo credentials |
| `SESSION_SECRET` | Long random string used to sign the login session cookie |

Sessions last 8 hours and are stored in an HttpOnly, SameSite=Strict cookie (Secure over HTTPS).
The API creates the local account only if absent, using a salted scrypt hash. Persisted credentials
are authoritative: changing environment bootstrap values never overwrites an existing account;
corrupt/inaccessible storage fails closed. Password changes require the exact current password,
matching confirmation, and a different new password of **minimum 12, maximum 128 characters**.
Spaces and paste are supported; passwords are never trimmed. Credential-version rotation invalidates
all prior local sessions; sign in again after a successful change. Ordinary logout clears only the
current browser's cookie, not every issued session. Login/password verification attempts are bounded
and persisted. SWA-provider admins can edit their own profile but must change passwords through their
identity provider; local password management is not available for those accounts.

Browser demo credentials and identity are memory-only; reload/logout discards the demo identity.
No password or session override is written to browser storage. Profile/password changes, form drafts,
publishing and activity are unavailable in demo mode; draft previews disallow all mutations.

## Versioned forms and limits

The public form loads the published configuration. Submissions send `{formVersion, answerValues}`
with stable question IDs and typed values (numbers remain numbers; multi-choice answers are arrays).
The API derives booking fields and validates the active branch; historical records retain the form
version, typed answers and answer labels. Legacy records remain readable. Draft saves do not change
the public form. Publishing uses a conditional state update and create-only version snapshots;
stale submissions or draft revisions receive 409 and require refreshing the latest form/draft.
Existing published/draft data is never overwritten by changes to source defaults, builds or restarts.
Invalid persisted configurations fail closed, not back to the source form.

- Supported types: text, textarea, email, number, date, single choice and multiple choice.
- At most **60 questions, 20 sections and 50 choices per question**. JSON is capped at
  **30 KiB measured as UTF-16**; the combined stored draft/published state must also fit, so
  an individually valid configuration may still be too large to save alongside the live form.
- Titles/choice labels/short answers are limited to 200 characters, help/section descriptions to
  1,000, and textarea answers to 2,000. Stable IDs have at most 64 characters. Numeric bounds
  are constrained to ±1,000,000; participant counts must be positive integers.
- Choice labels are persisted answer values, not independent stable option IDs. Renaming a choice
  changes values for future submissions, not historical snapshots. Display order does not change
  routing; explicit next/choice targets determine the validated acyclic graph.
- Essential requestor, division, category, date, facilitator, time and venue mappings must remain
  required on every submission path. Date/facilitator/time types and scheduling semantics are
  protected; custom fields cannot bypass them.
- Text and constrained theme tokens only: no arbitrary HTML, CSS, JavaScript, uploads or scripting.

Storage collections use **SdrfBookings, SdrfBlocks, SdrfAccounts, SdrfSettings and SdrfActivity**.
Activity records omit passwords, credential hashes, tokens and full personal-data snapshots. Audit
append and the primary mutation are **not atomic** across collections: a committed change can return
`auditRecorded:false` / `X-Audit-Recorded:false`; show the warning and **do not retry that mutation**.
This is operational history, not a tamper-proof compliance ledger. Activity pagination returns
25 rows per page but currently scans, filters and sorts the collection in memory, rather than
using storage continuation tokens; it is not optimized for large histories.

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
cd api && npm install && npm run build && cd ..
swa start
```
Open http://localhost:4280 → **Admin Login** → log in with the configured API account credentials.
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

### Independent package prerequisite (local build only)

Run **`npm run build` from `api/` in the full repository before packaging**. It copies canonical
`app/form-config.js` and `app/form-schema.js` into generated, gitignored `api/src/form-assets/`.
Repository API runs load canonical `app/` files; an API-only package loads only these built copies.
Missing or broken assets fail closed. Do not rely on production install/prestart to build: the
canonical frontend sources and build script are intentionally absent from the API package.
Dependency installation alone does not create these assets. Rebuild after shared asset changes,
include the copies in the complete packaged `src/` tree, and coordinate matching frontend/backend
releases for schema/transport updates. Building does not publish a form, overwrite stored defaults,
deploy infrastructure or upload code. See `infra/PACKAGING.md` for the packaging inventory.

### Isolated verification

Run `npm test` from `api/`, or `node --test api/test/*.test.js` from the repository root.
If the optional `rtk` proxy is unavailable, direct Node is supported. Tests use temporary local
files/in-memory stores, mocked browser transport and API-only package fixtures; they do not use
real accounts, publish live forms, modify shared data or deploy.

Existing target: **SellerDevelopment**, Standard Static Web App in **PersonalRG**, Primary Subscription
`2a77b3d9-39da-4b42-8219-c6fd9b8a6165`. Storage account: **sellerdevelopment**, Southeast Asia.

1. Provision a separately hosted Function App with managed identity after region, hosting costs,
   runtime-storage configuration and quota are approved. Managed SWA functions do not support managed identity.
2. Build shared assets as above, then package/deploy the API separately; retain the default `/api` route prefix.
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

- Every push to `main` updates the existing production Static Web App.
- Pull requests against `main` create or update PR previews only; closing a PR performs
  authenticated cleanup of that preview.
- `dev` is for local development. Pushes to `dev` do not deploy a stable environment;
  an open PR against `main` can still receive preview updates.
- The linked Functions API is deployed separately and remains unchanged. The frontend
  workflow keeps `api_location` empty; there is no production API pipeline.
- The legacy ambitious-sky workflow remains manual-only.

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
  or authorized SWA provider identity inside the API; profile, draft, publish and activity routes are also protected.
  Requests without a valid admin identity get 401. Browser admin writes require `X-Admin-Request: 1`
  and exact origin checks; no permissive CORS is added. For a linked backend, set
  `ADMIN_ALLOWED_ORIGINS` to a comma-separated list of exact HTTPS origins (no paths or trailing
  slashes), including the custom domain and default SWA origin. This list is authoritative, not
  supplemented by forwarded host headers; unlisted origins and malformed configuration fail closed.
  Without this setting, local/development requests use exact request/forwarded-host matching.
  Cross-site requests and writes missing the required header remain rejected in either mode.
- Public endpoints include `POST /api/bookings`, `GET /api/form-config`, `GET /api/availability`
  (no personal data), `GET /api/health` and `POST /api/auth/login`.
- Explicit quick UI test mode checks development credentials in the browser on localhost only.
  Deployed logins require a healthy linked API; API outages never silently store responses locally.
