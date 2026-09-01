"use client";

// Renders the Balance Sheet and Income & Expenditure Account in the prescribed
// Maharashtra co-operative housing society format - the classic two-sided
// T-format ledger presentation with a PRIOR-YEAR amount column on the far left
// of each side and the CURRENT-YEAR amount column on the far right, exactly as
// the auditor's statement prints it.
//
// Layout per side:
//   [ prior Rs ] [ particulars ................... ] [ current Rs ]
//
// ---------------------------------------------------------------------------
// BUG FIXED IN THIS REVISION (the "Income & Expenditure looks empty" defect)
// ---------------------------------------------------------------------------
// The Expenditure side was rendered as:
//     groups={[...(ie.expense || []), ...(ie.depreciation || [])]}
//
// but `ie.expense` items are SCHEDULE GROUPS  -> { label, accounts[], totalCurrent, totalPrior }
// while `ie.depreciation` items are FLAT ROWS -> { name, current, prior }
//
// So every depreciation row hit <ScheduleGroup> with `accounts` undefined,
// `label` undefined and `totalCurrent`/`totalPrior` undefined. multi === false,
// so it printed fmt(undefined) === "\u2014" in both amount columns and a blank
// particulars cell. That is why the reference run showed an Expenditure side of
// empty dashes whose TOTAL was nevertheless \u20b936,289.51: the \u20b934,650 of
// depreciation WAS in the totals, it just could never render.
//
// Fixed two ways (belt and braces):
//   1. FinancialStatementsService now also returns `depreciationGroup`, a
//      properly shaped schedule group.
//   2. `normalizeGroup()` below defensively upgrades ANY flat row it is handed
//      into a real group, so a shape mismatch can never blank a line again.
//
// Also added, to match the reference statutory format:
//   * "To " / "By " particulars prefixes on the I&E account
//   * "Amt (Rs)" caption over the amount columns
//   * both balancing rows (Excess of Income over Expenditure AND Excess of
//     Expenditure over Income) so a DEFICIT year prints correctly in brackets
//   * negative figures shown in accountancy brackets, in red
//   * filler rows so the two sides of a statement end level, like a real print
//   * an explicit "NIL" marker instead of a silent blank when a side is empty

const num = (n) => Number(n || 0);

/** Accountancy formatting: 1,23,456.78 - negatives in brackets, blank shown as an em dash. */
const fmt = (n) => {
  const v = num(n);
  if (Math.abs(v) < 0.005) return "\u2014";
  const abs = Math.abs(v).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `(${abs})` : abs;
};

/** Amount cell - red when negative, so a deficit is impossible to miss. */
function Amt({ value, className = "", bold = false }) {
  const v = num(value);
  return (
    <td
      className={`px-2 py-1 text-right align-top tabular-nums ${
        v < 0 ? "text-red-700" : ""
      } ${bold ? "font-semibold" : ""} ${className}`}
    >
      {fmt(v)}
    </td>
  );
}

const asDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
    : "";

/**
 * Accepts either a real schedule group or a flat {name,current,prior} row and
 * always returns a renderable group. This is the fix for the blank-dash rows.
 */
function normalizeGroup(g) {
  if (!g) return null;

  // Already a schedule group.
  if (Array.isArray(g.accounts)) return g;

  // Flat row (e.g. a per-asset depreciation line) -> single-line group.
  const current = g.current ?? g.amount ?? 0;
  const prior = g.prior ?? 0;
  return {
    scheduleCode: g.scheduleCode || null,
    label: g.label || g.name || "Unnamed",
    accounts: [],
    totalCurrent: current,
    totalPrior: prior,
  };
}

/** True for a real ChartOfAccount _id — the synthetic "dep:Water Pump" ids
 *  per-asset depreciation rows carry can't be drilled into (there's no
 *  single ledger account behind them, it's an aggregate across runs). */
function isRealAccountId(id) {
  return typeof id === "string" && !id.startsWith("dep:") && /^[a-f0-9]{24}$/i.test(id);
}

/** A schedule group: bold heading row, its accounts indented beneath.
 *  §7.30 drill-down: each account line is clickable when onAccountClick is
 *  supplied and the row carries a real account id — opens that account's
 *  ledger (see components/accounting/StatutoryStatements.js callers), so
 *  "where did this number come from" is answered without leaving the
 *  statement. Print/PDF rendering is unaffected: no handler in that context
 *  means the row renders as plain text, same as before this change. */
function ScheduleGroup({ group, prefix = "", onAccountClick }) {
  const accounts = group.accounts || [];
  const multi = accounts.length > 1;

  return (
    <>
      <tr>
        <Amt value={multi ? 0 : group.totalPrior} className="border-r border-gray-300 text-gray-600" />
        <td className="px-2 py-1 font-semibold">
          {multi ? "" : prefix}
          {group.label}
          {group.scheduleCode ? (
            <span className="ml-1 text-[11px] font-normal text-gray-500">
              (Sch. {group.scheduleCode})
            </span>
          ) : null}
        </td>
        <Amt value={multi ? 0 : group.totalCurrent} className="border-l border-gray-300" />
      </tr>

      {multi &&
        accounts.map((a) => {
          const clickable = onAccountClick && isRealAccountId(a.accountId);
          return (
            <tr key={a.accountId || a.name}>
              <Amt value={a.prior} className="border-r border-gray-300 text-gray-600" />
              <td className="py-1 pl-6 pr-2">
                {prefix}
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onAccountClick(a.accountId)}
                    className="underline decoration-dotted text-blue-700 hover:text-blue-900"
                    title="See this account's ledger"
                  >
                    {a.name}
                  </button>
                ) : (
                  a.name
                )}
              </td>
              <Amt value={a.current} className="border-l border-gray-300" />
            </tr>
          );
        })}

      {multi && (
        <tr>
          <Amt value={group.totalPrior} className="border-r border-gray-300 text-gray-600" />
          <td className="py-1 pl-6 pr-2 text-[12px] italic text-gray-600">Total {group.label}</td>
          <Amt value={group.totalCurrent} className="border-l border-gray-300" bold />
        </tr>
      )}
    </>
  );
}

/** One side (Liabilities / Assets / Expenditure / Income) of a T-format statement. */
function Side({
  heading,
  groups = [],
  extraRows = [],
  totalCurrent,
  totalPrior,
  totalLabel = "TOTAL",
  prefix = "",
  minRows = 0,
  onAccountClick,
}) {
  const clean = groups.map(normalizeGroup).filter(Boolean);

  // Roughly how many <tr>s the groups will produce, so both sides can be padded
  // to the same height the way a printed statement lines up.
  const rendered =
    clean.reduce((s, g) => s + ((g.accounts || []).length > 1 ? g.accounts.length + 2 : 1), 0) +
    extraRows.length;
  const fillers = Math.max(0, minRows - rendered);

  const isEmpty = clean.length === 0 && extraRows.length === 0;

  return (
    <div className="flex-1 border border-gray-400">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-gray-100">
            <th className="w-24 border-b border-r border-gray-400 px-2 py-1 text-right text-[11px] font-semibold">
              Previous Year
              <div className="font-normal text-gray-500">Amt (Rs)</div>
            </th>
            <th className="border-b border-gray-400 px-2 py-1 text-left font-semibold uppercase">
              {heading}
            </th>
            <th className="w-28 border-b border-l border-gray-400 px-2 py-1 text-right text-[11px] font-semibold">
              Current Year
              <div className="font-normal text-gray-500">Amt (Rs)</div>
            </th>
          </tr>
        </thead>
        <tbody>
          {isEmpty && (
            <tr>
              <td className="border-r border-gray-300">&nbsp;</td>
              <td className="px-2 py-1 italic text-gray-500">NIL - nothing posted to this side</td>
              <td className="border-l border-gray-300" />
            </tr>
          )}

          {clean.map((g, i) => (
            <ScheduleGroup key={g.scheduleCode || g.label || i} group={g} prefix={prefix} onAccountClick={onAccountClick} />
          ))}

          {extraRows.map((r) => (
            <tr key={r.label}>
              <Amt value={r.prior} className="border-r border-gray-300 text-gray-600" />
              <td className="px-2 py-1 italic">
                {prefix}
                {r.label}
              </td>
              <Amt value={r.current} className="border-l border-gray-300" />
            </tr>
          ))}

          {Array.from({ length: fillers }).map((_, i) => (
            <tr key={`filler-${i}`}>
              <td className="border-r border-gray-300">&nbsp;</td>
              <td />
              <td className="border-l border-gray-300" />
            </tr>
          ))}

          <tr>
            <td className="border-r border-gray-300">&nbsp;</td>
            <td />
            <td className="border-l border-gray-300" />
          </tr>
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 font-semibold">
            <Amt value={totalPrior} className="border-r border-t-2 border-gray-400" bold />
            <td className="border-t-2 border-gray-400 px-2 py-1">{totalLabel}</td>
            <Amt value={totalCurrent} className="border-l border-t-2 border-gray-400" bold />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Society name + address + registration no. above every statement — what an auditor's print header always carries. */
function SocietyHeader({ societyName, societyAddress, societyRegistrationNo }) {
  if (!societyName) return null;
  return (
    <>
      <h2 className="text-base font-bold uppercase">{societyName}</h2>
      {societyAddress && <p className="text-xs text-gray-600">{societyAddress}</p>}
      {societyRegistrationNo && (
        <p className="text-xs text-gray-500">Registration No.: {societyRegistrationNo}</p>
      )}
    </>
  );
}

function SignatureBlock() {
  return (
    <div className="mt-8">
      <p className="mb-10 text-center text-[13px] font-semibold uppercase">
        As per report of even date
      </p>
      <div className="grid grid-cols-3 gap-6 text-center text-[13px]">
        {["Chairman", "Secretary", "Treasurer"].map((role) => (
          <div key={role}>
            <div className="mx-auto mb-1 w-40 border-t border-gray-500" />
            <div className="font-semibold uppercase">{role}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StatutoryStatements({
  balanceSheet,
  incomeExpenditure,
  trialBalance,
  societyName,
  societyAddress,
  societyRegistrationNo,
  // Used only for the I&E header's "for the year ended" date when this
  // component is shown without a balanceSheet (e.g. a dedicated I&E page) —
  // balanceSheet.asOf is preferred whenever both are supplied.
  ieAsOf,
  // §7.30: called with a real ChartOfAccount _id when an account line is
  // clicked. Omit this prop (e.g. for a print/export render) and every line
  // renders as plain text — no behaviour change.
  onAccountClick,
}) {
  if (!balanceSheet && !incomeExpenditure) return null;

  const bs = balanceSheet || {};
  const ie = incomeExpenditure || {};

  // Surplus/deficit is presented as a line on the Liabilities side of the
  // Balance Sheet and as the balancing figure on the I&E Account itself.
  const liabilityGroups = [...(bs.liabilities || []), ...(bs.equity || [])];

  const surplusCurrent = num(bs.currentYearSurplusOrDeficit);
  const surplusPrior = num(bs.priorYearSurplusOrDeficit);

  const ieSurplusCurrent = num(ie.surplusOrDeficitCurrent);
  const ieSurplusPrior = num(ie.surplusOrDeficitPrior);

  // Prefer the properly-shaped group the service now returns; fall back to the
  // legacy flat array, which normalizeGroup() can still render safely.
  const depreciationGroups = ie.depreciationGroup
    ? [ie.depreciationGroup]
    : (ie.depreciation || []).length
      ? [
          {
            scheduleCode: null,
            label: "Depreciation",
            accounts: (ie.depreciation || []).map((d) => ({
              accountId: d.name,
              name: d.name,
              current: num(d.current),
              prior: num(d.prior),
            })),
            totalCurrent: (ie.depreciation || []).reduce((s, d) => s + num(d.current), 0),
            totalPrior: (ie.depreciation || []).reduce((s, d) => s + num(d.prior), 0),
          },
        ]
      : [];

  const expenditureGroups = [...(ie.expense || []), ...depreciationGroups];
  const incomeGroups = [...(ie.income || [])];

  const isDeficitCurrent = ieSurplusCurrent < 0;
  const isDeficitPrior = ieSurplusPrior < 0;

  // Balancing rows: a surplus closes the Expenditure side, a deficit closes the
  // Income side. Emit the row whenever EITHER year needs it so comparatives
  // stay aligned.
  const expenditureExtra =
    ieSurplusCurrent > 0 || ieSurplusPrior > 0
      ? [
          {
            label: "Excess of Income over Expenditure c/f",
            current: ieSurplusCurrent > 0 ? ieSurplusCurrent : 0,
            prior: ieSurplusPrior > 0 ? ieSurplusPrior : 0,
          },
        ]
      : [];

  const incomeExtra =
    isDeficitCurrent || isDeficitPrior
      ? [
          {
            label: "Excess of Expenditure over Income c/f",
            current: isDeficitCurrent ? Math.abs(ieSurplusCurrent) : 0,
            prior: isDeficitPrior ? Math.abs(ieSurplusPrior) : 0,
          },
        ]
      : [];

  const ieTotalExpCurrent =
    num(ie.totalExpenseCurrent) + (ieSurplusCurrent > 0 ? ieSurplusCurrent : 0);
  const ieTotalExpPrior = num(ie.totalExpensePrior) + (ieSurplusPrior > 0 ? ieSurplusPrior : 0);
  const ieTotalIncCurrent =
    num(ie.totalIncomeCurrent) + (isDeficitCurrent ? Math.abs(ieSurplusCurrent) : 0);
  const ieTotalIncPrior =
    num(ie.totalIncomePrior) + (isDeficitPrior ? Math.abs(ieSurplusPrior) : 0);

  const bsRows = Math.max(
    liabilityGroups.length + 1,
    (bs.assets || []).length,
  );
  const ieRows = Math.max(expenditureGroups.length, incomeGroups.length);

  return (
    <div className="space-y-10 bg-white">
      {trialBalance && (
        <div
          className={`rounded-md border px-4 py-2 text-sm ${
            trialBalance.isBalanced
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {"Trial Balance \u2014 Dr \u20b9"}
          {fmt(trialBalance.totalDebit)}
          {" / Cr \u20b9"}
          {fmt(trialBalance.totalCredit)}{" "}
          {trialBalance.isBalanced ? "\u2014 Balanced \u2713" : "\u2014 OUT OF BALANCE"}
        </div>
      )}

      {balanceSheet && (
        <div>
          <header className="mb-3 text-center">
            <SocietyHeader societyName={societyName} societyAddress={societyAddress} societyRegistrationNo={societyRegistrationNo} />
            <h3 className="text-sm font-bold uppercase">
              Balance Sheet as at {asDate(bs.asOf)}
            </h3>
            {bs.priorFinancialYearLabel && (
              <p className="text-xs text-gray-500">
                Comparative: {bs.priorFinancialYearLabel} vs {bs.financialYearLabel}
              </p>
            )}
          </header>

          <div className="flex flex-col gap-0 lg:flex-row">
            <Side
              heading="Liabilities"
              groups={liabilityGroups}
              minRows={bsRows}
              extraRows={[
                {
                  label: "Income & Expenditure A/c (Surplus / Deficit for the year)",
                  current: surplusCurrent,
                  prior: surplusPrior,
                },
              ]}
              totalCurrent={num(bs.totalLiabilitiesCurrent) + num(bs.totalEquityInclSurplusCurrent)}
              totalPrior={num(bs.totalLiabilitiesPrior) + num(bs.totalEquityInclSurplusPrior)}
              onAccountClick={onAccountClick}
            />
            <Side
              heading="Assets"
              groups={bs.assets || []}
              minRows={bsRows}
              totalCurrent={bs.totalAssetsCurrent}
              totalPrior={bs.totalAssetsPrior}
              onAccountClick={onAccountClick}
            />
          </div>

          <p
            className={`mt-2 text-sm ${
              bs.isBalancedCurrent ? "text-green-700" : "text-red-700"
            }`}
          >
            {bs.isBalancedCurrent
              ? "Balance Sheet balances \u2713"
              : "Balance Sheet does NOT balance \u2014 investigate"}
          </p>
        </div>
      )}

      {incomeExpenditure && (
        <div>
          <header className="mb-3 text-center">
            <SocietyHeader societyName={societyName} societyAddress={societyAddress} societyRegistrationNo={societyRegistrationNo} />
            <h3 className="text-sm font-bold uppercase">
              Income &amp; Expenditure Account for the year ended {asDate(bs.asOf || ieAsOf)}
            </h3>
          </header>

          <div className="flex flex-col gap-0 lg:flex-row">
            <Side
              heading="Expenditure"
              prefix="To "
              groups={expenditureGroups}
              extraRows={expenditureExtra}
              minRows={ieRows}
              totalCurrent={ieTotalExpCurrent}
              totalPrior={ieTotalExpPrior}
              onAccountClick={onAccountClick}
            />
            <Side
              heading="Income"
              prefix="By "
              groups={incomeGroups}
              extraRows={incomeExtra}
              minRows={ieRows}
              totalCurrent={ieTotalIncCurrent}
              totalPrior={ieTotalIncPrior}
              onAccountClick={onAccountClick}
            />
          </div>

          <p
            className={`mt-2 text-sm font-semibold ${
              isDeficitCurrent ? "text-red-700" : "text-green-700"
            }`}
          >
            {isDeficitCurrent
              ? `Deficit for the year \u2014 Excess of Expenditure over Income: \u20b9${fmt(
                  Math.abs(ieSurplusCurrent),
                )}`
              : `Surplus for the year \u2014 Excess of Income over Expenditure: \u20b9${fmt(
                  ieSurplusCurrent,
                )}`}
          </p>

          <p className="mt-1 text-xs text-gray-500">
            {`Expenditure ${fmt(ieTotalExpCurrent)} = Income ${fmt(ieTotalIncCurrent)} \u2014 both `}
            sides of the account must agree once the balancing figure is carried.
          </p>
        </div>
      )}

      <SignatureBlock />
    </div>
  );
}
