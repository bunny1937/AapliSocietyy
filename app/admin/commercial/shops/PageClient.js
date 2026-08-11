"use client";

// app/admin/commercial/shops/page.js
//
// NEW 2026-08-07. The one place a shop or office exists.
//
// THIS SCREEN REPLACES "classify a unit as commercial".
//
// The old flow asked you to pick a flat and change its "Flat Type" to Shop.
// That wrote flatType onto the MEMBER record, which meant the flat stopped
// being a flat. A-103 was a home; after one click it was a shop, its residential
// bill kept running off the same carpet area, its Rs 1,335 arrears got claimed
// by both series, and the original flat type was gone with no way to recover it.
//
// A shop is now its own record with its own area, its own opening balance and
// its own bill series. Linking it to an owner stores a reference on the SHOP.
// Nothing on this screen ever writes to a flat. You can delete a shop and the
// flat is exactly as it was.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardHead, Pill, Segmented, Table, Btn, StatTile } from "../_ui";

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "BILLABLE", label: "In billing" },
  { value: "NEEDS_ATTENTION", label: "Needs attention" },
  { value: "INACTIVE", label: "Not billed" },
];

const UNIT_KINDS = ["Shop", "Office"];
const AREA_BASIS = ["Carpet", "Built-up", "Super built-up", "Agreed/Other"];
const OCCUPANCY = ["Owner-Occupied", "Rented out", "Vacant"];
const ELECTRICITY = ["Own connection", "Society-managed sub-meter"];

const inputStyle = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: 7,
  border: "1px solid var(--cx-border)",
  background: "var(--cx-surface)",
  color: "var(--cx-fg-1)",
  fontSize: 13,
  fontFamily: "inherit",
};

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--cx-fg-3)",
  marginBottom: 4,
};

const help = { fontSize: 11, color: "var(--cx-fg-4)", marginTop: 3, lineHeight: 1.45 };

const sectionTitle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.6px",
  textTransform: "uppercase",
  color: "var(--cx-fg-4)",
  margin: "18px 0 10px",
};

const grid = (cols = 2) => ({
  display: "grid",
  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
  gap: 12,
});

function Field({ label, hint, children, span }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={help}>{hint}</div>}
    </div>
  );
}

const EMPTY_FORM = {
  shopNo: "",
  wing: "",
  floor: 0,
  unitKind: "Shop",
  ownerMemberId: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  areaSqft: "",
  areaBasisNote: "Carpet",
  occupancyType: "Owner-Occupied",
  tenantName: "",
  tenantPhone: "",
  tradeName: "",
  categoryId: "",
  gstin: "",
  shopActNumber: "",
  fssaiNumber: "",
  electricityMode: "Own connection",
  electricityMeterNo: "",
  waterConnectionNo: "",
  shutterCount: 1,
  hasSignage: false,
  signageSizeSqft: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  openingPrincipal: 0,
  openingInterest: 0,
  isBillable: true,
  isActive: true,
};

export default function CommercialShopsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null); // shop id, or "NEW"
  const [form, setForm] = useState(EMPTY_FORM);
  const [banner, setBanner] = useState(null); // { tone, title, detail }

  const shopsQuery = useQuery({
    queryKey: ["commercial-shops", search],
    queryFn: () =>
      apiClient.get(
        `/api/commercial/shops?inactive=1${search ? `&q=${encodeURIComponent(search)}` : ""}`,
      ),
  });

  const membersQuery = useQuery({
    queryKey: ["members-list", "shop-owner-picker"],
    queryFn: () => apiClient.get("/api/members/list?limit=500"),
  });

  const categoriesQuery = useQuery({
    queryKey: ["commercial-categories"],
    queryFn: () => apiClient.get("/api/commercial/categories"),
  });

  const shops = shopsQuery.data?.shops ?? [];
  const members = membersQuery.data?.members ?? [];
  const categories = (categoriesQuery.data?.categories ?? []).filter(
    (c) => c.isActive !== false,
  );

  const settingsQuery = useQuery({
    queryKey: ["commercial-settings"],
    queryFn: () => apiClient.get("/api/commercial/settings"),
  });
  const settings = settingsQuery.data?.settings ?? null;
  const tradeRequired = settings?.requireBusinessProfileBeforeBilling === true;

  // A shop needs attention when it cannot produce a correct bill.
  const problemsFor = (s) => {
    const out = [];
    if (!(Number(s.areaSqft) > 0))
      out.push("No area recorded, so every per-sq-ft charge would be Rs 0.");
    if (tradeRequired && !s.hasTradeDetails)
      out.push("Business name and category are required by this society before billing.");
    if (s.occupancyType === "Rented out" && !s.tenantName)
      out.push("Marked as rented out but no tenant name is recorded.");
    if (s.electricityMode === "Society-managed sub-meter" && !settings?.electricity?.societyManagedEnabled)
      out.push("Set to a society sub-meter, but that feature is switched off on the Rate Card.");
    return out;
  };

  const decorated = useMemo(
    () => shops.map((s) => ({ ...s, problems: problemsFor(s) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shops, tradeRequired, settings],
  );

  const counts = useMemo(
    () => ({
      all: decorated.length,
      billable: decorated.filter((s) => s.isBillable && s.isActive).length,
      problems: decorated.filter((s) => s.problems.length > 0).length,
      inactive: decorated.filter((s) => !s.isBillable || !s.isActive).length,
    }),
    [decorated],
  );

  const visible = useMemo(() => {
    if (filter === "BILLABLE") return decorated.filter((s) => s.isBillable && s.isActive);
    if (filter === "NEEDS_ATTENTION") return decorated.filter((s) => s.problems.length > 0);
    if (filter === "INACTIVE") return decorated.filter((s) => !s.isBillable || !s.isActive);
    return decorated;
  }, [decorated, filter]);

  // Members already used as a shop owner are still selectable — one person can
  // own several shops. We only show their flat for recognition.
  const memberOptions = useMemo(
    () =>
      members
        .filter((m) => !m.isDeleted)
        .map((m) => ({
          id: String(m.memberId ?? m._id ?? m.id ?? ""),
          label: `${m.wing || ""}-${m.flatNo || "?"} \u00b7 ${m.ownerName || "Unnamed"}`,
          ownerName: m.ownerName || "",
          phone: m.contactNumber || "",
          email: m.emailPrimary || "",
        }))
        .filter((m) => m.id),
    [members],
  );

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_FORM);
    setOpenId("NEW");
    setBanner(null);
  };

  const openExisting = (s) => {
    setForm({
      ...EMPTY_FORM,
      ...s,
      ownerMemberId: s.ownerMemberId || "",
      categoryId: s.categoryId || "",
      areaSqft: s.areaSqft ?? "",
      signageSizeSqft: s.signageSizeSqft ?? "",
    });
    setOpenId(s.id);
    setBanner(null);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["commercial-shops"] });
    qc.invalidateQueries({ queryKey: ["commercial-readiness"] });
  };

  // Errors from the API carry `issues[]` and a `hint`. Both are written for a
  // non-technical admin, so we render them verbatim rather than inventing text.
  const showError = (err) => {
    const body = err?.body ?? err?.data ?? {};
    setBanner({
      tone: "danger",
      title: body.error || err?.message || "That could not be saved.",
      detail: body.hint || null,
      issues: body.issues || null,
    });
  };

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      openId === "NEW"
        ? apiClient.post("/api/commercial/shops", payload)
        : apiClient.patch(`/api/commercial/shops/${openId}`, payload),
    onSuccess: (res) => {
      invalidate();
      setOpenId(null);
      setBanner({
        tone: "success",
        title:
          res?.nextStep ||
          "Saved. This shop will appear in the next commercial bill run.",
      });
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => apiClient.delete(`/api/commercial/shops/${id}`),
    onSuccess: (res) => {
      invalidate();
      setOpenId(null);
      setBanner({
        tone: "success",
        title: res?.nextStep || "Shop removed. The linked flat was not changed.",
      });
    },
    onError: showError,
  });

  const submit = (e) => {
    e.preventDefault();
    setBanner(null);

    // Client-side checks mirror the server exactly, so the admin gets the same
    // sentence either way and never sees a raw validation dump.
    const issues = [];
    if (!String(form.shopNo).trim())
      issues.push({ field: "shopNo", message: "Shop number is required, for example 103 or S-4." });
    if (!(Number(form.areaSqft) > 0))
      issues.push({
        field: "areaSqft",
        message:
          "Area is required. Per-sq-ft charges multiply by this number, so a blank area silently produces a Rs 0 bill.",
      });
    if (!form.ownerMemberId && !String(form.ownerName).trim())
      issues.push({
        field: "ownerName",
        message:
          "Pick the owner from the member list, or type a name if the owner is not a society member.",
      });
    if (form.occupancyType === "Rented out" && !String(form.tenantName).trim())
      issues.push({
        field: "tenantName",
        message: "Tenant name is required when a shop is rented out.",
      });

    if (issues.length) {
      setBanner({
        tone: "danger",
        title: "Please fix these before saving:",
        issues,
      });
      return;
    }

    const payload = {
      ...form,
      floor: Number(form.floor) || 0,
      areaSqft: Number(form.areaSqft),
      shutterCount: Number(form.shutterCount) || 0,
      signageSizeSqft: form.signageSizeSqft === "" ? null : Number(form.signageSizeSqft),
      openingPrincipal: Number(form.openingPrincipal) || 0,
      openingInterest: Number(form.openingInterest) || 0,
      ownerMemberId: form.ownerMemberId || null,
      categoryId: form.categoryId || null,
    };
    saveMutation.mutate(payload);
  };

  // ---- table -------------------------------------------------------------
  const cols = [
    { key: "unit", label: "Unit" },
    { key: "owner", label: "Owner" },
    { key: "area", label: "Area" },
    { key: "trade", label: "Business" },
    { key: "status", label: "Status" },
  ];

  const rows = visible.map((s) => ({
    key: s.id,
    cells: [
      <div key="unit">
        <div style={{ fontWeight: 600, color: "var(--cx-fg-1)" }}>
          {s.unitKind} {s.unitLabel}
        </div>
        <div style={{ fontSize: 11, color: "var(--cx-fg-4)" }}>floor {s.floor ?? 0}</div>
      </div>,
      <div key="owner">
        <div>{s.ownerName || "\u2014"}</div>
        {s.occupancyType === "Rented out" && (
          <div style={{ fontSize: 11, color: "var(--cx-fg-4)" }}>
            tenant: {s.tenantName || "not recorded"}
          </div>
        )}
      </div>,
      <div key="area">
        <div className="cx-num" style={{ fontWeight: 600 }}>
          {Number(s.areaSqft) > 0 ? `${s.areaSqft} sq ft` : "\u2014"}
        </div>
        <div style={{ fontSize: 11, color: "var(--cx-fg-4)" }}>{s.areaBasisNote}</div>
      </div>,
      s.tradeName || <span style={{ color: "var(--cx-fg-4)" }}>not set</span>,
      s.problems.length ? (
        <Pill tone="overdue">Needs attention</Pill>
      ) : !s.isBillable || !s.isActive ? (
        <Pill tone="neutral">Not billed</Pill>
      ) : (
        <Pill tone="active">In billing</Pill>
      ),
    ],
    expanded: s.problems.length ? (
      <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--cx-warning)" }}>
        {s.problems.map((p, i) => (
          <div key={i}>• {p}</div>
        ))}
      </div>
    ) : null,
  }));

  const emptyText = shopsQuery.error
    ? "The shop list could not be loaded. Refresh the page, and if it keeps failing your session may have expired."
    : search
      ? `No shop matches "${search}".`
      : "No shops or offices yet. Add your first one \u2014 this does not change any flat.";

  const editing = openId && openId !== "NEW" ? decorated.find((s) => s.id === openId) : null;

  return (
    // "commercial-scope" is not decoration -- _ui/tokens.css defines every
    // --cx-* variable under this exact class. Without it the whole page
    // renders with unresolved custom properties, which is the "no CSS" bug.
    <div
      className="commercial-scope cx-fade"
      style={{ padding: "1.75rem 2rem", maxWidth: 1180, margin: "0 auto" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--cx-fg-1)", margin: 0 }}>
            Shops &amp; Offices
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--cx-fg-3)", margin: "5px 0 0", maxWidth: 620 }}>
            Commercial units are separate records with their own area and their own
            bills. Adding one here never changes a flat, and removing one leaves the
            flat untouched.
          </p>
        </div>
        <Btn variant="primary" icon="plus" onClick={openNew}>
          Add shop or office
        </Btn>
      </div>

      <div style={{ ...grid(4), marginBottom: 16 }}>
        <StatTile icon="store" label="Total units" value={counts.all} />
        <StatTile icon="check" label="In billing" value={counts.billable} />
        <StatTile
          icon="alert"
          label="Needs attention"
          value={counts.problems}
          tone={counts.problems ? "danger" : undefined}
          hint={counts.problems ? "These would bill incorrectly" : "All good"}
        />
        <StatTile icon="pause" label="Not billed" value={counts.inactive} />
      </div>

      {banner && (
        <Card
          style={{
            marginBottom: 14,
            borderColor:
              banner.tone === "danger" ? "var(--cx-danger)" : "var(--cx-success)",
            background:
              banner.tone === "danger" ? "var(--cx-danger-soft)" : "var(--cx-success-soft)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: banner.tone === "danger" ? "var(--cx-danger)" : "var(--cx-success)",
            }}
          >
            {banner.title}
          </div>
          {banner.detail && <div style={{ ...help, marginTop: 5 }}>{banner.detail}</div>}
          {banner.issues && (
            <ul style={{ margin: "8px 0 0 16px", padding: 0, fontSize: 12, lineHeight: 1.6 }}>
              {banner.issues.map((i, idx) => (
                <li key={i.field || idx}>{i.message}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card padded={false}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 14px",
            borderBottom: "1px solid var(--cx-border)",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Segmented
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({
              ...f,
              count:
                f.value === "ALL"
                  ? counts.all
                  : f.value === "BILLABLE"
                    ? counts.billable
                    : f.value === "NEEDS_ATTENTION"
                      ? counts.problems
                      : counts.inactive,
            }))}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shop no, owner or business"
            style={{ ...inputStyle, width: 260 }}
          />
        </div>

        {shopsQuery.isLoading ? (
          <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--cx-fg-4)" }}>
            Loading shops…
          </div>
        ) : (
          <Table
            cols={cols}
            rows={rows}
            emptyText={emptyText}
            onRowClick={(r) => openExisting(visible.find((s) => s.id === r.key))}
          />
        )}
      </Card>

      {openId && (
        <Card style={{ marginTop: 16 }}>
          <CardHead
            title={openId === "NEW" ? "Add a shop or office" : `Edit ${editing?.unitKind || "shop"} ${editing?.unitLabel || ""}`}
            sub="Only three things are required: the shop number, the owner, and the area."
            right={
              <div style={{ display: "flex", gap: 8 }}>
                {openId !== "NEW" && (
                  <Btn
                    variant="danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove this shop? Its past bills are kept, and the linked flat is not changed.",
                        )
                      )
                        deleteMutation.mutate(openId);
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    Remove
                  </Btn>
                )}
                <Btn onClick={() => setOpenId(null)}>Cancel</Btn>
              </div>
            }
          />

          <form onSubmit={submit}>
            <div style={sectionTitle}>The unit</div>
            <div style={grid(4)}>
              <Field label="Shop number *" hint="As painted on the shutter.">
                <input
                  style={inputStyle}
                  value={form.shopNo}
                  onChange={(e) => set("shopNo", e.target.value)}
                  placeholder="103"
                />
              </Field>
              <Field label="Wing" hint="Leave blank if the society has no wings.">
                <input
                  style={inputStyle}
                  value={form.wing}
                  onChange={(e) => set("wing", e.target.value)}
                  placeholder="A"
                />
              </Field>
              <Field label="Floor">
                <input
                  type="number"
                  style={inputStyle}
                  value={form.floor}
                  onChange={(e) => set("floor", e.target.value)}
                />
              </Field>
              <Field label="Type">
                <select
                  style={inputStyle}
                  value={form.unitKind}
                  onChange={(e) => set("unitKind", e.target.value)}
                >
                  {UNIT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div style={sectionTitle}>Area used for billing</div>
            <div style={grid(3)}>
              <Field
                label="Area (sq ft) *"
                hint="This shop's own area. It is never taken from a flat."
              >
                <input
                  type="number"
                  step="0.01"
                  style={inputStyle}
                  value={form.areaSqft}
                  onChange={(e) => set("areaSqft", e.target.value)}
                  placeholder="300"
                />
              </Field>
              <Field label="What this figure is" hint="For your records. Does not change the maths.">
                <select
                  style={inputStyle}
                  value={form.areaBasisNote}
                  onChange={(e) => set("areaBasisNote", e.target.value)}
                >
                  {AREA_BASIS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="" hint="Bills already generated keep the area they were generated with, so correcting this never rewrites history.">
                <div style={{ height: 32 }} />
              </Field>
            </div>

            <div style={sectionTitle}>Owner</div>
            <div style={grid(3)}>
              <Field
                label="Society member"
                hint="Links the shop to an existing member. Their flat is not modified."
                span={1}
              >
                <select
                  style={inputStyle}
                  value={form.ownerMemberId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const m = memberOptions.find((x) => x.id === id);
                    setForm((f) => ({
                      ...f,
                      ownerMemberId: id,
                      ownerName: m?.ownerName || f.ownerName,
                      ownerPhone: m?.phone || f.ownerPhone,
                      ownerEmail: m?.email || f.ownerEmail,
                    }));
                  }}
                >
                  <option value="">Not a member / enter manually</option>
                  {memberOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Owner name *">
                <input
                  style={inputStyle}
                  value={form.ownerName}
                  onChange={(e) => set("ownerName", e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input
                  style={inputStyle}
                  value={form.ownerPhone}
                  onChange={(e) => set("ownerPhone", e.target.value)}
                />
              </Field>
            </div>

            <div style={sectionTitle}>Who occupies it</div>
            <div style={grid(3)}>
              <Field
                label="Occupancy"
                hint="Non-occupancy charge, if your society has it switched on, applies only to rented units."
              >
                <select
                  style={inputStyle}
                  value={form.occupancyType}
                  onChange={(e) => set("occupancyType", e.target.value)}
                >
                  {OCCUPANCY.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              {form.occupancyType === "Rented out" && (
                <>
                  <Field label="Tenant name *">
                    <input
                      style={inputStyle}
                      value={form.tenantName}
                      onChange={(e) => set("tenantName", e.target.value)}
                    />
                  </Field>
                  <Field label="Tenant phone">
                    <input
                      style={inputStyle}
                      value={form.tenantPhone}
                      onChange={(e) => set("tenantPhone", e.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>

            <div style={sectionTitle}>
              Business details{" "}
              <span style={{ textTransform: "none", fontWeight: 500, letterSpacing: 0 }}>
                {tradeRequired ? "(required by this society)" : "(optional)"}
              </span>
            </div>
            <div style={grid(3)}>
              <Field label="Business name">
                <input
                  style={inputStyle}
                  value={form.tradeName}
                  onChange={(e) => set("tradeName", e.target.value)}
                />
              </Field>
              <Field label="Category">
                <select
                  style={inputStyle}
                  value={form.categoryId}
                  onChange={(e) => set("categoryId", e.target.value)}
                >
                  <option value="">Not set</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="GSTIN" hint="Only if the shop is GST registered.">
                <input
                  style={inputStyle}
                  value={form.gstin}
                  onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Shop Act / Gumasta no.">
                <input
                  style={inputStyle}
                  value={form.shopActNumber}
                  onChange={(e) => set("shopActNumber", e.target.value)}
                />
              </Field>
              <Field label="FSSAI no." hint="Food businesses only.">
                <input
                  style={inputStyle}
                  value={form.fssaiNumber}
                  onChange={(e) => set("fssaiNumber", e.target.value)}
                />
              </Field>
            </div>

            <div style={sectionTitle}>Utilities &amp; premises</div>
            <div style={grid(3)}>
              <Field
                label="Electricity"
                hint="Most shops pay their own bill. Pick the sub-meter option only if the society recovers it."
              >
                <select
                  style={inputStyle}
                  value={form.electricityMode}
                  onChange={(e) => set("electricityMode", e.target.value)}
                >
                  {ELECTRICITY.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Meter number">
                <input
                  style={inputStyle}
                  value={form.electricityMeterNo}
                  onChange={(e) => set("electricityMeterNo", e.target.value)}
                />
              </Field>
              <Field label="Water connection no.">
                <input
                  style={inputStyle}
                  value={form.waterConnectionNo}
                  onChange={(e) => set("waterConnectionNo", e.target.value)}
                />
              </Field>
              <Field label="Shutters">
                <input
                  type="number"
                  style={inputStyle}
                  value={form.shutterCount}
                  onChange={(e) => set("shutterCount", e.target.value)}
                />
              </Field>
              <Field label="Signage board">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, height: 32 }}>
                  <input
                    type="checkbox"
                    checked={!!form.hasSignage}
                    onChange={(e) => set("hasSignage", e.target.checked)}
                  />
                  Has a signage board
                </label>
              </Field>
              {form.hasSignage && (
                <Field label="Signage size (sq ft)">
                  <input
                    type="number"
                    step="0.01"
                    style={inputStyle}
                    value={form.signageSizeSqft}
                    onChange={(e) => set("signageSizeSqft", e.target.value)}
                  />
                </Field>
              )}
            </div>

            <div style={sectionTitle}>Emergency contact</div>
            <div style={grid(2)}>
              <Field label="Name">
                <input
                  style={inputStyle}
                  value={form.emergencyContactName}
                  onChange={(e) => set("emergencyContactName", e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input
                  style={inputStyle}
                  value={form.emergencyContactPhone}
                  onChange={(e) => set("emergencyContactPhone", e.target.value)}
                />
              </Field>
            </div>

            <div style={sectionTitle}>Opening balance</div>
            <div style={grid(3)}>
              <Field
                label="Amount already due (Rs)"
                hint="What this SHOP owed before the system started. A flat's arrears are never carried here."
              >
                <input
                  type="number"
                  step="0.01"
                  style={inputStyle}
                  value={form.openingPrincipal}
                  onChange={(e) => set("openingPrincipal", e.target.value)}
                />
              </Field>
              <Field label="Interest already due (Rs)">
                <input
                  type="number"
                  step="0.01"
                  style={inputStyle}
                  value={form.openingInterest}
                  onChange={(e) => set("openingInterest", e.target.value)}
                />
              </Field>
              <Field label="Include in billing" hint="Switch off for a vacant unit you do not want billed.">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, height: 32 }}>
                  <input
                    type="checkbox"
                    checked={!!form.isBillable}
                    onChange={(e) => set("isBillable", e.target.checked)}
                  />
                  Generate bills for this unit
                </label>
              </Field>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <Btn variant="primary" type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving\u2026" : openId === "NEW" ? "Add shop" : "Save changes"}
              </Btn>
              <Btn onClick={() => setOpenId(null)}>Cancel</Btn>
            </div>
          </form>
        </Card>
      )}

      <div style={{ ...help, marginTop: 18 }}>
        Rates for these units are set once on the{" "}
        <Link href="/admin/commercial/rate-card" style={{ color: "var(--cx-brand)", fontWeight: 600 }}>
          Commercial Rate Card
        </Link>
        , and apply to every shop and office.
      </div>
    </div>
  );
}
