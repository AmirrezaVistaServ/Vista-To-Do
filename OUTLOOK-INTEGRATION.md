# Outlook follow-up flags → VISTA-To-Do

Prepared for Vista OSS, 19 October 2026.

## Status and scope
This source package adds a machine-to-machine import API, a durable duplicate ledger, an Exchange Online polling adapter, and tests. It has NOT connected to your mailbox, been deployed to the existing hosted site, or scheduled any live imports. Exchange Online versus on-premises Exchange still needs confirmation.

Exchange Online: use the supplied Microsoft Graph adapter after administrator configuration. On-premises Exchange: OSS must implement an approved Exchange-specific reader that sends the same payload to the import endpoint. The included Graph adapter does not provide an on-premises connector.

The first enabled run imports all currently flagged emails in each configured mailbox, including old flags. Subsequent runs scan active flags again; the ledger prevents repeat tasks, even after a task is deleted. This is periodic detection, not real-time event delivery. Flags added and cleared between polls are not captured. Outlook categories are ignored.

## What is created
Email subject → task title (up to 200 characters). Plain-text body → description (up to 12,000 characters), along with sender and original email link. Outlook follow-up due date → task deadline when available. Server-side mailbox mapping → assignee. Status starts at To do, priority Normal.

Import is one-way and create-only. Later email edits, changed deadlines, cleared/completed flags and Vista status changes do not update the other system. Imported tasks use the existing dashboard, projects and Kanban UI. Refresh the real workspace to see background imports; demo mode does not show them. Email attachments are not automatically copied; the existing manual task attachment feature remains available.

## Files added
- app/api/integrations/outlook/import/route.ts: POST endpoint.
- integrations/outlook/import-service.mjs: authentication, input validation, mapping, task creation and deduplication.
- integrations/outlook/graph-poller.mjs: Exchange Online one-pass polling job.
- db/schema.ts and drizzle/0001_fine_rick_jones.sql plus migration metadata: durable import ledger.
- tests/outlook-import.test.mjs: automated tests using SQLite and mocked Graph responses.

## 1. Prepare the Vista server
Deploy the application source to an OSS-controlled host with D1 and the existing bindings. Apply the new migration after the existing 0000 migration using your migration process. Never replay 0000 on an existing database. For a fresh local database, apply both files in order after a build, using the command pattern in README-OSS.md.

Configure these server-only environment variables:

```text
OUTLOOK_IMPORT_TOKEN=<random secret of at least 32 characters>
OUTLOOK_MAILBOX_MAP={"employee@your-company.example":{"owner":"<existing workspace user ID>","assignee":"<existing member ID>"}}
```

Generate a token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` on a trusted OSS machine and store it in a secret manager. Do not commit real tokens, secrets or mailbox mappings to GitHub. This import token is separate from Microsoft credentials.

Create/save the target real workspace and member before configuring the mapping. `owner` is the stable authenticated user ID used by the workspaces.owner column, NOT an email address or GitHub username. Obtain it through authorized server/database administration. `assignee` is that workspace's member ID, available in its JSON export. Multiple mailboxes may map to the same owner with different assignees. Payloads cannot override owner or assignee.

Endpoint: `POST https://<your-vista-host>/api/integrations/outlook/import`.

The endpoint verifies its own bearer token. The existing ChatGPT-hosted site is owner-private and its gateway may block machine requests before they reach this route. This package does not bypass that gateway. OSS must use an approved machine-accessible deployment/ingress and verify service-to-service access. Do not make the whole workspace public to make imports work. Protect the user-facing application with company authentication; see README-OSS.md for the current trusted-header adapter limitations.

## 2. Configure Microsoft access (Exchange Online only)
Have the Microsoft administrator register an application in the correct tenant, authorize application Mail.Read for the email body, and restrict effective mailbox access to the approved mailboxes using the company's Exchange application-access controls. A poller mailbox list alone is not a Microsoft permission boundary. No Mail.ReadWrite or send-mail permission is needed by this implementation. The provided adapter uses an application client secret; production teams may replace it with certificate/federated credentials according to company policy.

Set these variables in the scheduler's secret/environment configuration:

```text
MS_TENANT_ID=<tenant ID>
MS_CLIENT_ID=<application ID>
MS_CLIENT_SECRET=<secret from approved app registration>
OUTLOOK_MAILBOXES=employee@your-company.example
VISTA_IMPORT_URL=https://<your-vista-host>/api/integrations/outlook/import
OUTLOOK_IMPORT_TOKEN=<same secret as Vista server>
OUTLOOK_SYNC_ENABLED=true
OUTLOOK_DRY_RUN=true
```

Use canonical primary mailbox addresses consistently. The duplicate key combines owner, mailbox and immutable message ID; changing the mailbox spelling/alias or owner mapping can result in a new task. The adapter requests immutable Graph IDs, follows pagination, and retries HTTP 429/5xx responses with bounded backoff. It does not log email text or tokens. It rejects unexpected pagination origins and redirects.

## 3. Test and activate
Use Node.js 24 for the included test suite (node:sqlite). The application requires Node >=22.13.0.

```sh
node --test tests/outlook-import.test.mjs
node integrations/outlook/graph-poller.mjs
```

The poller defaults to disabled unless OUTLOOK_SYNC_ENABLED=true. With dry-run enabled it reads flagged messages and reports counts but does not create tasks. Review those counts before setting OUTLOOK_DRY_RUN=false. Then run it once and verify task title, assigned person, deadline and email link in the real workspace. Run again and confirm no duplicate task is created. Do not use a real mailbox for an unauthorized trial.

Schedule the one-pass command on an approved OSS server, for example every five minutes. No schedule is created by this package. Prevent overlapping jobs to reduce contention, capture exit status, monitor failures and handle secret rotation. On a network failure, subsequent runs can safely retry imports. A token expiry during a long scan causes failure; the next scheduled run obtains a fresh token and safely scans again. The scan is intended for a modest number of flagged messages; OSS should add delta tracking or another scalable strategy if mailbox volume requires it.

Stop by disabling the scheduled job or setting OUTLOOK_SYNC_ENABLED=false. Remove/rotate the Vista import token to revoke import access.

## API contract for an on-premises Exchange adapter
Authenticate with `Authorization: Bearer <OUTLOOK_IMPORT_TOKEN>` and Content-Type application/json. Send one active flagged email per request:

```json
{
  "mailbox": "employee@your-company.example",
  "messageId": "stable-message-identifier-from-approved-adapter",
  "flagStatus": "flagged",
  "subject": "Review the site audit report",
  "bodyText": "Please review the attached findings.",
  "sender": "manager@your-company.example",
  "due": "2026-10-20T09:00:00+03:30",
  "webLink": "https://your-approved-webmail.example/message"
}
```

Optional fields may be omitted except mailbox, messageId and flagStatus. Use a stable identifier across folder moves; do not change identifier strategies without migrating the ledger. Convert deadlines to ISO 8601 with a timezone. Graph adapter supports UTC, explicit offsets, and Tehran dates from 2023 onward; it rejects unsupported timezone values instead of guessing. Extend conversion for other mailbox timezones before enabling them. Description remains plain text. Links must use HTTPS.

201: created. 200: already_imported with original task ID (even if task was deleted). 400: invalid input. 401: invalid token. 403: mailbox not mapped. 409: missing workspace/assignee, capacity or contention; fix the configuration or retry as appropriate. 413: payload over 64 KiB. 415: wrong content type. 503: disabled configuration or storage/migration issue. No email data is returned in error responses.

The ledger and workspace write use one D1 transactional batch. The revision check preserves concurrent user edits; revision conflicts retry. Keep ledger records for as long as re-import prevention is needed. Deleting ledger records intentionally allows a message to be imported again. General workspace export does not export the ledger; include it in server backups.

## Verification limits
Tests cover creation, assignment/deadline mapping, replay after completion/deletion, concurrent retries, stale revisions, bad authorization, invalid flags/dates/links, unmapped mailboxes, missing assignees, and Graph pagination/dry-run behavior. TypeScript and production build were checked locally. SQLite/mocked-network tests are not a live Exchange, deployed D1, or browser integration test. OSS must validate those in staging before enabling imports.

## Microsoft references
- https://learn.microsoft.com/en-us/graph/api/resources/followupflag?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/outlook-immutable-id
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
