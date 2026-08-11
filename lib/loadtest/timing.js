// lib/loadtest/timing.js
//
// Real (not decorative) network timing for each request, using the
// browser's own Resource Timing API -- the same data Chrome DevTools'
// Network panel is built on. This is genuine measured DNS/TCP/TLS/
// waiting(TTFB)/download phase data for every fetch() call the Load Test
// Lab makes, with zero backend changes.
//
// What this CANNOT show: how long your Vercel function spent doing
// validation vs. how long the MongoDB round trip inside the handler took --
// the browser has no visibility inside the server process. If you want
// that split too, see the "Optional server-side timing" section of
// README-LOADTEST-LAB.md for a small, reviewable snippet you can add to
// the 3 routes yourself (intentionally not auto-applied here, since it
// touches production route files this tool did not fully re-verify).

if (typeof performance !== "undefined" && typeof performance.setResourceTimingBufferSize === "function") {
  try {
    performance.setResourceTimingBufferSize(2000);
  } catch (e) {
    // older browsers -- ignore, we just fall back to a smaller buffer
  }
}

function phasesFromEntry(entry) {
  if (!entry) return null;
  const dns = Math.max(0, entry.domainLookupEnd - entry.domainLookupStart);
  const tcp = Math.max(0, entry.connectEnd - entry.connectStart);
  const tls =
    entry.secureConnectionStart > 0
      ? Math.max(0, entry.connectEnd - entry.secureConnectionStart)
      : 0;
  const ttfb = Math.max(0, entry.responseStart - entry.requestStart);
  const download = Math.max(0, entry.responseEnd - entry.responseStart);
  const total = Math.max(0, entry.responseEnd - entry.startTime);
  return {
    dns: Math.round(dns),
    tcp: Math.round(tcp),
    tls: Math.round(tls),
    ttfb: Math.round(ttfb),
    download: Math.round(download),
    total: Math.round(total),
    transferSize: entry.transferSize || null,
    real: true,
  };
}

export function findResourceTiming(url, afterPerfTime) {
  if (typeof performance === "undefined" || !performance.getEntriesByType) return null;
  const entries = performance.getEntriesByType("resource");
  let best = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.name === url || e.name.endsWith(url)) {
      if (best == null || e.startTime >= afterPerfTime - 50) {
        best = e;
        if (e.startTime >= afterPerfTime - 50) break;
      }
    }
  }
  return phasesFromEntry(best);
}

// Wraps fetch with high-resolution timing + real Resource Timing phase
// data + captured response body (JSON when possible, else text), so
// nothing about a request/response is ever hidden from the event log.
export async function timedFetch(url, options) {
  const startPerf = typeof performance !== "undefined" ? performance.now() : Date.now();
  const startWall = Date.now();
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    const elapsedMs = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startPerf,
    );
    return {
      ok: false,
      status: 0,
      elapsedMs,
      error: err?.message || String(err),
      body: null,
      phases: null,
      startedAt: startWall,
      at: Date.now(),
    };
  }
  let body = null;
  const contentType = res.headers.get("content-type") || "";
  try {
    body = contentType.includes("application/json") ? await res.json() : await res.text();
  } catch (err) {
    body = { __parseError: err?.message || "Failed to parse response body" };
  }
  const elapsedMs = Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startPerf,
  );
  const phases = findResourceTiming(url, startPerf);
  return {
    ok: res.ok,
    status: res.status,
    elapsedMs,
    body,
    phases,
    startedAt: startWall,
    at: Date.now(),
  };
}
