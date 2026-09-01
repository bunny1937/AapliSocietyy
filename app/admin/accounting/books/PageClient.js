"use client";
/**
 * The books, in three tabs — design doc §12 Phase 4's route shrink.
 *
 * Each tab is the same PageClient that used to be its own route
 * (/admin/accounting/vouchers, /journal-entries, /audit-trail), mounted
 * unchanged: it does its own fetching against its own permission-gated API,
 * so a role with only one of the three underlying view permissions still
 * reaches this page and simply finds only that tab's data loading — the
 * others 403 inside their own fetch the same way they always did as
 * standalone pages. Nothing about their internals changed, only where they
 * live.
 *
 * Old URLs still work: /admin/accounting/vouchers, /journal-entries and
 * /audit-trail are now redirects to this page with `?tab=` set (see each
 * folder's page.js), so a bookmark or a link elsewhere in the app never
 * breaks.
 */
import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Tabs, Icon, RevampSkeleton } from "@/components/revamp";
import VouchersPage from "../vouchers/PageClient";
import JournalEntriesPage from "../journal-entries/PageClient";
import AuditTrailPage from "../audit-trail/PageClient";

// Financial Years / Automatic Entries / Book Checks / Statement Layout /
// Fiscal Config are NOT tabs here — they already live as drawers on the
// Accounting Overview page (app/admin/accounting/PageClient.js's DRAWERS
// map), which is this module's actual Home. Adding them again here would
// recreate the same duplication docs/accounting-module-audit-and-
// consolidation-plan.md §3 item 3 flags — three paths to one feature instead
// of one. Overview is where those five got folded into on this build.
const TABS = [
  { key: "entries", label: "Entries", icon: "receipt" },
  { key: "books", label: "The books", icon: "book-open" },
  { key: "corrections", label: "Corrections", icon: "history" },
];

function BooksPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("tab");
  const [tab, setTab] = useState(TABS.some((t) => t.key === initial) ? initial : "entries");

  const changeTab = useCallback((key) => {
    setTab(key);
    // Shallow — no data reload, this just keeps the URL bookmarkable/shareable.
    router.replace(`/admin/accounting/books?tab=${key}`, { scroll: false });
  }, [router]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="book-open" size={11} /> Was three separate pages</>}
        title="The books"
        sub="What was recorded, what actually posted, and what was corrected afterwards — one place."
      />
      <Tabs value={tab} onChange={changeTab} tabs={TABS} />
      {tab === "entries" ? <VouchersPage /> : null}
      {tab === "books" ? <JournalEntriesPage /> : null}
      {tab === "corrections" ? <AuditTrailPage /> : null}
    </div>
  );
}

export default function BooksPage() {
  return (
    <Suspense fallback={<div style={{ display: "grid", gap: 12 }}><RevampSkeleton h={90} /><RevampSkeleton h={220} /></div>}>
      <BooksPageInner />
    </Suspense>
  );
}
