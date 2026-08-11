"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  Badge,
  Spinner,
  Toast,
  EmptyState,
  tokens,
  fmtTime,
} from "@/components/visitor/ui";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const CATEGORIES = [
  "Salary",
  "Security",
  "Housekeeping",
  "Repairs & Maintenance",
  "Electricity",
  "Water",
  "Lift/Elevator",
  "Garden",
  "Legal & Professional",
  "Audit",
  "Insurance",
  "Property Tax",
  "Bank Charges",
  "Festival & Events",
  "Miscellaneous",
];
const METHODS = ["Cash", "Cheque", "Online", "NEFT", "UPI", "Card", "Other"];

const inr = (n) =>
  "\u20b9" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function currentFy() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

const S = {
  row: { padding: "14px 0", borderBottom: `1px solid ${tokens.border}` },
  rowHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  name: { fontWeight: 700, color: tokens.text },
  meta: { fontSize: 12.5, color: tokens.sub, marginTop: 4 },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "end" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, color: tokens.sub, fontWeight: 600 },
  input: { padding: "8px 10px", border: `1px solid ${tokens.border}`, borderRadius: 8, fontSize: 13.5 },
  summary: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 },
  stat: { background: tokens.bgSoft || "#f8fafc", border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "12px 16px", minWidth: 150 },
};

const emptyForm = () => ({
  category: "Repairs & Maintenance",
  amount: "",
  date: new Date().toISOString().slice(0, 10),
  paymentMethod: "Online",
  vendor: "",
  referenceNo: "",
  description: "",
});

export default function ExpenditurePage() {
  const [fy, setFy] = useState(currentFy());
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [byCategory, setByCategory] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/api/expenses?fy=${fy}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setByCategory(data.byCategory || {});
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  async function addExpense() {
    if (!form.amount || Number(form.amount) <= 0) {
      setToast({ type: "error", message: "Enter a valid amount" });
      return;
    }
    setSaving(true);
    try {
      await api("/api/expenses", { method: "POST", body: JSON.stringify(form) });
      setToast({ type: "success", message: "Expense added" });
      setForm(emptyForm());
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this expense?")) return;
    try {
      await api(`/api/expenses/${id}`, { method: "DELETE" });
      setToast({ type: "success", message: "Expense deleted" });
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <PageHeader
        title="Expenditure"
        subtitle="Record society expenses (salary, repairs, electricity, audit, etc.). These flow into the Balance Sheet as the outflow side."
      />

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <strong style={{ color: tokens.text }}>Add expense</strong>
          <label style={{ fontSize: 13, color: tokens.sub }}>
            FY&nbsp;
            <select value={fy} onChange={(e) => setFy(parseInt(e.target.value))} style={S.input}>
              {[0, 1, 2, 3].map((d) => {
                const y = currentFy() - d;
                return (
                  <option key={y} value={y}>
                    Apr {y} – Mar {y + 1}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <div style={S.form}>
          <div style={S.field}>
            <span style={S.label}>Category</span>
            <select value={form.category} onChange={set("category")} style={S.input}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div style={S.field}>
            <span style={S.label}>Amount (₹)</span>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={set("amount")} style={S.input} />
          </div>
          <div style={S.field}>
            <span style={S.label}>Date</span>
            <input type="date" value={form.date} onChange={set("date")} style={S.input} />
          </div>
          <div style={S.field}>
            <span style={S.label}>Method</span>
            <select value={form.paymentMethod} onChange={set("paymentMethod")} style={S.input}>
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div style={S.field}>
            <span style={S.label}>Vendor / payee</span>
            <input value={form.vendor} onChange={set("vendor")} style={S.input} placeholder="Optional" />
          </div>
          <div style={S.field}>
            <span style={S.label}>Reference no.</span>
            <input value={form.referenceNo} onChange={set("referenceNo")} style={S.input} placeholder="Optional" />
          </div>
          <div style={{ ...S.field, gridColumn: "1 / -1" }}>
            <span style={S.label}>Description</span>
            <input value={form.description} onChange={set("description")} style={S.input} placeholder="Optional note" />
          </div>
          <div>
            <Button onClick={addExpense} disabled={saving}>
              {saving ? "Saving…" : "Add expense"}
            </Button>
          </div>
        </div>
      </Card>

      <div style={{ height: 16 }} />

      <Card>
        <div style={S.summary}>
          <div style={S.stat}>
            <div style={{ fontSize: 12, color: tokens.sub }}>Total spent (FY)</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: tokens.text }}>{inr(total)}</div>
          </div>
          {Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([cat, amt]) => (
              <div key={cat} style={S.stat}>
                <div style={{ fontSize: 12, color: tokens.sub }}>{cat}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text }}>{inr(amt)}</div>
              </div>
            ))}
        </div>

        {loading ? (
          <div style={S.center}>
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon="\uD83D\uDCB8" title="No expenses recorded" subtitle="Add your first expense above to start building the balance sheet's outflow side." />
        ) : (
          items.map((it) => (
            <div key={it._id} style={S.row}>
              <div style={S.rowHead}>
                <div>
                  <div style={S.name}>
                    {inr(it.amount)} · <Badge>{it.category}</Badge>
                  </div>
                  <div style={S.meta}>
                    {fmtTime ? fmtTime(it.date) : new Date(it.date).toLocaleDateString("en-IN")} · {it.paymentMethod}
                    {it.vendor ? ` · ${it.vendor}` : ""}
                    {it.referenceNo ? ` · Ref ${it.referenceNo}` : ""}
                    {it.description ? ` — ${it.description}` : ""}
                  </div>
                </div>
                <Button variant="danger" onClick={() => remove(it._id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
