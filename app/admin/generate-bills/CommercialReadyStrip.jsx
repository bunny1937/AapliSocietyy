"use client";
// app/admin/generate-bills/CommercialReadyStrip.jsx  (NEW)
//
// Answers "is shop billing actually set up?" BEFORE the admin clicks anything.
//
// Until now the only feedback was the numbers on a preview (wrong for silent
// reasons: blank rate, no carpet area, module off, a flat wrongly typed as a
// Shop) followed by a dead-end "Could not load the collection sheet".
//
// Every issue here says: what is wrong, why it matters, what to do, and links
// to the page that fixes it. It also gates Record Collections, so the
// "no bills generated for this period" dead end is unreachable.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { apiClient } from "@/lib/api-client";

const box = (border, bg) => ({
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "11px 13px",
  border: "1px solid " + border,
  borderRadius: 10,
  marginBottom: 8,
  background: bg,
});

const fixBtn = (color) => ({
  fontSize: 12.5,
  fontWeight: 700,
  color,
  whiteSpace: "nowrap",
  textDecoration: "none",
  border: "1px solid " + color,
  borderRadius: 7,
  padding: "6px 10px",
});

export default function CommercialReadyStrip({ periodId, onReadiness }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["commercial-readiness", periodId || "none"],
    queryFn: () =>
      apiClient.get(
        "/api/commercial/readiness" +
          (periodId ? "?periodId=" + encodeURIComponent(periodId) : ""),
      ),
    retry: false,
  });

  useEffect(() => {
    if (data) onReadiness?.(data);
  }, [data, onReadiness]);

  if (isLoading) return null;

  if (isError) {
    return (
      <div style={box("var(--warning)", "var(--warning-bg)")}>
        <AlertTriangle size={16} color="var(--warning)" style={{ marginTop: 1, flexShrink: 0 }} />
        <div style={{ fontSize: 13, lineHeight: 1.55 }}>
          <b>We could not check whether shop billing is set up.</b>{" "}
          {error?.hint || error?.message || "Refresh the page and try again."}
        </div>
      </div>
    );
  }

  const issues = data?.issues || [];
  const counts = data?.counts || {};
  const blockers = issues.filter((i) => i.severity === "blocker");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div style={{ marginBottom: 14 }}>
      {blockers.length === 0 && warnings.length === 0 && (
        <div style={box("var(--success)", "var(--success-bg)")}>
          <CheckCircle2 size={16} color="var(--success)" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            <b>Ready to bill.</b> {counts.shops || 0} shop(s) and {counts.offices || 0}{" "}
            office(s), {counts.activeHeads || 0} charge(s) on the rate card. Residential
            flats are billed separately and are not affected.
          </div>
        </div>
      )}

      {blockers.map((i) => (
        <div key={i.code} style={box("var(--danger)", "var(--danger-bg)")}>
          <AlertTriangle size={16} color="var(--danger)" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55, flex: 1 }}>
            <b>{i.title}</b>
            <div style={{ opacity: 0.85 }}>{i.detail}</div>
            <div style={{ marginTop: 3 }}>
              <b>What to do:</b> {i.fix}
            </div>
            {i.affected?.length ? (
              <div style={{ marginTop: 3, opacity: 0.75, fontSize: 12 }}>
                Affected: {i.affected.slice(0, 8).join(", ")}
                {i.affected.length > 8 ? " and " + (i.affected.length - 8) + " more" : ""}
              </div>
            ) : null}
          </div>
          {i.fixHref && (
            <a href={i.fixHref} style={fixBtn("var(--danger)")}>
              Fix this
            </a>
          )}
        </div>
      ))}

      {warnings.map((i) => (
        <div key={i.code} style={box("var(--warning)", "var(--warning-bg)")}>
          <Info size={16} color="var(--warning)" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55, flex: 1 }}>
            <b>{i.title}</b>
            <div style={{ opacity: 0.85 }}>{i.detail}</div>
            <div style={{ marginTop: 3 }}>
              <b>What to do:</b> {i.fix}
            </div>
          </div>
          {i.fixHref && (
            <a href={i.fixHref} style={fixBtn("var(--warning-fg)")}>
              Fix this
            </a>
          )}
        </div>
      ))}

      {periodId && counts.billsThisPeriod === 0 && blockers.length === 0 && (
        <div style={box("var(--fg-5)", "var(--bg-canvas)")}>
          <Info size={16} color="var(--fg-4)" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            <b>Nothing generated for {periodId} yet.</b> A preview is only a look — it
            saves nothing. Press <b>Generate</b> to create the bills. Collections can
            only be recorded after that.
          </div>
        </div>
      )}
    </div>
  );
}
