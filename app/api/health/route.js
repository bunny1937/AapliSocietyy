// app/api/health/route.js  (NEW FILE — the app currently has NO /api/health,
// which is why test 01 measured 5,407 × 404. The redis/cache libs already
// expose ping() "Exposed for /api/health" — the route itself was never added.)
//
// Two-tier probe, standard for production:
//   GET /api/health        → 200 { ok:true, db:"up", ... }   (deep: DB ping)
//   GET /api/health?shallow=1 → 200 instantly, no DB touch    (load tests,
//                           uptime pingers, and Vercel checks should use this)
//
// Deep mode is deliberately bounded: if Mongo can't answer within 2.5s we
// return 503 instead of hanging the function (matches the fail-fast policy
// already in lib/mongodb.js).

import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never cache a health check

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("health timeout")), ms)),
  ]);
}

export async function GET(request) {
  const shallow = new URL(request.url).searchParams.get("shallow") === "1";
  const base = {
    ok: true,
    service: "aaplisociety",
    env: process.env.VERCEL_ENV || process.env.NODE_ENV,
    ts: new Date().toISOString(),
  };
  if (shallow) return NextResponse.json(base, { status: 200 });

  const started = Date.now();
  try {
    await withTimeout(connectDB(), 2500);
    await withTimeout(mongoose.connection.db.admin().command({ ping: 1 }), 1500);
    return NextResponse.json(
      { ...base, db: "up", dbLatencyMs: Date.now() - started },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { ...base, ok: false, db: "down", reason: String(err?.code || err?.message).slice(0, 120) },
      { status: 503 },
    );
  }
}

// HEAD lets uptime monitors (BetterStack/UptimeRobot/etc.) poll for free.
export async function HEAD() {
  return new Response(null, { status: 200 });
}
