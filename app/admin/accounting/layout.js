"use client";
/**
 * Layout for every /admin/accounting/* page — mounts QuickBar (universal
 * search + "New / Quick actions") and StepRail (the 6-page setup guide) once,
 * in a single row above whatever page renders below, instead of each page
 * rebuilding its own search or repeating `<StepRail currentKey="...">` by
 * hand. §7.6/§7.7 of docs/accounting-module-audit-and-consolidation-plan.md:
 * one search, one quick-actions menu, everywhere in the module.
 *
 * StepRail sits on the left, QuickBar's search + actions on the right —
 * previously each of the 6 setup pages rendered its own full-width StepRail
 * row above QuickBar's row, costing two stacked bars where one does. Which
 * step is "current" used to be a prop each of those 6 pages passed by hand;
 * here it's derived once from the URL, so a page navigated to directly (or
 * one outside the 6, like Posting Rules) still gets the rail with the right
 * step lit, or none lit at all, without needing to know about StepRail.
 *
 * Client layout (not server) because QuickBar itself is client-only (it
 * fetches on keystroke); Suspense here is defensive — none of the pages
 * below currently require it for this layout specifically, but a shared
 * layout is exactly the place a future page using useSearchParams would
 * need one anyway.
 */
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import QuickBar from "@/components/accounting/QuickBar";
import StepRail, { STEP_RAIL_PAGES } from "@/components/accounting/StepRail";
import Assistant from "@/components/accounting/Assistant";

/** Longest-href-first so "/admin/accounting" (the Configuration page itself)
 *  doesn't shadow every other page it's a prefix of. */
const RAIL_PAGES_BY_HREF_LENGTH = [...STEP_RAIL_PAGES].sort((a, b) => b.href.length - a.href.length);

function currentRailKey(pathname) {
  const hit = RAIL_PAGES_BY_HREF_LENGTH.find((p) => pathname === p.href || pathname.startsWith(p.href + "/"));
  return hit?.key ?? null;
}

export default function AccountingLayout({ children }) {
  const pathname = usePathname();
  // No outer padding here — DashboardLayout (components/DashboardLayout, via
  // app/admin/layout.js) already provides the page gutter; adding another
  // would double it.
  return (
    <>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <Suspense fallback={null}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <StepRail currentKey={currentRailKey(pathname)} />
            <QuickBar />
          </div>
        </Suspense>
      </div>
      {children}
      <Assistant />
    </>
  );
}
