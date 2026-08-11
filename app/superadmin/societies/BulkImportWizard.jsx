"use client";

// app/superadmin/societies/BulkImportWizard.jsx
//
// Native 6-sheet society import. Replaces the download-template /
// fill-in-Excel / upload / read-errors / re-upload loop entirely.
//
// Network budget for a whole import session:
//   1x GET  /api/admin/bulk-import/schema?probe=1   on open
//   1x POST /api/admin/bulk-import                  on submit, only when clean
//
// That is it. Every keystroke is validated locally by lib/import/
// validateWorkbook.js - the same module the server re-runs on submit, so the
// browser cannot show a green state the server would reject.
//
// Keyboard model matches the collections grid so the two screens feel like one
// product: Enter / arrows move, Tab moves, Cmd+Enter submits.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  Building2,
  Users,
  IdCard,
  Car,
  Heart,
  History,
  KeyRound,
  Plus,
  Trash2,
  ClipboardPaste,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  ArrowRight,
} from "lucide-react";
import {
  validateWorkbook,
  collectWarnings,
  validateCell,
  isBlankRow,
} from "@/lib/import/validateWorkbook";
import styles from "@/styles/BulkImportWizard.module.css";
import { ENUMS } from "@/lib/import/importSchema";

const ICONS = {
  building: Building2,
  users: Users,
  idcard: IdCard,
  car: Car,
  family: Heart,
  history: History,
  key: KeyRound,
};

function emptyRow(sheet) {
  const r = {};
  for (const c of sheet.columns) r[c.key] = "";
  return r;
}

// Header-aware paste. Admins export from their own spreadsheets, so column
// order and wording vary per society — "Maintenance Rate (Per Sq Ft)" vs
// "Maintenance Rate", "Admin Full Name" vs "Admin Name". Matching on a
// normalised header is the only thing that survives that; positional paste
// silently writes an address into a date field.
const normHeader = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/\((?:per\s+sq\s*ft|fixed|per\s+vehicle|days)\)/g, "")
    .replace(/[^a-z0-9]/g, "");

// Wording differences we accept. Left side is normalised incoming header.
const HEADER_ALIASES = {
  adminfullname: "Admin Name",
  contactperson: "Person of Contact",
  intereststartsafterduedate: "Interest After Days",
  gracedays: "Interest After Days",
  watercharges: "Water Charge",
  securitycharges: "Security Charge",
  electricitycharges: "Electricity Charge",
  regdate: "Date of Registration",
  pan: "PAN No",
  tan: "TAN No",
};

function resolveHeaders(headerCells, sheet) {
  const byNorm = new Map();
  for (const c of sheet.columns) {
    byNorm.set(normHeader(c.key), c.key);
    byNorm.set(normHeader(c.label), c.key);
  }
  return headerCells.map((h) => {
    const n = normHeader(h);
    return byNorm.get(n) || byNorm.get(normHeader(HEADER_ALIASES[n] || "")) || null;
  });
}

// Detects whether the first pasted line is a header rather than data.
function looksLikeHeader(cells, sheet) {
  const mapped = resolveHeaders(cells, sheet).filter(Boolean).length;
  return mapped >= Math.max(2, Math.ceil(cells.length * 0.4));
}

// Excel in India exports DD/MM/YYYY. The schema stores ISO. Converting on
// paste beats making the admin retype every date.
function coerceCell(raw, col) {
  if (!col || !raw) return raw;
  if (col.type === "date") {
    const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) {
      const [, d, mo, y] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }
  if (["money", "number", "area"].includes(col.type)) {
    return raw.replace(/[₹,\s]/g, "");
  }
  return raw;
}

/** Parse clipboard TSV into rows aligned to the sheet's columns. */
function parseClipboard(text, sheet, startColIdx) {
  let lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length);
  if (!lines.length) return [];

  // Admins copy the header row along with the data. If the first line's first
  // cell is a known column name, it's a header — drop it rather than writing
  // "Society Name" into the Society Name field.
  const firstCell = (lines[0] || "").split("\t")[0].trim().toLowerCase();
  const isHeader = sheet.columns.some(
    (c) => c.key.toLowerCase() === firstCell || c.label.toLowerCase() === firstCell,
  );
  if (isHeader) lines = lines.slice(1);

  return lines.map((line) => {
    const cells = line.split("\t");
    const row = emptyRow(sheet);
    cells.forEach((cell, i) => {
      const col = sheet.columns[startColIdx + i];
if (!col) return;
let v = cell.trim();
// Excel casing varies ("yes" vs "Yes"). Snap select values to the enum
// so a case difference isn't reported as a validation error.
if (col.type === "select" && v) {
  const opts = ENUMS[col.options] || [];
  v = opts.find((o) => o.toLowerCase() === v.toLowerCase()) || v;
}
row[col.key] = v;
    });
    return row;
  });
}

export default function BulkImportWizard({ open, onClose, onImported,BillHistoryStep  }) {
  const [schema, setSchema] = useState(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState(null);
  const [takenEmails, setTakenEmails] = useState(() => new Set());
const [showBillHistory, setShowBillHistory] = useState(false);
const [billHistoryDone, setBillHistoryDone] = useState(false);
  const [activeSheet, setActiveSheet] = useState("society");
  const [data, setData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverResult, setServerResult] = useState(null);
  const [focused, setFocused] = useState({ row: 0, col: 0 });
const [importRunId, setImportRunId] = useState(null);
const [progress, setProgress] = useState(null);
  const shellRef = useRef(null);
  const scrimRef = useRef(null);
  const cellRefs = useRef(new Map()); // "sheetId:row:colKey" -> input el
const [pasteNote, setPasteNote] = useState(null);
const [armedClear, setArmedClear] = useState(null); // sheet.id awaiting confirm
const fileInputRef = useRef(null);

// ── Schema: fetched once per open ──────────────────────────────────────
// The attempt flag is a ref, not state: loadingSchema was both a dependency
// and mutated by this effect, so a failed fetch flipped it back to false,
// retriggered the effect and re-fetched — an unthrottled retry loop against
// a 401.
const schemaAttempted = useRef(false);
useEffect(() => {
  if (!open) {
    schemaAttempted.current = false; // allow one retry on reopen
    return;
  }
  if (schema || schemaAttempted.current) return;
  schemaAttempted.current = true;
  setLoadingSchema(true);
  setSchemaError(null);

    fetch("/api/admin/bulk-import/schema?probe=1", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((payload) => {
        setSchema(payload);
        setTakenEmails(new Set(payload.probe?.takenEmails || []));
        // Seed one blank row per sheet so the grid is immediately usable.
        const seeded = {};
        for (const s of payload.sheets) {
          seeded[s.id] = s.mode === "single" ? [emptyRow(s)] : [emptyRow(s)];
        }
        setData(seeded);
      })
       .catch((e) => setSchemaError(e.message))
    .finally(() => setLoadingSchema(false));
}, [open, schema]);

  // ── Entrance morph ───────────────────────────────────────────────────
  // transform + opacity only. Animating width/height here would reflow a grid
  // that can hold a few hundred rows, on every frame.
  useEffect(() => {
    if (!open || !shellRef.current) return;
    const shell = shellRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      gsap.set(shell, { opacity: 1, scale: 1, y: 0 });
      return;
    }
    const tl = gsap.timeline();
    gsap.set(scrimRef.current, { opacity: 0 });
    gsap.set(shell, { opacity: 0, scaleX: 0.86, scaleY: 0.6, y: 28 });
    tl.to(scrimRef.current, { opacity: 1, duration: 0.18, ease: "none" }, 0)
      .to(shell, { opacity: 1, duration: 0.14, ease: "none" }, 0)
      .to(shell, { scaleX: 1, duration: 0.42, ease: "power3.out" }, 0)
      .to(shell, { scaleY: 1, y: 0, duration: 0.5, ease: "back.out(1.2)" }, 0.12)
      .to(
        shell.querySelectorAll("[data-stagger]"),
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: { amount: 0.2 } },
        0.3,
      )
      .set(shell, { clearProps: "transform" });
    return () => tl.kill();
  }, [open, schema]);

  // ── Validation: recomputed locally, never on the server ─────────────────────
  const verdict = useMemo(() => {
    if (!schema) return { ok: false, cellErrors: {}, sheetErrors: {}, counts: {}, totalErrors: 0 };
    return validateWorkbook(data);
  }, [schema, data]);

  const warnings = useMemo(
    () => (schema ? collectWarnings(data) : []),
    [schema, data],
  );
// The footer counted errors without naming them, which is useless at 84.
// Group identical messages: one misaligned column produces the same error on
// every row, so the fix is one line, not 84.
const errorDigest = useMemo(() => {
  const byMessage = new Map();
  for (const [sheetId, rowMap] of Object.entries(verdict.cellErrors || {})) {
    for (const [rowIdx, colMap] of Object.entries(rowMap)) {
      for (const [colKey, msg] of Object.entries(colMap)) {
        const k = `${sheetId}|${colKey}|${msg}`;
        const hit = byMessage.get(k) || { sheetId, colKey, msg, rows: [] };
        hit.rows.push(Number(rowIdx) + 1);
        byMessage.set(k, hit);
      }
    }
  }
  return [...byMessage.values()].sort((a, b) => b.rows.length - a.rows.length);
}, [verdict]);
  // Advisory email check layered on top - not part of validateWorkbook because
  // it depends on server state the isomorphic validator must not know about.
  const emailAdvisories = useMemo(() => {
    if (!schema) return {};
    const out = {};
    (data.basicInfo || []).forEach((row, i) => {
      const e = String(row["emailPrimary*"] || "").trim().toLowerCase();
      if (e && takenEmails.has(e)) {
        out[i] = `${e} is already registered on the platform. The import will be rejected.`;
      }
    });
    const adminEmail = String((data.society || [])[0]?.["Admin Email"] || "")
      .trim()
      .toLowerCase();
    if (adminEmail && takenEmails.has(adminEmail)) out.admin = `${adminEmail} is already registered.`;
    return out;
  }, [schema, data, takenEmails]);

  const blockedByAdvisory = Object.keys(emailAdvisories).length > 0;
  const canSubmit = verdict.ok && !blockedByAdvisory && !submitting;

  // ── Editing ──────────────────────────────────────────────────────────
  const setCell = useCallback((sheetId, rowIdx, colKey, value) => {
    setData((prev) => {
      const rows = [...(prev[sheetId] || [])];
      rows[rowIdx] = { ...rows[rowIdx], [colKey]: value };
      return { ...prev, [sheetId]: rows };
    });
  }, []);

  const addRow = useCallback(
    (sheet, count = 1) => {
      setData((prev) => ({
        ...prev,
        [sheet.id]: [
          ...(prev[sheet.id] || []),
          ...Array.from({ length: count }, () => emptyRow(sheet)),
        ],
      }));
    },
    [],
  );

  const removeRow = useCallback((sheetId, rowIdx) => {
    setData((prev) => {
      const rows = (prev[sheetId] || []).filter((_, i) => i !== rowIdx);
      return { ...prev, [sheetId]: rows.length ? rows : prev[sheetId] };
    });
  }, []);

const clearSheet = useCallback(
  (sheet) => {
    // A mispasted block is the common case, and per-row delete is unusable
    // at 84 rows. Reset to one blank row so the grid stays usable.
    setData((prev) => ({ ...prev, [sheet.id]: [emptyRow(sheet)] }));
    setPasteNote(null);
    setArmedClear(null);
  },
  [],
);

// Replaces the old template download. Paste this into row 1 of Excel and your
// columns line up with the grid, which is all the template was ever for.
const copyHeaders = useCallback((sheet) => {
  const tsv = sheet.columns.map((c) => c.key).join("\t");
  navigator.clipboard.writeText(tsv);
  setPasteNote(`Column headers for "${sheet.title}" copied — paste into row 1 of Excel.`);
}, []);

// ── Keyboard grid navigation ───────────────────────────────────────────
  // ── Keyboard grid navigation ───────────────────────────────────────────
  const focusCell = useCallback((sheetId, rowIdx, colIdx, sheet) => {
    const col = sheet.columns[colIdx];
    if (!col) return;
    const el = cellRefs.current.get(`${sheetId}:${rowIdx}:${col.key}`);
    if (el) {
      el.focus();
      if (el.select) el.select();
      setFocused({ row: rowIdx, col: colIdx });
    }
  }, []);

  const onCellKeyDown = useCallback(
    (e, sheet, rowIdx, colIdx) => {
      const rows = data[sheet.id] || [];
      const lastCol = sheet.columns.length - 1;
      const el = e.target;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const atEnd =
        el.selectionStart === (el.value?.length ?? 0) &&
        el.selectionEnd === (el.value?.length ?? 0);

      const go = (r, c) => {
        e.preventDefault();
        focusCell(sheet.id, r, c, sheet);
      };

      switch (e.key) {
        case "Enter":
          if (e.metaKey || e.ctrlKey) return; // reserved for submit
          e.preventDefault();
          if (rowIdx === rows.length - 1) {
            // Enter on the final row grows the sheet, like Excel.
            addRow(sheet, 1);
            requestAnimationFrame(() => focusCell(sheet.id, rowIdx + 1, colIdx, sheet));
          } else {
            focusCell(sheet.id, rowIdx + 1, colIdx, sheet);
          }
          break;
        case "ArrowDown":
          if (rowIdx < rows.length - 1) go(rowIdx + 1, colIdx);
          break;
        case "ArrowUp":
          if (rowIdx > 0) go(rowIdx - 1, colIdx);
          break;
        case "ArrowRight":
          // Only leave the cell when the caret is already at the end, so
          // arrowing through text still works.
          if (atEnd && colIdx < lastCol) go(rowIdx, colIdx + 1);
          break;
        case "ArrowLeft":
          if (atStart && colIdx > 0) go(rowIdx, colIdx - 1);
          break;
        case "Backspace":
          if (
            (e.metaKey || e.ctrlKey) &&
            rows.length > 1 &&
            isBlankRow(rows[rowIdx], sheet.columns)
          ) {
            e.preventDefault();
            removeRow(sheet.id, rowIdx);
          }
          break;
        default:
          break;
      }
    },
    [data, addRow, removeRow, focusCell],
  );

  const onPaste = useCallback(
    (e, sheet, rowIdx, colIdx) => {
      const text = e.clipboardData?.getData("text/plain") || "";
      if (!text.includes("\t") && !text.includes("\n")) return; // single cell
      e.preventDefault();
      const pasted = parseClipboard(text, sheet, colIdx);
      setData((prev) => {
        const rows = [...(prev[sheet.id] || [])];
        pasted.forEach((pRow, i) => {
          const target = rowIdx + i;
          const base = rows[target] ? { ...rows[target] } : emptyRow(sheet);
          for (const c of sheet.columns) {
            if (pRow[c.key] !== "") base[c.key] = pRow[c.key];
          }
          rows[target] = base;
        });
           return { ...prev, [sheet.id]: rows };
    });

    const extra = (text.split("\n")[0] || "").split("\t").length - sheet.columns.length;
    setPasteNote(
      extra > 0
        ? `${extra} extra column(s) in your clipboard were ignored — this sheet has ${sheet.columns.length}.`
        : null,
    );
  },
  [],
);
// Container-level fallback. Grid text inputs handle their own paste; this
// catches select cells, the single-mode Society tab, and a paste with
// nothing focused. Without it the first tab an admin lands on silently
// ignores Ctrl+V.
const onSheetPaste = useCallback(
  (e, sheet) => {
    if (e.target.tagName === "INPUT" && sheet.mode !== "single") return; // handled per-cell
    const text = e.clipboardData?.getData("text/plain") || "";
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const startRow = sheet.mode === "single" ? 0 : focused.row || 0;
    const startCol = sheet.mode === "single" ? 0 : focused.col || 0;
    const pasted = parseClipboard(text, sheet, startCol);
    setData((prev) => {
      const rows = [...(prev[sheet.id] || [])];
      pasted.forEach((pRow, i) => {
        const target = startRow + i;
        const base = rows[target] ? { ...rows[target] } : emptyRow(sheet);
        for (const c of sheet.columns) {
          if (pRow[c.key] !== "") base[c.key] = pRow[c.key];
        }
        rows[target] = base;
      });
      // Fill any holes — a sparse array makes React skip rows entirely.
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = emptyRow(sheet);
      return { ...prev, [sheet.id]: rows };
    });

    const extra = (text.split("\n")[0] || "").split("\t").length - sheet.columns.length;
    setPasteNote(
      extra > 0
        ? `${extra} extra column(s) in your clipboard were ignored — this sheet has ${sheet.columns.length}.`
        : null,
    );
  },
  [focused],
);
// Document-level paste. A handler on a wrapper div only fires when focus is
// already inside it, so Ctrl+V with nothing clicked does nothing — which is
// exactly how an admin uses this. Capturing at the document while open makes
// paste work on every tab regardless of focus or markup.
useEffect(() => {
  if (!open || !schema) return;
  const sheet = schema.sheets.find((s) => s.id === activeSheet);
  if (!sheet) return;

  const handler = (e) => {
    // Grid text inputs already handle their own paste.
    const t = e.target;
    if (t?.tagName === "INPUT" && sheet.mode !== "single") return;
    onSheetPaste(e, sheet);
  };

  document.addEventListener("paste", handler);
  return () => document.removeEventListener("paste", handler);
}, [open, schema, activeSheet, onSheetPaste]);
  // ── Submit: the one and only POST ──────────────────────────────────────
  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setServerResult(null);

    // Strip blank rows before sending. The grid keeps trailing blanks for
    // usability; the server should never see them.
    const cleaned = {};
    for (const sheet of schema.sheets) {
      cleaned[sheet.id] = (data[sheet.id] || []).filter(
        (r) => !isBlankRow(r, sheet.columns),
      );
    }

    try {
    // Stable id so the server can report progress and so a retry after a
// dropped connection replays instead of double-importing.
const runId = crypto.randomUUID();
setImportRunId(runId);

const poll = setInterval(async () => {
  try {
    const r = await fetch(
      `/api/admin/bulk-import/status?importRunId=${runId}`,
      { credentials: "include" },
    );
    if (r.ok) setProgress(await r.json());
  } catch { /* transient; next tick retries */ }
}, 1200);

const res = await fetch("/api/admin/bulk-import", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({
    importRunId: runId,
    schemaVersion: schema.schemaVersion,
    data: cleaned,
  }),
});
clearInterval(poll);
      const json = await res.json();
      setServerResult({ ok: res.ok, ...json });
      if (res.ok && json.success) onImported?.(json);
    } catch (err) {
      setServerResult({ ok: false, error: err.message });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, schema, data, onImported]);

  // ── Alternate path: upload the filled .xlsx template instead of pasting
  // seven sheets by hand. Same endpoint, same server-side validateWorkbook
  // pass, same progress/result UI — only how the rows get to the server
  // differs.
  const uploadFile = useCallback(
    async (file) => {
      if (!file || submitting) return;
      setSubmitting(true);
      setServerResult(null);

      const runId = crypto.randomUUID();
      setImportRunId(runId);

      const poll = setInterval(async () => {
        try {
          const r = await fetch(
            `/api/admin/bulk-import/status?importRunId=${runId}`,
            { credentials: "include" },
          );
          if (r.ok) setProgress(await r.json());
        } catch { /* transient; next tick retries */ }
      }, 1200);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("importRunId", runId);
        const res = await fetch("/api/admin/bulk-import", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const json = await res.json();
        setServerResult({ ok: res.ok, ...json });
        if (res.ok && json.success) onImported?.(json);
      } catch (err) {
        setServerResult({ ok: false, error: err.message });
      } finally {
        clearInterval(poll);
        setSubmitting(false);
      }
    },
    [submitting, onImported],
  );

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      if (e.key === "Escape" && !submitting) onClose?.();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, submit, submitting, onClose]);

  if (!open) return null;

  // ── Render ──────────────────────────────────────────────────────────
  const sheet = schema?.sheets.find((s) => s.id === activeSheet);
  const rows = data[activeSheet] || [];
  const sheetCellErrors = verdict.cellErrors[activeSheet] || {};

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div ref={scrimRef} className={styles.scrim} onClick={() => !submitting && onClose?.()} />

      <div ref={shellRef} className={styles.shell}>
        {/* Header */}
        <header className={styles.header} data-stagger>
          <div>
            <h2 className={styles.title}>Import a society</h2>
            <p className={styles.subtitle}>
              Six sheets, one submission. Everything is checked here in the
              browser — nothing is sent until all of it is valid.
            </p>
          </div>
          {schema && !submitting && !serverResult?.success && (
            <div className={styles.sheetActions}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // allow re-selecting the same file after a fix
                  if (f) uploadFile(f);
                }}
              />
              <button
                className={styles.ghostBtn}
                onClick={() => fileInputRef.current?.click()}
                title="Fill the downloaded template in Excel (all 7 sheets), then upload it here instead of pasting sheet by sheet."
              >
                <ClipboardPaste size={14} /> Upload filled Excel (.xlsx)
              </button>
            </div>
          )}
          <button className={styles.iconBtn} onClick={onClose} disabled={submitting} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {loadingSchema && (
          <div className={styles.centerState}>
            <Loader2 className={styles.spin} size={22} />
            <p>Loading the import schema…</p>
          </div>
        )}

        {schemaError && (
          <div className={styles.centerState}>
            <AlertTriangle size={22} className={styles.errIcon} />
            <p>Could not load the schema: {schemaError}</p>
          </div>
        )}

{schema && !submitting && !serverResult?.success && (
            <>
            {/* Sheet tabs */}
            <nav className={styles.tabs} data-stagger>
              {schema.sheets.map((s) => {
                const Icon = ICONS[s.icon] || Users;
                const c = verdict.counts[s.id] || { rows: 0, errors: 0 };
                const isActive = s.id === activeSheet;
                return (
                  <button
                    key={s.id}
                    className={`${styles.tab} ${isActive ? styles.tabActive : ""} ${
                      c.errors ? styles.tabError : ""
                    }`}
onClick={() => {
  setActiveSheet(s.id);
  setArmedClear(null); // don't carry a primed delete across tabs
}}                  >
                    <Icon size={15} />
                    <span className={styles.tabLabel}>{s.title}</span>
                    {c.errors > 0 ? (
                      <span className={styles.badgeErr}>{c.errors}</span>
                    ) : c.rows > 0 ? (
                      <span className={styles.badgeOk}>{c.rows}</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            {/* Sheet body */}
            <div className={styles.body} data-stagger>
              <div className={styles.sheetHead}>
                <div>
                  <h3 className={styles.sheetTitle}>{sheet.title}</h3>
                  <p className={styles.sheetSub}>{sheet.subtitle}</p>
                </div>
               <div className={styles.sheetActions}>
  {sheet.mode === "grid" && (
    <>
      <span className={styles.hint}>
        <ClipboardPaste size={13} /> paste a block from Excel to fill many rows
      </span>
      <button className={styles.ghostBtn} onClick={() => addRow(sheet, 1)}>
        <Plus size={14} /> Row
      </button>
      <button className={styles.ghostBtn} onClick={() => addRow(sheet, 10)}>
        <Plus size={14} /> 10 rows
      </button>
    </>
  )}
  <button
    className={styles.ghostBtn}
    onClick={() =>
      armedClear === sheet.id ? clearSheet(sheet) : setArmedClear(sheet.id)
    }
    onBlur={() => setArmedClear(null)}
  >
    <Trash2 size={14} />{" "}
    {armedClear === sheet.id ? "Click again to confirm" : "Discard all"}
  </button>
  <button className={styles.ghostBtn} onClick={() => copyHeaders(sheet)}>
  <ClipboardPaste size={14} /> Copy headers
</button>
<button
  className={styles.ghostBtn}
  onClick={async () => {
    const res = await fetch("/api/admin/bulk-import/template", {
      credentials: "include",
    });
    if (!res.ok) return setPasteNote("Template download failed.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "BulkImport_Template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }}
>
  Download template
</button>
</div>
              </div>

              {(verdict.sheetErrors[activeSheet] || []).map((m, i) => (
                <div key={i} className={styles.sheetErrorBar}>
                  <AlertTriangle size={14} /> {m}
                </div>
              ))}
{/* ← INSERT HERE */}
{pasteNote && (
  <div className={styles.sheetErrorBar}>
    <AlertTriangle size={14} /> {pasteNote}
  </div>
)}
              {/* Society = form, everything else = grid */}
              {sheet.mode === "single" ? (
                
                <div className={styles.form} onPaste={(e) => onSheetPaste(e, sheet)}>
                  {sheet.columns.map((col) => {
                    const value = rows[0]?.[col.key] ?? "";
                    const error = sheetCellErrors[0]?.[col.key];
                    const advisory = col.key === "Admin Email" ? emailAdvisories.admin : null;
                    return (
                      <label
                        key={col.key}
                        className={`${styles.field} ${error || advisory ? styles.fieldErr : ""}`}
                      >
                        <span className={styles.fieldLabel}>
                          {col.label}
                          {col.required && <em className={styles.req}>*</em>}
                        </span>
                        {col.type === "select" ? (
                          <select
                            value={value}
                            onChange={(e) => setCell(sheet.id, 0, col.key, e.target.value)}
                          >
                            <option value="">—</option>
                            {(schema.enums[col.options] || []).map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={col.type === "date" ? "date" : "text"}
                            inputMode={
                              ["number", "money", "area", "phone"].includes(col.type)
                                ? "decimal"
                                : undefined
                            }
                            value={value}
                            placeholder={col.help || ""}
                            onChange={(e) => setCell(sheet.id, 0, col.key, e.target.value)}
                          />
                        )}
                        {(error || advisory) && (
                          <span className={styles.fieldMsg}>{advisory || error}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.thIndex}>#</th>
                        {sheet.columns.map((col) => (
                          <th
                            key={col.key}
                            style={{ width: col.width }}
                            title={col.help || ""}
                          >
                            {col.label}
                            {col.required && <em className={styles.req}>*</em>}
                          </th>
                        ))}
                        <th className={styles.thDel} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rIdx) => {
                        const rowErrs = sheetCellErrors[rIdx] || {};
                        const advisory =
                          activeSheet === "basicInfo" ? emailAdvisories[rIdx] : null;
                        const blank = isBlankRow(row, sheet.columns);
                        const bad = Object.keys(rowErrs).length > 0 || advisory;
                        return (
                          <tr
                            key={rIdx}
                            className={`${bad ? styles.rowErr : ""} ${
                              blank ? styles.rowBlank : ""
                            }`}
                          >
                            <td className={styles.tdIndex}>{rIdx + 1}</td>
                            {sheet.columns.map((col, cIdx) => {
                              const err = rowErrs[col.key];
                              const val = row[col.key] ?? "";
                              return (
                                <td
                                  key={col.key}
                                  className={err ? styles.cellErr : ""}
                                  title={err || ""}
                                >
                                  {col.type === "select" ? (
                                    <select
                                      ref={(el) => {
                                        const k = `${sheet.id}:${rIdx}:${col.key}`;
                                        el ? cellRefs.current.set(k, el) : cellRefs.current.delete(k);
                                      }}
                                      value={val}
                                      onChange={(e) => setCell(sheet.id, rIdx, col.key, e.target.value)}
                                        onKeyDown={(e) => onCellKeyDown(e, sheet, rIdx, cIdx)}
  onPaste={(e) => onPaste(e, sheet, rIdx, cIdx)}
>
  <option value="">—</option>
                                      {(schema.enums[col.options] || []).map((o) => (
                                        <option key={o} value={o}>{o}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      ref={(el) => {
                                        const k = `${sheet.id}:${rIdx}:${col.key}`;
                                        el ? cellRefs.current.set(k, el) : cellRefs.current.delete(k);
                                      }}
                                      type="text"
                                      value={val}
                                      onChange={(e) => setCell(sheet.id, rIdx, col.key, e.target.value)}
                                      onKeyDown={(e) => onCellKeyDown(e, sheet, rIdx, cIdx)}
                                      onPaste={(e) => onPaste(e, sheet, rIdx, cIdx)}
                                    />
                                  )}
                                </td>
                              );
                            })}
                            <td className={styles.tdDel}>
                              {rows.length > 1 && (
                                <button
                                  className={styles.delBtn}
                                  onClick={() => removeRow(sheet.id, rIdx)}
                                  aria-label={`Delete row ${rIdx + 1}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className={styles.footer} data-stagger>
              <div className={styles.status}>
               {verdict.totalErrors > 0 ? (
  <details className={styles.warnBox} open>
   
    <ul>
      {errorDigest.slice(0, 12).map((d, i) => (
        <li key={i}>
          <strong>{d.colKey}</strong> — {d.msg}
          {d.rows.length > 1
            ? ` (${d.rows.length} rows: ${d.rows.slice(0, 5).join(", ")}${
                d.rows.length > 5 ? "…" : ""
              })`
            : ` (row ${d.rows[0]})`}
        </li>
      ))}
      {errorDigest.length > 12 && (
        <li>…and {errorDigest.length - 12} more kinds</li>
      )}
    </ul>
     <summary className={styles.statusErr}>
      <AlertTriangle size={15} />
      {verdict.totalErrors} problem{verdict.totalErrors === 1 ? "" : "s"} to fix
    </summary>
  </details>
) : blockedByAdvisory ? (
                  <span className={styles.statusErr}>
                    <AlertTriangle size={15} />
                    An email is already registered
                  </span>
                ) : (
                  <span className={styles.statusOk}>
                    <CheckCircle2 size={15} />
                    All {verdict.counts.basicInfo?.rows || 0} flats valid — ready to import
                  </span>
                )}

                {warnings.length > 0 && (
                  <details className={styles.warnBox}>
                    <summary>{warnings.length} note{warnings.length === 1 ? "" : "s"}</summary>
                    <ul>
                      {warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
           </div>

<button
  className={styles.ghostBtn}
  disabled={submitting}
  onClick={() => {
    if (armedClear !== "__all__") return setArmedClear("__all__");
    const seeded = {};
    for (const s of schema.sheets) seeded[s.id] = [emptyRow(s)];
    setData(seeded);
    setPasteNote(null);
    setArmedClear(null);
  }}
  onBlur={() => setArmedClear(null)}
>
  <Trash2 size={14} />{" "}
  {armedClear === "__all__" ? "Confirm — clears all 6 sheets" : "Start over"}
</button>

<button
  className={styles.submitBtn}
  disabled={!canSubmit}
  onClick={submit}
>
                {submitting ? (
                  <>
                    <Loader2 size={16} className={styles.spin} /> Importing…
                  </>
                ) : (
                  <>
                    Import society <ArrowRight size={16} />
                  </>
                )}
              </button>
            </footer>
          </>
        )}
{/* Live progress — real server stages, polled from BulkImportRun */}
{submitting && (
  <div style={{ padding: "1.5rem 0.5rem" }}>
    <div style={{ marginBottom: "1.25rem", fontWeight: 600, color: "#a5b4fc", fontSize: "0.9rem" }}>
      Importing {progress?.totalCount ? `${progress.processedCount ?? 0} / ${progress.totalCount} flats` : "…"}
    </div>
    {[
      { key: "VALIDATING", label: "Re-validating on the server", icon: "🔍" },
      { key: "IMPORTING", label: "Creating society, admin and flats", icon: "🏢" },
      { key: "FINALIZING", label: "Billing heads and current month bills", icon: "📋" },
      { key: "COMMITTED", label: "Committing the transaction", icon: "🔒" },
      { key: "EMAIL_QUEUED", label: "Queueing onboarding emails", icon: "✉️" },
      { key: "COMPLETED", label: "Done", icon: "✅" },
    ].map((s, i, arr) => {
      const now = arr.findIndex((x) => x.key === progress?.status);
      const done = now > i;
      const active = now === i;
      return (
        <div key={s.key} style={{
          display: "flex", alignItems: "center", gap: "0.75rem",
          padding: "0.6rem 0.75rem", marginBottom: "0.5rem", borderRadius: 8,
          background: done ? "#064e3b" : active ? "#1e3a5f" : "#1f2937",
          border: `1px solid ${done ? "#10b981" : active ? "#3b82f6" : "#374151"}`,
          opacity: done || active ? 1 : 0.45, transition: "all 0.3s ease",
        }}>
          <div style={{ fontSize: "1.1rem", minWidth: 24 }}>{done ? "✓" : s.icon}</div>
          <div style={{ flex: 1, fontSize: "0.83rem", fontWeight: done || active ? 600 : 400,
            color: done ? "#4ade80" : active ? "#93c5fd" : "#6b7280" }}>
            {progress?.stage && active ? progress.stage : s.label}
          </div>
          {active && <div style={{ fontSize: "0.7rem", color: "#60a5fa" }}>●●●</div>}
          {done && <div style={{ fontSize: "0.75rem", color: "#4ade80", fontWeight: 700 }}>Done</div>}
        </div>
      );
    })}
  </div>
)}
        {/* Server rejection */}
        {serverResult && !serverResult.success && (
          <div className={styles.serverErr}>
            <AlertTriangle size={16} />
            <div>
              <strong>The server rejected this import.</strong>
              {serverResult.serverRejectedClientValidated && (
                <p className={styles.mismatch}>
                  This should not happen — the browser and server ran the same
                  rules. Reload the page; the import format was probably updated
                  mid-session.
                </p>
              )}
              <ul>
                {(serverResult.errors || [serverResult.error || "Unknown error"])
                  .slice(0, 12)
                  .map((e, i) => (
                    <li key={i}>{typeof e === "string" ? e : e.label}</li>
                  ))}
              </ul>
            </div>
          </div>
        )}

        {/* Success */}
       {serverResult?.success && (
  <div style={{ padding: "0.5rem" }}>
    <div style={{ background: "#064e3b", borderRadius: 8, padding: "1.25rem", marginBottom: "1rem" }}>
      <div style={{ color: "#4ade80", fontWeight: 700, fontSize: "1rem", marginBottom: "0.75rem" }}>
        ✅ Import Successful
      </div>
      <div style={{ fontSize: "0.85rem", color: "#a7f3d0", lineHeight: 1.8 }}>
        <div><strong>Society:</strong> {serverResult.society?.name} ({serverResult.society?.societyId})</div>
        <div><strong>Members imported:</strong> {serverResult.membersCreated} / {serverResult.totalMemberRows}</div>
        <div>
          <strong>Billing heads:</strong>{" "}
          {serverResult.billingHeadsCreated > 0
            ? `${serverResult.billingHeadsCreated} heads created`
            : <span style={{ color: "#fbbf24" }}>⚠ None — rates were 0</span>}
        </div>
        <div>
          <strong>Bills generated:</strong>{" "}
          {serverResult.billsGenerated > 0
            ? `${serverResult.billsGenerated} bills for ${serverResult.billPeriod}`
            : <span style={{ color: "#fbbf24" }}>⚠ 0</span>}
        </div>
        {serverResult.society?.chargesSummary?.length > 0 && (
          <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: "2px solid #10b981" }}>
            {serverResult.society.chargesSummary.map((c, i) => (
              <div key={i} style={{ fontSize: "0.75rem", color: "#6ee7b7" }}>{c}</div>
            ))}
          </div>
        )}
      </div>
    </div>

    <div style={{ background: "#1e1b4b", borderRadius: 8, padding: "1.25rem", marginBottom: "1rem" }}>
      <div style={{ color: "#a5b4fc", fontWeight: 700, marginBottom: "0.5rem" }}>Admin Credentials</div>
      <div style={{ fontSize: "0.85rem", color: "#c7d2fe", lineHeight: 1.8 }}>
        <div><strong>Name:</strong> {serverResult.admin?.name}</div>
        <div><strong>Email:</strong> {serverResult.admin?.email}</div>
        <div>
          <strong>Password:</strong>{" "}
          <code style={{ background: "#312e81", padding: "2px 6px", borderRadius: 4 }}>
            {serverResult.admin?.password}
          </code>
        </div>
      </div>
    </div>

    {serverResult.memberCredentials?.length > 0 && (
      <div style={{ background: "#1e1b4b", borderRadius: 8, padding: "1.25rem", marginBottom: "1rem" }}>
        <div style={{ color: "#a5b4fc", fontWeight: 700, marginBottom: "0.5rem" }}>
          Members ({serverResult.memberCredentials.length})
        </div>
        <div style={{ overflowX: "auto", maxHeight: 320 }}>
          <table style={{ width: "100%", fontSize: "0.8rem", color: "#c7d2fe", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#a5b4fc" }}>
                <th style={{ padding: "4px 8px" }}>Flat</th>
                <th style={{ padding: "4px 8px" }}>Name</th>
                <th style={{ padding: "4px 8px" }}>Email</th>
                <th style={{ padding: "4px 8px" }}>Account</th>
                <th style={{ padding: "4px 8px" }}>Setup Link</th>
              </tr>
            </thead>
            <tbody>
              {serverResult.memberCredentials.map((c, i) => (
                <tr key={i} style={{ borderTop: "1px solid #312e81" }}>
                  <td style={{ padding: "4px 8px" }}>{c.wing}-{c.flatNo}</td>
                  <td style={{ padding: "4px 8px" }}>{c.ownerName}</td>
                  <td style={{ padding: "4px 8px" }}>{c.email || <span style={{ color: "#6b7280" }}>none</span>}</td>
                  <td style={{ padding: "4px 8px" }}>
                    {c.isNewUser
                      ? <span style={{ color: "#4ade80" }}>new login created</span>
                      : <span style={{ color: "#fbbf24" }}>existing account linked</span>}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    {c.setCredentialsUrl ? (
                      <button
                        onClick={() => navigator.clipboard.writeText(c.setCredentialsUrl)}
                        style={{ background: "none", border: "none", color: "#a5b4fc", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: "0.78rem" }}
                      >Copy link</button>
                    ) : <span style={{ color: "#6b7280" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {serverResult.warnings?.length > 0 && (
      <div style={{ background: "#451a03", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ color: "#fbbf24", fontWeight: 600, marginBottom: "0.5rem" }}>
          ⚠ {serverResult.warnings.length} Warning{serverResult.warnings.length > 1 ? "s" : ""}
        </div>
        {serverResult.warnings.map((w, i) => (
          <div key={i} style={{ fontSize: "0.8rem", color: "#fde68a", marginBottom: 4 }}>• {w}</div>
        ))}
      </div>
    )}

    {serverResult.billErrors?.length > 0 && (
      <div style={{ background: "#1c1917", border: "1px solid #b45309", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ color: "#fbbf24", fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.85rem" }}>
          ⚠ {serverResult.billErrors.length} bill(s) failed to generate:
        </div>
        {serverResult.billErrors.map((e, i) => (
          <div key={i} style={{ fontSize: "0.78rem", color: "#fde68a" }}>• {e}</div>
        ))}
      </div>
    )}

    {serverResult.memberCreateErrors?.length > 0 && (
      <div style={{ background: "#450a0a", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ color: "#fca5a5", fontWeight: 600, marginBottom: "0.5rem" }}>
          {serverResult.memberCreateErrors.length} member(s) failed:
        </div>
        {serverResult.memberCreateErrors.map((e, i) => (
          <div key={i} style={{ fontSize: "0.8rem", color: "#fca5a5" }}>{e.flat}: {e.error}</div>
        ))}
      </div>
    )}

    {serverResult.onboardingEmailErrors?.length > 0 && (
      <div style={{ background: "#450a0a", border: "1px solid #ef4444", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ color: "#fca5a5", fontWeight: 700, marginBottom: "0.5rem" }}>
          ⚠ {serverResult.onboardingEmailErrors.length} onboarding email(s) failed to send
        </div>
        <div style={{ fontSize: "0.78rem", color: "#fca5a5", marginBottom: 8 }}>
          Everything was created, but these members won't get their link by mail — use the Copy link column or the export below.
        </div>
        {serverResult.onboardingEmailErrors.map((e, i) => (
          <div key={i} style={{ fontSize: "0.8rem", color: "#fca5a5" }}>• {e}</div>
        ))}
      </div>
    )}

    {serverResult.memberCredentials?.length > 0 && (
      <button
        onClick={async () => {
          const res = await fetch("/api/members/download-credentials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ credentials: serverResult.memberCredentials }),
          });
          if (!res.ok) return alert("Download failed");
          const url = URL.createObjectURL(await res.blob());
          const a = document.createElement("a");
          a.href = url;
          a.download = `Member_Credentials_${Date.now()}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        }}
        style={{ width: "100%", background: "#059669", color: "#fff", border: "none", padding: "0.75rem", borderRadius: 8, cursor: "pointer", fontWeight: 600, marginBottom: "0.75rem" }}
      >
        📥 Download Member Credentials ({serverResult.memberCredentials.length} members)
      </button>
    )}

    {BillHistoryStep && !showBillHistory && !billHistoryDone && (
      <div style={{ background: "#1e1b4b", border: "1px solid #4f46e5", borderRadius: 8, padding: "1rem", marginBottom: "0.75rem" }}>
        <div style={{ color: "#a5b4fc", fontWeight: 700, marginBottom: "0.4rem", fontSize: "0.9rem" }}>
          📜 Step 4: Import Bill History (Recommended)
        </div>
        <div style={{ color: "#9ca3af", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
          Historical bills from the previous April up to the month before {serverResult.society?.name} joined. Required for correct opening balances and audit reports.
        </div>
        <button
          onClick={() => setShowBillHistory(true)}
          style={{ background: "#4f46e5", color: "#fff", border: "none", padding: "0.55rem 1.25rem", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
        >Start Bill History Import →</button>
      </div>
    )}

    {BillHistoryStep && showBillHistory && !billHistoryDone && (
      <div style={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, padding: "1.25rem", marginBottom: "0.75rem" }}>
        <BillHistoryStep
          societyId={serverResult.society?.id}
          societyName={serverResult.society?.name || ""}
          joinPeriodId={serverResult.billPeriod || ""}
          interestRate={21}
          onComplete={() => setBillHistoryDone(true)}
          onSkip={() => { setShowBillHistory(false); setBillHistoryDone(true); }}
        />
      </div>
    )}

    {billHistoryDone && (
      <div style={{ background: "#064e3b22", border: "1px solid #10b981", borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem", color: "#4ade80", fontSize: "0.85rem", fontWeight: 600 }}>
        ✓ Bill History step complete
      </div>
    )}

    <button
      onClick={onClose}
      style={{ width: "100%", background: "#6366f1", color: "#fff", border: "none", padding: "0.75rem", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
    >Close</button>
  </div>
)}
      </div>
    </div>
  );
}
