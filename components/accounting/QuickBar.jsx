"use client";
/**
 * QuickBar — universal search + quick actions, mounted once across the
 * accounting module (see app/admin/accounting/layout.js) instead of built
 * per-page. §7.6/§7.7 of docs/accounting-module-audit-and-consolidation-
 * plan.md: "the admin should never need to remember which tab contains an
 * operation."
 *
 * Search covers three things: members/flats (name/flat/wing/contact, via the
 * same /api/members/list every other admin page already uses), account heads
 * (client-cached chart of accounts), and every page/module in the accounting
 * environment itself (MODULE_PAGES below — static, no fetch). A member result
 * deep-links straight into the Ledger pre-filtered (?memberId=) — see
 * app/admin/ledger/PageClient.js. An account result opens Account Heads with
 * that row's ledger already expanded via ?openLedger=. A page result just
 * navigates there — this is the thing that lets "where's the thing that
 * records a vendor bill" resolve to Liabilities without knowing it's filed
 * under Registers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/revamp";
import { CHECK_RESOLVE } from "@/lib/accounting/checkResolve";
import { readRecents, pushRecent } from "@/lib/accounting/recents";
import { useCan } from "@/lib/accounting/useCan";

// §7.15 role-aware gating: each action lists the real permission id that
// gates its destination (same ids the pages themselves check server-side —
// see e.g. app/api/accounting/vouchers/route.js POST). A role without it
// doesn't get a dead-end click; the item just isn't offered. Fails OPEN
// (shows everything) until permissions load or if the fetch fails — never
// blocks on a slow/failed permission check, same pattern as
// app/admin/accounting/assets/PageClient.js's `can()`.
// Every page/module in the accounting environment, searchable by name. Kept
// as a flat static list (not derived from STEP_RAIL_PAGES, which only covers
// the 6-page setup guide) since most of the module — Vouchers, Funds,
// Liabilities, the four Statements tabs — isn't part of that guide at all.
// `perm` is only set where a real permission id is confirmed against that
// page's own guard (see each route's page.js); left unset elsewhere so an
// unverified guess can't wrongly hide a page — same fails-open stance as
// QUICK_ACTIONS below.
const MODULE_PAGES = [
  { label: "Configuration (Overview)", icon: "settings", href: "/admin/accounting" },
  { label: "Guided Setup", icon: "zap", href: "/admin/accounting/setup" },
  { label: "Account Heads", icon: "book-open", href: "/admin/accounting/chart-of-accounts" },
  { label: "Financial Years", icon: "calendar", href: "/admin/accounting/financial-years" },
  { label: "Automatic Entries (Posting Rules)", icon: "repeat", href: "/admin/accounting/posting-rules" },
  { label: "Book Checks (Validation Rules)", icon: "shield-check", href: "/admin/accounting/validation-rules" },
  { label: "Fiscal Configuration", icon: "sliders-horizontal", href: "/admin/accounting/fiscal-config" },
  { label: "Vouchers", icon: "receipt", href: "/admin/accounting/books?tab=entries", perm: "accounting.vouchers.view" },
  { label: "The Books (Journal Entries)", icon: "book-open", href: "/admin/accounting/books?tab=books", perm: "accounting.journalEntries.view" },
  { label: "Corrections (Audit Trail)", icon: "history", href: "/admin/accounting/books?tab=corrections", perm: "accounting.auditTrail.view" },
  { label: "Fixed Assets", icon: "package", href: "/admin/accounting/registers?tab=assets", perm: "accounting.assets.view" },
  { label: "Funds", icon: "piggy-bank", href: "/admin/accounting/registers?tab=funds", perm: "accounting.funds.view" },
  { label: "Liabilities", icon: "landmark", href: "/admin/accounting/registers?tab=liabilities", perm: "accounting.liabilities.view" },
  { label: "Cash Flow Setup (Bank Accounts)", icon: "banknote", href: "/admin/accounting/cash-flow" },
  { label: "Balance Sheet Format", icon: "layers", href: "/admin/accounting/format" },
  { label: "Full Statement Pack", icon: "file-text", href: "/admin/accounting/statements?tab=generate" },
  { label: "Income & Expenditure", icon: "trending-up", href: "/admin/accounting/statements?tab=income-expenditure" },
  { label: "Balance Sheet", icon: "scale", href: "/admin/accounting/statements?tab=assets-liabilities" },
  { label: "Trial Balance & Checks", icon: "check-square", href: "/admin/accounting/statements?tab=trial-balance" },
  { label: "Year-End Close", icon: "flag", href: "/admin/accounting/statements?tab=year-end" },
  { label: "Auditor Workspace", icon: "shield", href: "/admin/accounting/auditor", perm: "auditor.workspace.view" },
];

const QUICK_ACTIONS = [
  { label: "New Voucher", icon: "receipt", href: "/admin/accounting/books?tab=entries", perm: "accounting.vouchers.create" },
  { label: "Bank Reconciliation", icon: "banknote", href: "/admin/accounting/registers?tab=bank-accounts", perm: "accounting.bankAccounts.match" },
  { label: "Add Asset", icon: "package", href: "/admin/accounting/registers?tab=assets", perm: "accounting.assets.register" },
  { label: "Fund Transfer", icon: "piggy-bank", href: "/admin/accounting/registers?tab=funds", perm: "accounting.funds.transfer" },
  { label: "Record Liability", icon: "landmark", href: "/admin/accounting/registers?tab=liabilities", perm: "accounting.liabilities.incur" },
  { label: "Generate Statement", icon: "file-text", href: "/admin/accounting/statements", perm: "statements.incomeExpenditure.view" },
];

export default function QuickBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [members, setMembers] = useState([]);
  const [accounts, setAccounts] = useState(null); // cached once, client-side
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState([]);
  const can = useCan();
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setRecents(readRecents()); }, []);

  const visibleActions = QUICK_ACTIONS.filter((a) => can(a.perm));

  // §7.17 action inbox — one real surface, "Accounting — N actions
  // required", reading the same 7 checks Year-End Close shows, via the
  // shared lib/accounting/checkResolve.js map so the two never disagree.
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState(null); // null = not loaded yet
  const [inboxLoading, setInboxLoading] = useState(false);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const res = await fetch("/api/accounting/validation/run", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      const results = json.results || json.checks || [];
      setInboxItems(results.filter((c) => !c.passed));
    } catch {
      setInboxItems([]);
    } finally {
      setInboxLoading(false);
    }
  }, []);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  const inboxCount = inboxItems?.length ?? 0;

  // §7.16 "continue last unfinished workflow" — scans for any in-progress
  // wizard this browser left mid-flow (see YearEndClose.jsx's own
  // localStorage keys) and surfaces one link back to it, instead of the
  // admin having to remember it exists.
  const [unfinished, setUnfinished] = useState(null); // { label, href } | null
  useEffect(() => {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        const val = window.localStorage.getItem(key);
        if (key.startsWith("accounting.yearEndWizard.") && Number(val) > 1) {
          setUnfinished({ label: "Continue closing the year", href: "/admin/accounting/statements?tab=year-end" });
          return;
        }
        if (key.startsWith("accounting.appropriationWizard.") && Number(val) > 1) {
          setUnfinished({ label: "Continue surplus appropriation", href: "/admin/accounting/statements?tab=year-end" });
          return;
        }
      }
    } catch { /* best-effort */ }
  }, []);

  // §7.28 power-user shortcuts — never required for normal use, pure
  // acceleration: "/" focuses search, "n" opens Quick Actions, "Esc" closes
  // whichever is open. Ignored while typing in any input/textarea/select so
  // normal forms across the module are unaffected.
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
      if (e.key === "Escape") { setOpen(false); setMenuOpen(false); setInboxOpen(false); return; }
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); setMenuOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load the chart of accounts once, lazily, on first keystroke — not on
  // every page mount, so QuickBar costs nothing until it's used.
  const ensureAccounts = useCallback(async () => {
    if (accounts !== null) return;
    try {
      const res = await fetch("/api/accounting/chart-of-accounts", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      setAccounts(json.accounts || []);
    } catch {
      setAccounts([]); // search still works for members even if this fails
    }
  }, [accounts]);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setMembers([]);
      // Empty box with recents to show stays open (focus handler opened it);
      // otherwise there's nothing to show, so close.
      if (!recents.length) setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    ensureAccounts();
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members/list?search=${encodeURIComponent(needle)}&limit=6`, { credentials: "include", signal: ac.signal });
        const json = await res.json().catch(() => ({}));
        setMembers(json.members || []);
      } catch (e) {
        if (e?.name !== "AbortError") setMembers([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q, ensureAccounts, recents.length]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setMenuOpen(false); setInboxOpen(false); } };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const accountMatches = (() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2 || !accounts) return [];
    return accounts
      .filter((a) => a.name?.toLowerCase().includes(needle) || String(a.code).includes(needle))
      .slice(0, 6);
  })();

  const pageMatches = (() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return MODULE_PAGES
      .filter((p) => (!p.perm || can(p.perm)) && p.label.toLowerCase().includes(needle))
      .slice(0, 6);
  })();

  const goto = (href, recent) => {
    if (recent) { pushRecent(recent); setRecents(readRecents()); }
    setOpen(false); setMenuOpen(false); setInboxOpen(false); setQ(""); router.push(href);
  };

  return (
    <div
      ref={boxRef}
      style={{
        display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 16,
        position: "relative", flexWrap: "wrap",
      }}
    >
      <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 420 }}>
        <div style={{ position: "relative" }}>
          <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 9, color: "var(--r-fg-4)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => (q.trim().length >= 2 || recents.length) && setOpen(true)}
            placeholder="Search a member, flat, account head, or page… ( / )"
            style={{
              width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, fontSize: 13,
              border: "1px solid var(--r-hairline)", background: "var(--r-surface)", color: "var(--r-fg-1)",
            }}
          />
        </div>
        {open ? (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 40,
            background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)", maxHeight: 340, overflowY: "auto",
          }}>
            {loading ? (
              <div style={{ padding: 14, fontSize: 12, color: "var(--r-fg-4)" }}>Searching…</div>
            ) : q.trim().length < 2 && recents.length ? (
              <div style={{ padding: "8px 4px" }}>
                <div style={{ padding: "2px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: 0.4 }}>Recently viewed</div>
                {recents.map((r) => (
                  <div key={`${r.type}-${r.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px" }}>
                    <Icon name={r.type === "member" ? "user" : r.type === "voucher" ? "receipt" : "book-open"} size={13} style={{ color: "var(--r-fg-4)" }} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>{r.label}</div>
                    <button type="button" onClick={() => goto(r.href)} style={quickLinkStyle}>Open →</button>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {pageMatches.length ? (
                  <div style={{ padding: "8px 4px" }}>
                    <div style={{ padding: "2px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: 0.4 }}>Pages</div>
                    {pageMatches.map((p) => (
                      <div key={p.href} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px" }}>
                        <Icon name={p.icon} size={13} style={{ color: "var(--r-fg-4)", flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>{p.label}</div>
                        <button
                          type="button"
                          onClick={() => goto(p.href, { type: "page", id: p.href, label: p.label, href: p.href })}
                          style={quickLinkStyle}
                        >Open →</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {members.length ? (
                  <div style={{ padding: "8px 4px", borderTop: pageMatches.length ? "1px solid var(--r-hairline)" : "none" }}>
                    <div style={{ padding: "2px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: 0.4 }}>Members</div>
                    {members.map((m) => (
                      <div key={m._id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--r-fg-1)" }}>{m.wing ? `${m.wing}-` : ""}{m.flatNo} — {m.ownerName}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => goto(`/admin/ledger?memberId=${m._id}`, { type: "member", id: m._id, label: `${m.wing ? `${m.wing}-` : ""}${m.flatNo} — ${m.ownerName}`, href: `/admin/ledger?memberId=${m._id}` })}
                          style={quickLinkStyle}
                        >Ledger →</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {accountMatches.length ? (
                  <div style={{ padding: "8px 4px", borderTop: members.length || pageMatches.length ? "1px solid var(--r-hairline)" : "none" }}>
                    <div style={{ padding: "2px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: 0.4 }}>Account heads</div>
                    {accountMatches.map((a) => (
                      <div key={a._id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px" }}>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>{a.code} — {a.name}</div>
                        <button
                          type="button"
                          onClick={() => goto(`/admin/accounting/chart-of-accounts?openLedger=${a._id}`, { type: "account", id: a._id, label: `${a.code} — ${a.name}`, href: `/admin/accounting/chart-of-accounts?openLedger=${a._id}` })}
                          style={quickLinkStyle}
                        >Ledger →</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {!loading && !pageMatches.length && !members.length && !accountMatches.length ? (
                  <div style={{ padding: 14, fontSize: 12, color: "var(--r-fg-4)" }}>No match for &ldquo;{q}&rdquo;.</div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {unfinished ? (
        <button
          type="button"
          onClick={() => goto(unfinished.href)}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
            background: "var(--r-warning-bg, #fff8e6)", color: "var(--r-warning-fg, #7a5b00)", border: "1px solid var(--r-warning, #f0c36d)", cursor: "pointer",
          }}
        >
          <Icon name="rotate-ccw" size={13} /> {unfinished.label}
        </button>
      ) : null}

      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setInboxOpen((v) => !v)}
          title="Accounting actions required"
          style={{
            position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 8, background: "var(--r-surface)",
            border: "1px solid var(--r-hairline)", cursor: "pointer",
          }}
        >
          <Icon name="bell" size={15} color="var(--r-fg-2)" />
          {inboxCount > 0 ? (
            <span style={{
              position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 999,
              background: "var(--r-danger)", color: "#fff", fontSize: 9.5, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{inboxCount}</span>
          ) : null}
        </button>
        {inboxOpen ? (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 40, width: 300,
            background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)", padding: 10,
          }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
              {inboxLoading ? "Checking…" : inboxCount === 0 ? "You're all caught up" : `Accounting — ${inboxCount} action${inboxCount === 1 ? "" : "s"} required`}
            </div>
            {!inboxLoading && inboxCount > 0 ? (
              <div style={{ display: "grid", gap: 6 }}>
                {inboxItems.map((c) => {
                  const r = CHECK_RESOLVE[c.rule];
                  return (
                    <div key={c.rule} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon name={c.blocking ? "alert-triangle" : "info"} size={13} color={c.blocking ? "var(--r-danger)" : "var(--r-warning)"} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--r-fg-2)" }}>{r?.label || c.message || c.rule}</div>
                      {r ? <button type="button" onClick={() => goto(r.href)} style={quickLinkStyle}>{r.fix} →</button> : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: "var(--r-brand)", color: "var(--r-brand-ink)", border: "1px solid var(--r-brand)", cursor: "pointer",
          }}
        >
          <Icon name="plus" size={14} /> New / Quick actions <span style={{ opacity: 0.7, fontWeight: 400 }}>(N)</span>
        </button>
        {menuOpen ? (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 40, minWidth: 220,
            background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)", padding: 6,
          }}>
            {visibleActions.length === 0 ? (
              <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--r-fg-4)" }}>No quick actions available for your role.</div>
            ) : null}
            {visibleActions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => goto(a.href)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                  padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--r-fg-1)",
                  background: "transparent", border: "none", cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--r-surface-2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <Icon name={a.icon} size={14} /> {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const quickLinkStyle = {
  fontSize: 11.5, fontWeight: 600, color: "var(--r-brand)", background: "none",
  border: "none", cursor: "pointer", flexShrink: 0,
};
