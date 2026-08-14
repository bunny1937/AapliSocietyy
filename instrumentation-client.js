// instrumentation-client.js — Next.js browser-side Sentry init.
// No-ops when NEXT_PUBLIC_SENTRY_DSN is unset (see instrumentation.js).
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // Session replay is opt-in and off by default here — flip on later if
    // wanted, it's a separate cost/PII consideration from error tracking.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? Sentry.captureRouterTransitionStart
  : undefined;
