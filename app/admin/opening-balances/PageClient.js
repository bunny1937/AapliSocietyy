"use client";

// Opening Balances — the real, production page to set a Financial Year's
// starting position (not a simulator). One-time setup per Financial Year:
// how much cash/bank the society had, what it owned, what it owed, and its
// accumulated Funds, on day one of the year.
//
// Plain-language note for non-technical society admins: everywhere else in
// this app calls one recorded transaction a "voucher" — think of it as one
// receipt/payment slip in a paper cash book. This page creates exactly one
// such slip: the "opening" slip that carries last year's closing figures
// into this year's books.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "../../../components/accounting/generate/Icon";
import { PageHeader, FySelect, Btn, EmptyState } from "../../../components/accounting/generate/PageHeader";
import { useFinancialYears } from "../../../components/accounting/generate/useFinancialYears";
import { fmtINR, Banner } from "../../../components/accounting/generate/Primitives";

async function fetchJSON(url, opts) {
  const res = await fetch(url, { credentials: "include", ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const GROUP_LABEL = {
  Asset: "What the society owns (Assets) — cash, bank, fixed deposits, property, dues from members",
  Liability: "What the society owes (Liabilities) — bills payable, deposits held for others",
  Equity: "Society Funds — Share Capital, Reserve Fund, Sinking Fund, General Fund etc.",
};

export default function OpeningBalancesScreen() {
  const router = useRouter();
  const { years, financialYearId, setFinancialYearId, loading: fyLoading } = useFinancialYears();
  const [status, setStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [amounts, setAmounts] = useState({}); // accountId -> string
  const [fundAccountId, setFundAccountId] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(null);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    if (!financialYearId) return;
    let cancelled = false;
    setFetching(true);
    setError(null);
    setPosted(false);
    Promise.all([
      fetchJSON(`/api/accounting/opening-balance?financialYearId=${financialYearId}`),
      fetchJSON(`/api/accounting/chart-of-accounts`),
    ])
      .then(([{ status }, { accounts }]) => {
        if (cancelled) return;
        setStatus(status);
        const relevant = accounts.filter((a) => ["Asset", "Liability", "Equity"].includes(a.type));
        setAccounts(relevant);
        setAmounts({});
        const firstEquity = relevant.find((a) => a.type === "Equity" && /general fund/i.test(a.name)) || relevant.find((a) => a.type === "Equity");
        setFundAccountId(firstEquity ? String(firstEquity._id) : "");
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setFetching(false));
    return () => { cancelled = true; };
  }, [financialYearId]);

  const grouped = useMemo(() => {
    const g = { Asset: [], Liability: [], Equity: [] };
    accounts.forEach((a) => { if (g[a.type]) g[a.type].push(a); });
    return g;
  }, [accounts]);

  const entries = useMemo(
    () =>
      Object.entries(amounts)
        .filter(([, v]) => Number(v) > 0)
        .map(([accountId, v]) => ({ accountId, amount: Number(v) })),
    [amounts],
  );

  const totals = useMemo(() => {
    let debit = 0, credit = 0;
    entries.forEach(({ accountId, amount }) => {
      const acc = accounts.find((a) => String(a._id) === accountId);
      if (!acc) return;
      if (acc.normalBalance === "Debit") debit += amount; else credit += amount;
    });
    return { debit, credit };
  }, [entries, accounts]);

  const balancingAmount = round2(Math.abs(totals.debit - totals.credit));
  function round2(n) { return Math.round(n * 100) / 100; }

  const canPost = status?.canEnterOpening && entries.length > 0 && fundAccountId;

  const submit = async () => {
    setPosting(true);
    setPostError(null);
    try {
      await fetchJSON("/api/accounting/opening-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financialYearId, entries, openingFundAccountId: fundAccountId }),
      });
      setPosted(true);
      const { status: fresh } = await fetchJSON(`/api/accounting/opening-balance?financialYearId=${financialYearId}`);
      setStatus(fresh);
    } catch (e) {
      setPostError(e.message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Opening Balances"
        subtitle="One-time setup per Financial Year — carry last year's closing figures into this year's books"
        right={<FySelect years={years} value={financialYearId} onChange={setFinancialYearId} />}
      />

      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#1e40af", display: "flex", gap: 10 }}>
        <Icon name="database" size={17} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          <strong>In plain words:</strong> this page is where you tell the system how much cash, bank balance, property, dues and funds the society had on the first day of this Financial Year.
          Everywhere else the app calls one recorded entry a "voucher" — it just means one receipt/payment slip, same as a paper cash book. This page creates exactly one such slip: the opening slip.
        </span>
      </div>

      {fyLoading || fetching ? (
        <EmptyState text="Loading…" />
      ) : error ? (
        <Banner tone="danger" icon="alert-triangle">{error}</Banner>
      ) : !status ? (
        <EmptyState text="No Financial Year found" hint="Create a Financial Year under Accounting first." />
      ) : status.openingBalancesConfirmed ? (
        <Banner tone="success" icon="check-circle">
          Opening balances are already posted and confirmed for this Financial Year. To change them, ask your accountant to post a correcting Journal Entry — the opening slip itself is locked once posted, the same way a paper cash book's first page isn't rewritten.
        </Banner>
      ) : !status.canEnterOpening ? (
        <>
          <Banner tone="danger" icon="alert-triangle">
            {status.voucherCount} transaction(s) are already recorded in this Financial Year, so the opening-balance step can no longer be entered here — it must be the very first entry in a Financial Year, before anything else.
          </Banner>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginTop: 16, fontSize: 13.5, color: "#374151", lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}><strong>What this means:</strong> either (a) this Financial Year genuinely started from zero and there's nothing to fix, or (b) the society's real starting cash/bank/dues/funds were never recorded and are missing from the books.</p>
            <p><strong>What to do:</strong> this can't be self-served from here anymore — ask your accountant to review the {status.voucherCount} recorded transactions in the Ledger and, if a starting balance really is missing, post one correcting Journal Entry for it.</p>
            <Btn variant="secondary" onClick={() => router.push("/admin/ledger")}>
              <Icon name="file-text" size={14} /> Review transactions in the Ledger
            </Btn>
          </div>
        </>
      ) : (
        <>
          {posted && <Banner tone="success" icon="check-circle">Opening balances posted. This Financial Year now has a confirmed starting position.</Banner>}
          {postError && <Banner tone="danger" icon="alert-triangle">{postError}</Banner>}

          {["Asset", "Liability", "Equity"].map((type) => (
            <div key={type} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, marginBottom: 16, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontSize: 13, fontWeight: 700, color: "#1f2937" }}>{GROUP_LABEL[type]}</div>
              <div style={{ padding: "6px 18px" }}>
                {grouped[type].length === 0 && <div style={{ padding: "12px 0", fontSize: 13, color: "#9ca3af" }}>No accounts of this kind set up yet.</div>}
                {grouped[type].map((a) => (
                  <div key={a._id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                    <span style={{ flex: 1, fontSize: 13.5, color: "#374151" }}>{a.name} <span style={{ color: "#9ca3af", fontSize: 12 }}>({a.code})</span></span>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>₹</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={amounts[a._id] ?? ""}
                      onChange={(e) => setAmounts((s) => ({ ...s, [a._id]: e.target.value }))}
                      style={{ width: 140, padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, textAlign: "right", fontFamily: "inherit" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18, marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
              Balancing Fund account (absorbs the difference between what's owned and what's owed — usually General Fund)
            </label>
            <select
              value={fundAccountId}
              onChange={(e) => setFundAccountId(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "inherit", width: "100%", maxWidth: 360 }}
            >
              <option value="">Select a Fund account…</option>
              {grouped.Equity.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              Entered so far: <strong style={{ color: "#0f172a" }}>{entries.length}</strong> account(s) · Debits {fmtINR(totals.debit)} · Credits {fmtINR(totals.credit)}
              {balancingAmount > 0.005 && <> · balancing figure {fmtINR(balancingAmount)} will post to the Fund account above</>}
            </div>
            <Btn variant="primary" onClick={submit} disabled={!canPost || posting}>
              <Icon name="check-circle" size={14} /> {posting ? "Posting…" : "Post opening balances"}
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
