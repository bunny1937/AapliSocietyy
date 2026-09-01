"use client";
/**
 * Accounting Assistant — offline, rule-based, this-society-only. §7.14 of
 * docs/accounting-module-audit-and-consolidation-plan.md, scoped down per
 * explicit direction: a real LLM has per-call cost this project doesn't have
 * budget for, so this is NOT a chatbot and takes no free-text input. It's a
 * fixed set of buttons, each backed by a deterministic handler that reads
 * this society's real data through APIs already built and verified
 * elsewhere in this module (validation/run, setup-state,
 * financial-statements/income-expenditure). No network call to any AI
 * provider, ever — every answer is computed here from real numbers.
 *
 * Adding a new question: add one entry to QUESTIONS with an `answer(ctx)`
 * function. ctx carries the already-fetched checks/setupState/surplus so
 * most questions don't need their own fetch.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Btn } from "@/components/revamp";

const RESOLVE_HREF = {
  trialBalanceBalanced: "/admin/accounting/statements?tab=trial-balance",
  accountsMissingScheduleCode: "/admin/accounting/books?tab=schedules",
  defaultAccountMappingsConfigured: "/admin/accounting?drawer=fiscal-config",
  draftVouchersPending: "/admin/accounting/books?tab=entries",
  depreciationPosted: "/admin/accounting/registers?tab=assets",
  bankStatementLinesUnmatched: "/admin/accounting/registers?tab=bank-accounts",
  liabilitiesOverdue: "/admin/accounting/registers?tab=liabilities",
};

const QUESTIONS = [
  {
    key: "pending",
    label: "What's pending before I close the year?",
    answer: (ctx) => {
      const open = (ctx.checks || []).filter((c) => !c.passed);
      if (!open.length) return { text: "Nothing — every check passes. You're clear to close the year.", actions: [] };
      return {
        text: `${open.length} item${open.length === 1 ? "" : "s"} outstanding:`,
        list: open.map((c) => c.message || c.rule),
        actions: open.slice(0, 3).map((c) => ({ label: `Fix: ${c.message?.slice(0, 40) || c.rule}`, href: RESOLVE_HREF[c.rule] })).filter((a) => a.href),
      };
    },
  },
  {
    key: "surplus",
    label: "What's this year's surplus or deficit?",
    answer: (ctx) => {
      if (ctx.surplus === null) return { text: "Couldn't read the Income & Expenditure statement — check a Financial Year exists.", actions: [] };
      const kind = ctx.surplus >= 0 ? "surplus" : "deficit";
      return {
        text: `₹${Math.abs(ctx.surplus).toLocaleString("en-IN")} ${kind} for the year, from the Income & Expenditure statement.`,
        actions: [
          { label: "View Income & Expenditure", href: "/admin/accounting/statements?tab=income-expenditure" },
          ...(ctx.surplus > 0 ? [{ label: "Appropriate to a fund", href: "/admin/accounting/registers?tab=funds" }] : []),
        ],
      };
    },
  },
  {
    key: "agm",
    label: "What do I need for the AGM?",
    answer: () => ({
      text: "The AGM pack needs, side by side with last year's figures: Income & Expenditure, Balance Sheet, Receipts & Payments, Schedules A–J, Trial Balance, and the member dues position. All of these come from one Financial Year once it's closed.",
      actions: [
        { label: "Open Year-End Close", href: "/admin/accounting/statements?tab=year-end" },
        { label: "Open Statements", href: "/admin/accounting/statements" },
      ],
    }),
  },
  {
    key: "fixnonblocking",
    label: "What non-blocking issues are open?",
    answer: (ctx) => {
      const soft = (ctx.checks || []).filter((c) => !c.passed && !c.blocking);
      if (!soft.length) return { text: "None — every non-blocking check passes too.", actions: [] };
      return {
        text: `${soft.length} non-blocking item${soft.length === 1 ? "" : "s"} — won't stop a statement printing, but worth clearing:`,
        list: soft.map((c) => c.message || c.rule),
        actions: soft.slice(0, 3).map((c) => ({ label: `Review: ${c.message?.slice(0, 40) || c.rule}`, href: RESOLVE_HREF[c.rule] })).filter((a) => a.href),
      };
    },
  },
  {
    key: "fy",
    label: "What financial year am I in, and what's its status?",
    answer: (ctx) => {
      const fy = ctx.setupState?.financialYear;
      if (!fy) return { text: "No Financial Year exists yet.", actions: [{ label: "Create one", href: "/admin/accounting?drawer=financial-years" }] };
      return { text: `${fy.label || "This year"} — status: ${fy.status || "unknown"}.`, actions: [{ label: "Financial Years", href: "/admin/accounting?drawer=financial-years" }] };
    },
  },
];

export default function Assistant() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState(null); // { question, result } | null

  const loadCtx = useCallback(async () => {
    if (ctx) return ctx;
    setLoading(true);
    try {
      const [setupRes, checksRes] = await Promise.all([
        fetch("/api/accounting/setup-state", { credentials: "include" }).then((r) => r.json()).catch(() => null),
        fetch("/api/accounting/validation/run", { credentials: "include" }).then((r) => r.json()).catch(() => null),
      ]);
      const fyId = setupRes?.financialYear?._id;
      const ieRes = fyId
        ? await fetch(`/api/accounting/financial-statements/income-expenditure?financialYearId=${fyId}`, { credentials: "include" }).then((r) => r.json()).catch(() => null)
        : null;
      const next = {
        setupState: setupRes || null,
        checks: checksRes?.results || checksRes?.checks || [],
        surplus: ieRes?.statement?.surplusOrDeficitCurrent ?? null,
      };
      setCtx(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  const ask = useCallback(async (q) => {
    const c = await loadCtx();
    setAnswer({ question: q.label, result: q.answer(c) });
  }, [loadCtx]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Accounting Assistant"
        style={{
          position: "fixed", bottom: 22, right: 22, zIndex: 60, width: 46, height: 46, borderRadius: 999,
          background: "var(--r-brand)", color: "var(--r-brand-ink)", border: "none", cursor: "pointer",
          boxShadow: "0 6px 18px rgba(0,0,0,0.22)", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Icon name="help-circle" size={20} />
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 22, right: 22, zIndex: 60, width: 340, maxHeight: "70vh",
      background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: 12,
      boxShadow: "0 12px 32px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--r-hairline)" }}>
        <Icon name="help-circle" size={16} color="var(--r-brand)" />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Accounting Assistant</div>
        <button type="button" onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--r-fg-4)", fontSize: 15 }}>×</button>
      </div>
      <div style={{ padding: 10, fontSize: 11, color: "var(--r-fg-4)", lineHeight: 1.5 }}>
        Answers your society&apos;s own data, offline — pick a question, no free typing. Not a chatbot.
      </div>
      <div style={{ overflowY: "auto", padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        {answer ? (
          <div style={{ marginBottom: 4 }}>
            <button type="button" onClick={() => setAnswer(null)} style={{ fontSize: 11, color: "var(--r-brand)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 8 }}>
              ← Ask something else
            </button>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-1)", marginBottom: 6 }}>{answer.question}</div>
            <div style={{ fontSize: 12.5, color: "var(--r-fg-2)", lineHeight: 1.6 }}>{answer.result.text}</div>
            {answer.result.list?.length ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--r-fg-3)", lineHeight: 1.7 }}>
                {answer.result.list.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            ) : null}
            {answer.result.actions?.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {answer.result.actions.map((a) => (
                  <Btn key={a.href} size="sm" variant="primary" onClick={() => { setOpen(false); router.push(a.href); }}>
                    {a.label}
                  </Btn>
                ))}
              </div>
            ) : null}
          </div>
        ) : loading ? (
          <div style={{ fontSize: 12, color: "var(--r-fg-4)", padding: "8px 2px" }}>Checking your society&apos;s books…</div>
        ) : (
          QUESTIONS.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={() => ask(q)}
              style={{
                textAlign: "left", padding: "9px 10px", borderRadius: 8, fontSize: 12.5,
                background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)", color: "var(--r-fg-1)", cursor: "pointer",
              }}
            >
              {q.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
