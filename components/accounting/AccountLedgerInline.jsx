"use client";
/**
 * <AccountLedgerInline> — the same drill-down panel built for Chart of
 * Accounts (§7.12), extracted so Funds/Liabilities can show "View ledger"
 * on their own rows too instead of only being reachable from Account Heads.
 * This is also how §7.22 (reversal, not delete) reaches these pages: the
 * voucher link here opens straight into Books > Entries, where Reverse
 * already lives (Vouchers already have real reverse — this just gets you
 * there from wherever the posting actually happened).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/revamp";
import { pushRecent } from "@/lib/accounting/recents";

export default function AccountLedgerInline({ accountId, financialYearId, accountLabel }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    setErr(null);
    const ac = new AbortController();
    const qs = financialYearId ? `?accountId=${accountId}&financialYearId=${financialYearId}` : `?accountId=${accountId}`;
    fetch(`/api/accounting/general-ledger${qs}`, { credentials: "include", signal: ac.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Could not load this account's ledger.");
        setRows(json.ledger?.lines || []);
        setSummary(json.ledger || null);
      })
      .catch((e) => { if (e?.name !== "AbortError") setErr(e.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [accountId, financialYearId]);

  if (loading) return <div style={{ fontSize: 12, color: "var(--fg-4)", padding: "8px 0" }}>Loading…</div>;
  if (err) return <div style={{ fontSize: 12, color: "var(--danger, #b91c1c)", padding: "8px 0" }}>{err}</div>;
  if (!rows?.length) return <div style={{ fontSize: 12, color: "var(--fg-4)", padding: "8px 0" }}>No postings against this account this financial year.</div>;

  return (
    <div style={{ padding: "8px 0", display: "grid", gap: 8 }}>
      {summary ? (
        <div style={{ fontSize: 11.5, color: "var(--fg-4)", paddingBottom: 6, borderBottom: "1px dashed var(--border)" }}>
          Opened at ₹{summary.openingBalance.toLocaleString("en-IN")} {summary.openingSide} · ₹{summary.totalDebit.toLocaleString("en-IN")} debited,
          ₹{summary.totalCredit.toLocaleString("en-IN")} credited · closes at ₹{summary.closingBalance.toLocaleString("en-IN")} {summary.closingSide}
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((l) => (
          <div key={l.lineId} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
            <span style={{ color: "var(--fg-4)", width: 84, flexShrink: 0 }}>{l.date ? new Date(l.date).toLocaleDateString("en-IN") : "—"}</span>
            <span style={{ flex: 1, minWidth: 140, color: "var(--fg-3)" }}>{l.narration || "—"}</span>
            <span style={{ minWidth: 90, textAlign: "right", color: l.debit ? "var(--fg-1)" : "var(--fg-5)" }}>{l.debit ? `Dr ₹${l.debit.toLocaleString("en-IN")}` : ""}</span>
            <span style={{ minWidth: 90, textAlign: "right", color: l.credit ? "var(--fg-1)" : "var(--fg-5)" }}>{l.credit ? `Cr ₹${l.credit.toLocaleString("en-IN")}` : ""}</span>
            {l.voucherNumber ? (
              <Btn
                size="sm"
                onClick={() => {
                  pushRecent({ type: "voucher", id: l.voucherId, label: `${l.voucherNumber} — ${l.narration || accountLabel || ""}`, href: `/admin/accounting/books?tab=entries&open=${l.voucherId}&q=${encodeURIComponent(l.voucherNumber)}` });
                  router.push(`/admin/accounting/books?tab=entries&open=${l.voucherId}&q=${encodeURIComponent(l.voucherNumber)}`);
                }}
              >
                {l.voucherNumber} → Reverse if needed
              </Btn>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
