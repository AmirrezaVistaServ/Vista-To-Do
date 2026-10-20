# VISTA-To-Do — OSS handover

Updated 19 October 2026: Outlook follow-up flag import code is included. Read OUTLOOK-INTEGRATION.md for configuration, testing and remaining Exchange requirements. The original hosted application has not been updated by this handover.

Source snapshot: da8b0de1380092db6636aba931a9ce8332de543a
Prepared: 18 October 2026

## Start here
This package contains the current task-management prototype and Vista assets. Import the extracted folder into your company Git repository. This is a source handover, not an installer or a production-ready multi-user deployment. No live workspace records, uploaded attachments, dependencies, credentials, or Git history are included. Fictional demo records are included in lib/demo-data.ts.

## Local development
Use Node.js >=22.13.0 and pnpm 11.25.0 (the version pinned in package.json). From the extracted project folder:

```sh
pnpm install --frozen-lockfile
pnpm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_wet_sentry.sql
pnpm run dev
```

Apply the initial SQL only to a fresh local database. Use the localhost URL printed by the dev server, normally port 5173. Visit /signin-with-chatgpt?return_to=/ on that origin to use the portable local mock identity. The clean checkout defaults to the portable profile. Demo mode is initially on; select “Switch to my real data” to test local persistence and attachments. Local data stays on the developer's machine. The package retains the DB and BUCKET declarations but removes the original hosted project ID to avoid targeting the existing site.

The source build and TypeScript checks passed in the originating managed environment. These local setup instructions follow the included starter configuration; a clean installation on your team's machines has not been tested. See STARTER-REFERENCE.md for the framework notes; use pnpm and the supplied pnpm lockfile rather than that reference's generic npm install examples.

## Implemented functions
- Task creation/editing, assignee records, priorities, deadlines, notes and activity.
- Dashboard charts, clickable KPIs, task results and filters.
- To do, In progress, In review, Completed and Cancelled statuses.
- Kanban drag/drop and status moves.
- Projects, follow-ups, results and calendar deadlines.
- In-app reminder popups, specific dates/times, daily/weekly and odd/even schedules.
- Tehran time and optional Persian date display.
- Multiple task attachments: upload, download and remove; 20 MB per file. Save new tasks before attaching files. Attachments save independently of task edits.
- Vista branding and fictional sample mode.

## Technical map
- app/desk.tsx: main workspace and task editor.
- app/dashboard.tsx, app/kanban.tsx, app/projects.tsx: dashboard, board and projects.
- app/reminder-controls.tsx and lib/reminders.ts: reminders and recurrence rules.
- app/task-attachments.tsx and app/api/attachments/route.ts: attachment UI and R2 API.
- app/api/workspace/route.ts: authenticated workspace reads/writes with revision conflict checks.
- app/chatgpt-auth.ts: identity adapter; app/page.tsx requires authentication.
- db/schema.ts and drizzle/: D1 schema and migration.
- app/globals.css and public/: appearance and branded assets.
- vite.config.ts, build/, scripts/: Vinext/Workers integration and local tooling.

Stack: React, TypeScript, Vinext, Cloudflare Workers, Drizzle/D1, R2. D1 stores each owner's workspace as one JSON document with an optimistic revision token. R2 stores files under owner/task prefixes. JSON exports contain workspace records, not attachment bytes.

## Work needed before a staff rollout
1. Replace ChatGPT identity with company SSO or an authenticated gateway. Current production auth trusts headers supplied by the Sites gateway. Never expose this adapter directly to untrusted client-supplied identity headers. Local mock login is development-only.
2. Design a shared workspace, membership and role model. Staff records currently are labels, not login accounts. Each signed-in owner has separate data. Sharing the frontend alone will not create a shared team workspace.
3. Enforce manager/member permissions on every task, project and attachment operation. Migrate owner-scoped data and R2 paths deliberately.
4. Add scheduled background reminders and the required email/SMS/push delivery. Current reminders only run while the app is open; selecting a staff reminder filter does not authenticate that staff member.
5. Configure production DB and file storage, backups, quotas, monitoring and recovery. If using another backend, replace the D1/R2 adapters while preserving UI behavior.
6. Add file scanning and agreed file-type policies if required. Files currently download as attachments, without inline execution. Define retention and cleanup: deleting a task makes its files inaccessible through the API but does not currently delete its R2 objects.
7. Review concurrent editing, scale, validation and audit requirements. A normalized database model may be preferable as staff use grows.
8. Test browser/mobile behavior, network access from staff locations, permissions and notification delivery before rollout.

## Verification and acceptance
The source passed a production build and TypeScript check. Mocked attachment API checks covered upload/list/download/delete, file-size rejection, cross-origin rejection, missing tasks, authentication and owner isolation. Browser QA and live end-to-end file transfer were not performed. The Outlook extension includes an automated test suite; see OUTLOOK-INTEGRATION.md.

OSS acceptance should cover: create and assign a task; save and reopen; upload/download a file and compare bytes; reject oversized upload; deny access from another user; move status on Kanban; filter dashboard results; review project deadlines; test recurrence in Tehran time; ensure completed/cancelled reminders stop; test persistence after refresh in real-data mode.

## Deployment and ownership
The reference site remains at https://vista-team-task-desk.livelycurry16.chatgpt.site and is owner-private. This ZIP does not grant access to that site or its hosted data. Choose a new company deployment target and configure its resources and authentication. Do not deploy over the existing site by accident. Preserve included third-party license notices; review dependency licensing and Vista asset permissions through your normal internal process.
