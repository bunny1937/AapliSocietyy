// lib/loadtest/runner.js
//
// Client-side load-test engine, v2. Still NOT a new backend process --
// every function here calls your EXISTING production routes
// (/api/auth/signup, /api/members/import, /api/billing/generate,
// /api/billing/upload-payments) directly from the browser, and reports
// real timing/status back through `emit(event)`.
//
// What changed from v1 (per your feedback on the two actual failed runs):
//   1. Every lane now runs against its OWN auto-provisioned, EMPTY society
//      (see provisioning.js) -- no more "where do I even add members",
//      and "generate for every member in the society" is now safe by
//      construction instead of by trusting a checkbox.
//   2. Every event carries the FULL raw response body (success or
//      failure) -- the v1 500 on import and 400 on payments-confirm were
//      both silently swallowed before; now they are captured verbatim.
//   3. A failed stage SKIPS only stages that depend on it (generate/pay
//      depend on import; payments-confirm depends on payments-preview).
//      Independent lanes are never affected by another lane's failure.
//   4. Two phases, matching "all 3 individually, then all 3 concurrently":
//        - runIndividualPhase: import -> generate -> pay, in order, one
//          lane at a time internally (sequential per lane) -- this is the
//          clean baseline measurement.
//        - runConcurrentPhase: a SECOND, non-overlapping batch of import +
//          generate (new period) + pay (against the baseline's bills) are
//          fired with Promise.all so they hit the server at the same
//          instant, and every lane's Promise.all runs at the same time
//          too -- true "every task simultaneously, across N societies".
//   5. Real per-request network phase timing (DNS/TCP/TLS/TTFB/download)
//      from the browser's Resource Timing API -- see timing.js -- instead
//      of a decorative animated dot.
//   6. computeStats() below gives p50/p90/p99 + requests/sec, the way
//      k6/JMeter report load tests, instead of only success/fail counts.

import { timedFetch } from "./timing";
import {
  buildMemberImportWorkbook,
  buildPaymentImportWorkbook,
  makeRunTag,
} from "./xlsxBuilders";

function authHeaders(lane) {
  return { Authorization: `Bearer ${lane.token}` };
}

async function runStage({ lane, stage, phase, url, options, emit }) {
  emit({ type: "request-start", lane: lane.id, stage, phase, url, at: Date.now() });
  const result = await timedFetch(url, options);
  emit({
    type: result.ok ? "request-success" : "request-fail",
    lane: lane.id,
    stage,
    phase,
    url,
    status: result.status,
    elapsedMs: result.elapsedMs,
    body: result.body,
    error: result.error,
    phases: result.phases,
    at: result.at,
  });
  return result;
}

// ---- Stage: bulk member import ----------------------------------------
export async function runMemberImport({ lane, file, stage = "import", phase, emit }) {
  const form = new FormData();
  form.append("file", file, "loadtest-members.xlsx");
  form.append("confirmImport", "true");
  return runStage({
    lane,
    stage,
    phase,
    url: "/api/members/import",
    options: { method: "POST", body: form, credentials: "omit", headers: authHeaders(lane) },
    emit,
  });
}

// ---- Stage: bulk bill generation ---------------------------------------
// No memberIds/bills sent -- the route targets every member currently in
// this lane's society. Safe because each lane's society is freshly
// provisioned and starts empty (see provisioning.js).
export async function runBillGenerate({ lane, year, month, stage = "generate", phase, emit }) {
  return runStage({
    lane,
    stage,
    phase,
    url: "/api/billing/generate",
    options: {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json", ...authHeaders(lane) },
      body: JSON.stringify({ year, month }),
    },
    emit,
  });
}

// ---- Stage: bulk payment processing (preview then confirm) -----------
export async function runPaymentProcess({ lane, file, stagePrefix = "payments", phase, emit }) {
  const form = new FormData();
  form.append("file", file, "loadtest-payments.xlsx");
  const preview = await runStage({
    lane,
    stage: `${stagePrefix}-preview`,
    phase,
    url: "/api/billing/upload-payments?action=preview",
    options: { method: "POST", body: form, credentials: "omit", headers: authHeaders(lane) },
    emit,
  });
  if (!preview.ok || !preview.body || !preview.body.batchKey) {
    emit({
      type: "stage-skipped",
      lane: lane.id,
      stage: `${stagePrefix}-confirm`,
      phase,
      reason: `Skipped: ${stagePrefix}-preview did not return a usable batchKey`,
      at: Date.now(),
    });
    return { preview, confirm: null };
  }
  const confirm = await runStage({
    lane,
    stage: `${stagePrefix}-confirm`,
    phase,
    url: "/api/billing/upload-payments?action=confirm",
    options: {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json", ...authHeaders(lane) },
      body: JSON.stringify({ batchKey: preview.body.batchKey, notes: "loadtest-lab" }),
    },
    emit,
  });
  return { preview, confirm };
}

function skip(emit, lane, stage, phase, reason) {
  emit({ type: "stage-skipped", lane: lane.id, stage, phase, reason, at: Date.now() });
}

// ---- Phase 1: individual/baseline -- import -> generate -> pay, in order
// for one lane. Dependent stages are skipped (not attempted) when an
// earlier stage they depend on fails, per your "skip dependents, keep
// independent lanes running" choice.
export async function runIndividualPhase({ lane, config, emit }) {
  const runTag = makeRunTag();
  emit({ type: "lane-start", lane: lane.id, phase: "individual", runTag, at: Date.now() });

  const importBlob = await buildMemberImportWorkbook({
    count: config.memberCount,
    runTag,
    startIndex: 1,
  });
  const importResult = await runMemberImport({ lane, file: importBlob, phase: "individual", emit });

  let genResult = null;
  if (importResult.ok) {
    genResult = await runBillGenerate({
      lane,
      year: config.year,
      month: config.month,
      phase: "individual",
      emit,
    });
  } else {
    skip(emit, lane, "generate", "individual", "Skipped: import failed, no members to bill");
    skip(emit, lane, "payments-preview", "individual", "Skipped: import failed upstream");
    skip(emit, lane, "payments-confirm", "individual", "Skipped: import failed upstream");
  }

  let payResult = null;
  if (genResult && genResult.ok) {
    const payBlob = await buildPaymentImportWorkbook({
      count: config.memberCount,
      month: config.month,
      year: config.year,
      amount: config.paymentAmount,
      runTag,
      startIndex: 1,
    });
    payResult = await runPaymentProcess({ lane, file: payBlob, phase: "individual", emit });
  } else if (importResult.ok) {
    skip(emit, lane, "payments-preview", "individual", "Skipped: bill generation failed or produced nothing to pay");
    skip(emit, lane, "payments-confirm", "individual", "Skipped: bill generation failed upstream");
  }

  emit({ type: "lane-complete", lane: lane.id, phase: "individual", runTag, at: Date.now() });
  return { runTag, importResult, genResult, payResult };
}

// ---- Phase 2: concurrent -- fires a SECOND, non-overlapping batch of all
// 3 tasks at once (Promise.all) within a lane, so generate isn't racing
// against a not-yet-committed import: the concurrent import batch targets
// new flatNos, concurrent generate targets a new month (so it can't clash
// with the baseline's bills or the concurrent import's not-yet-created
// members), and concurrent payments target the BASELINE phase's
// already-generated bills (which are guaranteed to exist by the time this
// phase runs). Every lane's Promise.all also runs at the same time as
// every other lane's, via the outer Promise.all in runFullLoadTest.
export async function runConcurrentPhase({ lane, config, baseline, emit }) {
  if (!baseline || !baseline.importResult?.ok) {
    skip(emit, lane, "import", "concurrent", "Skipped: baseline phase did not complete for this lane");
    skip(emit, lane, "generate", "concurrent", "Skipped: baseline phase did not complete for this lane");
    skip(emit, lane, "payments-preview", "concurrent", "Skipped: baseline phase did not complete for this lane");
    skip(emit, lane, "payments-confirm", "concurrent", "Skipped: baseline phase did not complete for this lane");
    return null;
  }
  const { runTag } = baseline;
  emit({ type: "lane-start", lane: lane.id, phase: "concurrent", runTag, at: Date.now() });

  const concurrentImportBlob = await buildMemberImportWorkbook({
    count: config.memberCount,
    runTag,
    startIndex: config.memberCount + 1, // non-overlapping with baseline batch
  });
  const concurrentMonth = config.month === 12 ? 1 : config.month + 1;
  const concurrentYear = config.month === 12 ? config.year + 1 : config.year;
  // Pay against the baseline batch's own flatNo range -- those bills
  // already exist from Phase 1, so this can safely run at the same instant
  // as the concurrent import/generate calls above without depending on them.
  const concurrentPayBlob = await buildPaymentImportWorkbook({
    count: config.memberCount,
    month: config.month,
    year: config.year,
    amount: config.paymentAmount,
    runTag,
    startIndex: 1,
  });

  const [importResult, genResult, payResult] = await Promise.all([
    runMemberImport({ lane, file: concurrentImportBlob, phase: "concurrent", emit }),
    runBillGenerate({ lane, year: concurrentYear, month: concurrentMonth, phase: "concurrent", emit }),
    runPaymentProcess({ lane, file: concurrentPayBlob, phase: "concurrent", emit }),
  ]);

  emit({ type: "lane-complete", lane: lane.id, phase: "concurrent", runTag, at: Date.now() });
  return { runTag, importResult, genResult, payResult };
}

// ---- Orchestrates the whole round across N lanes: every lane runs its
// individual/baseline phase (lanes run concurrently with each other even
// in this "phase", since it's per-lane sequencing that matters, not
// global sequencing), then every lane runs its concurrent phase, and all
// lanes' concurrent phases fire at the same time via the outer
// Promise.all -- satisfying "every task simultaneously" across
// "multiple societies doing it at once".
export async function runFullLoadTest({ lanes, config, emit }) {
  emit({ type: "round-start", lanes: lanes.map((l) => l.id), at: Date.now() });

  const baselines = await Promise.all(
    lanes.map((lane) => runIndividualPhase({ lane, config, emit })),
  );

  const concurrentResults = await Promise.all(
    lanes.map((lane, i) =>
      runConcurrentPhase({ lane, config, baseline: baselines[i], emit }),
    ),
  );

  emit({ type: "round-complete", at: Date.now() });
  return { baselines, concurrentResults };
}

// ---- Real load-test statistics: p50/p90/p99 latency + requests/sec,
// computed from the raw request-success/request-fail events the phases
// above emit -- not invented numbers.
export function computeStats(events) {
  const requests = events.filter((e) => e.type === "request-success" || e.type === "request-fail");
  if (!requests.length) {
    return { count: 0, successCount: 0, failCount: 0, p50: 0, p90: 0, p99: 0, rps: 0, byStage: {} };
  }
  const sorted = [...requests].sort((a, b) => a.elapsedMs - b.elapsedMs);
  const pct = (p) => {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx]?.elapsedMs || 0;
  };
  const successCount = requests.filter((e) => e.type === "request-success").length;
  const failCount = requests.length - successCount;
  const times = requests.map((e) => e.at).filter(Boolean);
  const windowSeconds = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 1000 : 1;
  const rps = windowSeconds > 0 ? requests.length / windowSeconds : requests.length;

  const byStage = {};
  for (const e of requests) {
    if (!byStage[e.stage]) byStage[e.stage] = { count: 0, successCount: 0, failCount: 0, totalMs: 0 };
    byStage[e.stage].count += 1;
    byStage[e.stage].totalMs += e.elapsedMs || 0;
    if (e.type === "request-success") byStage[e.stage].successCount += 1;
    else byStage[e.stage].failCount += 1;
  }
  for (const stage of Object.keys(byStage)) {
    byStage[stage].avgMs = Math.round(byStage[stage].totalMs / byStage[stage].count);
  }

  return {
    count: requests.length,
    successCount,
    failCount,
    p50: Math.round(pct(50)),
    p90: Math.round(pct(90)),
    p99: Math.round(pct(99)),
    rps: Math.round(rps * 100) / 100,
    byStage,
  };
}
