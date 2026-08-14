"use client";
// Catches React render errors that escape every route's own error boundary
// and reports them to Sentry. Next.js requires this file to render its own
// <html>/<body> since it replaces the root layout when it fires.
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";

export default function GlobalError({ error }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
