"use client";
import { useEffect, useState } from "react";
export default function SecurityGuardsPage() {
  const [guards, setGuards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    gateLabel: "Main Gate",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // Edit state. The backend already exposes PATCH /api/admin/security-guards/:id
  // (name, phone, gateLabel, isActive) - the UI simply never offered it.
  const [edit, setEdit] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");
  async function loadGuards() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/security-guards", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) setGuards(data.guards || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadGuards();
  }, []);
  async function handleCreate(e) {
    e.preventDefault();
    setMsg("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/security-guards", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "Failed");
        return;
      }
      setMsg("Guard account created.");
      setForm({ name: "", username: "", password: "", gateLabel: "Main Gate" });
      setShowForm(false);
      loadGuards();
    } finally {
      setSaving(false);
    }
  }
  async function toggleActive(guardId, current) {
    const res = await fetch(`/api/admin/security-guards/${guardId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    if (res.ok) loadGuards();
  }
  async function saveEdit(e) {
    e.preventDefault();
    setEditErr("");
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/security-guards/${edit._id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: edit.name,
          phone: edit.phone || "",
          gateLabel: edit.gateLabel || "Main Gate",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditErr(data.error || "Failed to update guard");
        return;
      }
      setEdit(null);
      loadGuards();
    } finally {
      setEditSaving(false);
    }
  }
  async function removeGuard(guardId, name) {
    if (!window.confirm(`Delete the guard account for ${name}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/security-guards/${guardId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) loadGuards();
    else {
      const data = await res.json().catch(() => ({}));
      setMsg(data.error || "Failed to delete guard");
    }
  }
  return (
    <div style={{ padding: 24, display: "grid", gap: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
            Security Guards
          </h1>
          <p style={{ margin: "6px 0 0", color: "#6b7280" }}>
            Manage gate guard accounts for this society.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((f) => !f);
            setMsg("");
          }}
          style={{
            padding: "10px 18px",
            background: "#111827",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showForm ? "Cancel" : "+ Add Guard"}
        </button>
      </div>
      {msg && (
        <div
          style={{
            padding: "10px 14px",
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 8,
            color: "#166534",
            fontSize: 14,
          }}
        >
          {msg}
        </div>
      )}
      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 20,
            display: "grid",
            gap: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            New Guard Account
          </h2>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <div>
              <label
                style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
              >
                Full Name
              </label>
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((s) => ({ ...s, name: e.target.value }))
                }
                placeholder="Guard name"
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                }}
              />
            </div>
            <div>
              <label
                style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
              >
                Username
              </label>
              <input
                value={form.username}
                onChange={(e) =>
                  setForm((s) => ({ ...s, username: e.target.value }))
                }
                placeholder="e.g. guard01"
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                }}
              />
            </div>
            <div>
              <label
                style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
              >
                Password
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm((s) => ({ ...s, password: e.target.value }))
                }
                placeholder="Min 6 characters"
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                }}
              />
            </div>
            <div>
              <label
                style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
              >
                Gate Label
              </label>
              <input
                value={form.gateLabel}
                onChange={(e) =>
                  setForm((s) => ({ ...s, gateLabel: e.target.value }))
                }
                placeholder="e.g. Main Gate, Rear Gate"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                }}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "11px 0",
              background: "#111827",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Creating..." : "Create Guard Account"}
          </button>
        </form>
      )}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 20,
        }}
      >
        {loading ? (
          <div style={{ color: "#6b7280" }}>Loading...</div>
        ) : guards.length === 0 ? (
          <div style={{ color: "#6b7280" }}>
            No security guards yet. Add one above.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {guards.map((g) => (
              <div
                key={g._id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "grid", gap: 3 }}>
                  <div style={{ fontWeight: 700 }}>{g.name}</div>
                  <div style={{ color: "#6b7280", fontSize: 14 }}>
                    @{g.username} · {g.gateLabel || "Main Gate"}
                    {g.phone ? ` · ${g.phone}` : " · no phone on file"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={() =>
                      setEdit({
                        _id: g._id,
                        name: g.name || "",
                        phone: g.phone || "",
                        gateLabel: g.gateLabel || "Main Gate",
                        username: g.username,
                      })
                    }
                    style={{
                      padding: "6px 14px",
                      borderRadius: 20,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#374151",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeGuard(g._id, g.name)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 20,
                      border: "1px solid #fecaca",
                      background: "#fff",
                      color: "#991b1b",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => toggleActive(g._id, g.isActive)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 20,
                      border: "none",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                      background: g.isActive ? "#dcfce7" : "#fee2e2",
                      color: g.isActive ? "#166534" : "#991b1b",
                    }}
                  >
                    {g.isActive ? "Active" : "Inactive"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && (
        <div
          onClick={() => setEdit(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 20,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveEdit}
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 22,
              width: "100%",
              maxWidth: 420,
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 17 }}>Edit guard</div>
            <div style={{ color: "#6b7280", fontSize: 13, marginTop: -8 }}>
              @{edit.username} · username and password cannot be changed here
            </div>
            {editErr && (
              <div style={{ color: "#991b1b", fontSize: 13, fontWeight: 600 }}>{editErr}</div>
            )}
            <div>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Name</label>
              <input
                value={edit.name}
                onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                required
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
                Phone
              </label>
              <input
                value={edit.phone}
                onChange={(e) => setEdit((s) => ({ ...s, phone: e.target.value }))}
                placeholder="Used by the Call guard button in the resident app"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Gate label</label>
              <input
                value={edit.gateLabel}
                onChange={(e) => setEdit((s) => ({ ...s, gateLabel: e.target.value }))}
                placeholder="e.g. Main Gate, Rear Gate"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="submit"
                disabled={editSaving}
                style={{
                  flex: 1,
                  padding: "11px 0",
                  background: "#111827",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: editSaving ? "not-allowed" : "pointer",
                }}
              >
                {editSaving ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                onClick={() => setEdit(null)}
                style={{
                  padding: "11px 18px",
                  background: "#fff",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}