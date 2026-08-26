'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import notify from '@/lib/notify';
const H = {};
async function adminGet(url) {
  const res = await fetch(url, { credentials: "include", headers: H });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}
async function adminPost(url, body) {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}
export default function AdminDataBrowserPage() {
  const [selectedSociety, setSelectedSociety] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('bills');
  const [selectedItems, setSelectedItems] = useState([]);
  const queryClient = useQueryClient();
  const { data: societiesData } = useQuery({
    queryKey: ['admin-societies'],
    queryFn: () => adminGet('/api/admin/societies'),
  });
  const { data: collectionData, isLoading } = useQuery({
    queryKey: ['admin-data', selectedSociety, selectedCollection],
    queryFn: () => adminGet(`/api/admin/data-browser?societyId=${selectedSociety}&collection=${selectedCollection}`),
    enabled: !!selectedSociety && !!selectedCollection,
  });
  const data = collectionData?.data || [];
  const deleteMutation = useMutation({
    mutationFn: (payload) => adminPost('/api/admin/data-browser', payload),
    onSuccess: (response) => {
      notify.success(`${response.deletedCount} items deleted. Exported to Archive for 90 days.`);
      setSelectedItems([]);
      queryClient.invalidateQueries(['admin-data']);
    }
  });
  const handleDelete = async () => {
    if (selectedItems.length === 0) {
      notify.warning('Please select items to delete');
      return;
    }
    const reason = await notify.prompt('Reason for deletion (required):');
    if (!reason || reason.trim() === '') {
      notify.warning('Deletion reason is required');
      return;
    }
    if (!(await notify.confirm(`⚠️ Delete ${selectedItems.length} items?\n\n✅ They will be:\n- Exported to Archive\n- Kept for 90 days\n- Auto-deleted after that`, { tone: "danger" }))) {
      return;
    }
    deleteMutation.mutate({
      action: 'delete',
      societyId: selectedSociety,
      collection: selectedCollection,
      ids: selectedItems,
      reason
    });
  };
  const toggleSelectAll = () => {
    if (selectedItems.length === data.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(data.map(d => d._id));
    }
  };
  const toggleItem = (id) => {
    if (selectedItems.includes(id)) {
      setSelectedItems(selectedItems.filter(i => i !== id));
    } else {
      setSelectedItems([...selectedItems, id]);
    }
  };
  const statusColors = {
    paid: { background: "#10b98122", color: "var(--success)" },
    unpaid: { background: "#ef444422", color: "var(--danger)" },
    partial: { background: "#f59e0b22", color: "var(--warning)" },
  };
  return (
    <div style={{ padding: 0, maxWidth: 1300, margin: "0 auto", color: "var(--fg-2)" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "var(--fg-2)" }}>Data Browser</h1>
          <p style={{ color: "var(--fg-4)", fontSize: "0.85rem", marginTop: 4 }}>View and manage all society data with export-before-delete protection</p>
        </div>
      </div>
      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
          <label style={{ color: "var(--fg-4)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Society</label>
          <select
            value={selectedSociety}
            onChange={(e) => {
              setSelectedSociety(e.target.value);
              setSelectedItems([]);
            }}
            style={{ padding: "0.6rem 0.75rem", borderRadius: 6, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-2)" }}
          >
            <option value="">-- Select Society --</option>
            {societiesData?.societies?.map(s => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
          <label style={{ color: "var(--fg-4)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Collection</label>
          <select
            value={selectedCollection}
            onChange={(e) => {
              setSelectedCollection(e.target.value);
              setSelectedItems([]);
            }}
            style={{ padding: "0.6rem 0.75rem", borderRadius: 6, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-2)" }}
          >
            <option value="bills">Bills</option>
            <option value="members">Members</option>
            <option value="transactions">Transactions</option>
            <option value="billingheads">Billing Heads</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
          <label style={{ color: "var(--fg-4)", fontSize: "12px", fontWeight: 600 }}>&nbsp;</label>
          <button
            onClick={handleDelete}
            disabled={selectedItems.length === 0 || deleteMutation.isPending}
            style={{ padding: "0.6rem 1.25rem", borderRadius: 6, border: "none", background: selectedItems.length > 0 ? "var(--danger)" : "var(--border)", color: selectedItems.length > 0 ? "var(--bg-surface)" : "var(--fg-5)", fontWeight: 700, cursor: selectedItems.length > 0 ? "pointer" : "not-allowed" }}
          >
            {deleteMutation.isPending ? 'Deleting...' : `🗑️ Delete Selected (${selectedItems.length})`}
          </button>
        </div>
      </div>
      {/* Info Box */}
      {selectedSociety && (
        <div style={{ background: "var(--success-bg)", border: "1px solid var(--success)", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "1.25rem", fontSize: "13px", color: "var(--success-fg)" }}>
          <h4>🔒 Export-Before-Delete Protection Active</h4>
          <ul>
            <li>✅ All deleted data is automatically exported to Archive collection</li>
            <li>📅 Archived data is retained for 90 days</li>
            <li>♻️ Can be restored within 90 days if needed</li>
            <li>🗑️ Automatically purged after 90 days</li>
          </ul>
        </div>
      )}
      {/* Data Table */}
      {isLoading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>Loading data...</div>
      ) : selectedSociety && data.length > 0 ? (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--fg-4)", fontSize: "13px", background: "var(--bg-sunken)" }}>
            <div>
              <strong style={{ color: "var(--fg-2)" }}>{data.length}</strong> records found
            </div>
            <button onClick={toggleSelectAll} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "none", color: "var(--fg-4)", cursor: "pointer", fontSize: "12px" }}>
              {selectedItems.length === data.length ? '☐ Deselect All' : '☑ Select All'}
            </button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "var(--bg-sunken)" }}>
                <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", width: 50 }}>
                  <input
                    type="checkbox"
                    checked={selectedItems.length === data.length && data.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>ID</th>
                {selectedCollection === 'bills' && (
                  <>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Member</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Period</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Amount</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Status</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Created</th>
                  </>
                )}
                {selectedCollection === 'members' && (
                  <>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Name</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Flat</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Contact</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Area</th>
                  </>
                )}
                {selectedCollection === 'transactions' && (
                  <>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Member</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Type</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Amount</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Date</th>
                  </>
                )}
                {selectedCollection === 'billingheads' && (
                  <>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Name</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Calculation Type</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Default Amount</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Active</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((item, i) => (
                <tr
                  key={item._id}
                  style={{
                    background: selectedItems.includes(item._id) ? "var(--primary-tint)" : "var(--bg-surface)",
                    borderBottom: "1px solid var(--bg-muted)",
                    ...(selectedItems.includes(item._id) ? { outline: "1px solid var(--primary)" } : {}),
                  }}
                >
                  <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item._id)}
                      onChange={() => toggleItem(item._id)}
                    />
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--fg-5)", fontFamily: "monospace", fontSize: "11px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{item._id}</td>
                  {selectedCollection === 'bills' && (
                    <>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.memberId?.wing}-{item.memberId?.roomNo}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.billPeriodId}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>₹{item.totalAmount}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, ...statusColors[item.status?.toLowerCase()] }}>
                          {item.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{new Date(item.createdAt).toLocaleDateString('en-IN')}</td>
                    </>
                  )}
                  {selectedCollection === 'members' && (
                    <>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.ownerName}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.wing}-{item.roomNo}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.contact}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.areaSqFt} sq ft</td>
                    </>
                  )}
                  {selectedCollection === 'transactions' && (
                    <>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.memberId?.wing}-{item.memberId?.roomNo}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.type}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>₹{item.amount}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{new Date(item.date).toLocaleDateString('en-IN')}</td>
                    </>
                  )}
                  {selectedCollection === 'billingheads' && (
                    <>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.headName}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.calculationType}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>₹{item.defaultAmount}</td>
                      <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{item.isActive ? '✅' : '❌'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : selectedSociety ? (
        <div style={{ padding: "4rem", textAlign: "center", color: "var(--fg-3)", border: "2px dashed var(--fg-2)", borderRadius: 10, margin: "1rem 0" }}>
          <p>No data found in this collection</p>
        </div>
      ) : (
        <div style={{ padding: "4rem", textAlign: "center", color: "var(--fg-3)", border: "2px dashed var(--fg-2)", borderRadius: 10, margin: "1rem 0" }}>
          <p>👆 Select a society to view data</p>
        </div>
      )}
    </div>
  );
}
