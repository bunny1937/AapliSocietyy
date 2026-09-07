// app/api/v1/cron/escalate/route.js
//
// ## Why this file exists
//
// cron-job.org has a job named "Escalate" pointed at
//
//   https://aaplisociety.visync.in/api/v1/cron/escalate
//
// which has never existed. The real escalation route is
// /api/v1/cron/escalate-visitors (a superseded duplicate at
// /api/visitor/cron/escalate was removed during the 2026-08-14 security
// remediation pass — it wasn't in the confirmed list of live cron URLs).
// That cron-job.org job has therefore reported "Failed (HTTP error)" on
// every single run since it was created — it is a 404, not a bug in the
// sweep itself.
//
// Two ways to fix it. This file is the safer one because it needs no dashboard
// change and cannot be forgotten:
//
//   A. (this file) Add the missing route as a thin alias. The existing URL in
//      cron-job.org starts returning 200 on the next deploy.
//   B. Edit the job in cron-job.org to point at /api/v1/cron/escalate-visitors
//      and delete this file.
//
// Do NOT do both and leave both jobs enabled — that runs the same sweep twice
// per tick for no benefit. Since you already have a working
// "AapliSociety – escalate visitors" job hitting escalate-visitors directly,
// the cleanest end state is: keep this alias deployed (harmless), and DISABLE
// or delete the broken "Escalate" job in the dashboard.
//
// Route segment config is declared explicitly rather than re-exported — Next
// only statically analyses these when they are literal declarations in the
// route file itself.
import { GET as escalateVisitors } from "../escalate-visitors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = escalateVisitors;
export const POST = escalateVisitors;
