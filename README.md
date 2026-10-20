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

## Booking reservations and pending requests

Pending requests do not reserve a facilitator's time or appear as booked in public availability.
Multiple pending requests may share the same facilitator, date and overlapping time. Only
Approved and Completed bookings reserve time; Rejected and Cancelled bookings do not.
Blocked dates remain unavailable. New requests are still rejected when they overlap a confirmed
reservation. Pending requests remain visible in administrator queues and calendars.

Dashboard summary tiles are keyboard-accessible toggle buttons. Selecting a tile highlights it
and displays all matching bookings in a highlighted results panel; Conflicts preserves grouped
conflict details. Select another tile to switch, or select it again/use Clear selection to restore
the overview. Selection stays in memory across data refresh and navigation, with updated counts,
empty-category guidance and announced result changes. Booking and reservation rules are unchanged.

Administrators also see informational conflicts between Pending, Approved and Completed
bookings sharing a date/facilitator and overlapping time. The dashboard counts unique affected
bookings and groups connected overlaps, while the bookings table provides text badges and a
Conflicts only filter. Booking details link to competing requests and refresh warnings as schedule
fields change. Approval warns about competing pending requests without treating them as reservations.
Rejected/Cancelled requests are excluded; blocked-date warnings remain. Informational warnings
never change public availability or server-enforced reservation checks.

Approval rechecks confirmed reservations. Administrator edits and training acceptance share a
versioned scheduling guard committed atomically with the booking in the existing bookings
partition, preventing simultaneous approvals of overlapping pending requests across API instances.
A scheduling conflict leaves the losing request pending. Explicit administrator conflict overrides
remain supported. Existing records need no status migration; the separately deployed API must be
updated for live availability and conflict rules to change. Browser demo scheduling uses the same
reservation statuses.

## Activity attribution

New booking submission events snapshot the validated requestor name with a Self-reported label;
this name is not proof of identity. Signed-in actions snapshot the actor's display name, username,
role and account ID independently of the booking requestor or modified account. Later profile
changes do not rewrite historical events. Older records are labelled Not recorded and are not
reconstructed from current bookings. The log is operational history, not a tamper-proof ledger.

Administrators can search actors, filter actor types and actions, set inclusive From/To dates,
clear filters and expand event details. Filters apply before pagination. Friendly action names
are displayed while technical actions, timestamps and target IDs remain available in details.
Related booking links may be unavailable after deletion or until the dashboard data refreshes.

IP addresses and geolocation are not collected in this release. Event details explicitly show
Source unavailable; enabling masked network attribution requires a verified proxy trust model
and agreed retention/privacy policy. No third-party location lookups are performed. Activity
remains administrator-only and never contains passwords, tokens, cookies or complete request bodies.
Deploy the updated API before relying on actor snapshots and the new filters in production.

## Facilitator account management

The administrator's Facilitator accounts workspace provides account totals, active/disabled
filters, username/facilitator search, and CSV export of the filtered directory. Exports contain
only usernames, assignments, status and recorded creation/update timestamps, never credentials;
spreadsheet formula prefixes are neutralized. Disabled accounts retain their facilitator assignment.

Create accounts or manage assignments in a keyboard-accessible details drawer. Password resets
and enable/disable actions have separate confirmation flows. Initial/reset passwords must have
12–128 characters; the generator uses browser cryptographic randomness to produce 20 characters.
Reveal/copy controls are explicit, passwords are not saved to browser storage, and password fields
are cleared when the drawer closes. Hand credentials over through an approved private channel;
clear the clipboard afterward. Unsaved changes prompt before leaving; saves block duplicate actions.
Assignment, password and status updates invalidate sessions; contact-only updates preserve them.
Disabling prevents sign-in without deleting account or training history.

My profile is available to both administrators and facilitators for their own display name,
email and optional phone. The page has Contact details and Security sections, read-only username,
role and facilitator assignment, unchanged-save protection, cancellation and inline feedback.
Administrators can create facilitator contacts and edit them separately from assignments in account
details; directory search includes display names and email. Email is contact information only,
not a verified address, sign-in identifier or password-recovery mechanism. Contact information
is not published in availability or recorded in audit summaries; CSV exports remain contact-free. Administrator authorization and unique assignments remain API-enforced.
Activity actor metadata separately snapshots the signed-in actor's display name, not the modified
account's contact payload. Administrator authorization and unique assignments remain API-enforced.

Account details show paginated recorded activity filtered by account ID. Older records may show
“Not recorded” timestamps or generic update summaries. This is operational history, not a complete
compliance ledger; failed activity recording is surfaced without suggesting a mutation retry.
Backend updates are required for timestamps, account-target filtering and detailed update summaries.
Do not perform account mutation tests against the localhost shared-production endpoint.

## Opt-in localhost with production tables

`api/scripts/start-shared-production.ps1 -AcknowledgeLiveWrites -CsatKeyFile <encrypted-key.xml>`
runs current workspace frontend/API on localhost:4281 using the exact production tables.
Use Node22 and Azure CLI authentication to the production tenant with approved table-scoped
Storage Table Data Contributor access. The key file is an Export-Clixml SecureString,
protected for the current Windows user; never commit it or copy the production session secret.
The launcher generates a separate local login-session secret and uses the dedicated shared
CSAT key. Production still accepts legacy shared links; new s2 links use the separate key.
Distributed QR links point to the live HTTPS survey, not localhost.

This mode fails if prerequisites/table access are missing, never creates tables or bootstraps
an admin, and displays LOCAL CODE / LIVE DATA warnings. Local writes affect live bookings,
accounts, form publication and feedback. Ordinary isolated JSON tests remain available and
existing isolated records are not merged. Shared production is not safe for destructive tests.
Local code iteration avoids deployments, but Azure network latency and transaction costs remain.

## Frontend/backend release compatibility

Production uses a separately linked Functions API. Updating the Static Web App alone
never deploys backend routes. Build and deploy the compatible independent API first;
`GET /api/health` exposes non-sensitive protocol, release and feature capabilities.
Production frontend pushes run `api/scripts/check-production-compatibility.js` and fail
before upload if the backend is incompatible. PR previews do not query this production gate.
New CSAT/account operations show **Backend update required** with a compatibility retry
when unavailable, without disabling existing core booking/profile behavior.

Local facilitator accounts are not production accounts. Create them through the live
Facilitator accounts screen using new credentials; never copy local settings/signing
secrets or the development database. Preserve existing account records and storage when
releasing backend code. If rollback is necessary after new data exists, prefer a compatible
frontend rollback rather than downgrading the account/storage-aware API.

## Reporting

**Admin → Reporting** provides a read-only training report with summary metrics,
monthly booking trends, booking status, popular topics and facilitator workload.
Expand **Explore categories, divisions, leaders and venues** for more breakdowns;
every chart includes an exact-value table. Section links jump to Overview, Training
demand, Feedback and Records.

Filters use inclusive training dates and apply to charts, records and CSV exports.
**Export summary CSV** shares totals; **Export booking CSV** includes every matching
record, not just the current page. **Print / Save PDF** expands all breakdowns and
includes all matching records. Completion rate is Completed divided by all matching
bookings. Reserved hours sum Approved and Completed time slots, not unique capacity.
CSAT loads on demand for eligible Phone Videography sessions; local demo mode has no
CSAT data. Accounts, activity and form settings stay in their dedicated menus.

## Phone Videography CSAT and facilitator access

**Admin → Facilitator accounts** creates local username/password accounts mapped
explicitly to a Training Facilitator label. Use a unique username and a 12–128
character password and hand credentials over privately. Admins can change the mapping,
disable/reactivate accounts, or reset passwords; changes invalidate existing sessions.
One account is reserved per facilitator label. The existing bootstrap admin and optional
SWA admin login remain supported. Facilitators use the same `/admin/` login but see
only **CSAT / Training** and **My profile**. Assignment comes from the persisted mapping,
not the user's editable display name. Unmapped sessions remain administrator-only.

Facilitators can read their assigned sessions, **Accept request** or **Decline request**
for assigned Pending bookings, register attendees, complete approved Phone Videography
sessions, and see their named responses and rating averages. Acceptance changes Pending
to Approved; decline changes it to Rejected. Both require confirmation, record the actor,
and reject stale/non-Pending decisions. Acceptance checks scheduling conflicts; only
admins can override conflicts. Facilitators cannot reschedule/delete bookings, change
shared settings or forms, manage accounts/blocked dates, or read global activity.
Authorization and assignment checks are enforced by the API.

**CSAT / Training → Attendees and CSAT** now defaults to one **Session CSAT link and QR**.
No attendee registration is needed: attendees open the link or scan the QR and answer the
survey. Sharing metadata is created with new Phone Videography requests and initialized
on demand for older requests. The link remains closed until an admin or assigned facilitator
completes an Approved session. Previously Completed bookings still require explicit admin
activation; other modules do not activate CSAT. Requesters see read-only link/QR controls
in their owned **My Request** detail only when CSAT is open, without access to results.

Staff can copy the same retrievable link, download its QR as PNG, revoke sharing or rotate
its URL/QR. Reactivation generates a new URL. Rotation/revocation does not delete responses
or affect legacy individual invitations. Links use a purpose-specific HMAC and persisted
nonce, not a raw stored secret. Changing SESSION_SECRET invalidates existing shared URLs;
reload sharing controls and redistribute the regenerated URL/QR afterward. Links are bearer
access, not verified attendee identity. Anyone holding a shared link can submit multiple
responses; **Submit another response** starts a blank form. Each attempt has an idempotency
ID so network retries do not duplicate that attempt. Shared submissions are throttled at
300 successful new responses per session per minute for service protection, not identity
or expected participant enforcement.

The QR is generated locally with MIT-licensed qrcode-generator 2.0.4; no link is sent to an
external QR service. Refresh the checked-in browser asset with `npm run build:qr` in `api/`
after changing that dependency. Keep its license notice with the asset. The independent
jsqr decoder is a development-only test dependency. A localhost QR points to the scanner's
own device: phone testing needs a reachable development hostname or deployed HTTPS origin.
No firewall or external network exposure is configured automatically.

**Legacy individual invitations** remains a collapsed optional workflow. Existing registered
attendees and their responses are preserved (maximum 2000 legacy attendees per session).
Each individual invitation still permits only one final response, with no reset after
submission. Raw individual tokens are stored only as hashes and cannot be recovered;
Reissue invalidates the old token and Revoke closes an unanswered invitation. Optional
legacy email is metadata only; no email is sent. All tokens travel in URL fragments and
POST bodies; reopen the original link after a page reload because fragments are removed.
No automatic expiry is configured. Reopening/cancelling a booking or changing its topic
away from Phone Videography blocks new responses; existing responses remain saved.
Returning an activated session to Completed requires approval first. Deleting a booking
makes its invitations inaccessible but retains its attendee/response records for controlled
retention. There is no automatic CSAT purge; authorized storage operators must apply the
organization's retention/deletion policy to the booking and related attendee records.

The CSAT page uses a **one-question-per-slide carousel**, branch-aware progress and
large numbered 1–5 rating tiles. Pointer rating selection confirms briefly and advances;
keyboard users can select with arrow keys and confirm with Next or Enter. Back allows
corrections, feedback has character counters, and only the final comments slide submits.
Answers remain in memory, not browser draft storage. Published application palettes,
card/glass settings and saved/system light/dark mode are applied, with a Dark mode switch
and reduced-motion support. Theme-loading failures retain usable shared defaults.

The in-app survey reproduces the authorized source's six divisions and director/officer
branches, including OMF's direct skip and the duplicate OJ choice with separate IDs.
It contains five required 1–5 satisfaction ratings and two required text answers. Name
(maximum 200 characters), branch choice where applicable, division and all evaluation
answers are required; evaluation text allows 2000 characters per answer. Existing
Microsoft Forms responses are not imported and submissions are not sent to Microsoft
Forms. Named answers are visible only to admins and the currently assigned facilitator.

CSAT records are typed rows in the existing `SdrfBookings` table (same partition for
atomic booking/invitation transactions); they are excluded from ordinary booking lists.
Legacy responses remain on attendee rows; shared responses use independent typed response
rows rather than booking JSON. Staff results combine both sources and display total
submissions, without claiming a response rate against a registered roster. Account
uniqueness uses an atomic directory/account transaction in `SdrfAccounts`. Concurrent
completion, roster, invitation or response changes fail with a recoverable 409 instead of
overwriting state. Refresh after a conflict; after a lost submission response the survey
checks whether the invitation was already consumed. Audit failures report a saved-operation
warning: do not repeat a saved operation blindly. No new Azure service is required.
CSAT/account management requires the API and is unavailable in browser-only demo mode.

API routes: `/api/manage/facilitators[/{id}]`, `/api/training-sessions[/{id}]`,
`/api/training-sessions/{id}/complete`, `/api/training-sessions/{id}/decision`,
`/api/training-sessions/{id}/sharing` (GET, or POST rotate/revoke/reactivate),
`/api/training-sessions/{id}/attendees`,
`/api/training-sessions/{id}/attendees/{attendeeId}/invitation`, and public POST
`/api/csat/resolve` and `/api/csat/submit`. Deploy the `/csat/` static page and include
canonical `csat-config.js` and `csat-schema.js` in the independent API asset build.

## Anonymous request history

**My Request** at the top left of the public header opens this browser's previous
and newly created requests, newest first, with pagination, current status and read-only
submitted answers. The submission confirmation also provides **View my requests**.
No login or physical-device fingerprinting is used. A server-generated HttpOnly,
SameSite=Strict cookie scoped to `/api` grants access for one year, renewed on return;
production uses Secure cookies. Only the token hash is stored with each new request.
History responses are not cached and exclude internal admin notes and ownership data.

Requests remain in shared server storage under the existing retention policy. Clearing
cookies removes access, not the requests. Private browsing, blocked cookies, a different
browser/profile or a different device may have no history. Anyone sharing the browser
profile can see its history. There is no recovery code, cross-device sync, editing or
cancellation in this feature; earlier unowned requests cannot be claimed retroactively.
A successful submission is still saved if history access cannot be confirmed; the
confirmation warns against resubmitting it. Draft preview does not initialize history.
The explicit localhost `?storage=local` demo uses browser storage only and is not a
production persistence mechanism.

Public endpoints: `GET /api/my-requests?cursor=...` returns
`{items,nextCursor,recognized}`; `GET /api/my-requests/{id}` returns an owned request's
safe detail or 404. Both derive ownership from the cookie, never a client-supplied
owner identifier. History reads time out after ten seconds so initialization cannot
block submission indefinitely. Azure Table queries filter ownership server-side;
that property is not indexed, so large datasets may require an indexed history store.

## Application design and appearance

Public and admin screens share a slate-and-teal design system in `app/design-tokens.css`
and accessible theme controls in `app/ui-controls.css`. Question titles focused during
section navigation have no colored outline; interactive controls retain focus indicators. Semantic light/dark colors cover
surfaces, text, focus, status feedback, tables, calendars, and dialogs. The shared
`app/theme.js` applies the saved preference before page rendering and synchronizes
changes across same-origin pages, including draft previews. If storage is unavailable,
the switch still works for the current page.

The admin portal uses a desktop sidebar and expandable mobile navigation, retaining
all nine destinations and unsaved-draft protections. The theme switch is available
both at login and within the portal. Published form accent/background choices remain
unchanged; light mode respects those settings, while dark mode uses accessible viewer
colors without saving changes to the form. The teal bootstrap default applies only to
configurations without an explicit theme, not existing saved drafts or published forms.
Public action buttons use compact padding while retaining 44px minimum touch heights;
option tiles and full-width mobile submission remain unchanged.
No external fonts, UI framework, or additional runtime dependency is needed.

### Liquid Glass-inspired appearance and Settings

**Admin → Settings → Appearance** offers **Liquid glass** (40% transparency,
4px blur), **Frosted glass** (20% transparency, 16px blur), and **Solid** presets.
The shared material treatment covers public and admin surfaces, with rounded controls
and reflective depth. Fine-tune transparency and blur in **Form Builder**. Existing and new forms default to **disabled**, with a preset
of **20% transparency and 12px frost blur**. Transparency accepts 0–40%; blur accepts
0–20px. Readability caps effective transparency at 20% in light mode and 10% in dark
mode, regardless of the configured background. Text, inputs, actions and status
feedback remain opaque. **Reset and disable glass** restores the preset and disables
it without changing other appearance settings.

Settings also offers independent **light and dark color palettes**, with Teal, Ocean,
Violet and Rose presets, custom accent/background color pickers, and side-by-side
previews. Unpublished color edits preview only inside Settings, and the light/dark
switch selects the corresponding draft palette. Leaving Settings restores the published
palette without changing the selected mode. All other admin tabs and the booking page
use the same published colors. Saved drafts remain available when Settings is reopened;
discarding unsaved changes preserves the saved draft. Publishing applies the new palettes
everywhere. Visitors retain their own mode preferences.
After publishing, loading or refreshing the booking page applies both published palettes
globally, including the header, form cards, controls and keyboard focus indicators.
Both entry points restore the last published light/dark palettes from a same-origin browser
cache before styles load. They briefly wait for fresh validated configuration before revealing
the page (up to 1.5 seconds), releasing immediately on success or failure. Slow or failed
loads fall back to cached colors, or defaults if storage is unavailable; a later successful
response remains authoritative. Different origins have separate caches. Settings previews
and authenticated draft previews never overwrite the published palette cache.
Saving a draft alone does not change the public booking page; already-open visitor pages
receive published updates on their next load or refresh. Text, surfaces, focus and button colors adapt for
contrast; accents may be adjusted and custom glass made more opaque for readability. Legacy forms retain the default
dark palette. Custom colors accept six-digit hex values; optional `darkPrimary` and
`darkBackground` extend the existing light `primary` and `background` fields.

**Page layout & style** controls comfortable/compact spacing, narrow/standard/wide
content width, and outlined/elevated/flat cards across the booking page and every admin
tab. Layout remains responsive and unchanged when switching light/dark modes. These
controls share the Form Builder theme fields; unsaved choices update only the Settings
sample, not the live application.

Use **Save draft → Preview form → Publish** to apply changes. These actions save or
publish the **entire form draft**, not just appearance. Saving alone does not change
the live site. Settings also provides scheduling safeguards, facilitator management,
CSV export, activity and account shortcuts. **Reduce motion** and **Reduce transparency**
are browser-local preferences shared across same-origin pages, not global admin changes.
They remain available in local mode; shared appearance requires the authenticated API.
Unsupported browsers,
reduced-transparency preferences and forced-colors mode retain solid surfaces;
Safari uses the prefixed backdrop-filter enhancement. Existing reduced-motion and
keyboard-focus behavior is preserved. Release the frontend and packaged API shared
schema together before publishing glass-enabled configurations; an older API schema
will reject the new appearance fields.

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
| Settings | Shared glass materials, light/dark color presets and custom palettes, application spacing/width/card style, browser-local accessibility preferences, scheduling safeguards and team/data/account shortcuts |

### Form builder
Select a numbered question to edit its label, answer type and hints. Advanced options stay under **Question routing**, **Choice routing**, **Form settings** and **Sections**. Apply choice edits before saving; unavailable move controls protect existing routes. Required booking fields cannot be removed or made optional.

Use **Save draft → Preview → Publish**. Saving does not change the live form; publishing makes the saved draft available to new requests. **Reload draft** discards unsaved edits after confirmation.

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

### VS Code Run and Debug (F5)

Open this repository folder in VS Code, select **Booking application (full stack)**
in **Run and Debug**, and press **F5**. The launcher starts the Functions API on
7071 with its Node inspector on 9229, starts the SWA frontend on 4281, waits for
readiness, and opens Edge with browser debugging at `http://localhost:4281/`.
Set frontend breakpoints in `app/` and backend breakpoints in `api/src/`.
The installed Node.js, Functions Core Tools v4 and SWA CLI must be on PATH;
install the API dependencies as described in Option B below before the first run.

Stop debugging to shut down the launcher and its service processes; start again
with F5. Close the debug browser when finished. For running without the browser
debugger, use **Terminal -> Run Task -> Run booking full stack** and stop its
terminal with Ctrl+C. Existing separate run tasks remain available.
If startup reports an occupied port, stop the existing API/frontend task or debug
session first; the launcher never terminates a process merely because it owns a port.

This workflow keeps `api/local.settings.json` unchanged. Your configured Azure
Table endpoint still uses your Azure credentials and Table data permissions, and
local requests use that configured storage, not an isolated test database.
For alternate ports, set `BOOKING_API_PORT`, `BOOKING_WEB_PORT` and
`BOOKING_INSPECT_PORT` in the launch configuration's `env` object; the defaults
are 7071, 4281 and 9229. The browser URL follows the selected frontend port.

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

### Linked API release smoke check

A frontend release does not install new API routes. Build and publish the verified source-only
API package separately as described in `infra/PACKAGING.md`, then run:

```powershell
node api\scripts\smoke-history.js https://sellerdevelopmentrf.clouditechsolution.com
```

This read-only check verifies new/returning anonymous history, production cookie flags,
unknown-detail privacy and Table-backed health. It creates no bookings and prints no cookie
values. A failure should block release acceptance; do not clear browser cookies or stored requests.
Run `node --test api\test\smoke-history.test.js` for isolated smoke-tool regression tests.

Automated backend publication still requires an approved Azure deployment identity and
GitHub authorization configuration. No repository environments or variables are currently
configured, and the existing SWA token is not a Function App deployment credential. Do not
reuse it, create credentials or grant deployment roles without approval. Keep `api_location`
empty for the separately linked backend.

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
