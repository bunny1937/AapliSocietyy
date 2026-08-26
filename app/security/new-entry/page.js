"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Avatar,
  StatusBadge,
  Spinner,
  Toast,
  EmptyState,
  PhotoCapture,
  tokens,
} from "@/components/visitor/ui";
import { VISITOR_PURPOSES } from "@/lib/visitor-config";
async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}
const PURPOSES = Array.isArray(VISITOR_PURPOSES)
  ? VISITOR_PURPOSES
  : ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"];
const S = {
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 360px) 1fr",
    gap: 16,
    alignItems: "start",
  },
  h3: { fontSize: 16, fontWeight: 700, color: tokens.text, margin: "0 0 12px" },
  flatListWrap: { marginTop: 12, maxHeight: 380, overflow: "auto" },
  center: { display: "flex", justifyContent: "center", padding: 24 },
  flatNo: { fontWeight: 700, color: tokens.text, fontSize: 14 },
  flatSub: { fontSize: 12, color: tokens.sub },
  banner: {
    background: "var(--accent-tint)",
    color: tokens.text,
    padding: "10px 12px",
    borderRadius: 10,
    fontSize: 13,
    marginBottom: 14,
  },
  strongBlue: { color: tokens.primary },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  full: { gridColumn: "1 / -1" },
  photoPrev: { display: "flex", alignItems: "center", gap: 12, marginTop: 14 },
  photoLbl: { fontSize: 13, color: tokens.sub },
  submitWrap: { marginTop: 18 },
  resultBox: {
    marginTop: 18,
    padding: 16,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--bg-sunken)",
  },
  resultHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  resultName: { fontSize: 15, color: tokens.text },
  resultMsg: { fontSize: 13, color: tokens.sub, marginTop: 8 },
  channels: { fontSize: 12, color: tokens.sub, marginTop: 8 },
  watch: { fontSize: 12, color: tokens.danger, marginTop: 8, fontWeight: 600 },
};
function flatRow(active) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 10,
    cursor: "pointer",
    border: active ? "1px solid " + tokens.primary : "1px solid transparent",
    background: active ? "var(--accent-tint)" : "transparent",
  };
}
export default function NewEntryPage() {
  const [q, setQ] = useState("");
  const [flats, setFlats] = useState([]);
  const [searching, setSearching] = useState(false);
  const [flat, setFlat] = useState(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    photo: "",
    purpose: "Guest",
    purposeNote: "",
    vehicleNumber: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState(null);
  const pollRef = useRef(null);
  const notify = (message, type = "info") => setToast({ message, type });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (!q || q.length < 1) {
      setFlats([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api("/api/security/flats/search?q=" + encodeURIComponent(q));
        setFlats((data && (data.flats || data.data)) || []);
      } catch (e) {
        notify(e.message, "error");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const pollStatus = useCallback((visitorId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await api("/api/visitor/list?scope=all&limit=20").catch(() => null);
        const list = (data && (data.visitors || data.data)) || [];
        const found = list.find((x) => (x._id || x.id) === visitorId);
        if (found) {
          setResult((r) => (r ? { ...r, status: found.status } : r));
          if (["Approved", "Rejected", "Entered", "Exited"].includes(found.status)) {
            clearInterval(pollRef.current);
          }
        }
      } catch (_) {}
    }, 5000);
  }, []);
  useEffect(() => () => clearInterval(pollRef.current), []);
  const submit = async (e) => {
    e.preventDefault();
    if (!flat) return notify("Select a flat first", "error");
    if (!form.name.trim()) return notify("Enter the visitor's name", "error");
    setSubmitting(true);
    try {
      const body = {
        memberId: flat._id || flat.id,
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        photo: form.photo.trim() || undefined,
        purpose: form.purpose,
        purposeNote: form.purposeNote.trim() || undefined,
        vehicleNumber: form.vehicleNumber.trim() || undefined,
      };
      const data = await api("/api/visitor/log", { method: "POST", body: JSON.stringify(body) });
      setResult({
        visitorId: data.visitorId,
        status: data.status || "Pending",
        delivery: data.delivery,
        watchlist: data.watchlist,
        name: body.name,
      });
      notify("Resident notified — awaiting approval", "success");
      if (data.visitorId) pollStatus(data.visitorId);
      setForm({ name: "", phone: "", photo: "", purpose: "Guest", purposeNote: "", vehicleNumber: "" });
    } catch (e2) {
      notify(e2.message || "Could not log visitor", "error");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div>
      <PageHeader title="New Visitor Entry" subtitle="Log a walk-in visitor and notify the resident" />
      <div style={S.layout}>
        <Card>
          <h3 style={S.h3}>1 &middot; Select flat</h3>
          <Input
            placeholder="Search flat no, wing or resident…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div style={S.flatListWrap}>
            {searching ? (
              <div style={S.center}>
                <Spinner />
              </div>
            ) : flats.length === 0 ? (
              <EmptyState icon="🔍" title="Search a flat" subtitle="Type to find the resident." />
            ) : (
              flats.map((f) => {
                const active = flat && (flat._id || flat.id) === (f._id || f.id);
                return (
                  <div key={f._id || f.id} style={flatRow(active)} onClick={() => setFlat(f)}>
                    <Avatar name={f.ownerName || f.flatNo} size={38} />
                    <div>
                      <div style={S.flatNo}>
                        {f.wing ? f.wing + "-" : ""}
                        {f.flatNo}
                      </div>
                      <div style={S.flatSub}>{f.ownerName || "Resident"}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
        <Card>
          <h3 style={S.h3}>2 &middot; Visitor details</h3>
          {flat && (
            <div style={S.banner}>
              Notifying{" "}
              <strong style={S.strongBlue}>
                {flat.wing ? flat.wing + "-" : ""}
                {flat.flatNo}
              </strong>{" "}
              ({flat.ownerName || "Resident"})
            </div>
          )}
          <form onSubmit={submit}>
            <div style={S.formGrid}>
              <Field label="Visitor name" required>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Full name" />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile" />
              </Field>
              <Field label="Purpose" required>
                <Select value={form.purpose} onChange={(e) => set("purpose", e.target.value)}>
                  {PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Vehicle number">
                <Input
                  value={form.vehicleNumber}
                  onChange={(e) => set("vehicleNumber", e.target.value.toUpperCase())}
                  placeholder="MH01AB1234"
                />
              </Field>
              <div style={S.full}>
                <PhotoCapture
                  label="Visitor photo"
                  hint="Tap to snap the visitor (or their ID) with the gate camera"
                  value={form.photo}
                  onChange={(url) => set("photo", url)}
                />
              </div>
              <div style={S.full}>
                <Field label="Note">
                  <Textarea
                    value={form.purposeNote}
                    onChange={(e) => set("purposeNote", e.target.value)}
                    placeholder="Optional extra context for the resident"
                  />
                </Field>
              </div>
            </div>
            <div style={S.submitWrap}>
              <Button type="submit" size="lg" full disabled={submitting || !flat}>
                {submitting ? "Notifying resident…" : "Log entry & notify resident"}
              </Button>
            </div>
          </form>
          {result && (
            <div style={S.resultBox}>
              <div style={S.resultHead}>
                <strong style={S.resultName}>{result.name}</strong>
                <StatusBadge status={result.status} />
              </div>
              <div style={S.resultMsg}>
                {result.status === "Pending" && "Waiting for the resident to approve… (auto-refreshing)"}
                {result.status === "Approved" && "✅ Approved — you may allow the visitor in."}
                {result.status === "Rejected" && "⛔ Resident declined entry."}
              </div>
              {result.delivery && result.delivery.channels && (
                <div style={S.channels}>
                  Notified via: {result.delivery.channels.join(", ") || "in-app"}
                  {result.delivery.reachable === false &&
                    " — ⚠️ resident contact may be unreachable, try the registered phone."}
                </div>
              )}
              {result.watchlist && (
                <div style={S.watch}>
                  ⚠️ Watchlist match: {result.watchlist.reason || "flagged visitor"}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
      <Toast {...(toast || {})} onClose={() => setToast(null)} />
    </div>
  );
}
