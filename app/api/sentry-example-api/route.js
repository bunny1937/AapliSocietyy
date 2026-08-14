// Server-side half of the Sentry setup check. Throws on purpose so
// instrumentation.js's Sentry.init on the nodejs runtime has something
// real to capture. Not linked from any nav — reachable only by URL.
export async function GET() {
  throw new Error("Sentry Example API Route Error");
}
