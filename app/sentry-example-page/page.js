"use client";
// Manual Sentry setup-verification page (the wizard normally generates this;
// wired by hand since Sentry was installed manually — see
// docs/security-remediation.md, P1). Not linked from any nav — reachable
// only by URL. Safe to delete once verified once.
import { useState } from "react";
import * as Sentry from "@sentry/nextjs";

export default function SentryExamplePage() {
  const [hasSentError, setHasSentError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif", maxWidth: 560 }}>
      <h1>Sentry setup verification</h1>
      <p>Click the button to trigger a test error on both client and server.</p>
      <button
        type="button"
        disabled={isLoading}
        style={{ padding: "10px 20px", fontSize: 16, cursor: "pointer" }}
        onClick={async () => {
          setIsLoading(true);
          await Sentry.startSpan(
            { name: "Example Frontend Span", op: "test" },
            async () => {
              const res = await fetch("/api/sentry-example-api");
              if (!res.ok) setHasSentError(true);
            },
          );
          // Client-side error — deliberately calling an undefined function.
          // eslint-disable-next-line no-undef
          myUndefinedFunction();
        }}
      >
        {isLoading ? "Sending..." : "Throw test error"}
      </button>
      {hasSentError && (
        <p style={{ marginTop: 16 }}>
          Server error sent. Check your Sentry Issues dashboard for both
          "Sentry Example API Route Error" and the client-side
          ReferenceError.
        </p>
      )}
    </div>
  );
}
