"use client";
import { useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  Field,
  Input,
  Avatar,
  StatusBadge,
  PurposeTag,
  Toast,
  tokens,
} from "@/components/visitor/ui";
async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Verification failed");
  return data;
}
const S = {
  layout: { display: "grid", gridTemplateColumns: "minmax(280px, 420px) 1fr", gap: 16, alignItems: "start" },
  h3: { fontSize: 16, fontWeight: 700, color: tokens.text, margin: "0 0 4px" },
  hint: { fontSize: 13, color: tokens.sub, margin: "0 0 16px" },
  tabBar: { display: "flex", gap: 8, marginBottom: 16 },
  divider: { textAlign: "center", color: tokens.sub, fontSize: 12, margin: "14px 0" },
  resultWrap: { display: "flex", flexDirection: "column", gap: 14 },
  vhead: { display: "flex", alignItems: "center", gap: 14 },
  vname: { fontSize: 20, fontWeight: 700, color: tokens.text },
  vmeta: { fontSize: 13, color: tokens.sub, marginTop: 4 },
  grant: {
    background: "var(--success-bg)",
    color: "var(--success)",
    borderRadius: 12,
    padding: "16px 18px",
    fontWeight: 700,
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  detailRow: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 },
  detailKey: { color: tokens.sub },
  detailVal: { color: tokens.text, fontWeight: 600 },
  placeholder: { textAlign: "center", color: tokens.sub, padding: "40px 10px" },
  bigIcon: { fontSize: 44, marginBottom: 10 },
  otpInput: { fontSize: 22, letterSpacing: 6, textAlign: "center", fontWeight: 700 },
  submitWrap: { marginTop: 16 },
};
function tabBtnStyle(active) {
  return {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 10,
    border: active ? "1px solid " + tokens.primary : "1px solid var(--border)",
    background: active ? "var(--primary-tint)" : "var(--bg-surface)",
    color: active ? tokens.primary : tokens.text,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
  };
}
export default function VerifyPassPage() {
  const [tab, setTab] = useState("otp");
  const [otp, setOtp] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [visitor, setVisitor] = useState(null);
  const [toast, setToast] = useState(null);
  const notify = (message, type = "info") => setToast({ message, type });
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setVisitor(null);
    try {
      const body = tab === "otp" ? { otp: otp.trim() } : { qrToken: qrToken.trim() };
      if (tab === "otp" && !body.otp) throw new Error("Enter the OTP");
      if (tab === "qr" && !body.qrToken) throw new Error("Paste the QR token");
      const data = await api("/api/visitor/pass/verify", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setVisitor(data.visitor || data);
      notify("Pass verified — entry granted", "success");
      setOtp("");
      setQrToken("");
    } catch (e2) {
      notify(e2.message || "Invalid or expired pass", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Verify Gate Pass" subtitle="Validate a pre-approved visitor's OTP or QR" />
      <div style={S.layout}>
        <Card>
          <h3 style={S.h3}>Enter pass credential</h3>
          <p style={S.hint}>Ask the visitor for their OTP, or scan/paste their QR token.</p>
          <div style={S.tabBar}>
            <button type="button" style={tabBtnStyle(tab === "otp")} onClick={() => setTab("otp")}>
              🔢 OTP
            </button>
            <button type="button" style={tabBtnStyle(tab === "qr")} onClick={() => setTab("qr")}>
              🎟️ QR token
            </button>
          </div>
          <form onSubmit={verify}>
            {tab === "otp" ? (
              <Field label="One-time password" required>
                <Input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={8}
                  style={S.otpInput}
                />
              </Field>
            ) : (
              <Field label="QR token" required hint="Paste the scanned QR string from the visitor's pass">
                <Input value={qrToken} onChange={(e) => setQrToken(e.target.value)} placeholder="qr_…" />
              </Field>
            )}
            <div style={S.submitWrap}>
              <Button type="submit" size="lg" full disabled={busy}>
                {busy ? "Verifying…" : "Verify & grant entry"}
              </Button>
            </div>
          </form>
        </Card>
        <Card>
          {visitor ? (
            <div style={S.resultWrap}>
              <div style={S.grant}>✅ Entry granted</div>
              <div style={S.vhead}>
                <Avatar src={visitor.photo} name={visitor.name} size={64} />
                <div>
                  <div style={S.vname}>{visitor.name}</div>
                  <div style={S.vmeta}>
                    <PurposeTag purpose={visitor.purpose} />
                  </div>
                </div>
              </div>
              <div>
                <div style={S.detailRow}>
                  <span style={S.detailKey}>Flat</span>
                  <span style={S.detailVal}>{visitor.flat || "—"}</span>
                </div>
                <div style={S.detailRow}>
                  <span style={S.detailKey}>Pass type</span>
                  <span style={S.detailVal}>{visitor.passType || "One-time"}</span>
                </div>
                <div style={S.detailRow}>
                  <span style={S.detailKey}>Status</span>
                  <span style={S.detailVal}>
                    <StatusBadge status={visitor.status || "Entered"} />
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div style={S.placeholder}>
              <div style={S.bigIcon}>🎟️</div>
              <div>Verified visitor details will appear here.</div>
            </div>
          )}
        </Card>
      </div>
      <Toast {...(toast || {})} onClose={() => setToast(null)} />
    </div>
  );
}
