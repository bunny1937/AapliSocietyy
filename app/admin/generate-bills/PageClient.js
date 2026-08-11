"use client";
// app/admin/generate-bills/page.js
//
// Thin segment switch. All wizard logic lives in ./BillGenerationFlow, which
// is rendered once per segment (Residential | Commercial) with the matching
// config from ./segments. The key={activeSegment} is deliberate: it forces a
// full unmount/remount so the two segments never share in-flight local state.
import { useState } from "react";
import BillGenerationFlow from "./BillGenerationFlow";
import { SEGMENTS } from "./segments";

export default function GenerateBillsPage() {
  const [activeSegment, setActiveSegment] = useState("residential");
  const [residentialComplete, setResidentialComplete] = useState(false);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.5rem 0" }}>
        <div style={{ display: "inline-flex", padding: 3, background: "#eef2ff", borderRadius: 10, gap: 2 }}>
          {["residential", "commercial"].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveSegment(key)}
              style={{
                padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                fontWeight: 700, fontSize: "0.82rem",
                background: activeSegment === key ? "#fff" : "transparent",
                color: activeSegment === key ? "#1e3a8a" : "#64748b",
                boxShadow: activeSegment === key ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {SEGMENTS[key].label}
            </button>
          ))}
        </div>
      </div>

      {activeSegment === "residential" && residentialComplete && (
        <div style={{ margin: "0 1.5rem 1rem", padding: "1rem 1.25rem", background: "#ecfdf5", border: "1px solid #6ee7b7", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <span style={{ color: "#065f46", fontWeight: 600, fontSize: "0.88rem" }}>
            Residential billing complete for this cycle. Continue to Commercial billing?
          </span>
          <button
            type="button"
            onClick={() => setActiveSegment("commercial")}
            style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "none", background: "#059669", color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}
          >
            Continue to Commercial →
          </button>
        </div>
      )}

      <BillGenerationFlow
        key={activeSegment}
        segment={SEGMENTS[activeSegment]}
        onSegmentComplete={() => {
          if (activeSegment === "residential") setResidentialComplete(true);
        }}
      />
    </>
  );
}
