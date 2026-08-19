// Shared HTTP helpers for /v1 route handlers. Replaces the Express
// errorHandler middleware: withRoute connects to Mongo, runs the handler, and
// converts thrown ApiError / unexpected errors into JSON responses.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { wantsTiming, recordTiming } from "@/lib/appserverlogs";

export class ApiError extends Error {
  // message may be a string OR an already-shaped body object (e.g. a zod
  // flatten result under { error: ... }).
  constructor(status, message) {
    super(typeof message === "string" ? message : "error");
    this.status = status;
    this.body = typeof message === "string" ? { error: message } : message;
  }
}

export function json(data, init) {
  return NextResponse.json(data, init);
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

// Throw for a failed zod safeParse, preserving the flattened field errors
// the Flutter client's api_error.dart already knows how to read.
export function zodError(parsed) {
  return new ApiError(400, { error: parsed.error.flatten() });
}

// Wraps a route handler: ensures a DB connection, catches ApiError and
// unexpected errors. Handlers receive (req, ctx) exactly like Next.js passes.
export function withRoute(fn) {
  return async (req, ctx) => {
    const timing = wantsTiming(req);
    const startedAt = timing ? Date.now() : 0;
    let status = 500;
    try {
      await connectDB();
      const res = await fn(req, ctx);
      status = res.status;
      return res;
    } catch (e) {
      if (e instanceof ApiError) {
        status = e.status;
        return NextResponse.json(e.body, { status: e.status });
      }
      console.error("[v1] unhandled error", e);
      // TEMP DEV TOOL — DELETE: single-developer testing phase, same reasoning
      // as the dev-diagnostics access loosening. A 500 used to be a dead end
      // that could only be diagnosed by pulling the Vercel dashboard log for
      // that exact request - now the real reason rides along in the response
      // body the Flutter client already reads (apiErrorMessage() -> 'error'
      // key), so it shows up in the app itself. Revert to the generic message
      // before real users are on this.
      return NextResponse.json(
        { error: `Internal server error: ${e?.message || String(e)}` },
        { status: 500 },
      );
    } finally {
      if (timing) {
        recordTiming({
          method: req.method,
          path: new URL(req.url).pathname,
          durationMs: Date.now() - startedAt,
          status,
        });
      }
    }
  };
}