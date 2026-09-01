"use client";
/**
 * Year-End Close — the command centre from §7.9/§7.10/§7.11 of
 * docs/accounting-module-audit-and-consolidation-plan.md: one checklist
 * instead of hunting through pages, a readiness %, and one action that
 * confirms every statement is ready to view instead of clicking Generate
 * seven times.
 *
 * Every line on this checklist is a REAL check already running in
 * lib/accounting/validation/checks.js (CHECK_REGISTRY) via
 * /api/accounting/validation/run — this tab doesn't invent new signals, it
 * reframes the same seven checks the Book Checks page already runs, with a
 * "Resolve" button that jumps straight to the fix.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Btn, Icon, Progress, Pill } from "@/components/revamp";
import { fetchSetupState } from "@/lib/accounting/setupStateClient";
import Term from "@/components/accounting/Term";
import notify from "@/lib/notify";
import FirstRunHint from "@/components/accounting/FirstRunHint";
import { CHECK_RESOLVE } from "@/lib/accounting/checkResolve";

// href/fix-label come from the single shared map (lib/accounting/checkResolve.js)
// so this checklist and QuickBar's action inbox can never point at different
// places for the same check.
const RESOLVE = Object.fromEntries(
  Object.entries(CHECK_RESOLVE).map(([k, v]) => [k, { label: v.fix, href: v.href }]),
);

const LABELS = {
  trialBalanceBalanced: <><Term word="Trial Balance" /> balanced</>,
  accountsMissingScheduleCode: <>Every account head has a <Term word="Schedule" /></>,
  defaultAccountMappingsConfigured: "Default account mappings configured",
  draftVouchersPending: "No vouchers left in Draft",
  depreciationPosted: <><Term word="Depreciation" /> posted for the year</>,
  bankStatementLinesUnmatched: <>Bank statements fully <Term word="Reconciliation">reconciled</Term></>,
  liabilitiesOverdue: "No overdue liabilities",
};

// Advancing a Financial Year one step (see app/api/accounting/financial-
// years/[id]/transition/route.js) — the 5-state chain the module already
// enforces server-side. Plain-language labels for what each step means.
const FY_STEPS = ["Draft", "Reviewed", "Auditor Review", "Approved", "Locked"];
const NEXT_STEP_COPY = {
  Draft: "Marks the books reviewed and ready for the auditor.",
  Reviewed: "Hands the year to Auditor Review.",
  "Auditor Review": "Marks the auditor's review complete — Approved.",
  Approved: "Locks the year permanently. No entry in it can be edited again.",
};

export default function YearEndClose() {
  const router = useRouter();
  const [checks, setChecks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [surplus, setSurplus] = useState(null);
  const [packState, setPackState] = useState(null); // { checking: bool, results: [...] } | null
  const [financialYearId, setFinancialYearId] = useState(null);
  const [fy, setFy] = useState(null); // { _id, label, status }

  // §7.4/§7.23 guided wizard with autosave: which step of the close flow the
  // admin was on, kept per Financial Year so leaving mid-flow and coming
  // back resumes instead of restarting. Real state (Preview -> Confirm),
  // not a fake progress bar — the "step" is which screen of THIS wizard is
  // showing, independent of the FY's own server-side status chain above.
  const [wizardStep, setWizardStep] = useState(1); // 1 = closed/collapsed, 2 = preview, 3 = confirming
  const [closing, setClosing] = useState(false);
  const wizardKey = financialYearId ? `accounting.yearEndWizard.${financialYearId}` : null;

  // Second wizard on this same tab — Surplus Appropriation (one of the
  // doc's own 8 minimum flows). Same Preview -> Confirm shape, same
  // per-FY autosave pattern, posts through FundService.contributeToFund —
  // real money movement, not a UI-only "mark as done".
  const [apStep, setApStep] = useState(1); // 1 = closed, 2 = choose fund, 3 = confirm
  const [funds, setFunds] = useState([]);
  const [retainedSurplusAccountId, setRetainedSurplusAccountId] = useState(null);
  const [apFundId, setApFundId] = useState("");
  const [apposting, setApposting] = useState(false);
  const apKey = financialYearId ? `accounting.appropriationWizard.${financialYearId}` : null;

  useEffect(() => {
    if (!apKey) return;
    try {
      const saved = window.localStorage.getItem(apKey);
      if (saved) setApStep(Number(saved) || 1);
    } catch { /* no saved progress */ }
  }, [apKey]);

  const goApStep = useCallback((step) => {
    setApStep(step);
    try { if (apKey) window.localStorage.setItem(apKey, String(step)); } catch { /* best-effort */ }
  }, [apKey]);

  const startAppropriation = useCallback(async () => {
    try {
      const [fRes, aRes] = await Promise.all([
        fetch("/api/accounting/funds", { credentials: "include" }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include" }),
      ]);
      const fJson = await fRes.json().catch(() => ({}));
      const aJson = await aRes.json().catch(() => ({}));
      setFunds(fJson.funds || []);
      const retained = (aJson.accounts || []).find((a) => a.subType === "RetainedSurplus");
      setRetainedSurplusAccountId(retained?._id || null);
      goApStep(2);
    } catch (e) {
      notify.error(e.message);
    }
  }, [goApStep]);

  const confirmAppropriation = useCallback(async () => {
    if (!apFundId || !retainedSurplusAccountId || !surplus) return;
    setApposting(true);
    try {
      const res = await fetch(`/api/accounting/funds/${apFundId}/contribute`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contraAccountId: retainedSurplusAccountId, amount: Math.abs(surplus), note: "Year-end surplus appropriation" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not post the appropriation.");
      notify.success(`₹${Math.abs(surplus).toLocaleString("en-IN")} appropriated.`);
      goApStep(1);
      try { if (apKey) window.localStorage.removeItem(apKey); } catch { /* best-effort */ }
      load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setApposting(false);
    }
  }, [apFundId, retainedSurplusAccountId, surplus, apKey, goApStep]);

  useEffect(() => {
    if (!wizardKey) return;
    try {
      const saved = window.localStorage.getItem(wizardKey);
      if (saved) setWizardStep(Number(saved) || 1);
    } catch { /* no saved progress, start fresh */ }
  }, [wizardKey]);

  const goStep = useCallback((step) => {
    setWizardStep(step);
    try { if (wizardKey) window.localStorage.setItem(wizardKey, String(step)); } catch { /* best-effort */ }
  }, [wizardKey]);

  const closeYear = useCallback(async () => {
    if (!financialYearId) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/accounting/financial-years/${financialYearId}/transition`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Closed via Year-End Close wizard" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not advance the Financial Year.");
      setFy(json.financialYear);
      goStep(1);
      try { if (wizardKey) window.localStorage.removeItem(wizardKey); } catch { /* best-effort */ }
    } catch (e) {
      notify.error(e.message);
    } finally {
      setClosing(false);
    }
  }, [financialYearId, wizardKey, goStep]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const setupState = await fetchSetupState().catch(() => null);
      const fyId = setupState?.financialYear?._id || null;
      setFinancialYearId(fyId);
      setFy(setupState?.financialYear || null);
      const qs = fyId ? `?financialYearId=${fyId}` : "";
      const [vRes, ieRes] = await Promise.all([
        fetch(`/api/accounting/validation/run${qs}`, { credentials: "include" }),
        fetch(`/api/accounting/financial-statements/income-expenditure${qs}`, { credentials: "include" }),
      ]);
      const vJson = await vRes.json().catch(() => ({}));
      if (vRes.ok) setChecks(vJson.results || vJson.checks || []);
      const ieJson = await ieRes.json().catch(() => ({}));
      if (ieRes.ok) setSurplus(ieJson.statement?.surplusOrDeficitCurrent ?? null);
    } finally {
      setLoading(false);
    }
  }, [financialYearId]);

  useEffect(() => { load(); }, [load]);

  const generatePack = useCallback(async () => {
    setPackState({ checking: true, results: [] });
    const targets = [
      { key: "income-expenditure", label: "Income & Expenditure", url: `/api/accounting/financial-statements/income-expenditure${financialYearId ? `?financialYearId=${financialYearId}` : ""}` },
      { key: "balance-sheet", label: "Balance Sheet", url: `/api/accounting/financial-statements/balance-sheet${financialYearId ? `?financialYearId=${financialYearId}` : ""}` },
      { key: "trial-balance", label: "Trial Balance", url: `/api/accounting/trial-balance${financialYearId ? `?financialYearId=${financialYearId}` : ""}` },
    ];
    const results = [];
    for (const t of targets) {
      try {
        const res = await fetch(t.url, { credentials: "include" });
        results.push({ ...t, ok: res.ok, error: res.ok ? null : (await res.json().catch(() => ({}))).error });
      } catch (e) {
        results.push({ ...t, ok: false, error: e.message });
      }
    }
    setPackState({ checking: false, results });
  }, [financialYearId]);

  if (loading) return <Card><div style={{ padding: 20, fontSize: 13, color: "var(--r-fg-4)" }}>Checking year-end readiness…</div></Card>;

  const list = checks || [];
  const passed = list.filter((c) => c.passed).length;
  const pct = list.length ? Math.round((passed / list.length) * 100) : 0;
  const blocking = list.filter((c) => !c.passed && c.blocking);

  return (
    <div>
      <FirstRunHint
        featureKey="year-end-close"
        title="Year-End Close"
        body="One checklist for everything the year needs before closing — each item links straight to where you fix it. Nothing closes until every blocking item is resolved."
        meta="Checklist → Close the year → Appropriate surplus"
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Year-End Readiness: {pct}%</div>
            {surplus !== null ? (
              <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 3 }}>
                ₹{Math.abs(surplus).toLocaleString("en-IN")} {surplus >= 0 ? "surplus" : "deficit"} for the year
                {surplus > 0 ? <> — <Term word="Appropriation">appropriate</Term> to Reserve/Sinking Fund from the Funds tab when ready.</> : ""}
              </div>
            ) : null}
          </div>
          <Pill tone={pct === 100 ? "paid" : blocking.length ? "overdue" : "partial"}>
            {pct === 100 ? "Ready" : blocking.length ? `${blocking.length} blocking` : "Almost there"}
          </Pill>
        </div>
        <Progress value={pct} total={100} color={pct === 100 ? "var(--r-success)" : blocking.length ? "var(--r-danger)" : "var(--r-warning)"} height={8} />
      </Card>

      <Card style={{ marginBottom: 16 }} padded={false}>
        {list.map((c, i) => (
          <div key={c.rule} style={{
            display: "flex", gap: 10, alignItems: "center", padding: "12px 15px",
            borderBottom: i === list.length - 1 ? "none" : "1px solid var(--r-hairline)",
          }}>
            <Icon name={c.passed ? "check-circle" : c.blocking ? "alert-triangle" : "info"} size={16} color={c.passed ? "var(--r-success)" : c.blocking ? "var(--r-danger)" : "var(--r-warning)"} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{LABELS[c.rule] || c.description || c.rule}</div>
              {!c.passed ? <div style={{ fontSize: 12, color: "var(--r-fg-3)", marginTop: 2 }}>{c.message}</div> : null}
            </div>
            {!c.passed && RESOLVE[c.rule] ? (
              <Btn size="sm" variant="primary" onClick={() => router.push(RESOLVE[c.rule].href)}>{RESOLVE[c.rule].label}</Btn>
            ) : null}
          </div>
        ))}
        {!list.length ? (
          <div style={{ padding: 20, fontSize: 13, color: "var(--r-fg-4)" }}>No checks available.</div>
        ) : null}
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Generate Year-End Pack</div>
            <div style={{ fontSize: 12, color: "var(--r-fg-3)", marginTop: 3 }}>
              Confirms Income & Expenditure, Balance Sheet and Trial Balance are all ready to view — then open each from its own tab above.
            </div>
          </div>
          <Btn variant="primary" icon="play" disabled={packState?.checking} onClick={generatePack}>
            {packState?.checking ? "Checking…" : "Generate"}
          </Btn>
        </div>
        {packState?.results?.length ? (
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {packState.results.map((r) => (
              <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <Icon name={r.ok ? "check-circle" : "alert-triangle"} size={14} color={r.ok ? "var(--r-success)" : "var(--r-danger)"} />
                <span style={{ flex: 1 }}>{r.label}{r.ok ? " — ready" : ` — ${r.error || "not ready"}`}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {/* §7.4/§7.23 guided wizard — the real close action, autosaved per FY. */}
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Close this Financial Year</div>
            <div style={{ fontSize: 12, color: "var(--r-fg-3)", marginTop: 3 }}>
              {fy ? <>Currently: <strong>{fy.status}</strong>{fy.status !== "Locked" && NEXT_STEP_COPY[fy.status] ? <> — next step {NEXT_STEP_COPY[fy.status]}</> : ""}</> : "No Financial Year found."}
            </div>
          </div>
          {fy && fy.status !== "Locked" && wizardStep === 1 ? (
            <Btn variant="primary" onClick={() => goStep(2)}>Start closing</Btn>
          ) : null}
        </div>

        {wizardStep === 2 && fy ? (
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Step 2 of 3 — Preview</div>
            <div style={{ fontSize: 12.5, color: "var(--r-fg-2)", lineHeight: 1.6 }}>
              This moves <strong>{fy.label}</strong> from <strong>{fy.status}</strong> to the next stage.{" "}
              {NEXT_STEP_COPY[fy.status]}
              {fy.status === "Approved" ? " This step cannot be undone from here." : ""}
            </div>
            {pct < 100 ? (
              <div style={{ fontSize: 12, color: "var(--r-warning)", marginTop: 8 }}>
                {blocking.length} blocking item{blocking.length === 1 ? "" : "s"} still open above — the server will refuse this step until they're resolved.
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Btn size="sm" onClick={() => goStep(1)}>Cancel</Btn>
              <Btn size="sm" variant="primary" onClick={() => goStep(3)}>Continue</Btn>
            </div>
          </div>
        ) : null}

        {wizardStep === 3 && fy ? (
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "var(--r-surface-2)", border: "1px solid var(--r-brand)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Step 3 of 3 — Confirm</div>
            <div style={{ fontSize: 12.5, color: "var(--r-fg-2)", lineHeight: 1.6 }}>
              Confirming moves <strong>{fy.label}</strong> to the next stage now. This is a real, recorded action.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Btn size="sm" disabled={closing} onClick={() => goStep(2)}>Back</Btn>
              <Btn size="sm" variant="primary" disabled={closing} onClick={closeYear}>
                {closing ? "Closing…" : "Confirm & advance"}
              </Btn>
            </div>
          </div>
        ) : null}
      </Card>

      {surplus > 0 ? (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Appropriate this year&apos;s surplus</div>
              <div style={{ fontSize: 12, color: "var(--r-fg-3)", marginTop: 3 }}>
                Move ₹{surplus.toLocaleString("en-IN")} out of plain surplus into a Reserve or Sinking Fund — a real posting, the same as doing it from the Funds tab.
              </div>
            </div>
            {apStep === 1 ? <Btn variant="primary" onClick={startAppropriation}>Start</Btn> : null}
          </div>

          {apStep === 2 ? (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Step 2 of 3 — Choose a fund</div>
              {!retainedSurplusAccountId ? (
                <div style={{ fontSize: 12, color: "var(--r-danger)" }}>Could not find the &ldquo;Income &amp; Expenditure A/c&rdquo; head — check Chart of Accounts.</div>
              ) : !funds.length ? (
                <div style={{ fontSize: 12, color: "var(--r-fg-3)" }}>No funds registered yet — add one on the Funds tab first.</div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {funds.map((f) => (
                    <button
                      key={f._id}
                      type="button"
                      onClick={() => setApFundId(f._id)}
                      style={{
                        padding: "6px 10px", borderRadius: 8, fontSize: 12,
                        border: apFundId === f._id ? "1px solid var(--r-brand)" : "1px solid var(--r-hairline)",
                        background: apFundId === f._id ? "var(--r-brand-soft, var(--r-surface-2))" : "var(--r-surface)",
                        color: "var(--r-fg-1)", cursor: "pointer",
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn size="sm" onClick={() => goApStep(1)}>Cancel</Btn>
                <Btn size="sm" variant="primary" disabled={!apFundId || !retainedSurplusAccountId} onClick={() => goApStep(3)}>Continue</Btn>
              </div>
            </div>
          ) : null}

          {apStep === 3 ? (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "var(--r-surface-2)", border: "1px solid var(--r-brand)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Step 3 of 3 — Confirm</div>
              <div style={{ fontSize: 12.5, color: "var(--r-fg-2)", lineHeight: 1.6 }}>
                ₹{surplus.toLocaleString("en-IN")} moves from Income &amp; Expenditure A/c into <strong>{funds.find((f) => f._id === apFundId)?.name}</strong> — a real entry, posted immediately.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn size="sm" disabled={apposting} onClick={() => goApStep(2)}>Back</Btn>
                <Btn size="sm" variant="primary" disabled={apposting} onClick={confirmAppropriation}>
                  {apposting ? "Posting…" : "Confirm & post"}
                </Btn>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
