"use client";
// app/admin/generate-bills/CollectionsPanel.jsx
//
// The orchestrator. Drop this into the existing Generate Bills page in place
// of the Download Template / Upload Excel block and it owns the whole flow:
//
//   idle  -> (genie morph from the Record Collections button)
//   grid  -> (genie morph from the Verify & Submit button)
//   done  -> Payments Processed: Push now | Push & schedule
//
// Everything below the seam is self-contained. The parent page only has to
// hand it a periodId.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { gsap } from "gsap";
import { ClipboardList, Sparkles } from "lucide-react";
import CollectionsGrid, { resolveRow } from "./CollectionsGrid";
import VerifyGenieOverlay from "./VerifyGenieOverlay";
import PaymentsProcessed from "./PaymentsProcessed";
import { useGenieMorph } from "./useGenieMorph";
import s from "@/styles/CollectionsGrid.module.css";

/** Stable per-session token so a double-click cannot post twice. */
function newCommitToken() {
  return `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function CollectionsPanel({ periodId, billSeries = "RESIDENTIAL" }) {
  const qc = useQueryClient();
  const { openFrom } = useGenieMorph();

  const openBtnRef = useRef(null);
  const gridShellRef = useRef(null);
  const verifyBtnRef = useRef(null);
  const commitTokenRef = useRef(newCommitToken());

  const [stage, setStage] = useState("idle"); // idle | grid | done
  const [sheet, setSheet] = useState(null);
  const [rowState, setRowState] = useState({}); // billId -> { amountPaid, mode, remarks }
  const [results, setResults] = useState({}); // billId -> verify result
  const [passCache, setPassCache] = useState({}); // billId -> content signature
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(null);
  const [banner, setBanner] = useState(null);

  // ---- Genie: the Record Collections button opens into the grid ---------
  const openGrid = useCallback(() => {
    setStage("grid");
    // One frame so the grid shell exists and has been laid out before we
    // measure it. Measuring in the same tick would read a zero rect.
    requestAnimationFrame(() => {
      if (gridShellRef.current && openBtnRef.current) {
        openFrom(openBtnRef.current, gridShellRef.current, {
          contentSelector: "[data-genie-content]",
        });
      }
    });
  }, [openFrom]);

  // ---- Editing a row invalidates only that row's cached pass ------------
  //
  // The pass cache is keyed on the row's *content*, so this happens
  // automatically inside the overlay's queue calculation. We only need to
  // clear the visible result chip so a stale green tick does not linger under
  // a value the admin just changed.
  const setRowStateTracked = useCallback((updater) => {
    setRowState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const changed = Object.keys(next).filter(
        (k) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]),
      );
      if (changed.length) {
        setResults((r) => {
          const copy = { ...r };
          for (const id of changed) delete copy[id];
          return copy;
        });
      }
      return next;
    });
  }, []);

  // ---- Cmd/Ctrl+Enter opens the verify overlay --------------------------
  useEffect(() => {
    if (stage !== "grid") return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        const unresolved = (sheet?.rows || []).some(
          (r) => !resolveRow(r, rowState[r.billId]).resolved,
        );
        if (!unresolved) setOverlayOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, sheet, rowState]);

  const handleStale = useCallback(() => {
    setOverlayOpen(false);
    setPassCache({});
    setResults({});
    setBanner({
      tone: "warn",
      text: "Billing configuration changed while this sheet was open. The ledger has been refetched — please verify again.",
    });
    qc.invalidateQueries({ queryKey: ["collection-sheet", billSeries, periodId] });
  }, [qc, billSeries, periodId]);

  const handleAllPassed = useCallback((collected) => {
    setResults(collected);
    setOverlayOpen(false);
    setStage("done");
  }, []);

  const handleCommit = useCallback(
    async (opts) => {
      setCommitting(true);
      setBanner(null);
      try {
        // Only rows that passed and carry a real payment are sent. Unpaid
        // declarations need no write.
        const rows = Object.values(results)
          .filter((r) => r.ok && r.willRecord)
          .map((r) => ({
            billId: r.billId,
            sig: sheet.rows.find((x) => x.billId === r.billId)?.sig,
            amountPaid: r.willRecord.advanceCredit
              ? Math.round((r.willRecord.amount + r.willRecord.advanceCredit) * 100) / 100
              : r.willRecord.amount,
            mode: r.willRecord.mode,
            remarks: r.willRecord.remarks,
            overpayAsAdvance: !!rowState[r.billId]?.overpayAsAdvance,
          }));

        const res = await apiClient.post("/api/bills/collection-sheet/commit", {
          ...opts,
          billSeries,
          rows,
          commitToken: commitTokenRef.current,
        });

        setCommitted({ ...res, scheduled: res.scheduled });
        qc.invalidateQueries({ queryKey: ["collection-sheet", billSeries, periodId] });
        qc.invalidateQueries({ queryKey: ["latest-period", billSeries] });
        qc.invalidateQueries({ queryKey: ["latest-period"] });
      } catch (err) {
        if (err?.data?.code === "STALE_FINGERPRINT") {
          setStage("grid");
          handleStale();
        } else if (err?.data?.code === "COMMIT_REJECTED") {
          setStage("grid");
          setBanner({
            tone: "error",
            text: `${err.data.rejected.length} row(s) failed the final check and nothing was posted. Verify again.`,
          });
          setPassCache({});
        } else {
          setBanner({ tone: "error", text: err?.message || "Commit failed." });
        }
      } finally {
        setCommitting(false);
      }
    },
    [results, sheet, qc, billSeries, periodId, handleStale],
  );

  // ---- Idle: the button that replaced Download Template -----------------
  if (stage === "idle") {
    return (
      <div className={s.launchWrap}>
        <button
          ref={openBtnRef}
          className={s.launchBtn}
          onClick={openGrid}
          onMouseEnter={(e) =>
            gsap.to(e.currentTarget.querySelector("[data-spark]"), {
              rotate: 18,
              scale: 1.12,
              duration: 0.28,
              ease: "back.out(3)",
            })
          }
          onMouseLeave={(e) =>
            gsap.to(e.currentTarget.querySelector("[data-spark]"), {
              rotate: 0,
              scale: 1,
              duration: 0.22,
              ease: "power2.out",
            })
          }
        >
          <ClipboardList size={18} />
          Record Collections
          <Sparkles size={14} data-spark className={s.launchSpark} />
        </button>
        <p className={s.launchHint}>
          Opens the {periodId} collection sheet in the browser. No template to
          download, nothing to re-upload.
        </p>
      </div>
    );
  }

  // ---- Done -------------------------------------------------------------
  if (stage === "done") {
    return (
      <PaymentsProcessed
        periodId={periodId}
        results={results}
        fingerprint={sheet?.fingerprint}
        committing={committing}
        committed={committed}
        onCommit={handleCommit}
        onBack={() => setStage("grid")}
      />
    );
  }

  // ---- Grid -------------------------------------------------------------
  return (
    // flex:1 + min-width:0 so this panel fills the row it sits in and is
    // allowed to be narrower than the table inside it - that is what lets
    // .tableScroll actually scroll instead of overflowing its card.
    <div ref={gridShellRef} style={{ flex: "1 1 100%", minWidth: 0, width: "100%" }}>
      <div data-genie-content>
        {banner && (
          <div
            className={
              banner.tone === "error" ? s.bannerError : s.bannerWarn
            }
            role="status"
          >
            {banner.text}
          </div>
        )}

        <CollectionsGrid
          periodId={periodId}
          billSeries={billSeries}
          rowState={rowState}
          setRowState={setRowStateTracked}
          results={results}
          busy={overlayOpen || committing}
          verifyBtnRef={verifyBtnRef}
          onSheetLoaded={setSheet}
          onRequestVerify={() => setOverlayOpen(true)}
        />
      </div>

      <VerifyGenieOverlay
        open={overlayOpen}
        originRef={verifyBtnRef}
        periodId={periodId}
        billSeries={billSeries}
        fingerprint={sheet?.fingerprint}
        rows={sheet?.rows || []}
        rowState={rowState}
        passCache={passCache}
        setPassCache={setPassCache}
        onResults={(r) => setResults((prev) => ({ ...prev, ...r }))}
        onAllPassed={handleAllPassed}
        onClose={() => setOverlayOpen(false)}
        onStaleFingerprint={handleStale}
      />
    </div>
  );
}
