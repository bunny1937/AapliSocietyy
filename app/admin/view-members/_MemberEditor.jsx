"use client";
// app/admin/view-members/_MemberEditor.jsx
//
// The editable half of the member drawer.
//
// View Members used to render every one of these fields as a read-only <div>:
// the data was fetched from the database, but there was no edit button, no
// save, no toggle and no delete anywhere in the screen. Correcting a misspelt
// owner name, adding a family member, recording a new parking slot or marking
// a flat inactive all required a database edit.
//
// Each section saves on its own, with its own busy state and its own error, so
// a failure in one never loses what was typed in another. Server messages
// (including field-level `issues[]`) are shown verbatim — never replaced with
// a generic "something went wrong".

import { useEffect, useMemo, useState } from "react";
import view from "@/styles/ViewMembers.module.css";
import f from "@/styles/MemberEditor.module.css";

const PARKING_TYPES = ["Stilt", "Open", "Covered"];
const VEHICLE_TYPES = ["Two-Wheeler", "Four-Wheeler"];
const OWNERSHIP_TYPES = ["Owner-Occupied", "Rented", "Vacant", "Under-Dispute"];
const MEMBERSHIP_STATUSES = ["Active", "Inactive", "Suspended", "Blocked", "Exited"];

const dash = "—";

async function callApi(url, options) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(body?.error || `That request failed (${res.status}).`);
    err.code = body?.code;
    err.issues = body?.issues;
    err.hint = body?.hint;
    throw err;
  }
  return body;
}

/** Renders a server error exactly as the server described it. */
function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div className={`${f.banner} ${f.bannerError}`} role="alert">
      <div>{error.message}</div>
      {error.hint && <div style={{ marginTop: 4 }}>{error.hint}</div>}
      {Array.isArray(error.issues) && error.issues.length > 0 && (
        <ul className={f.issueList}>
          {error.issues.map((i, idx) => (
            <li key={`${i.field}-${idx}`}>
              <b>{i.field}</b>: {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OkBanner({ text }) {
  if (!text) return null;
  return (
    <div className={`${f.banner} ${f.bannerOk}`} role="status">
      {text}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className={view.field}>
      <label className={f.label}>{label}</label>
      {children}
      {hint && <div className={f.hint}>{hint}</div>}
    </div>
  );
}

function Confirm({ open, title, body, confirmLabel, danger, busy, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className={f.confirmOverlay} onClick={busy ? undefined : onCancel}>
      <div className={f.confirmBox} onClick={(e) => e.stopPropagation()}>
        <h4 className={f.confirmTitle}>{title}</h4>
        <div className={f.confirmBody}>{body}</div>
        <div className={f.confirmActions}>
          <button className={f.btn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`${f.btn} ${danger ? f.btnDanger : f.btnPrimary}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Flat + owner details
   ══════════════════════════════════════════════════════════════════════════ */
function DetailsSection({ member, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  // Reseed whenever a different flat is opened, so the drawer never shows one
  // flat's details over another's.
  useEffect(() => {
    setEditing(false);
    setDraft({});
    setError(null);
    setOk(null);
  }, [member._id]);

  const start = () => {
    setDraft({
      flatNo: member.flatNo ?? "",
      wing: member.wing ?? "",
      floor: member.floor ?? "",
      flatType: member.flatType ?? "",
      carpetAreaSqft: member.carpetAreaSqft ?? "",
      builtUpAreaSqft: member.builtUpAreaSqft ?? "",
      ownershipType: member.ownershipType ?? "Owner-Occupied",
      ownerName: member.ownerName ?? "",
      contactNumber: member.contactNumber ?? "",
      alternateContact: member.alternateContact ?? "",
      whatsappNumber: member.whatsappNumber ?? "",
      emailPrimary: member.emailPrimary ?? "",
      emailSecondary: member.emailSecondary ?? "",
      panCard: member.panCard ?? "",
      internalNotes: member.internalNotes ?? "",
    });
    setError(null);
    setOk(null);
    setEditing(true);
  };

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      // Only send what actually changed: a partial update keeps the audit log
      // readable and cannot clobber a field this form does not show.
      const payload = { memberId: member._id };
      for (const [k, v] of Object.entries(draft)) {
        const current = member[k] ?? "";
        if (String(v ?? "") === String(current)) continue;
        if (["floor", "carpetAreaSqft", "builtUpAreaSqft"].includes(k)) {
          payload[k] = v === "" ? null : Number(v);
        } else {
          payload[k] = v === "" ? null : v;
        }
      }
      if (Object.keys(payload).length === 1) {
        setEditing(false);
        setBusy(false);
        setOk("Nothing had changed, so nothing was saved.");
        return;
      }
      const res = await callApi("/api/members/update", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setOk("Details saved.");
      setEditing(false);
      onSaved(res?.member ?? null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const ro = (value, suffix = "") => (
    <div className={`${f.readonly} ${value === undefined || value === null || value === "" ? f.muted : ""}`}>
      {value === undefined || value === null || value === "" ? dash : `${value}${suffix}`}
    </div>
  );

  return (
    <>
      <section className={view.section}>
        <div className={f.sectionBar}>
          <h3 className={view.sectionTitle} style={{ margin: 0 }}>
            🏢 Flat &amp; owner details
          </h3>
          <div className={f.sectionActions}>
            {editing ? (
              <>
                <button className={f.btn} onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </button>
                <button className={`${f.btn} ${f.btnPrimary}`} onClick={save} disabled={busy}>
                  {busy ? "Saving..." : "Save details"}
                </button>
              </>
            ) : (
              <button className={f.btn} onClick={start}>
                Edit details
              </button>
            )}
          </div>
        </div>

        <ErrorBanner error={error} />
        <OkBanner text={ok} />

        <div className={view.grid}>
          <Field label="Flat number">
            {editing ? (
              <input className={f.input} value={draft.flatNo} onChange={(e) => set("flatNo", e.target.value)} />
            ) : (
              ro(member.flatNo)
            )}
          </Field>
          <Field label="Wing">
            {editing ? (
              <input className={f.input} value={draft.wing} onChange={(e) => set("wing", e.target.value)} />
            ) : (
              ro(member.wing)
            )}
          </Field>
          <Field label="Floor">
            {editing ? (
              <input
                className={f.input}
                type="number"
                value={draft.floor}
                onChange={(e) => set("floor", e.target.value)}
              />
            ) : (
              ro(member.floor)
            )}
          </Field>
          <Field label="Flat type">
            {editing ? (
              <input
                className={f.input}
                value={draft.flatType}
                onChange={(e) => set("flatType", e.target.value)}
              />
            ) : (
              ro(member.flatType)
            )}
          </Field>
          <Field
            label="Carpet area (sq ft)"
            hint={editing ? "Maintenance is billed on this figure." : undefined}
          >
            {editing ? (
              <input
                className={f.input}
                type="number"
                step="0.01"
                value={draft.carpetAreaSqft}
                onChange={(e) => set("carpetAreaSqft", e.target.value)}
              />
            ) : (
              ro(member.carpetAreaSqft, " sq.ft")
            )}
          </Field>
          <Field label="Built-up area (sq ft)">
            {editing ? (
              <input
                className={f.input}
                type="number"
                step="0.01"
                value={draft.builtUpAreaSqft}
                onChange={(e) => set("builtUpAreaSqft", e.target.value)}
              />
            ) : (
              ro(member.builtUpAreaSqft, " sq.ft")
            )}
          </Field>
          <Field label="Ownership type">
            {editing ? (
              <select
                className={f.select}
                value={draft.ownershipType}
                onChange={(e) => set("ownershipType", e.target.value)}
              >
                {OWNERSHIP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <div className={f.readonly}>
                <span className={view.badge}>{member.ownershipType || dash}</span>
              </div>
            )}
          </Field>
          <Field label="Possession date">
            {ro(
              member.possessionDate ? new Date(member.possessionDate).toLocaleDateString("en-IN") : "",
            )}
          </Field>

          <Field label="Owner name">
            {editing ? (
              <input
                className={f.input}
                value={draft.ownerName}
                onChange={(e) => set("ownerName", e.target.value)}
              />
            ) : (
              ro(member.ownerName)
            )}
          </Field>
          <Field label="Contact number">
            {editing ? (
              <input
                className={f.input}
                value={draft.contactNumber}
                onChange={(e) => set("contactNumber", e.target.value)}
              />
            ) : (
              ro(member.contactNumber)
            )}
          </Field>
          <Field label="Alternate contact">
            {editing ? (
              <input
                className={f.input}
                value={draft.alternateContact}
                onChange={(e) => set("alternateContact", e.target.value)}
              />
            ) : (
              ro(member.alternateContact)
            )}
          </Field>
          <Field label="WhatsApp">
            {editing ? (
              <input
                className={f.input}
                value={draft.whatsappNumber}
                onChange={(e) => set("whatsappNumber", e.target.value)}
              />
            ) : (
              ro(member.whatsappNumber)
            )}
          </Field>
          <Field label="Primary email">
            {editing ? (
              <input
                className={f.input}
                value={draft.emailPrimary}
                onChange={(e) => set("emailPrimary", e.target.value)}
              />
            ) : (
              ro(member.emailPrimary)
            )}
          </Field>
          <Field label="Secondary email">
            {editing ? (
              <input
                className={f.input}
                value={draft.emailSecondary}
                onChange={(e) => set("emailSecondary", e.target.value)}
              />
            ) : (
              ro(member.emailSecondary)
            )}
          </Field>
          <Field label="PAN card">
            {editing ? (
              <input
                className={f.input}
                value={draft.panCard}
                onChange={(e) => set("panCard", e.target.value.toUpperCase())}
              />
            ) : (
              ro(member.panCard)
            )}
          </Field>
          {/* D1: Aadhaar is no longer collected. The field stays visible ONLY
              where a value already exists, masked, so an admin can see that
              legacy data is there and that it is on its way out — hiding it
              would leave people believing it was already gone. There is no
              input: nothing new can be entered. */}
          {member.aadhaar ? (
            <Field label="Aadhaar" hint="No longer collected. This legacy value will be cleared.">
              {ro(`XXXX XXXX ${String(member.aadhaar).slice(-4)}`)}
            </Field>
          ) : null}
        </div>

        <div style={{ marginTop: "0.8rem" }}>
          <Field label="Internal notes" hint="Admin-only. The resident never sees this.">
            {editing ? (
              <textarea
                className={f.textarea}
                value={draft.internalNotes}
                onChange={(e) => set("internalNotes", e.target.value)}
              />
            ) : (
              ro(member.internalNotes)
            )}
          </Field>
        </div>
      </section>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Family members
   ══════════════════════════════════════════════════════════════════════════ */
function FamilySection({ member, onSaved }) {
  const [rows, setRows] = useState(member.familyMembers ?? []);
  const [editingId, setEditingId] = useState(null); // subdoc _id, or "NEW"
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [confirmRow, setConfirmRow] = useState(null);

  useEffect(() => {
    setRows(member.familyMembers ?? []);
    setEditingId(null);
    setError(null);
    setOk(null);
  }, [member._id, member.familyMembers]);

  const startAdd = () => {
    setDraft({ name: "", relation: "", age: "", contactNumber: "", occupation: "" });
    setEditingId("NEW");
    setError(null);
    setOk(null);
  };
  const startEdit = (row) => {
    setDraft({
      name: row.name ?? "",
      relation: row.relation ?? "",
      age: row.age ?? "",
      contactNumber: row.contactNumber ?? "",
      occupation: row.occupation ?? "",
    });
    setEditingId(String(row._id));
    setError(null);
    setOk(null);
  };

  const send = async (action, extra = {}) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await callApi(`/api/members/${member._id}/family`, {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      setRows(res.familyMembers ?? []);
      setOk(res.message);
      setEditingId(null);
      setConfirmRow(null);
      onSaved({ familyMembers: res.familyMembers ?? [] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const payload = {
      name: draft.name,
      relation: draft.relation || null,
      age: draft.age === "" ? null : Number(draft.age),
      contactNumber: draft.contactNumber || null,
      occupation: draft.occupation || null,
    };
    if (editingId === "NEW") send("Add", { payload });
    else send("Edit", { familyMemberId: editingId, payload });
  };

  const editor = (
    <div className={f.rowCard}>
      <div className={f.rowGrid}>
        <div>
          <label className={f.label}>Name</label>
          <input
            className={f.input}
            value={draft.name ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Full name"
          />
        </div>
        <div>
          <label className={f.label}>Relation</label>
          <input
            className={f.input}
            value={draft.relation ?? ""}
            onChange={(e) => setDraft({ ...draft, relation: e.target.value })}
            placeholder="Spouse, Son, Parent..."
          />
        </div>
        <div>
          <label className={f.label}>Age</label>
          <input
            className={f.input}
            type="number"
            min="0"
            max="120"
            value={draft.age ?? ""}
            onChange={(e) => setDraft({ ...draft, age: e.target.value })}
          />
        </div>
        <div>
          <label className={f.label}>Contact</label>
          <input
            className={f.input}
            value={draft.contactNumber ?? ""}
            onChange={(e) => setDraft({ ...draft, contactNumber: e.target.value })}
          />
        </div>
        <div>
          <label className={f.label}>Occupation</label>
          <input
            className={f.input}
            value={draft.occupation ?? ""}
            onChange={(e) => setDraft({ ...draft, occupation: e.target.value })}
          />
        </div>
      </div>
      <div className={f.rowActions}>
        <button className={f.btn} onClick={() => setEditingId(null)} disabled={busy}>
          Cancel
        </button>
        <button
          className={`${f.btn} ${f.btnPrimary}`}
          onClick={submit}
          disabled={busy || !String(draft.name || "").trim()}
        >
          {busy ? "Saving..." : editingId === "NEW" ? "Add family member" : "Save changes"}
        </button>
      </div>
    </div>
  );

  return (
    <section className={view.section}>
      <div className={f.sectionBar}>
        <h3 className={view.sectionTitle} style={{ margin: 0 }}>
          👨‍👩‍👧‍👦 Family members ({rows.length})
        </h3>
        <div className={f.sectionActions}>
          <button className={f.btn} onClick={startAdd} disabled={editingId !== null}>
            + Add family member
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />
      <OkBanner text={ok} />

      {editingId === "NEW" && editor}

      {rows.length === 0 && editingId !== "NEW" && (
        <div className={f.empty}>
          No family members recorded for this flat yet.
          <br />
          Add them here so their names appear on visitor passes and amenity cards.
        </div>
      )}

      {rows.map((row) =>
        editingId === String(row._id) ? (
          <div key={String(row._id)}>{editor}</div>
        ) : (
          <div key={String(row._id)} className={f.rowCard}>
            <div>
              <strong>{row.name}</strong>
              <div className={f.rowMeta}>
                {[row.relation, row.age ? `${row.age} years` : null, row.occupation, row.contactNumber]
                  .filter(Boolean)
                  .join(" · ") || "No other details recorded"}
              </div>
            </div>
            <div className={f.rowActions}>
              <button
                className={`${f.btn} ${f.btnTiny}`}
                onClick={() => startEdit(row)}
                disabled={editingId !== null || busy}
              >
                Edit
              </button>
              <button
                className={`${f.btn} ${f.btnTiny} ${f.btnDanger}`}
                onClick={() => setConfirmRow(row)}
                disabled={editingId !== null || busy}
              >
                Remove
              </button>
            </div>
          </div>
        ),
      )}

      <Confirm
        open={!!confirmRow}
        title="Remove this family member?"
        body={
          <>
            <b>{confirmRow?.name}</b> will be removed from {member.flatNo}. Any amenity card issued in
            their name stops working. This cannot be undone from here.
          </>
        }
        confirmLabel="Remove"
        danger
        busy={busy}
        onCancel={() => setConfirmRow(null)}
        onConfirm={() => send("Remove", { familyMemberId: String(confirmRow._id) })}
      />
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Parking slots — billable, so every change warns about the bill
   ══════════════════════════════════════════════════════════════════════════ */
function ParkingSection({ member, onSaved, billPeriodId }) {
  const [rows, setRows] = useState(member.parkingSlots ?? []);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [confirmRow, setConfirmRow] = useState(null);
  const [recalc, setRecalc] = useState(true);

  useEffect(() => {
    setRows(member.parkingSlots ?? []);
    setEditingId(null);
    setError(null);
    setOk(null);
  }, [member._id, member.parkingSlots]);

  const billed = useMemo(() => rows.filter((r) => r.type !== "Stilt").length, [rows]);

  const startAdd = () => {
    setDraft({ slotNumber: "", type: "Open", vehicleType: "Four-Wheeler" });
    setEditingId("NEW");
    setError(null);
    setOk(null);
  };
  const startEdit = (row) => {
    setDraft({
      slotNumber: row.slotNumber ?? "",
      type: row.type ?? "Open",
      vehicleType: row.vehicleType ?? "Four-Wheeler",
    });
    setEditingId(String(row._id));
    setError(null);
    setOk(null);
  };

  const send = async (action, extra = {}) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await callApi(`/api/members/${member._id}/parking`, {
        method: "POST",
        body: JSON.stringify({
          action,
          recalcBillPeriodId: recalc && billPeriodId ? billPeriodId : undefined,
          ...extra,
        }),
      });
      setRows(res.parkingSlots ?? []);
      setOk(
        [res.message, res.billRecalculated ? `The ${billPeriodId} bill was recalculated.` : res.recalcNote]
          .filter(Boolean)
          .join(" "),
      );
      setEditingId(null);
      setConfirmRow(null);
      onSaved({ parkingSlots: res.parkingSlots ?? [] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (editingId === "NEW") {
      send("Add", {
        payload: {
          slotNumber: draft.slotNumber,
          type: draft.type,
          vehicleType: draft.vehicleType,
        },
      });
    } else {
      send("Edit", {
        slotId: editingId,
        payload: {
          slotNumber: draft.slotNumber,
          type: draft.type,
          vehicleType: draft.vehicleType,
        },
      });
    }
  };

  const editor = (
    <div className={f.rowCard}>
      <div className={f.rowGrid}>
        <div>
          <label className={f.label}>Slot number</label>
          <input
            className={f.input}
            value={draft.slotNumber ?? ""}
            onChange={(e) => setDraft({ ...draft, slotNumber: e.target.value })}
            placeholder="P-12"
          />
        </div>
        <div>
          <label className={f.label}>Type</label>
          <select
            className={f.select}
            value={draft.type ?? "Open"}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          >
            {PARKING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={f.label}>Vehicle</label>
          <select
            className={f.select}
            value={draft.vehicleType ?? "Four-Wheeler"}
            onChange={(e) => setDraft({ ...draft, vehicleType: e.target.value })}
          >
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={f.hint}>
        {draft.type === "Stilt"
          ? "Stilt slots are not billed monthly."
          : "This slot will be billed at the society's parking rate for its type and vehicle."}
      </div>
      <div className={f.rowActions}>
        <button className={f.btn} onClick={() => setEditingId(null)} disabled={busy}>
          Cancel
        </button>
        <button
          className={`${f.btn} ${f.btnPrimary}`}
          onClick={submit}
          disabled={busy || !String(draft.slotNumber || "").trim()}
        >
          {busy ? "Saving..." : editingId === "NEW" ? "Add slot" : "Save changes"}
        </button>
      </div>
    </div>
  );

  return (
    <section className={view.section}>
      <div className={f.sectionBar}>
        <h3 className={view.sectionTitle} style={{ margin: 0 }}>
          🚗 Parking slots ({rows.length}
          {rows.length > 0 ? `, ${billed} billed` : ""})
        </h3>
        <div className={f.sectionActions}>
          <button className={f.btn} onClick={startAdd} disabled={editingId !== null}>
            + Add slot
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />
      <OkBanner text={ok} />

      {billPeriodId && (
        <label
          style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: "0.7rem" }}
        >
          <input
            type="checkbox"
            checked={recalc}
            onChange={(e) => setRecalc(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span className={f.hint} style={{ marginTop: 0 }}>
            Also recalculate this flat&apos;s <b>{billPeriodId}</b> bill. Leave ticked so the bill
            matches the parking on record. A bill that already has a payment against it is never
            touched — you will be told if that happens.
          </span>
        </label>
      )}

      {editingId === "NEW" && editor}

      {rows.length === 0 && editingId !== "NEW" && (
        <div className={f.empty}>
          No parking slots recorded for this flat.
          <br />
          Nothing is being billed for parking until a slot is added here.
        </div>
      )}

      {rows.map((row) =>
        editingId === String(row._id) ? (
          <div key={String(row._id)}>{editor}</div>
        ) : (
          <div key={String(row._id)} className={f.rowCard}>
            <div>
              <strong>{row.slotNumber}</strong>
              <div className={f.rowMeta}>
                {row.type} · {row.vehicleType} ·{" "}
                {row.type === "Stilt" || row.monthlyBilling === false
                  ? "not billed monthly"
                  : "billed monthly"}
              </div>
            </div>
            <div className={f.rowActions}>
              <button
                className={`${f.btn} ${f.btnTiny}`}
                onClick={() => startEdit(row)}
                disabled={editingId !== null || busy}
              >
                Edit
              </button>
              <button
                className={`${f.btn} ${f.btnTiny} ${f.btnDanger}`}
                onClick={() => setConfirmRow(row)}
                disabled={editingId !== null || busy}
              >
                Remove
              </button>
            </div>
          </div>
        ),
      )}

      <Confirm
        open={!!confirmRow}
        title="Remove this parking slot?"
        body={
          <>
            Slot <b>{confirmRow?.slotNumber}</b> will be removed from {member.flatNo}.
            {confirmRow?.type !== "Stilt" && (
              <>
                {" "}
                It is currently billed monthly, so this flat&apos;s charges will go down
                {recalc && billPeriodId ? ` and the ${billPeriodId} bill will be recalculated` : ""}.
              </>
            )}
          </>
        }
        confirmLabel="Remove slot"
        danger
        busy={busy}
        onCancel={() => setConfirmRow(null)}
        onConfirm={() => send("Remove", { payload: { slotId: String(confirmRow._id) } })}
      />
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Flat status + login control
   ══════════════════════════════════════════════════════════════════════════ */
function StatusSection({ member, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [status, setStatus] = useState(member.membershipStatus || "Active");
  const [pauseDate, setPauseDate] = useState("");
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    setStatus(member.membershipStatus || "Active");
    setError(null);
    setOk(null);
  }, [member._id, member.membershipStatus]);

  const send = async (payload) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await callApi(`/api/members/${member._id}/status`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setOk(res.message);
      setConfirm(null);
      onSaved({
        isActive: res.member?.isActive,
        membershipStatus: res.member?.membershipStatus,
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const flatActive = member.isActive !== false && (member.membershipStatus || "Active") === "Active";

  return (
    <section className={view.section}>
      <h3 className={view.sectionTitle}>⚙️ Status &amp; access</h3>

      <ErrorBanner error={error} />
      <OkBanner text={ok} />

      <div className={f.switchRow}>
        <div className={f.switchText}>
          <div className={f.switchTitle}>Flat status</div>
          <div className={f.switchDesc}>
            {flatActive
              ? "This flat is active and will be included in every bill run."
              : `This flat is marked ${member.membershipStatus || "Inactive"} and is left out of bill runs. Its data and history are kept.`}
          </div>
        </div>
        <div className={f.switchControls}>
          <select
            className={f.select}
            style={{ width: "auto" }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={busy}
          >
            {MEMBERSHIP_STATUSES.map((sName) => (
              <option key={sName} value={sName}>
                {sName}
              </option>
            ))}
          </select>
          <button
            className={`${f.btn} ${f.btnPrimary}`}
            disabled={busy || status === (member.membershipStatus || "Active")}
            onClick={() =>
              setConfirm({
                title: `Mark this flat ${status}?`,
                body:
                  status === "Active"
                    ? `${member.flatNo} will be included in bill runs again from the next generation.`
                    : `${member.flatNo} will be left out of every bill run until you set it back to Active. Existing bills and history are untouched.`,
                confirmLabel: `Mark ${status}`,
                danger: status !== "Active",
                run: () => send({ membershipStatus: status }),
              })
            }
          >
            Apply
          </button>
        </div>
      </div>

      <div className={f.switchRow}>
        <div className={f.switchText}>
          <div className={f.switchTitle}>Resident login</div>
          <div className={f.switchDesc}>
            Switch this resident&apos;s app and web login on or off. If the same person also holds a
            flat in another society on this account, only this flat&apos;s access changes — the
            response will tell you which happened. Any open session ends immediately.
          </div>
        </div>
        <div className={f.switchControls}>
          <button
            className={f.btn}
            disabled={busy}
            onClick={() =>
              setConfirm({
                title: "Switch this login back on?",
                body: "The resident will be able to sign in again straight away.",
                confirmLabel: "Switch on",
                run: () => send({ login: "enable" }),
              })
            }
          >
            Enable
          </button>
          <button
            className={`${f.btn} ${f.btnDanger}`}
            disabled={busy}
            onClick={() =>
              setConfirm({
                title: "Switch this login off?",
                body: `${member.ownerName} will be signed out immediately and cannot sign in again until you switch it back on. Their bills and data are untouched.`,
                confirmLabel: "Switch off",
                danger: true,
                run: () => send({ login: "disable" }),
              })
            }
          >
            Disable
          </button>
        </div>
      </div>

      <div className={f.switchRow}>
        <div className={f.switchText}>
          <div className={f.switchTitle}>Pause login until a date</div>
          <div className={f.switchDesc}>
            A temporary hold that lifts on its own, so nobody has to remember to switch the login
            back on.
          </div>
        </div>
        <div className={f.switchControls}>
          <input
            type="date"
            className={f.input}
            style={{ width: "auto" }}
            value={pauseDate}
            onChange={(e) => setPauseDate(e.target.value)}
            disabled={busy}
          />
          <button
            className={f.btn}
            disabled={busy || !pauseDate}
            onClick={() =>
              setConfirm({
                title: "Pause this login?",
                body: `${member.ownerName} will be signed out now and cannot sign in until ${pauseDate}. It lifts by itself on that date.`,
                confirmLabel: "Pause login",
                danger: true,
                run: () => send({ login: "pause", pausedUntil: pauseDate }),
              })
            }
          >
            Pause
          </button>
        </div>
      </div>

      <Confirm
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm?.run?.()}
      />
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function MemberEditor({ member, onPatch, billPeriodId }) {
  return (
    <>
      <StatusSection member={member} onSaved={onPatch} />
      <DetailsSection member={member} onSaved={(m) => onPatch(m || {})} />
      <FamilySection member={member} onSaved={onPatch} />
      <ParkingSection member={member} onSaved={onPatch} billPeriodId={billPeriodId} />
    </>
  );
}
