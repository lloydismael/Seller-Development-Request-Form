# Seller Development Request Form + Admin Portal

Azure Static Web App: public booking form (`/`) and an administrator portal (`/admin/`),
backed by a managed Azure Functions API (`/api`) and Azure Table Storage.

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

When running on `localhost`, the login screen shows these defaults and a **Use default credentials** button.
They are hidden on the deployed site.

**Change them before going live:** set these app settings (Static Web App → Environment variables), or edit
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
Open the URL shown → **Admin Login** → **Use default credentials** → **Log in**.
Data is kept in browser storage; use **Load sample data** in the yellow bar to fill the calendar.

### Option B – full stack (same as Azure)
Prerequisites: Node.js 20, then:
```bash
npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
cd api && npm install && cd ..
swa start
```
Open http://localhost:4280 → **Admin Login** → log in with the default credentials.
Data is saved to `api/.data/db.json`. To use Azurite or a real storage account, set
`STORAGE_CONNECTION_STRING` in `api/local.settings.json` (Azurite: `UseDevelopmentStorage=true`).

## Deploy to Azure Static Web Apps
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
- Quick UI test mode (no API) checks the default credentials in the browser. That is for local testing only;
  always deploy with the `api` folder so logins are verified on the server.
