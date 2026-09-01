/**
 * GET/POST /api/accounting/setup/run
 * ----------------------------------------------------------------------------
 * The guided setup, one step per request — the replacement for quick-setup's
 * single opaque call. See docs/accounting-guided-ux/00-plan.md Phase 3.
 *
 * GET   returns the step definitions and where the society currently stands.
 * POST  { step } runs exactly that one step and reports what it did.
 *
 * Required permission : accounting.overview.view (GET)
 *                       accounting.financialYears.create (POST)
 * Tenant validation   : societyId from the verified token, never the body
 * Failure behaviour   : 400 unknown/blocked step; 401/403 authorize; 500 else
 *
 * ## Why POST is gated on financialYears.create
 *
 * Every step here writes society-level accounting configuration, and the first
 * one literally creates a Financial Year. That is the same authority, so it is
 * the same permission rather than a new one nobody would remember to grant.
 */

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorizeAny } from "@/lib/rbac/authorize";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import {
  SETUP_STEPS,
  SETUP_STEP_KEYS,
  runSetupStep,
  planSetupStep,
  runSetupStepStream,
  getSetupStepStates,
} from "@/lib/accounting/setupSteps";
import { writeSetupReceipt, getLatestReceipts } from "@/lib/accounting/setupReceipts";

export const dynamic = "force-dynamic";

const VIEW = ["accounting.overview.view", "society.systemTests.view"];
const RUN = ["accounting.financialYears.create", "society.systemTests.update"];

export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, VIEW);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const states = await getSetupStepStates(gate.context.societyId);
    const receipts = await getLatestReceipts(gate.context.societyId, SETUP_STEP_KEYS).catch(() => ({}));
    return NextResponse.json({ steps: SETUP_STEPS, states, receipts });
  } catch (error) {
    console.error("[accounting] setup GET failed:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, RUN);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const stream = url.searchParams.get("stream") === "1";

  const body = await request.json().catch(() => ({}));
  const step = String(body.step || "");
  if (!SETUP_STEP_KEYS.includes(step)) {
    return NextResponse.json({ error: `Unknown step "${step}"` }, { status: 400 });
  }

  // PLAN — design doc §6 phase 1. Read-only: a diff, never a write, so it can
  // be shown and cancelled with zero risk.
  if (dryRun) {
    try {
      await connectDB();
      const plan = await planSetupStep(step, { societyId: gate.context.societyId });
      return NextResponse.json({ t: "plan", step, ...plan });
    } catch (error) {
      const isKnown = error?.code === "MISSING_ACCOUNTS";
      return NextResponse.json(
        { step, ok: false, error: error?.message || "Could not build a plan for that step.", code: error?.code },
        { status: isKnown ? 400 : 500 },
      );
    }
  }

  // STREAM — design doc §6 phase 2. NDJSON, one SetupEvent per line. Runs the
  // step for real (runSetupStepStream does the write, then paces the events),
  // and writes the receipt itself once the generator finishes or errors —
  // there is no separate JSON response afterwards to hang a receipt write on.
  if (stream) {
    await connectDB();
    const startedAt = new Date();
    const societyId = gate.context.societyId;
    const userId = gate.context.userId;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (event) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        const created = [];
        const skipped = [];
        let finalError = null;
        try {
          for await (const event of runSetupStepStream(step, { societyId, userId })) {
            send(event);
            if (event.t === "item") (event.action === "skipped" ? skipped : created).push(event.label);
            if (event.t === "error") finalError = { code: event.code, message: event.message };
          }
        } catch (error) {
          finalError = { code: error?.code, message: error?.message || "That step could not be completed." };
          send({ t: "error", step, code: finalError.code || "STEP_FAILED", message: finalError.message, remedy: "Try again, or check the server log." });
        }
        await writeSetupReceipt({
          societyId, step, userId, startedAt,
          result: finalError ? undefined : { created, skipped },
          error: finalError || undefined,
        }).catch((e) => console.error(`[accounting] setup receipt write failed for "${step}":`, e?.message));
        controller.close();
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const startedAt = new Date();
  try {
    await connectDB();
    const result = await runSetupStep(step, {
      societyId: gate.context.societyId,
      userId: gate.context.userId,
    });
    const receipt = await writeSetupReceipt({
      societyId: gate.context.societyId,
      step,
      userId: gate.context.userId,
      startedAt,
      result,
    }).catch((e) => {
      // The step itself succeeded — losing the receipt write is a logging
      // failure, not a reason to tell the admin the step failed.
      console.error(`[accounting] setup receipt write failed for "${step}":`, e?.message);
      return null;
    });
    return NextResponse.json({
      step,
      ok: true,
      ...result,
      receipt: receipt ? { at: receipt.finishedAt, actorName: receipt.actorName || null } : null,
    });
  } catch (error) {
    // A blocked step is the user's situation, not a server fault — it carries
    // a sentence naming what to do, so it must reach the page intact rather
    // than being flattened into "Internal server error".
    const isKnown = error?.code === "MISSING_ACCOUNTS";
    await writeSetupReceipt({
      societyId: gate.context.societyId,
      step,
      userId: gate.context.userId,
      startedAt,
      error: { code: error?.code, message: error?.message || "That step could not be completed." },
    }).catch((e) => console.error(`[accounting] setup receipt write failed for "${step}":`, e?.message));

    if (isKnown) {
      return NextResponse.json(
        { step, ok: false, error: error.message, code: error.code },
        { status: 400 },
      );
    }
    console.error(`[accounting] setup step "${step}" failed:`, error?.message);
    return NextResponse.json(
      { step, ok: false, error: error?.message || "That step could not be completed." },
      { status: 500 },
    );
  }
}
