"use client";
// app/admin/generate-bills/BillGenerationFlow.jsx
//
// The full bill-generation wizard, parameterized by segment (Residential |
// Commercial) via SEGMENTS in ./segments.js. Both segments render this same
// component with a different config — this is what "exact same flow, just
// switchable" means structurally. Extracted from the single-purpose
// GenerateBillsPage this used to be; see docs/superpowers/specs/
// 2026-08-07-commercial-billing-parity-and-redesign-design.md.
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { postNdjson } from "@/lib/ndjson-client";
import styles from "@/styles/GenerateBills.module.css";
import { resolveHeadsForMember } from "@/lib/commercial/billingApplicability";
import ExcelBillUploadFlow from "./ExcelBillUploadFlow";
import TestConfigPanel from "./TestConfigPanel";
import CollectionsPanel from "./CollectionsPanel";
// NEW 2026-08-07: plain-language "is shop billing actually set up?" check,
// shown before the admin previews or tries to record collections.
import CommercialReadyStrip from "./CommercialReadyStrip";
import notify from "@/lib/notify";
// ─── Pure billing engine functions (client-safe, no DB/React imports) ────────
function buildParkingRates(heads) {
  const parkingRates = {};
  heads.forEach((h) => {
    const hLower = h.headName?.trim().toLowerCase() || "";
    if (!hLower.includes("parking")) return;
    const typeMatch = ["covered", "open", "stilt"].find((t) =>
      hLower.includes(t),
    );
    const vehicleMatch = hLower.includes("four")
      ? "Four-Wheeler"
      : hLower.includes("two")
        ? "Two-Wheeler"
        : null;
    if (typeMatch && vehicleMatch) {
      const key = `${typeMatch.charAt(0).toUpperCase() + typeMatch.slice(1)}-${vehicleMatch}`;
      parkingRates[key] = h.defaultAmount;
    }
  });
  return parkingRates;
}
function computeCurrentCharges(member, heads, parkingRates, serviceTaxRate) {
  // Commercial: drop heads that do not apply to this unit class and resolve
  // per-class rate overrides, so this on-screen preview matches exactly what
  // lib/calculate-member-bill.js will generate. A head with neither setting
  // (every head that exists today) passes through untouched.
  heads = resolveHeadsForMember(heads, member);
  const area = Number(
    member.carpetAreaSqft ?? member.builtUpAreaSqft ?? member.areaSqFt ?? 0,
  );
  const charges = [];
  let subtotal = 0;
  for (const head of heads) {
    if (!head.headName?.trim() || head.isActive === false) continue;
    const hLower = head.headName.trim().toLowerCase();
    if (hLower.includes("parking")) continue;
    let amount = 0;
    if (head.calculationType === "Per Sq Ft") {
      amount = area * head.defaultAmount;
    } else if (head.calculationType === "Percentage") {
      amount = (subtotal * head.defaultAmount) / 100;
    } else {
      amount = head.defaultAmount;
    }
    charges.push({
      name: head.headName,
      amount: parseFloat(amount.toFixed(2)),
    });
    subtotal += amount;
  }
  for (const slot of member.parkingSlots || []) {
    if (slot.type === "Stilt" || slot.monthlyBilling === false) continue;
    const key = `${slot.type}-${slot.vehicleType}`;
    const rate = parkingRates[key] ?? 0;
    if (rate > 0) {
      charges.push({
        name: `${slot.type} Parking - ${slot.vehicleType} (${slot.slotNumber})`,
        amount: rate,
      });
      subtotal += rate;
    }
  }
  const serviceTax =
    serviceTaxRate > 0
      ? parseFloat(((subtotal * serviceTaxRate) / 100).toFixed(2))
      : 0;
  const currentBillTotal = parseFloat((subtotal + serviceTax).toFixed(2));
  return {
    charges,
    subtotal: parseFloat(subtotal.toFixed(2)),
    serviceTax,
    currentBillTotal,
  };
}
function computeMonthlyInterest(principalOutstanding, annualRate) {
  if (principalOutstanding <= 0 || annualRate <= 0) return 0;
  return parseFloat(((principalOutstanding * annualRate) / 1200).toFixed(2));
}
function computeBillTotal({
  principalOutstanding,
  interestOutstanding,
  currInt,
  currentBillTotal,
  advanceCredit,
}) {
  const billPrincipal = parseFloat(
    (principalOutstanding + currentBillTotal).toFixed(2),
  );
  const billInterest = parseFloat((interestOutstanding + currInt).toFixed(2));
  const totalBillDue = parseFloat((billPrincipal + billInterest).toFixed(2));
  const advApplied = parseFloat(
    Math.min(advanceCredit, totalBillDue).toFixed(2),
  );
  const grandTotal = parseFloat(
    Math.max(0, totalBillDue - advApplied).toFixed(2),
  );
  return { billPrincipal, billInterest, totalBillDue, advApplied, grandTotal };
}
// ─────────────────────────────────────────────────────────────────────────────
export default function BillGenerationFlow({ segment, onSegmentComplete }) {
  const queryClient = useQueryClient();
  const [billMonth, setBillMonth] = useState(null); // 0-indexed, null until auto-detected
  const [billYear, setBillYear] = useState(null);
  // Flow 1: Bill Generation
  const [showPreview, setShowPreview] = useState(false);
  const [excelFile, setExcelFile] = useState(null);
  const [excelValidation, setExcelValidation] = useState(null);
  const [excelValidating, setExcelValidating] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewProgress, setPreviewProgress] = useState({
    current: 0,
    total: 0,
  });
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 });
  const [excelImporting, setExcelImporting] = useState(false);
  const [approvedDiffs, setApprovedDiffs] = useState(new Set());
  const [billsGeneratedForPeriod, setBillsGeneratedForPeriod] = useState(null); // periodLabel when bills were generated
  // Excel Preview Grids
  const [billGrid, setBillGrid] = useState(null);
  const [payGrid, setPayGrid] = useState(null);
  // Payment Collection
  const [payPreview, setPayPreview] = useState(null);
  const [payBatchKey, setPayBatchKey] = useState(null);
  const [payConfirming, setPayConfirming] = useState(false);
  const [payConfirmProgress, setPayConfirmProgress] = useState({ current: 0, total: 0 });
  const [payResults, setPayResults] = useState(null);
  const [autoGenState, setAutoGenState] = useState(null); // null | { status: "running"|"done"|"error", label, count, error }
  // Safe default after payment upload: generate only for successfully paid members.
  // Full-society generation remains available, but must be explicitly selected.
  const [nextGenScope, setNextGenScope] = useState("paid");
  const [nextPushMode, setNextPushMode] = useState("schedule");
  const [nextPushDate, setNextPushDate] = useState("");
  const diffIssues =
    excelValidation?.issues?.filter((i) => i.type === "diff") || [];
  // Conflicts can no longer be "approved" — they must be fixed in the Excel and
  // re-uploaded. Any mismatch hard-blocks generation.
  const allDiffsApproved = diffIssues.length === 0;
  const canGenerate = !excelImporting && allDiffsApproved;
  const runValidation = async (file) => {
    if (!file || billMonth === null || billYear === null) return;
    setExcelValidating(true);
    setExcelValidation(null);
    setBillGrid(null);
    setApprovedDiffs(new Set());
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("month", String(billMonth + 1));
      formData.append("year", String(billYear));
      const res = await fetch("/api/billing/validate-excel", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      setExcelValidation(data);
      if (data.gridRows && data.gridColumns) {
        setBillGrid({ gridRows: data.gridRows, columns: data.gridColumns });
      }
    } catch (e) {
      notify.error("Validation error: " + e.message);
    } finally {
      setExcelValidating(false);
    }
  };
  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });
  const { data: latestPeriodData, isLoading: latestPeriodLoading } = useQuery({
    queryKey: ["latest-period", segment.billSeries],
    queryFn: () =>
      apiClient.get(`/api/bills/latest-period?billSeries=${segment.billSeries}`),
    staleTime: 30000,
  });
  // FIXED 2026-08-07 — "the generate button says no period".
  //
  // Two causes. (a) The period was only ever set from the latest-period query;
  // if that call failed or was still in flight the page sat with billMonth =
  // null forever and every downstream label rendered blank. (b) Switching
  // Residential <-> Commercial did not reset it, so the commercial tab silently
  // reused the residential period. Both are handled: the segment resets the
  // period, and there is now a hard fallback to the current month.
  useEffect(() => {
    setBillMonth(null);
    setBillYear(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.billSeries]);

  useEffect(() => {
    if (billMonth !== null) return;
    if (latestPeriodLoading) return;
    if (!latestPeriodData) {
      // The lookup failed. Billing must still be possible — default to this month.
      const now = new Date();
      setBillYear(now.getFullYear());
      setBillMonth(now.getMonth());
      return;
    }
    const {
      latestPeriodId,
      currentPeriodId,
      currentGenerated,
      allPaid,
      nextPeriodId,
    } = latestPeriodData;
   let targetPeriod;
if (!latestPeriodId) {
  // No bills ever — generate current month
  targetPeriod = currentPeriodId;
} else if (!allPaid) {
  // Latest period still has UNPAID bills — stay on it so the template flow
  // can COLLECT those payments. Generating the next month is a separate,
  // explicit action via the "Next Month Generation" button below.
  targetPeriod = latestPeriodId;
} else {
  // Everything for the latest period is collected — advance to generate next.
  targetPeriod = nextPeriodId || currentPeriodId;
}
    const [y, m] = targetPeriod.split("-").map(Number);
    setBillYear(y);
    setBillMonth(m - 1); // convert to 0-indexed
  }, [latestPeriodData, latestPeriodLoading, billMonth]);
  const { data: membersData } = useQuery({
    queryKey: segment.membersQueryKey,
    queryFn: () => apiClient.get(segment.membersUrl),
  });
  const { data: billingHeadsData } = useQuery({
    queryKey: segment.headsQueryKey,
    queryFn: () => apiClient.get(segment.headsUrl),
  });
  const { data: templateData } = useQuery({
    queryKey: ["bill-template-full"],
    queryFn: () => apiClient.get("/api/bill-template/get-full"),
  });
  // Commercial rows come back as `shops`, residential as `members`. The segment
  // says which. Falling back to `members` keeps the residential path identical.
  const allMembers =
    membersData?.[segment.membersResponseKey || "members"] || membersData?.members || [];
  // Members this segment actually bills. Residential's filter is the same
  // `!m.isDeleted` predicate the old page applied inline; commercial narrows
  // further to Shop/Office units.
  const segmentMembers = allMembers.filter(segment.memberFilter);
  // Readiness payload from /api/commercial/readiness (commercial segment only).
  const [commercialReadiness, setCommercialReadiness] = useState(null);
  // Units the commercial preview refused to bill, with the reason — previously
  // they vanished from the run with no trace.
  const [previewSkipped, setPreviewSkipped] = useState([]);
  const periodLabel =
    billMonth !== null && billYear
      ? `${billYear}-${String(billMonth + 1).padStart(2, "0")}`
      : null;
  const hasValidPeriodLabel = Boolean(
    periodLabel && /^\d{4}-\d{2}$/.test(periodLabel),
  );
  // Server-computed preview (Commercial). The route runs the real generation
  // engine as a dry run, so the numbers on screen can never diverge from what
  // generation writes. Its PreviewRow shape is reconciled here to the exact
  // row shape renderBillHTML(), the preview modal and generateMutation already
  // consume — residential-only fields the server has no concept of
  // (parkingCharges, serviceTax, advanceCredit) are defaulted, never dropped,
  // so no downstream consumer needs a segment-aware branch.
  const buildServerPreview = async (members) => {
    const config = societyData?.society?.config || {};
    const interestRate = parseFloat(config.interestRate) || 0;
    const interestAfterDays = config.interestAfterDays ?? 15;
    const total = members.length;
    setPreviewProgress({ current: 0, total, label: "calculating" });
    const res = await apiClient.post(segment.previewUrl, {
      memberIds: members.map((m) => m._id || m.memberId || m.id).filter(Boolean),
      billYear,
      billMonth: billMonth + 1,
    });
    const previews = res.previews || {};
    // Surfaced under the Preview button instead of being dropped silently.
    setPreviewSkipped(res.skipped || []);
    // Shop rows carry no `_id` — only `id` (aliased to `memberId` by the
    // shops API) — so this must match the same fallback chain used to build
    // the request above. Keying on `m._id` alone silently emptied every
    // commercial preview: the modal's currentBill was undefined, its render
    // guard failed, and the button just stopped spinning with nothing shown.
    return members
      .map((m) => previews[m._id || m.memberId || m.id])
      .filter(Boolean)
      .map((p) => ({
        memberId: p.memberId,
        member: p.flat, // "Wing-FlatNo" — the key the modal header + sort read
        memberName: p.memberName,
        memberContact: "",
        area: p.area ?? 0,
        advanceCredit: 0, // commercial engine settles advances at generation time
        parkingCharges: 0, // residential-only concept
        // Field names below follow the server's computeBill() output
        // (lib/billing/generationService.js), not the client-side residential
        // shape — the commercial preview route never sends previousBalance/
        // currInt/subtotal/currentBillTotal/grandTotal directly.
        previousBalance: (p.openingPrincipal ?? 0) + (p.openingInterest ?? 0),
        previousBalanceDays: 0, // not tracked by the commercial preview route
        lastBillDate: null,
        unpaidBills: p.unpaidBills || [],
        recentTransactions: p.recentTransactions || [],
        interestRate: p.interestRateApplied ?? interestRate,
        interestAfterDays,
        prevRemPrincipal: p.openingPrincipal ?? 0,
        prevRemInt: p.openingInterest ?? 0,
        currInt: p.currentInterest ?? 0,
        interestAmount: (p.openingInterest ?? 0) + (p.currentInterest ?? 0),
        charges: p.charges || [],
        // Rate-card heads this unit is NOT billed, with the reason. Carried
        // through so the preview can answer "where did signage go?" on screen.
        notCharged: p.notCharged || [],
        subtotal: p.currentCharges ?? 0,
        serviceTax: 0, // commercial heads carry their own tax treatment
        serviceTaxRate: 0,
        currentBillTotal: p.totalBillDue ?? 0,
        grandTotal: p.totalBillDue ?? 0,
        unitClass: p.unitClass,
      }));
  };
  const generatePreview = async () => {
    if (billMonth === null || billYear === null) return;
    const members = allMembers.filter(segment.memberFilter);
    setIsPreviewing(true);
    setPreviewProgress({ current: 0, total: members.length });
    await new Promise((r) => setTimeout(r, 50));
    setPreviewProgress({ current: 0, total: 0, label: "fetching" });
    await new Promise((r) => setTimeout(r, 50));
    try {
      // Both branches produce the same row shape and converge on the shared
      // sort + setPreviewData + setShowPreview tail below.
      let previewRows;
      if (segment.previewMode === "server") {
        previewRows = await buildServerPreview(members);
      } else {
      const society = societyData?.society || {};
      const config = society.config || {};
      const heads = billingHeadsData?.heads || [];
      // Build parking rates from billing heads (source of truth), not society config
      const parkingRates = buildParkingRates(heads);
      const interestRate = parseFloat(config.interestRate) || 0;
      const interestAfterDays = config.interestAfterDays ?? 15;
      const serviceTaxRate = parseFloat(config.serviceTaxRate) || 0;
      const _billingMonthStr = `${billYear}-${String(billMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`;
      const previousBalancesResponse = await apiClient.post(
        "/api/bills/get-previous-balances",
        {
          memberIds: members.map((m) => m._id || m.memberId || m.id).filter(Boolean),
          billMonth: billMonth + 1,
          billYear,
          billDate: _billingMonthStr,
          billSeries: segment.billSeries,
        },
      );
      const previousBalances = previousBalancesResponse.balances || {};
      const total = members.length;
      setPreviewProgress({ current: 0, total, label: "calculating" });
      await new Promise((r) => setTimeout(r, 0));
      const preview = [];
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        setPreviewProgress({ current: i + 1, total });
        const area = Number(
          member.carpetAreaSqft ??
            member.builtUpAreaSqft ??
            member.areaSqFt ??
            0,
        );
        const flatNo = member.roomNo || member.flatNo || "";
        const memberId = member._id;
        const prevData = previousBalances[memberId] || {
          balance: 0,
          daysOverdue: 0,
          lastBillDate: null,
        };
        const principalBase = prevData.principalBalance ?? 0;
        const remInt = prevData.remInt ?? 0;
        const currInt = computeMonthlyInterest(principalBase, interestRate);
        const interestAmount = parseFloat((remInt + currInt).toFixed(2));
        const {
          charges: activeCharges,
          subtotal,
          serviceTax,
          currentBillTotal,
        } = computeCurrentCharges(member, heads, parkingRates, serviceTaxRate);
        const memberParkingCharges = (member.parkingSlots || [])
          .filter((s) => s.type !== "Stilt" && s.monthlyBilling !== false)
          .reduce(
            (sum, slot) =>
              sum + (parkingRates[`${slot.type}-${slot.vehicleType}`] ?? 0),
            0,
          );
        const advanceCredit = prevData.advanceCredit || 0;
        const { grandTotal: grandTotalRounded } = computeBillTotal({
          principalOutstanding: principalBase,
          interestOutstanding: remInt,
          currInt,
          currentBillTotal,
          advanceCredit,
        });
        preview.push({
          memberId,
          member: `${member.wing || ""}-${flatNo}`,
          memberName: member.ownerName || "Unknown",
          memberContact: member.contact || "",
          area,
          advanceCredit,
          parkingCharges: memberParkingCharges,
          previousBalance: prevData.balance || 0,
          previousBalanceDays: 0,
          lastBillDate: null,
          unpaidBills: prevData.unpaidBills || [],
          recentTransactions: prevData.recentTransactions || [],
          interestRate,
          interestAfterDays,
          prevRemPrincipal: principalBase,
          prevRemInt: remInt,
          currInt,
          interestAmount: Math.round(interestAmount * 100) / 100,
          charges: activeCharges,
          subtotal,
          serviceTax,
          serviceTaxRate,
          currentBillTotal,
          grandTotal: grandTotalRounded,
        });
        await new Promise((r) => setTimeout(r, 0));
      }
        previewRows = preview;
      }
      const sortedPreview = [...previewRows].sort((a, b) => {
        const [wA, rA] = (a.member ?? "").split("-");
        const [wB, rB] = (b.member ?? "").split("-");
        const wingDiff = (wA ?? "").localeCompare(wB ?? "");
        if (wingDiff !== 0) return wingDiff;
        return Number(rA ?? 0) - Number(rB ?? 0);
      });
      setPreviewProgress({ current: 0, total: 0 });
      setPreviewData(sortedPreview);
      setPreviewIndex(0);
      setShowPreview(true);
    } catch (err) {
      notify.error("Failed to build previews: " + err.message);
    } finally {
      setIsPreviewing(false);
      setPreviewProgress({ current: 0, total: 0 });
    }
  };
  const autoGenerateNextMonth = async () => {
    const nextDate = new Date(billYear, billMonth + 1, 1);
    const nextMonth = nextDate.getMonth(); // 0-indexed
    const nextYear = nextDate.getFullYear();
    const nextPeriodLabel = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
    const currentPeriodLabel = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;
    const interestAfterDays = societyData?.society?.config?.interestAfterDays || 15;
    const dueDateObj = new Date(nextYear, nextMonth, 1 + interestAfterDays);
    const nextDueDate = `${dueDateObj.getFullYear()}-${String(dueDateObj.getMonth() + 1).padStart(2, "0")}-${String(dueDateObj.getDate()).padStart(2, "0")}`;
    setAutoGenState({
      status: "running",
      label: nextPeriodLabel,
      count: 0,
      error: null,
    });
    try {
      // Fetch fresh member data — user may have changed carpetArea/parking after page load
      const freshMembersRes = await apiClient.get(segment.membersUrl);
      queryClient.setQueryData(segment.membersQueryKey, freshMembersRes);
      const allMembers = (
        freshMembersRes?.[segment.membersResponseKey || "members"] ||
        freshMembersRes?.members ||
        []
      ).filter(segment.memberFilter);
      const successfulPaymentMemberIds = new Set(
        (payResults?.results || [])
          .filter((r) => r.status === "Success")
          .map((r) => String(r.memberId)),
      );
      const members = nextGenScope === "paid"
        ? allMembers.filter((m) => successfulPaymentMemberIds.has(String(m._id)))
        : allMembers;
      if (!members.length) {
        throw new Error(
          nextGenScope === "paid"
            ? `No successfully paid ${segment.unitNounPlural || "members"} are available. Select All only if you intentionally want a society-wide run.`
            : segment.emptyMessage || `No active ${segment.unitNounPlural || "members"} found`,
        );
      }
      if (nextGenScope === "all") {
        const ok = await notify.confirm(
          `You selected ALL ${members.length} ${segment.unitNounPlural || "members"}. This will generate ${nextPeriodLabel} for every one of them. Continue?`,
          { tone: "warning" },
        );
        if (!ok) { setAutoGenState(null); return; }
      }
      const checkRes = await apiClient.post(
        "/api/bills/get-previous-balances",
        {
          memberIds: members.map((m) => m._id || m.memberId || m.id).filter(Boolean),
          billMonth: billMonth + 1,
          billYear,
          billDate: `${billYear}-${String(billMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`,
          billSeries: segment.billSeries,
        },
      );
      const balances = checkRes.balances || {};
      const unpaidMembers = Object.values(balances).filter(
        (b) =>
          (b.unpaidBills || []).reduce(
            (s, u) => s + (u.balanceAmount || 0),
            0,
          ) > 0.005,
      );
      const unpaidCount = unpaidMembers.length;
      if (unpaidCount > 0) {
        const memberLines = unpaidMembers
          .map((b) => {
            const bill = b.unpaidBills[0];
            return `  • Member has Rs ${b.unpaidBills.reduce((s, u) => s + (u.balanceAmount || 0), 0).toFixed(2)} pending since ${b.unpaidBills.map((u) => u.billPeriodId).join(", ")}`;
          })
          .join("\n");
        const proceed = await notify.confirm(
          `${unpaidCount} member(s) have not fully paid their previous bills:\n\n${memberLines}\n\n` +
            `Their unpaid amount will be carried forward into ${nextPeriodLabel} bills and interest will be added.\n\n` +
            `OK = Generate ${nextPeriodLabel} bills now\nCancel = Go back and collect pending payments first`,
          { tone: "warning" },
        );
        if (!proceed) {
          setAutoGenState(null);
          return;
        }
      }
      const [freshSocietyRes, freshHeadsRes] = await Promise.all([
        apiClient.get("/api/society/config"),
        apiClient.get(segment.headsUrl),
      ]);
      queryClient.setQueryData(["society-config"], freshSocietyRes);
      queryClient.setQueryData(segment.headsQueryKey, freshHeadsRes);
      const society = freshSocietyRes?.society || societyData?.society || {};
      const config = society.config || {};
      const heads = freshHeadsRes?.heads || billingHeadsData?.heads || [];
      const interestRate = parseFloat(config.interestRate) || 0;
      const serviceTaxRate = parseFloat(config.serviceTaxRate) || 0;
      const parkingRates = buildParkingRates(heads);
      const billingMonthStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`;
      const prevBalRes = await apiClient.post(
        "/api/bills/get-previous-balances",
        {
          memberIds: members.map((m) => m._id || m.memberId || m.id).filter(Boolean),
          billMonth: nextMonth + 1,
          billYear: nextYear,
          billDate: billingMonthStr,
          billSeries: segment.billSeries,
        },
      );
      const previousBalances = prevBalRes.balances || {};
      const bills = members.map((member) => {
        const memberId = member._id;
        const prevData = previousBalances[memberId] || {
          balance: 0,
          principalBalance: 0,
          remInt: 0,
          unpaidBills: [],
          recentTransactions: [],
        };
        const principalBase = prevData.principalBalance ?? 0;
        const remInt = prevData.remInt ?? 0;
        const currInt = computeMonthlyInterest(principalBase, interestRate);
        const interestAmount = parseFloat((remInt + currInt).toFixed(2));
        const { charges, subtotal, serviceTax, currentBillTotal } =
          computeCurrentCharges(member, heads, parkingRates, serviceTaxRate);
        const advanceCredit = prevData.advanceCredit || 0;
        const { grandTotal } = computeBillTotal({
          principalOutstanding: principalBase,
          interestOutstanding: remInt,
          currInt,
          currentBillTotal,
          advanceCredit,
        });
        return {
          memberId,
          totalAmount: grandTotal,
          previousBalance: prevData.balance || 0,
          advanceCredit,
          interestAmount,
          subtotal,
          serviceTax,
          currentBillTotal,
          breakdown: Object.fromEntries(charges.map((c) => [c.name, c.amount])),
          unpaidBills: prevData.unpaidBills || [],
          recentTransactions: prevData.recentTransactions || [],
        };
      });
      const payload = {
        billMonth: nextMonth,
        billYear: nextYear,
        billSeries: segment.billSeries,
        dueDate: nextDueDate,
        bills,
        publishMode: nextPushMode === "now" ? "now" : "schedule",
        scheduledPushDate:
          nextPushMode === "schedule"
            ? new Date(`${nextPushDate}T09:00:00+05:30`).toISOString()
            : null,
      };
      if (nextPushMode === "schedule" && !nextPushDate) {
        throw new Error("Choose the date on which members should receive the generated bill");
      }
      const result = await postNdjson("/api/bills/generate-final", payload, (p) =>
        setAutoGenState((s) => (s ? { ...s, progress: { current: p.done, total: p.total } } : s)),
      );
      const count = result.billsGenerated ?? result.count ?? 0;
      // Advance UI to next month
      setBillMonth(nextMonth);
      setBillYear(nextYear);
      setPayResults(null);
      setExcelFile(null);
      setExcelValidation(null);
      setBillGrid(null);
      setPayGrid(null);
      setBillsGeneratedForPeriod(nextPeriodLabel);
      queryClient.invalidateQueries(["bills-list"]);
      queryClient.invalidateQueries(["latest-period"]);
      setAutoGenState({
        status: "done",
        label: nextPeriodLabel,
        count,
        error: null,
      });
      onSegmentComplete?.();
    } catch (err) {
      setAutoGenState({
        status: "error",
        label: null,
        count: 0,
        error: err.message,
      });
    }
  };
  const generateMutation = useMutation({
    mutationFn: async () => {
      const billsToSend = previewData || [];
      const total = billsToSend.length;
      setGenProgress({ current: 0, total });
      if (total === 0) {
        throw new Error("No preview data available");
      }
      const _dueDay = societyData?.society?.config?.interestAfterDays || 15;
      const computedDueDate = `${billYear}-${String(billMonth + 1).padStart(2, "0")}-${String(_dueDay).padStart(2, "0")}`;
      const payload = {
        billMonth,
        billYear,
        billSeries: segment.billSeries,
        dueDate: computedDueDate,
        bills: billsToSend.map((b) => ({
          memberId: b.memberId,
          totalAmount: b.grandTotal,
          previousBalance: b.previousBalance || 0,
          advanceCredit: b.advanceCredit || 0,
          interestAmount: b.interestAmount || 0,
          subtotal: b.subtotal || 0,
          serviceTax: b.serviceTax || 0,
          currentBillTotal: b.currentBillTotal || 0,
          breakdown: Object.fromEntries(
            b.charges.map((c) => [c.name, c.amount]),
          ),
          unpaidBills: b.unpaidBills,
          recentTransactions: b.recentTransactions,
        })),
      };
      const onProgress = (p) => setGenProgress({ current: p.done, total: p.total });
      let result;
      try {
        result = await postNdjson("/api/bills/generate-final", payload, onProgress);
      } catch (err) {
        if (err.message?.includes("already exist")) {
          const confirmed = await notify.confirm(
            `Bills for ${periodLabel} already exist.\n\nDo you want to DELETE the existing bills and regenerate?\n\nThis cannot be undone. Payments already recorded against these bills will NOT be deleted.`,
            { tone: "danger" },
          );
          if (!confirmed) throw new Error("Generation cancelled");
          result = await postNdjson("/api/bills/generate-final", {
            ...payload,
            forceRegenerate: true,
          }, onProgress);
        } else {
          throw err;
        }
      }
      setGenProgress({ current: total, total });
      return {
        count: result.billsGenerated ?? result.count ?? 0,
        failed: result.failed ?? 0,
        errors: result.errors ?? [],
      };
    },
    onSuccess: (data) => {
      setGenProgress({ current: 0, total: 0 });
      if (data.count === 0 && data.failed > 0) {
        // Every member in the batch failed — this is not a success, and
        // saying "Generated 0 bills successfully!" (the old message) read as
        // one regardless. Show the actual reason instead.
        notify.error(
          `No bills were generated.\n\n${data.errors.map((e) => `• ${e.error}`).join("\n")}`,
        );
      } else if (data.failed > 0) {
        notify.error(
          `Generated ${data.count} bill(s), but ${data.failed} failed:\n\n${data.errors.map((e) => `• ${e.error}`).join("\n")}`,
        );
      } else {
        notify.success(`Generated ${data.count} bill(s) successfully!`);
      }
      setShowPreview(false);
      setBillsGeneratedForPeriod(periodLabel);
      queryClient.invalidateQueries(["bills-list"]);
      queryClient.invalidateQueries(["latest-period"]);
      onSegmentComplete?.();
    },
    onError: (error) => {
      notify.error("Failed to generate bills: " + error.message);
    },
  });
  const renderBillHTML = (billData) => {
    const template = templateData?.template;
    if (template?.type === "uploaded-pdf" && template?.pdfUrl) {
      const hasFormFields = template.hasFormFields || false;
      const fieldCount = template.detectedFields?.length || 0;
      return `
    <div style="text-align: center;">
      <div style="background: var(--bg-sunken); padding: 2rem; border-radius: 8px; margin-bottom: 1rem;">
        <p style="margin: 0 0 1rem 0; font-size: 1.1rem; color: var(--fg-3);">
          <strong>Bill will be generated using your uploaded PDF template</strong>
        </p>
        <p style="margin: 0; font-size: 0.95rem; color: var(--fg-4);">
          ${
            hasFormFields
              ? `Auto-detected ${fieldCount} fillable fields`
              : "Data will be overlaid on PDF"
          }
        </p>
      </div>
      <div style="background: white; padding: 2rem; border-radius: 8px; border: 2px solid var(--border); text-align: left;">
        <h3 style="margin: 0 0 1.5rem 0; color: var(--fg-2); border-bottom: 2px solid var(--primary); padding-bottom: 0.75rem;">
          Data to be filled in PDF:
        </h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">
          <div>
            <div style="font-size: 0.875rem; color: var(--fg-4); margin-bottom: 0.25rem;">Member Name</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: var(--fg-2);">${billData.memberName}</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: var(--fg-4); margin-bottom: 0.25rem;">Flat No</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: var(--fg-2);">${billData.member}</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: var(--fg-4); margin-bottom: 0.25rem;">Area</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: var(--fg-2);">${billData.area} sq ft</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: var(--fg-4); margin-bottom: 0.25rem;">Bill Period</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: var(--fg-2);">${billYear}-${String(billMonth + 1).padStart(2, "0")}</div>
          </div>
        </div>
        <h4 style="margin: 0 0 1rem 0; color: var(--fg-3); font-size: 1rem;">Current Month Charges:</h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <thead>
            <tr style="background: var(--bg-muted);">
              <th style="padding: 0.75rem; text-align: left; border: 1px solid var(--border); font-size: 0.875rem;">Sr.</th>
              <th style="padding: 0.75rem; text-align: left; border: 1px solid var(--border); font-size: 0.875rem;">Particulars</th>
              <th style="padding: 0.75rem; text-align: right; border: 1px solid var(--border); font-size: 0.875rem;">Amount (Rs)</th>
            </tr>
          </thead>
          <tbody>
            ${billData.charges
              .map(
                (charge, idx) => `
              <tr style="background: ${idx % 2 === 0 ? "var(--bg-surface)" : "var(--bg-sunken)"};">
                <td style="padding: 0.75rem; border: 1px solid var(--border);">${idx + 1}</td>
                <td style="padding: 0.75rem; border: 1px solid var(--border);">${charge.name}</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid var(--border); font-weight: 600;">
                  ${charge.amount.toFixed(2)}
                </td>
              </tr>
            `,
              )
              .join("")}
            <tr style="background: var(--primary-tint); font-weight: 700;">
              <td colspan="2" style="padding: 1rem; text-align: right; border: 1px solid var(--border); color: var(--primary-hover);">
                Current Month Total
              </td>
              <td style="padding: 1rem; text-align: right; border: 1px solid var(--border); color: var(--primary-hover); font-size: 1.2rem;">
                Rs ${billData.currentBillTotal.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
        ${
          (billData.notCharged || []).length
            ? `
        <div style="border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1.5rem; overflow: hidden;">
          <div style="padding: 0.6rem 0.75rem; background: var(--bg-sunken); font-size: 0.8rem; font-weight: 700; color: var(--fg-3);">
            On the rate card but not charged to this unit
          </div>
          ${billData.notCharged
            .map(
              (n) => `
            <div style="padding: 0.6rem 0.75rem; border-top: 1px solid var(--border); font-size: 0.8rem; color: var(--fg-3); line-height: 1.5;">
              <b style="color: var(--fg-3);">${n.name}</b> &mdash; ${n.reason}
            </div>
          `,
            )
            .join("")}
        </div>
        `
            : ""
        }
        ${
          Math.abs(billData.previousBalance) > 0
            ? `
          <div style="background: ${billData.previousBalance > 0 ? "var(--danger-bg)" : "var(--success-bg)"}; border-left: 4px solid ${billData.previousBalance > 0 ? "var(--danger)" : "var(--success)"}; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: ${billData.previousBalance > 0 ? "var(--danger-fg)" : "var(--success-fg)"};">
              ${billData.previousBalance > 0 ? "Previous Outstanding Balance" : "Opening Balance Credit"}
            </h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
              <div>
                <div style="font-size: 0.875rem; color: ${billData.previousBalance > 0 ? "var(--danger-fg)" : "var(--success-fg)"}; margin-bottom: 0.5rem;">
                  ${billData.previousBalance > 0 ? "Amount Owed" : "Credit Adjustment"}
                </div>
                <div style="font-size: 1.75rem; font-weight: 700; color: ${billData.previousBalance > 0 ? "var(--danger)" : "var(--success)"};">
                  Rs ${Math.abs(billData.previousBalance).toLocaleString("en-IN")}
                </div>
                ${
                  billData.prevRemPrincipal > 0 || billData.prevRemInt > 0
                    ? `
                <div style="font-size: 0.78rem; margin-top: 0.35rem; opacity: 0.85; line-height: 1.6;">
                  Principal: Rs ${(billData.prevRemPrincipal || 0).toFixed(2)}<br/>
                  Prev. Interest: Rs ${(billData.prevRemInt || 0).toFixed(2)}
                </div>`
                    : ""
                }
              </div>
              <div>
                <div style="font-size: 0.875rem; color: ${billData.previousBalance > 0 ? "var(--danger-fg)" : "var(--success-fg)"}; margin-bottom: 0.5rem;">
                  Days ${billData.previousBalance > 0 ? "Overdue" : "in Credit"}
                </div>
                <div style="font-size: 1.75rem; font-weight: 700; color: ${billData.previousBalance > 0 ? "var(--danger)" : "var(--success)"};">
                  ${billData.previousBalanceDays} days
                </div>
              </div>
            </div>
            ${
              billData.interestAmount > 0
                ? `
              <div style="background: var(--danger-fg); color: white; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                  <div style="font-size: 0.95rem; font-weight: 600;">Interest Charged</div>
                  <div style="font-size: 1.5rem; font-weight: 700;">Rs ${billData.interestAmount.toLocaleString("en-IN")}</div>
                </div>
                ${
                  billData.prevRemInt > 0 || billData.currInt > 0
                    ? `
                <div style="background: rgba(255,255,255,0.15); border-radius: 6px; padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; font-size: 0.82rem; line-height: 1.8;">
                  ${billData.prevRemInt > 0 ? "<div>Carried unpaid interest: Rs " + billData.prevRemInt.toFixed(2) + "</div>" : ""}
                  ${billData.currInt > 0 ? "<div>New this month (Rs " + billData.prevRemPrincipal?.toFixed(2) + " x " + billData.interestRate + "% / 12): Rs " + billData.currInt.toFixed(2) + "</div>" : ""}
                  ${billData.prevRemInt > 0 && billData.currInt > 0 ? '<div style="border-top: 1px solid rgba(255,255,255,0.3); margin-top: 0.4rem; padding-top: 0.4rem;">Total: Rs ' + billData.prevRemInt.toFixed(2) + " + Rs " + billData.currInt.toFixed(2) + " = Rs " + billData.interestAmount.toFixed(2) + "</div>" : ""}
                </div>
                `
                    : ""
                }
                <div style="font-size: 0.8rem; opacity: 0.9; line-height: 1.5;">
                  Rate: ${billData.interestRate}% p.a. | Formula: principal × rate / 12
                  ${billData.currInt > 0 ? "<br/>Formula: Rs " + billData.prevRemPrincipal?.toFixed(2) + " x " + billData.interestRate + "% / 12 = Rs " + billData.currInt.toFixed(2) + " (new this month)" : ""}
                </div>
              </div>
            `
                : ""
            }
          </div>
        `
            : ""
        }
        ${
          billData.advanceCredit > 0
            ? `
        <div style="background:var(--success-bg);border:2px solid var(--success);border-radius:8px;padding:1rem 1.5rem;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;color:var(--success-fg);font-size:0.95rem;">Advance Credit Applied</div>
            <div style="font-size:0.8rem;color:var(--success-fg);margin-top:2px;">Overpayment from previous month adjusted</div>
          </div>
          <div style="font-size:1.5rem;font-weight:700;color:var(--success);">- Rs ${billData.advanceCredit.toFixed(2)}</div>
        </div>`
            : ""
        }
        <div style="background: var(--primary-tint); padding: 1.5rem; border-radius: 8px; border: 3px solid var(--primary-hover); margin-bottom: 1rem;">
         <div style="display: flex; justify-content: space-between; align-items: center;">
  <div style="font-size: 1.2rem; font-weight: 700; color: ${billData.grandTotal <= 0 ? "var(--success)" : "var(--primary-hover)"};">
    ${billData.grandTotal <= 0 ? "ADVANCE CREDIT BALANCE" : "TOTAL AMOUNT PAYABLE"}
  </div>
  <div style="font-size: 1.8rem; font-weight: 700; color: ${billData.grandTotal <= 0 ? "var(--success)" : "var(--primary-hover)"};">
    Rs ${Math.abs(billData.grandTotal).toFixed(2)}
  </div>
</div>
${
  billData.grandTotal <= 0
    ? `
  <div style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: var(--success-bg); border-radius: 6px; font-size: 0.8rem; color: var(--success-fg);">
    No payment due. Rs ${Math.abs(billData.grandTotal).toFixed(2)} credit will be adjusted in next bill.
  </div>
`
    : ""
}
          <div style="margin-top: 1rem; padding-top: 1rem; border-top: 2px solid var(--primary-hover); font-size: 0.85rem; color: var(--primary-hover); line-height: 1.8;">
            ${billData.previousBalance > 0 ? "Previous Balance: Rs " + billData.previousBalance.toFixed(2) + "<br/>" : ""}
            ${(billData.prevRemPrincipal || 0) > 0 ? "Principal carried: Rs " + billData.prevRemPrincipal.toFixed(2) + "<br/>" : ""}
            ${(billData.currInt || 0) > 0 ? "Interest (Rs " + billData.prevRemPrincipal.toFixed(2) + " × " + billData.interestRate + "% ÷ 12): Rs " + billData.currInt.toFixed(2) + "<br/>" : "No interest (no outstanding principal)<br/>"}
            Current charges: Rs ${billData.currentBillTotal.toFixed(2)}
            ${billData.advanceCredit > 0 ? "<br/>Advance credit: - Rs " + billData.advanceCredit.toFixed(2) : ""}
            <br/><strong>Total: Rs ${Math.abs(billData.grandTotal).toFixed(2)}</strong>
          </div>
        </div>
        <div style="background: var(--bg-sunken); padding: 1rem; border-radius: 8px; border: 1px solid var(--border);">
          <p style="margin: 0; font-size: 0.875rem; color: var(--fg-4); text-align: center;">
            Click "Generate All Bills" to create PDF bills using your template
          </p>
        </div>
      </div>
      <div style="margin-top: 2rem; border: 2px solid var(--border); border-radius: 8px; overflow: hidden;">
        <div style="background: var(--fg-2); color: white; padding: 1rem; font-weight: 600;">
          Your PDF Template (data will be filled here)
        </div>
        <iframe
          src="${template.pdfUrl}"
          style="width: 100%; height: 800px; border: none; background: white;"
        />
      </div>
    </div>
  `;
    }
    if (template?.type === "uploaded-image" && template?.imageUrl) {
      return `
      <div style="text-align: center;">
        <div style="background: var(--bg-sunken); padding: 2rem; border-radius: 8px; margin-bottom: 1rem;">
          <p style="margin: 0 0 1rem 0; font-size: 1.1rem; color: var(--fg-3);">
            <strong>Bill will be generated using your uploaded image template</strong>
          </p>
          <p style="margin: 0; font-size: 0.95rem; color: var(--fg-4);">
            Data will be overlaid on the image
          </p>
        </div>
        <div style="margin-top: 2rem; border: 2px solid var(--border); border-radius: 8px; overflow: hidden;">
          <div style="background: var(--fg-2); color: white; padding: 1rem; font-weight: 600;">
            Your Image Template (data will be overlaid)
          </div>
          <img src="${template.imageUrl}" style="width: 100%; height: auto;" />
        </div>
      </div>
    `;
    }
    const society = societyData?.society || {};
    const design = template?.design || {
      /* TODO: unmapped color, needs design review */
      headerBg: "linear-gradient(135deg, var(--accent) 0%, var(--fg-4) 100%)",
      headerColor: "var(--bg-surface)",
      societyNameSize: 28,
      addressSize: 14,
      billTitleSize: 22,
      billTitleAlign: "center",
      tableHeaderBg: "var(--primary)",
      tableHeaderColor: "var(--bg-surface)",
      tableRowBg1: "var(--bg-surface)",
      tableRowBg2: "var(--bg-sunken)",
      tableBorderColor: "var(--border)",
      totalBg: "var(--primary-tint)",
      totalColor: "var(--primary-hover)",
      totalSize: 20,
      footerSize: 10,
      footerText: [
        "Payment should be made on or before due date",
        "Interest will be charged on overdue payments",
        "This is a computer-generated bill",
      ],
      showSignature: true,
      signatureLabel: "Authorized Signatory",
    };
    const logoUrl = template?.logoUrl || "";
    const signatureUrl = template?.signatureUrl || "";
    return `
    <div style="max-width: 800px; margin: 0 auto; padding: 40px; font-family: Arial, sans-serif; background: white; border: 1px solid var(--border); border-radius: 8px;">
      <div style="background: ${design.headerBg}; color: ${design.headerColor}; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
        ${logoUrl ? `<img src="${logoUrl}" style="width: 80px; margin-bottom: 15px;" />` : ""}
        <h1 style="margin: 0; font-size: ${design.societyNameSize}px;">${society.name || "Society Name"}</h1>
        <p style="margin: 5px 0 0 0; font-size: ${design.addressSize}px; opacity: 0.9;">${society.address || ""}</p>
      </div>
      <h2 style="text-align: ${design.billTitleAlign}; font-size: ${design.billTitleSize}px; margin: 0 0 20px 0; color: var(--fg-2);">
        MAINTENANCE BILL
      </h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; padding: 20px; background: var(--bg-sunken); border-radius: 8px; border: 1px solid var(--border);">
        <div><strong>Bill Period:</strong> ${billYear}-${String(billMonth + 1).padStart(2, "0")}</div>
        <div><strong>Bill Date:</strong> ${new Date().toLocaleDateString("en-IN")}</div>
        <div><strong>Member:</strong> ${billData.member}</div>
        <div><strong>Due Date:</strong> ${new Date(billYear, billMonth + 1, 10).toLocaleDateString("en-IN")}</div>
        <div><strong>Name:</strong> ${billData.memberName}</div>
        <div><strong>Area:</strong> ${billData.area} sq ft</div>
      </div>
${
  Math.abs(billData.previousBalance) > 0
    ? `
        <div style="background: var(--danger-bg); border-left: 4px solid var(--danger); padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 1rem 0; color: var(--danger-fg);">Previous Outstanding Balance</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid var(--danger-bg);">
            <div>
              <div style="font-size: 0.875rem; color: var(--danger-fg); margin-bottom: 0.5rem;">Total Outstanding</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: var(--danger);">Rs ${billData.previousBalance.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div style="font-size: 0.875rem; color: var(--danger-fg); margin-bottom: 0.5rem;">${billData.previousBalance < 0 ? "Days in Credit" : "Days Overdue"}</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: var(--danger);">${billData.previousBalanceDays || 0} days</div>
            </div>
          </div>
          ${
            billData.unpaidBills && billData.unpaidBills.length > 0
              ? `
            <div style="margin-bottom: 1.5rem;">
              <h5 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: var(--danger-fg); font-weight: 600;">Unpaid Bills:</h5>
              <table style="width: 100%; font-size: 0.875rem; border-collapse: collapse;">
                <thead>
                  <tr style="background: var(--danger-bg);">
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid var(--danger); color: var(--danger-fg);">Period</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid var(--danger); color: var(--danger-fg);">Amount</th>
                    <th style="padding: 0.5rem; text-align: center; border: 1px solid var(--danger); color: var(--danger-fg);">Due Date</th>
                    <th style="padding: 0.5rem; text-align: center; border: 1px solid var(--danger); color: var(--danger-fg);">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${billData.unpaidBills
                    .map(
                      (bill) => `
                    <tr style="background: white;">
                      <td style="padding: 0.5rem; border: 1px solid var(--danger-bg); font-weight: 600;">${bill.billPeriodId}</td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid var(--danger-bg); font-weight: 600; color: var(--danger);">Rs ${(bill.balanceAmount ?? bill.amount ?? 0).toFixed(2)}</td>
                      <td style="padding: 0.5rem; text-align: center; border: 1px solid var(--danger-bg); font-size: 0.8rem;">${new Date(bill.dueDate).toLocaleDateString("en-IN")}</td>
                      <td style="padding: 0.5rem; text-align: center; border: 1px solid var(--danger-bg);">
                        <span style="background: var(--danger); color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${bill.status}</span>
                      </td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
              : ""
          }
          ${
            billData.recentTransactions &&
            billData.recentTransactions.length > 0
              ? `
            <div style="margin-bottom: 1.5rem;">
              <h5 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: var(--danger-fg); font-weight: 600;">Recent Transactions:</h5>
              <table style="width: 100%; font-size: 0.8rem; border-collapse: collapse;">
                <thead>
                  <tr style="background: var(--danger-bg);">
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid var(--danger); color: var(--danger-fg);">Date</th>
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid var(--danger); color: var(--danger-fg);">Description</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid var(--danger); color: var(--danger-fg);">Debit</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid var(--danger); color: var(--danger-fg);">Credit</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid var(--danger); color: var(--danger-fg);">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  ${billData.recentTransactions
                    .slice(0, 5)
                    .map(
                      (txn) => `
                    <tr style="background: white;">
                      <td style="padding: 0.5rem; border: 1px solid var(--danger-bg); font-size: 0.75rem;">${new Date(txn.date).toLocaleDateString("en-IN")}</td>
                      <td style="padding: 0.5rem; border: 1px solid var(--danger-bg);">
                        ${txn.description || txn.category}
                        ${txn.billPeriod ? '<br/><span style="font-size: 0.7rem; color: var(--danger-fg);">(' + txn.billPeriod + ")</span>" : ""}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid var(--danger-bg); color: ${txn.type === "Debit" ? "var(--danger)" : "var(--fg-5)"}; font-weight: ${txn.type === "Debit" ? "600" : "400"};">
                        ${txn.type === "Debit" ? "Rs " + txn.amount.toFixed(2) : "-"}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid var(--danger-bg); color: ${txn.type === "Credit" ? "var(--success)" : "var(--fg-5)"}; font-weight: ${txn.type === "Credit" ? "600" : "400"};">
                        ${txn.type === "Credit" ? "Rs " + txn.amount.toFixed(2) : "-"}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid var(--danger-bg); font-weight: 600; color: ${txn.balance >= 0 ? "var(--success)" : "var(--danger)"};">
                        Rs ${txn.balance.toFixed(2)}
                      </td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
              : ""
          }
          ${
            billData.interestAmount > 0
              ? `
            <div style="background: var(--danger-fg); color: white; padding: 1rem; border-radius: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <div style="font-size: 0.95rem; font-weight: 600;">Interest Charged</div>
                <div style="font-size: 1.5rem; font-weight: 700;">Rs ${billData.interestAmount.toLocaleString("en-IN")}</div>
              </div>
              <div style="font-size: 0.8rem; opacity: 0.9; line-height: 1.5;">
                Rate: ${billData.interestRate}% p.a.<br/>
                ${billData.prevRemInt > 0 ? "Carried interest: Rs " + billData.prevRemInt.toFixed(2) + (billData.currInt > 0 ? " | " : "") : ""}${billData.currInt > 0 ? "New this month: Rs " + billData.prevRemPrincipal?.toFixed(2) + " x " + billData.interestRate + "% / 12 = Rs " + billData.currInt.toFixed(2) : ""}
              </div>
            </div>
          `
              : ""
          }
        </div>
      `
    : ""
}
      <h3 style="margin: 0 0 15px 0; font-size: 16px; color: var(--fg-3); font-weight: 600;">Current Month Charges</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: ${design.tableHeaderBg}; color: ${design.tableHeaderColor};">
            <th style="padding: 12px; text-align: left; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Sr.</th>
            <th style="padding: 12px; text-align: left; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Particulars</th>
            <th style="padding: 12px; text-align: center; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Calculation</th>
            <th style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Amount (Rs)</th>
          </tr>
        </thead>
        <tbody>
          ${billData.charges
            .map(
              (charge, idx) => `
            <tr style="background: ${idx % 2 === 0 ? design.tableRowBg1 : design.tableRowBg2};">
              <td style="padding: 10px; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">${idx + 1}</td>
              <td style="padding: 10px; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">
                <strong>${charge.name}</strong>
              </td>
              <td style="padding: 10px; text-align: center; border: 1px solid ${design.tableBorderColor}; font-size: 12px; color: var(--fg-4);">
                ${charge.calculation || (charge.fixed ? "Fixed" : "-")}
              </td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 13px;">
                ${charge.amount.toFixed(2)}
              </td>
            </tr>
          `,
            )
            .join("")}
          <tr style="background: var(--bg-sunken);">
            <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 14px;">Subtotal</td>
            <td style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 700; font-size: 14px;">
              ${billData.subtotal.toFixed(2)}
            </td>
          </tr>
          ${
            billData.serviceTax > 0
              ? `
            <tr style="background: var(--bg-sunken);">
              <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Service Tax (${billData.serviceTaxRate}%)</td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 13px;">
                ${billData.serviceTax.toFixed(2)}
              </td>
            </tr>
          `
              : ""
          }
          <tr style="background: ${design.totalBg}; font-weight: 700;">
            <td colspan="3" style="padding: 14px; text-align: right; border: 1px solid ${design.tableBorderColor}; color: ${design.totalColor}; font-size: 15px;">
              CURRENT BILL TOTAL
            </td>
            <td style="padding: 14px; text-align: right; border: 1px solid ${design.tableBorderColor}; color: ${design.totalColor}; font-size: 16px;">
              Rs ${billData.currentBillTotal.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
      <div style="background: ${design.totalBg}; padding: 25px; border-radius: 8px; margin-bottom: 30px; border: 3px solid ${design.totalColor};">
        <div style="margin-bottom: 15px;">
          <div style="font-size: 12px; color: var(--fg-4); margin-bottom: 8px;">Calculation:</div>
          <div style="font-size: 13px; color: var(--fg-3); line-height: 1.6;">
${
  Math.abs(billData.previousBalance) > 0
    ? `
              <div>Previous Balance: <strong>Rs ${billData.previousBalance.toFixed(2)}</strong></div>
            `
    : ""
}
            ${
              billData.interestAmount > 0
                ? `
              <div>Interest: <strong>+Rs ${billData.interestAmount.toFixed(2)}</strong></div>
            `
                : ""
            }
            <div>Current Bill: <strong>+Rs ${billData.currentBillTotal.toFixed(2)}</strong></div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 15px; border-top: 2px solid ${billData.grandTotal <= 0 ? "var(--success)" : design.totalColor};">
  <div style="font-size: 16px; font-weight: 700; color: ${billData.grandTotal <= 0 ? "var(--success)" : design.totalColor};">
    ${billData.grandTotal <= 0 ? "ADVANCE CREDIT BALANCE" : "TOTAL AMOUNT PAYABLE"}
  </div>
  <div style="font-size: ${design.totalSize}px; font-weight: 700; color: ${billData.grandTotal <= 0 ? "var(--success)" : design.totalColor};">
    Rs ${Math.abs(billData.grandTotal).toFixed(2)}
  </div>
</div>
${
  billData.grandTotal <= 0
    ? `
  <div style="margin-top: 10px; padding: 8px 12px; background: var(--success-bg); border-radius: 6px; font-size: 11px; color: var(--success-fg);">
    No payment due. Rs ${Math.abs(billData.grandTotal).toFixed(2)} credit will be adjusted in next bill.
  </div>
`
    : ""
}
      </div>
      ${
        design.footerText && design.footerText.length > 0
          ? `
        <div style="border-top: 2px solid var(--border); padding-top: 20px; margin-bottom: 30px;">
          <strong style="display: block; margin-bottom: 10px; color: var(--fg-2);">Terms & Conditions:</strong>
          <ol style="margin: 0; padding-left: 20px; font-size: ${design.footerSize}px; color: var(--fg-4); line-height: 1.8;">
            ${design.footerText.map((text) => `<li style="margin-bottom: 5px;">${text}</li>`).join("")}
          </ol>
        </div>
      `
          : ""
      }
      ${
        design.showSignature
          ? `
        <div style="text-align: right; margin-top: 40px;">
          ${
            signatureUrl
              ? `
            <img src="${signatureUrl}" style="width: 150px; height: auto; margin-bottom: 10px;" />
          `
              : `
            <div style="height: 60px; border-bottom: 2px solid var(--fg-1); width: 200px; margin-left: auto; margin-bottom: 10px;"></div>
          `
          }
          <div style="font-size: 12px; color: var(--fg-4); font-weight: 600;">${design.signatureLabel || "Authorized Signatory"}</div>
        </div>
      `
          : ""
      }
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); text-align: center; font-size: 10px; color: var(--fg-5);">
        Generated on ${new Date().toLocaleString("en-IN")} | Computer Generated Bill
      </div>
    </div>
  `;
  };
  const currentBill = previewData?.[previewIndex];
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
          <div>
          <h1>Generate {segment.label} Bills</h1>
          <p>
            {latestPeriodLoading
              ? "Detecting billing period..."
              : billMonth !== null && billYear
                ? (() => {
                    const { currentGenerated, allPaid, latestPeriodId } =
                      latestPeriodData || {};
                    if (!latestPeriodId)
                      return `No bills generated yet — starting with ${periodLabel}`;
                    if (!currentGenerated)
                      return `${latestPeriodId} bills exist — generating ${periodLabel}`;
                    if (allPaid)
                      return `Payments collected — ready for ${periodLabel}`;
                    if (latestPeriodId < (latestPeriodData?.currentPeriodId || ""))
                      return `${latestPeriodId} has partial payments — generating next period ${periodLabel}`;
                    return `Bills generated for ${latestPeriodId} — collect payments or generate ${periodLabel}`;
                  })()
                : "Detecting billing period..."}
          </p>
          </div>
        </div>
      </div>
      {membersData?.members && (
        <div className={styles.statsBanner}>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>
              {segment.key === "residential"
                ? membersData.members.length
                : segmentMembers.length}
            </div>
            <div className={styles.statLabel}>Total Members</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>
              {billingHeadsData?.heads?.length || 0}
            </div>
            <div className={styles.statLabel}>Billing Heads</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber} style={{ fontSize: "1.1rem" }}>
              {periodLabel}
            </div>
            <div className={styles.statLabel}>Active Period</div>
          </div>
        </div>
      )}
      {/* ── TEST CONFIG PANEL (temporary) ─────────────────���������────────────── */}
      {segment.key === "residential" && (
      <TestConfigPanel
        members={allMembers}
        periodLabel={periodLabel}
        onSaved={() => queryClient.invalidateQueries(["members-list"])}
      />
      )}
      {segment.supportsExcelUpload && (
      <ExcelBillUploadFlow
        periodLabel={periodLabel}
        hasValidPeriodLabel={hasValidPeriodLabel}
        isPreviewing={isPreviewing}
        previewProgress={previewProgress}
        generatePreview={generatePreview}
        billMonth={billMonth}
        billYear={billYear}
        nextGenScope={nextGenScope}
        setNextGenScope={setNextGenScope}
        nextPushMode={nextPushMode}
        setNextPushMode={setNextPushMode}
        nextPushDate={nextPushDate}
        setNextPushDate={setNextPushDate}
        autoGenState={autoGenState}
        setAutoGenState={setAutoGenState}
        autoGenerateNextMonth={autoGenerateNextMonth}
      />
      )}
      {/* ── Commercial wizard body ───────────────────────────────────────────
          Commercial has no bill-template / Excel round trip, so its body is
          just the two actions the Excel block used to host: Record Collections
          (scoped to this segment's bill series) and Preview Bills, which opens
          the same Preview Modal and the same generate mutation below. */}
      {!segment.supportsExcelUpload && (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "2px solid var(--primary-tint)",
            borderRadius: "12px",
            marginBottom: "1.5rem",
            // Was `overflow: "hidden"`, which clipped the 1380px collections
            // table instead of letting its own scroller move. Only the vertical
            // axis is clipped now; the inner .tableScroll owns the horizontal one.
            overflowX: "visible",
            overflowY: "hidden",
          }}
        >
          <div
            style={{
              background: "var(--accent-tint)",
              padding: "1rem 1.5rem",
              borderBottom: "1px solid var(--primary-tint)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--primary)" }}>
              {segment.label} Bill Generation &amp; Payment Collection
            </h2>
            <p
              style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--accent)" }}
            >
              Charges come straight from the{" "}
              <a href="/admin/commercial/rate-card">Commercial Rate Card</a> —
              preview every Shop/Office bill, generate, then record collections
              in the browser.
            </p>
          </div>
          <div style={{ padding: "1.5rem" }}>
            {/* NEW: says what is missing BEFORE anything is clicked. */}
            <CommercialReadyStrip
              periodId={hasValidPeriodLabel ? periodLabel : null}
              onReadiness={setCommercialReadiness}
            />

            {previewSkipped.length > 0 && (
              <div
                style={{
                  border: "1px solid var(--warning)",
                  background: "var(--warning-bg)",
                  borderRadius: 10,
                  padding: "11px 13px",
                  marginBottom: 12,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "var(--warning-fg)",
                }}
              >
                <b>
                  {previewSkipped.length} unit
                  {previewSkipped.length === 1 ? " was" : "s were"} left out of this
                  preview.
                </b>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {previewSkipped.slice(0, 10).map((sk) => (
                    <li key={sk.memberId || sk.flat}>
                      <b>{sk.flat || sk.memberId}</b> — {sk.reason}{" "}
                      {sk.fix ? <span>({sk.fix})</span> : null}
                      {sk.fixHref ? (
                        <>
                          {" "}
                          <a href={sk.fixHref} style={{ fontWeight: 700, color: "var(--warning-fg)" }}>
                            Fix
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                // Without this the collections panel inherits min-width:auto
                // from its 1380px table and can never shrink, so no scrollbar
                // is generated and the right-hand columns are unreachable.
                minWidth: 0,
              }}
            >
              {hasValidPeriodLabel &&
              (commercialReadiness?.counts?.billsThisPeriod ?? 1) === 0 ? (
                // FIXED: "Record collections" was clickable straight after a preview
                // and always failed — a preview saves nothing, so there was never a
                // bill to collect against. Now it says so instead of erroring.
                <div
                  style={{
                    fontSize: "0.82rem",
                    color: "var(--warning-fg)",
                    padding: "0.6rem 0.9rem",
                    border: "1px solid var(--warning)",
                    borderRadius: "8px",
                    background: "var(--warning-bg)",
                    maxWidth: 470,
                    lineHeight: 1.5,
                  }}
                >
                  <b>Collections open after you generate.</b> Preview the bills, then
                  press Generate below. Once the {periodLabel} shop &amp; office bills
                  exist, this becomes a Record Collections button.
                </div>
              ) : hasValidPeriodLabel ? (
                <CollectionsPanel
                  periodId={periodLabel}
                  billSeries={segment.billSeries}
                />
              ) : (
                <div
                  style={{
                    fontSize: "0.82rem",
                    color: "var(--fg-4)",
                    padding: "0.6rem 0.9rem",
                    border: "1px dashed var(--border-strong)",
                    borderRadius: "8px",
                    background: "var(--bg-sunken)",
                  }}
                >
                  Preparing billing period…
                </div>
              )}
              <button
                className="btn btn-secondary"
                disabled={isPreviewing}
                onClick={generatePreview}
                style={{ fontSize: "0.875rem" }}
              >
                {isPreviewing ? (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span className="loading-spinner" />
                    {previewProgress.label === "fetching"
                      ? "Fetching balances..."
                      : `Calculating ${previewProgress.current}/${previewProgress.total}`}
                  </span>
                ) : (
                  "Preview Bills"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Preview Modal */}
      {showPreview && previewData && currentBill && (
        <div className={styles.modal}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalHeader}>
                  <h2>Bill Preview - {currentBill.member}</h2>
                </div>{" "}
                <p
                  style={{
                    margin: "5px 0 0 0",
                    color: "var(--fg-4)",
                    fontSize: "0.95rem",
                  }}
                >
                  {currentBill.memberName} | {currentBill.area} sq ft
                  {currentBill.previousBalance > 0 && (
                    <span
                      style={{
                        color: "var(--danger)",
                        fontWeight: "600",
                        marginLeft: "15px",
                      }}
                    >
                      Has Outstanding: Rs
                      {currentBill.previousBalance.toLocaleString("en-IN")}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className={styles.closeBtn}
              >
                X
              </button>
            </div>
            <div className={styles.modalBody}>
              <div
                dangerouslySetInnerHTML={{
                  __html: renderBillHTML(currentBill),
                }}
              />
            </div>
            <div className={styles.modalFooter}>
              <div className={styles.navigation}>
                <button
                  onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                  disabled={previewIndex === 0}
                  className="btn btn-secondary"
                >
                  Previous
                </button>
                <span className={styles.pageInfo}>
                  <strong>{previewIndex + 1}</strong> of{" "}
                  <strong>{previewData.length}</strong>
                </span>
                <button
                  onClick={() =>
                    setPreviewIndex(
                      Math.min(previewData.length - 1, previewIndex + 1),
                    )
                  }
                  disabled={previewIndex === previewData.length - 1}
                  className="btn btn-secondary"
                >
                  Next
                </button>
              </div>
              <button
                onClick={generateMutation.mutate}
                disabled={generateMutation.isPending}
                className="btn btn-success btn-lg"
                style={{ minWidth: 250 }}
              >
                {generateMutation.isPending ? (
                  <>
                    <span className="loading-spinner"></span>
                    {` Generating ${segment.label} bills... ${genProgress.current}/${genProgress.total}`}
                    <div
                      style={{
                        marginTop: 6,
                        height: 4,
                        background: "var(--primary-tint)",
                        borderRadius: 4,
                      }}
                    >
                      <div
                        style={{
                          width: `${genProgress.total ? (genProgress.current / genProgress.total) * 100 : 0}%`,
                          height: "100%",
                          background: "var(--primary-hover)",
                          borderRadius: 4,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </>
                ) : (
                  `Generate ${segment.label} Bills for ${previewData?.length ?? 0} Members`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
