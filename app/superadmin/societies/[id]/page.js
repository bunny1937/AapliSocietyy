"use client";
// One society, everything about it, and the controls to act on it.
//
// The stats here read from society.stats — counts the API computes with
// countDocuments across the whole collection. They previously read the length
// of the per-tab arrays, which are fetched lazily (`enabled: activeTab === …`),
// so the Overview tab you land on had fetched nothing and every card showed 0
// for every society. The tab arrays are still the right source inside their own
// tab, where they hold the rows being listed; they were never a total.

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/admin-api";
import notify from "@/lib/notify";
import {
  Card, CardHead, StatusPill, PlanChip, SocietyMark,
  Metric, Btn, Empty, money, shortDate, relativeDays,
} from "../../_components/PlatformUI";

const PLANS = ["Free", "Basic", "Premium", "Enterprise"];
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "subscription", label: "Subscription" },
  { id: "members", label: "Members" },
  { id: "bills", label: "Bills" },
  { id: "transactions", label: "Transactions" },
  { id: "offboarding", label: "Offboarding" },
];

const GATE_LOOK = {
  done: { icon: "✓", fg: "var(--success)", bg: "var(--success-bg)", label: "Done" },
  pending: { icon: "◷", fg: "var(--warning)", bg: "var(--warning-bg)", label: "Waiting" },
  blocked: { icon: "✕", fg: "var(--danger)", bg: "var(--danger-bg)", label: "Blocked" },
  waived: { icon: "⤳", fg: "var(--info)", bg: "var(--info-bg)", label: "Waived" },
  "not-started": { icon: "○", fg: "var(--fg-4)", bg: "var(--bg-muted)", label: "Not started" },
};

export default function SocietyDetail() {
  const [activeTab, setActiveTab] = useState("overview");
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const societyId = params.id;

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if ((d.user || d)?.role !== "SuperAdmin") router.replace("/superadmin/login");
      })
      .catch(() => router.replace("/superadmin/login"));
  }, [router]);

  const { data: societyData, isLoading } = useQuery({
    queryKey: ["society", societyId],
    queryFn: () => adminApi.fetchSociety(societyId),
    staleTime: 60 * 1000,
  });

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["society-data", societyId, "members"],
    queryFn: () => adminApi.fetchData(societyId, "members"),
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === "members",
  });
  const { data: billsData, isLoading: billsLoading } = useQuery({
    queryKey: ["society-data", societyId, "bills"],
    queryFn: () => adminApi.fetchData(societyId, "bills"),
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === "bills",
  });
  const { data: txnData, isLoading: txnLoading } = useQuery({
    queryKey: ["society-data", societyId, "transactions"],
    queryFn: () => adminApi.fetchData(societyId, "transactions"),
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === "transactions",
  });

  const act = useMutation({
    mutationFn: async (body) => {
      const res = await fetch(`/api/admin/subscriptions/${societyId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Action failed");
      return json;
    },
    onSuccess: (json) => {
      notify.success(json.summary || "Updated");
      queryClient.invalidateQueries({ queryKey: ["society", societyId] });
      queryClient.invalidateQueries({ queryKey: ["platform-metrics"] });
    },
    onError: (e) => notify.error(e.message),
  });

  const society = societyData?.society;
  const members = membersData?.data || [];
  const bills = billsData?.data || [];
  const transactions = txnData?.data || [];

  if (isLoading) return <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>Loading society…</div>;
  if (!society) return <div style={{ padding: "3rem", textAlign: "center", color: "var(--danger)" }}>Society not found</div>;

  const stats = society.stats || {};
  const sub = society.subscription || {};
  const status = sub.status || "Trial";
  const history = [...(sub.paymentHistory || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const lifetime = history.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const overdue = sub.nextPaymentDate && new Date(sub.nextPaymentDate) < new Date() && status === "Active";
  const n = (v) => (typeof v === "number" ? v.toLocaleString("en-IN") : "—");

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", color: "var(--fg-2)" }}>
      <Btn variant="ghost" size="sm" onClick={() => router.push("/superadmin/societies")} style={{ marginBottom: 14 }}>
        ← All societies
      </Btn>

      {/* Header */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 14, minWidth: 0 }}>
            <SocietyMark name={society.name} size={52} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "var(--fg-1)" }}>{society.name}</h1>
                <StatusPill status={status} />
                <PlanChip plan={sub.planType || "Free"} />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--fg-4)", marginTop: 5 }}>
                {society.address || "No address on file"}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg-5)", marginTop: 3 }}>
                Reg {society.registrationNo || "—"} · code {society.societyId || "—"} · since {shortDate(society.createdAt)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            {status === "Active" ? (
              <Btn
                variant="danger"
                disabled={act.isPending}
                onClick={async () => {
                  if (!(await notify.confirm("Suspend this society? They will lose access immediately.", { tone: "warning" }))) return;
                  act.mutate({ action: "set-status", status: "Suspended" });
                }}
              >
                Suspend
              </Btn>
            ) : (
              <Btn variant="primary" disabled={act.isPending} onClick={() => act.mutate({ action: "set-status", status: "Active" })}>
                Activate
              </Btn>
            )}
            <Btn onClick={() => setActiveTab("subscription")}>Manage subscription</Btn>
            <Btn variant="ghost" onClick={() => router.push(`/superadmin/data-browser?societyId=${societyId}`)}>Data browser</Btn>
          </div>
        </div>
      </Card>

      {/* KPIs — from society.stats, not from the lazily-loaded tab arrays */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 11, marginBottom: 14 }}>
        <Card><Metric label="Members" value={n(stats.members)} sub="on the roll" /></Card>
        <Card>
          <Metric label="Bills" value={n(stats.bills)} sub={stats.bills ? `${n(stats.paidBills ?? 0)} paid` : "none raised"} />
        </Card>
        <Card><Metric label="Transactions" value={n(stats.transactions)} sub="ledger entries" /></Card>
        <Card><Metric label="Lifetime paid" value={money(lifetime || sub.amountPaid || 0)} sub={`${history.length} payment${history.length === 1 ? "" : "s"}`} /></Card>
        <Card>
          <Metric
            label="Next due"
            value={sub.nextPaymentDate ? shortDate(sub.nextPaymentDate) : "—"}
            sub={sub.nextPaymentDate ? relativeDays(sub.nextPaymentDate) : "no cycle started"}
            tone={overdue ? "var(--danger)" : undefined}
          />
        </Card>
        <Card>
          <Metric
            label="Trial ends"
            value={sub.trialEndsAt ? shortDate(sub.trialEndsAt) : "—"}
            sub={sub.trialEndsAt ? relativeDays(sub.trialEndsAt) : "not on trial"}
            tone={sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date() ? "var(--danger)" : undefined}
          />
        </Card>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const count = { members: stats.members, bills: stats.bills, transactions: stats.transactions }[t.id];
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "9px 13px", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                background: "transparent", border: "none", cursor: "pointer",
                color: activeTab === t.id ? "var(--fg-2)" : "var(--fg-4)",
                borderBottom: `2px solid ${activeTab === t.id ? "var(--primary)" : "transparent"}`,
                marginBottom: -1,
              }}
            >
              {t.label}{typeof count === "number" ? ` (${count.toLocaleString("en-IN")})` : ""}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
          <Card>
            <CardHead title="Society details" />
            <KV rows={[
              ["Registration no", society.registrationNo],
              ["Registered on", society.dateOfRegistration ? shortDate(society.dateOfRegistration) : null],
              ["Society code", society.societyId],
              ["Short code", society.societyCode],
              ["Address", society.address],
              ["Area", society.area],
              ["PAN", society.panNo],
              ["TAN", society.tanNo],
              ["Carpet area", society.carpetAreaSqft ? `${society.carpetAreaSqft.toLocaleString("en-IN")} sq ft` : null],
            ]} />
          </Card>
          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <Card>
              <CardHead title="Contact" />
              <KV rows={[
                ["Contact person", society.personOfContact],
                ["Email", society.contactEmail],
                ["Phone", society.contactPhone],
                ["Admin login", society.credentials?.adminEmail],
              ]} />
            </Card>
            <Card>
              <CardHead title="Lifecycle" />
              <KV rows={[
                ["Created", shortDate(society.createdAt)],
                ["Last updated", shortDate(society.updatedAt)],
                ["Lifecycle", society.lifecycleStatus || "Active"],
                ["Paused until", society.pausedUntil ? shortDate(society.pausedUntil) : null],
                ["Deleted", society.isDeleted ? shortDate(society.deletedAt) : null],
                ["Config version", `v${society.configVersion || 1}`],
              ]} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === "subscription" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <Card>
              <CardHead title="Record a payment" sub="Appends to history, rolls the due date forward one month" />
              <PaymentForm busy={act.isPending} onSubmit={(body) => act.mutate(body)} />
            </Card>
            <Card>
              <CardHead title="Plan" />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PLANS.map((p) => (
                  <Btn key={p} size="sm" variant={sub.planType === p ? "primary" : "secondary"} disabled={act.isPending || sub.planType === p} onClick={() => act.mutate({ action: "change-plan", planType: p })}>
                    {p}
                  </Btn>
                ))}
              </div>
            </Card>
            <Card>
              <CardHead title="Trial" sub={sub.trialEndsAt ? `Ends ${shortDate(sub.trialEndsAt)}` : "No trial end date set"} />
              <TrialForm busy={act.isPending} onSubmit={(days) => act.mutate({ action: "extend-trial", days })} />
            </Card>
          </div>

          <Card padded={false}>
            <div style={{ padding: "15px 18px" }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Payment history</div>
              <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>
                {history.length ? `${history.length} recorded · ${money(lifetime)} total` : "Nothing recorded yet"}
              </div>
            </div>
            {history.length === 0 ? (
              <Empty title="No payments recorded" sub="Recording one here starts the billing cycle." />
            ) : (
              <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
                <table style={table}>
                  <thead><tr>{["Date", "Amount", "Method", "Reference"].map((h, i) => <th key={h} style={{ ...th, textAlign: i === 1 ? "right" : "left" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {history.map((p, i) => (
                      <tr key={i}>
                        <td style={td}>{shortDate(p.date)}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(p.amount)}</td>
                        <td style={td}>{p.method || "—"}</td>
                        <td style={{ ...td, color: "var(--fg-4)" }}>{p.transactionId || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === "offboarding" && <OffboardingTab society={society} router={router} societyId={societyId} onChanged={() => queryClient.invalidateQueries({ queryKey: ["society", societyId] })} />}

      {activeTab === "members" && (
        <DataTable
          loading={membersLoading}
          rows={members}
          expected={stats.members}
          empty="No members in this society"
          columns={[
            ["Name", (m) => m.name || m.fullName],
            ["Flat", (m) => `${m.wing ? m.wing + "-" : ""}${m.flatNo || m.flat || "—"}`],
            ["Contact", (m) => m.phone || m.email || "—"],
            ["Area (sq ft)", (m) => m.areaSqft || m.carpetArea || "—", "right"],
            ["Ownership", (m) => m.ownershipType || m.occupancyType || "—"],
          ]}
        />
      )}

      {activeTab === "bills" && (
        <DataTable
          loading={billsLoading}
          rows={bills}
          expected={stats.bills}
          empty="No bills raised for this society"
          columns={[
            ["Bill", (b) => b.billNumber || b.billNo || String(b._id).slice(-6)],
            ["Period", (b) => b.billPeriod || b.period || "—"],
            ["Flat", (b) => b.flatNo || "—"],
            ["Amount", (b) => money(b.totalAmount ?? b.amount ?? 0), "right"],
            ["Due", (b) => (b.dueDate ? shortDate(b.dueDate) : "—")],
            ["Status", (b) => b.status || "—"],
          ]}
        />
      )}

      {activeTab === "transactions" && (
        <DataTable
          loading={txnLoading}
          rows={transactions}
          expected={stats.transactions}
          empty="No ledger entries for this society"
          columns={[
            ["Date", (t) => (t.date ? shortDate(t.date) : "—")],
            ["Type", (t) => t.type || t.category || "—"],
            ["Narration", (t) => t.narration || t.description || "—"],
            ["Amount", (t) => money(t.amount ?? 0), "right"],
          ]}
        />
      )}
    </div>
  );
}

/* ── bits ─────────────────────────────────────────────────────────────── */

const table = { width: "100%", borderCollapse: "collapse", fontSize: 12.5 };
const th = {
  padding: "9px 12px", fontSize: 10, fontWeight: 700, color: "var(--fg-4)",
  textTransform: "uppercase", letterSpacing: "0.6px", background: "var(--bg-sunken)",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", textAlign: "left",
};
const td = { padding: "10px 12px", borderBottom: "1px solid var(--border)" };

function KV({ rows }) {
  return (
    <div>
      {rows.map(([k, v], i) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, padding: "8px 0", borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--border)" }}>
          <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{k}</span>
          <span style={{ fontSize: 12.5, color: v ? "var(--fg-2)" : "var(--fg-5)" }}>{v || "Not provided"}</span>
        </div>
      ))}
    </div>
  );
}

function DataTable({ loading, rows, expected, columns, empty }) {
  if (loading) return <Card><Empty title="Loading…" /></Card>;
  if (!rows.length) {
    return (
      <Card>
        <Empty
          title={empty}
          sub={expected ? `${expected.toLocaleString("en-IN")} are on record for this society — the data browser returned none, which points at a filter or permission problem rather than an empty society.` : undefined}
        />
      </Card>
    );
  }
  return (
    <Card padded={false}>
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--fg-4)" }}>
        Showing {rows.length.toLocaleString("en-IN")}
        {typeof expected === "number" && expected !== rows.length ? ` of ${expected.toLocaleString("en-IN")}` : ""}
      </div>
      <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
        <table style={table}>
          <thead><tr>{columns.map(([label, , align]) => <th key={label} style={{ ...th, textAlign: align || "left" }}>{label}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row._id || i}>
                {columns.map(([label, get, align]) => (
                  <td key={label} style={{ ...td, textAlign: align || "left" }}>{get(row) ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PaymentForm({ busy, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [txnId, setTxnId] = useState("");
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Labelled label="Amount (₹)"><input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} /></Labelled>
      <Labelled label="Date"><input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} style={input} /></Labelled>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Labelled label="Method"><input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="UPI, NEFT…" style={input} /></Labelled>
        <Labelled label="Reference"><input value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="optional" style={input} /></Labelled>
      </div>
      <Btn variant="primary" disabled={busy || !amount} onClick={() => onSubmit({ action: "record-payment", amount: Number(amount), date, method, transactionId: txnId })}>
        {busy ? "Saving…" : "Record payment"}
      </Btn>
    </div>
  );
}

function TrialForm({ busy, onSubmit }) {
  const [days, setDays] = useState(14);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input type="number" min="1" max="90" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...input, width: 90 }} />
      <Btn size="sm" disabled={busy} onClick={() => onSubmit(days)}>Extend by {days} days</Btn>
    </div>
  );
}

function Labelled({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, color: "var(--fg-4)", fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

const input = {
  width: "100%", padding: "8px 11px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))",
  color: "var(--fg-2)", outline: "none", fontFamily: "inherit",
};


/**
 * The offboarding checklist.
 *
 * Six gates decide whether a society is ever erased (see
 * app/api/v1/cron/society-purge/route.js). Before this, the only way to know
 * which ones a society had satisfied was to read a skip reason in the ops
 * table or query the database, so "I completed the handover — what now?" had
 * no answer in the product. Now every gate says done / waiting / blocked /
 * not started, and anything outstanding carries the thing to go and do.
 */
function OffboardingTab({ society, router, societyId, onChanged }) {
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function waive() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/societies/${societyId}/offboarding`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "waive-handover", reason: reason.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed");
      notify.success(json.summary || "Waived");
      setWaiving(false);
      setReason("");
      onChanged?.();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const plan = society.offboarding;
  const handover = society.handover;
  if (!plan) {
    return <Card><Empty title="Checklist unavailable" sub="This society was loaded before the checklist existed — refresh the page." /></Card>;
  }

  const done = plan.gates.filter((g) => g.state === "done" || g.state === "waived").length;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card
        style={{
          borderLeft: `3px solid ${plan.purgeReady ? "var(--danger)" : plan.started ? "var(--warning)" : "var(--border)"}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)" }}>
              {plan.purgeReady
                ? "Ready to be erased"
                : plan.started
                  ? "Deletion in progress"
                  : "Live — not scheduled for deletion"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 5, lineHeight: 1.55, maxWidth: 620 }}>
              {plan.summary}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--fg-1)" }}>{done}<span style={{ color: "var(--fg-4)", fontSize: 15 }}>/{plan.gates.length}</span></div>
            <div style={{ fontSize: 10.5, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700 }}>gates met</div>
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gap: 9 }}>
        {plan.gates.map((g, i) => {
          const look = GATE_LOOK[g.state] || GATE_LOOK["not-started"];
          return (
            <Card key={g.id} style={{ padding: 14 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div
                  aria-hidden
                  style={{
                    width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                    background: look.bg, color: look.fg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 800,
                  }}
                >
                  {look.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10.5, color: "var(--fg-5)", fontWeight: 700 }}>{i + 1}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg-1)" }}>{g.title}</span>
                    <span style={{
                      background: look.bg, color: look.fg, borderRadius: 999,
                      padding: "2px 8px", fontSize: 10, fontWeight: 800,
                      textTransform: "uppercase", letterSpacing: "0.4px",
                    }}>
                      {look.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 4, lineHeight: 1.55 }}>
                    {g.detail}
                  </div>
                </div>
                {g.action && (
                  <Btn size="sm" onClick={() => router.push(g.action.href)}>{g.action.label}</Btn>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {plan.gates.some((g) => g.id === "handover-collected" && (g.state === "pending" || g.state === "not-started")) && plan.started && (
        <Card style={{ borderColor: "var(--warning)" }}>
          <CardHead
            title="Cannot reach this society?"
            sub="Waiving gate 6 erases a society that never collected its own records — a judgement, recorded as one."
          />
          {!waiving ? (
            <Btn variant="danger" size="sm" onClick={() => setWaiving(true)}>Waive the handover requirement</Btn>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                placeholder="Why can this society not collect its records? e.g. committee dissolved, registered address bounces."
                style={{
                  width: "100%", minHeight: 90, padding: "10px 12px", borderRadius: 9,
                  border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))",
                  color: "var(--fg-1)", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Btn variant="danger" size="sm" disabled={busy || reason.trim().length < 20} onClick={waive}>
                  {busy ? "Recording…" : "Waive and record"}
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => setWaiving(false)}>Cancel</Btn>
                <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{reason.trim().length}/20 minimum</span>
              </div>
            </div>
          )}
        </Card>
      )}

      {handover && (
        <Card>
          <CardHead title="Handover" sub="The copy prepared for the society itself" />
          <KV rows={[
            ["Status", handover.status],
            ["Sent to", (handover.recipients || []).join(", ") || null],
            ["Sent", handover.notifiedAt ? shortDate(handover.notifiedAt) : null],
            ["Downloaded", handover.downloadedAt ? shortDate(handover.downloadedAt) : null],
            ["Confirmed", handover.confirmedAt ? shortDate(handover.confirmedAt) : null],
            ["Reminders sent", String(handover.reminderCount ?? 0)],
          ]} />
          {plan.drift > 0 && (
            <div style={{
              marginTop: 12, padding: "10px 12px", borderRadius: 9,
              background: "var(--warning-bg)", color: "var(--warning)",
              fontSize: 12, lineHeight: 1.55,
            }}>
              <strong>{plan.drift} record{plan.drift === 1 ? "" : "s"} changed</strong> between the export
              being built and the society confirming it. Deliberately not a gate: they do hold a complete
              copy of the society as it stood when the export was taken. Rebuild the handover if they need
              the newer state.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
