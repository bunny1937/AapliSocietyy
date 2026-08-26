"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  StatusBadge,
  PurposeTag,
  ZoomableAvatar,
  EmptyState,
  Spinner,
  Toast,
  tokens,
  timeAgo,
  fmtTime,
} from "@/components/visitor/ui";
import CallButton from "@/components/visitor/CallButton";
// Auto-refresh so a resident sees a guard-logged visitor without reloading.
const POLL_MS = 30000;
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
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}
const S = {
  loadingWrap: { display: "flex", justifyContent: "center", padding: 60 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: tokens.text,
    margin: "0 0 4px",
  },
  helpText: {
    fontSize: 12.5,
    color: tokens.sub,
    margin: "0 0 14px",
    lineHeight: 1.5,
  },
  // Big, unmissable card for a visitor waiting at the gate.
  pendingCard: {
    border: "2px solid var(--warning)",
    background: "var(--warning-bg)",
    borderRadius: tokens.radius,
    padding: 18,
    marginBottom: 14,
  },
  enteredCard: {
    border: "2px solid var(--danger)",
    background: "var(--danger-bg)",
    borderRadius: tokens.radius,
    padding: 18,
    marginBottom: 14,
  },
  pendingHead: { display: "flex", gap: 14, alignItems: "center" },
  vName: { fontSize: 18, fontWeight: 700, color: tokens.text },
  vMeta: { fontSize: 13, color: tokens.sub, marginTop: 3 },
  bigActions: { display: "flex", gap: 12, marginTop: 16 },
  question: {
    fontSize: 14,
    fontWeight: 600,
    color: tokens.text,
    margin: "14px 0 0",
  },
  logRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 0",
    borderBottom: "1px solid var(--border)",
  },
  pendingWrap: { marginBottom: 20 },
  logMain: { flex: 1, minWidth: 0 },
  logName: { fontWeight: 600, color: tokens.text, fontSize: 14 },
  logMeta: { fontSize: 12, color: tokens.sub, marginTop: 2 },
};
export default function MemberVisitorsPage() {
  const [pending, setPending] = useState([]);
  const [today, setToday] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const notify = (message, type = "info") => setToast({ message, type });
  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const [p, t] = await Promise.all([
        api("/api/visitor/list?scope=pending&limit=50").catch(() => ({
          visitors: [],
        })),
        api("/api/visitor/list?scope=today&limit=50").catch(() => ({
          visitors: [],
        })),
      ]);
      setPending((p && (p.visitors || p.data)) || []);
      setToday((t && (t.visitors || t.data)) || []);
    } catch (e) {
      notify(e.message || "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    // Poll only while the tab is visible -- cuts background Vercel invocations.
    let timer = null;
    const start = () => {
      if (timer == null) timer = setInterval(() => load(true), POLL_MS);
    };
    const stop = () => {
      if (timer != null) { clearInterval(timer); timer = null; }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else { load(true); start(); }
    };
    if (typeof document === "undefined" || !document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [load]);
  // One tap. The backend records the decision and notifies the guard instantly.
  const decide = async (id, action) => {
    setBusyId(id + action);
    try {
      await api("/api/visitor/approve", {
        method: "POST",
        body: JSON.stringify({ visitorId: id, action }),
      });
      notify(
        action === "approve"
          ? "Approved — the guard can now let them in ✓"
          : "Denied — the guard has been told to turn them away",
        action === "approve" ? "success" : "info",
      );
      await load(true);
    } catch (e) {
      notify(e.message || "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  };
  // Offline entries the guard already let in — resident confirms after the fact.
  const confirmEntry = async (id, decision) => {
    setBusyId(id + decision);
    try {
      await api("/api/visitor/confirm-entry", {
        method: "PATCH",
        body: JSON.stringify({ visitorId: id, decision }),
      });
      notify(
        decision === "acknowledge"
          ? "Thanks — entry confirmed ✓"
          : "Flagged — the guard has been alerted to verify at the gate",
        decision === "acknowledge" ? "success" : "info",
      );
      await load(true);
    } catch (e) {
      notify(e.message || "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  };
  const needConfirm = today.filter(
    (v) =>
      v.entryMethod === "OfflineEntry" &&
      (!v.offlineMeta ||
        !v.offlineMeta.confirmation ||
        v.offlineMeta.confirmation.status === "Pending"),
  );
  return (
    <div>
      <PageHeader
        title="My Visitors"
        subtitle="Approve people at the gate and see today’s activity"
        actions={
          <Button variant="ghost" size="md" onClick={() => load()}>
            ↻ Refresh
          </Button>
        }
      />
      {loading ? (
        <div style={S.loadingWrap}>
          <Spinner size={30} />
        </div>
      ) : (
        <>
          {/* Someone already entered (offline) — confirm after the fact */}
          {needConfirm.length > 0 && (
            <div style={S.pendingWrap}>
              <h3 style={S.sectionTitle}>
                Someone entered to meet you — please confirm (
                {needConfirm.length})
              </h3>
              <p style={S.helpText}>
                The gate logged these entries (the network may have been down,
                so you’re seeing it now). Tap <b>✅ Yes, I know them</b> or{" "}
                <b>🚨 I don’t recognise</b> — flagging instantly alerts the
                guard.
              </p>
              {needConfirm.map((v) => {
                const id = v._id || v.id;
                return (
                  <div key={id} style={S.enteredCard}>
                    <div style={S.pendingHead}>
                      <ZoomableAvatar src={v.photo} name={v.name} size={64} />
                      <div>
                        <div style={S.vName}>{v.name}</div>
                        <div style={S.vMeta}>
                          <PurposeTag purpose={v.purpose} /> &middot; entered{" "}
                          {timeAgo(v.entryTime || v.createdAt)}
                        </div>
                        {v.offlineMeta && v.offlineMeta.note ? (
                          <div style={S.vMeta}>📝 {v.offlineMeta.note}</div>
                        ) : null}
                      </div>
                    </div>
                    <div style={S.bigActions}>
                      <Button
                        variant="success"
                        size="lg"
                        disabled={busyId === id + "acknowledge"}
                        onClick={() => confirmEntry(id, "acknowledge")}
                      >
                        {busyId === id + "acknowledge"
                          ? "Saving\u2026"
                          : "\u2705 Yes, I know them"}
                      </Button>
                      <Button
                        variant="danger"
                        size="lg"
                        disabled={busyId === id + "flag"}
                        onClick={() => confirmEntry(id, "flag")}
                      >
                        {busyId === id + "flag"
                          ? "Alerting\u2026"
                          : "\uD83D\uDEA8 I don’t recognise"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Waiting for YOUR approval */}
          {pending.length > 0 && (
            <div style={S.pendingWrap}>
              <h3 style={S.sectionTitle}>
                Someone’s at the gate — your approval needed ({pending.length})
              </h3>
              <p style={S.helpText}>
                Tap <b>✅ Allow</b> to let them in, or <b>⛔ Deny</b> to turn
                them away. The guard sees your choice instantly.
              </p>
              {pending.map((v) => {
                const id = v._id || v.id;
                return (
                  <div key={id} style={S.pendingCard}>
                    <div style={S.pendingHead}>
                      <ZoomableAvatar src={v.photo} name={v.name} size={64} />
                      <div>
                        <div style={S.vName}>{v.name}</div>
                        <div style={S.vMeta}>
                          <PurposeTag purpose={v.purpose} /> &middot; arrived{" "}
                          {timeAgo(v.createdAt)}
                        </div>
                        {v.phone ? (
                          <div style={S.vMeta}>📞 {v.phone}</div>
                        ) : null}
                      </div>
                    </div>
                    <p style={S.question}>
                      Do you want to allow this visitor in?
                    </p>
                    <div style={S.bigActions}>
                      <Button
                        variant="success"
                        size="lg"
                        disabled={busyId === id + "approve"}
                        onClick={() => decide(id, "approve")}
                      >
                        {busyId === id + "approve"
                          ? "Allowing\u2026"
                          : "\u2705 Allow"}
                      </Button>
                      <Button
                        variant="danger"
                        size="lg"
                        disabled={busyId === id + "reject"}
                        onClick={() => decide(id, "reject")}
                      >
                        {busyId === id + "reject"
                          ? "Denying\u2026"
                          : "\u26d4 Deny"}
                      </Button>
                      <CallButton
                        phone={(v.enteredBy && v.enteredBy.phone) || ""}
                        label="📞 Call guard"
                        title="Call the guard at the gate"
                      />
                    </div>
                    {!(v.enteredBy && v.enteredBy.phone) && (
                      <div style={S.vMeta}>
                        ⚠️ Guard's number isn't on file — ask the admin to add
                        it so you can call the gate.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Today's activity log */}
          <Card>
            <h3 style={S.sectionTitle}>Today’s visitors ({today.length})</h3>
            <p style={S.helpText}>Everyone who came to your flat today.</p>
            {today.length === 0 ? (
              <EmptyState
                icon="👋"
                title="No visitors yet"
                subtitle="When someone arrives at the gate for your flat, they’ll show up here."
              />
            ) : (
              today.map((v) => {
                const id = v._id || v.id;
                return (
                  <div key={id} style={S.logRow}>
                    <ZoomableAvatar src={v.photo} name={v.name} size={42} />
                    <div style={S.logMain}>
                      <div style={S.logName}>{v.name}</div>
                      <div style={S.logMeta}>
                        <PurposeTag purpose={v.purpose} /> &middot;{" "}
                        {fmtTime(v.createdAt)}
                        {v.entryTime ? ` · in ${fmtTime(v.entryTime)}` : ""}
                        {v.exitTime ? ` · out ${fmtTime(v.exitTime)}` : ""}
                      </div>
                    </div>
                    <StatusBadge status={v.status} />
                  </div>
                );
              })
            )}
          </Card>
        </>
      )}
      <Toast {...(toast || {})} onClose={() => setToast(null)} />
    </div>
  );
}