'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import styles from '@/styles/Admin.module.css';

export default function AdminDataBrowserPage() {
  const [selectedSociety, setSelectedSociety] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('bills');
  const [selectedItems, setSelectedItems] = useState([]);
  const queryClient = useQueryClient();

  // Fetch societies
  const { data: societiesData } = useQuery({
    queryKey: ['admin-societies'],
    queryFn: () => apiClient.get('/api/admin/societies')
  });

  // Fetch data for selected society + collection
  const { data: collectionData, isLoading } = useQuery({
    queryKey: ['admin-data', selectedSociety, selectedCollection],
    queryFn: () => apiClient.get(`/api/admin/data-browser?societyId=${selectedSociety}&collection=${selectedCollection}`),
    enabled: !!selectedSociety && !!selectedCollection
  });

  const data = collectionData?.data || [];

  // Delete with auto-export mutation
  const deleteMutation = useMutation({
    mutationFn: (payload) => apiClient.post('/api/admin/data-browser', payload),
    onSuccess: (response) => {
      alert(`✅ ${response.deletedCount} items deleted. Exported to Archive for 90 days.`);
      setSelectedItems([]);
      queryClient.invalidateQueries(['admin-data']);
    }
  });

  const handleDelete = () => {
    if (selectedItems.length === 0) {
      alert('Please select items to delete');
      return;
    }

    const reason = prompt('Reason for deletion (required):');
    if (!reason || reason.trim() === '') {
      alert('Deletion reason is required');
      return;
    }

    if (!confirm(`⚠️ Delete ${selectedItems.length} items?\n\n✅ They will be:\n- Exported to Archive\n- Kept for 90 days\n- Auto-deleted after that`)) {
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

  return (
    <div className={styles.adminContainer}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Data Browser</h1>
          <p className={styles.pageSubtitle}>View and manage all society data with export-before-delete protection</p>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.browserControls}>
        <div className={styles.controlGroup}>
          <label>Society</label>
          <select 
            value={selectedSociety}
            onChange={(e) => {
              setSelectedSociety(e.target.value);
              setSelectedItems([]);
            }}
            className={styles.controlSelect}
          >
            <option value="">-- Select Society --</option>
            {societiesData?.societies?.map(s => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className={styles.controlGroup}>
          <label>Collection</label>
          <select 
            value={selectedCollection}
            onChange={(e) => {
              setSelectedCollection(e.target.value);
              setSelectedItems([]);
            }}
            className={styles.controlSelect}
          >
            <option value="bills">Bills</option>
            <option value="members">Members</option>
            <option value="transactions">Transactions</option>
            <option value="billingheads">Billing Heads</option>
          </select>
        </div>

        <div className={styles.controlGroup}>
          <label>&nbsp;</label>
          <button 
            onClick={handleDelete}
            disabled={selectedItems.length === 0 || deleteMutation.isPending}
            className={styles.deleteButton}
          >
            {deleteMutation.isPending ? 'Deleting...' : `🗑️ Delete Selected (${selectedItems.length})`}
          </button>
        </div>
      </div>

      {/* Info Box */}
      {selectedSociety && (
        <div className={styles.infoBox}>
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
        <div className={styles.loading}>Loading data...</div>
      ) : selectedSociety && data.length > 0 ? (
        <div className={styles.tableCard}>
          <div className={styles.tableHeader}>
            <div>
              <strong>{data.length}</strong> records found
            </div>
            <button onClick={toggleSelectAll} className={styles.btnSmall}>
              {selectedItems.length === data.length ? '☐ Deselect All' : '☑ Select All'}
            </button>
          </div>

          <table className={styles.adminTable}>
            <thead>
              <tr>
                <th style={{width: '50px'}}>
                  <input 
                    type="checkbox"
                    checked={selectedItems.length === data.length && data.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>ID</th>
                {selectedCollection === 'bills' && (
                  <>
                    <th>Member</th>
                    <th>Period</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Created</th>
                  </>
                )}
                {selectedCollection === 'members' && (
                  <>
                    <th>Name</th>
                    <th>Flat</th>
                    <th>Contact</th>
                    <th>Area</th>
                  </>
                )}
                {selectedCollection === 'transactions' && (
                  <>
                    <th>Member</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Date</th>
                  </>
                )}
                {selectedCollection === 'billingheads' && (
                  <>
                    <th>Name</th>
                    <th>Calculation Type</th>
                    <th>Default Amount</th>
                    <th>Active</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map(item => (
                <tr key={item._id} className={selectedItems.includes(item._id) ? styles.selectedRow : ''}>
                  <td>
                    <input 
                      type="checkbox"
                      checked={selectedItems.includes(item._id)}
                      onChange={() => toggleItem(item._id)}
                    />
                  </td>
                  <td className={styles.idCell}>{item._id}</td>
                  
                  {selectedCollection === 'bills' && (
                    <>
                      <td>{item.memberId?.wing}-{item.memberId?.roomNo}</td>
                      <td>{item.billPeriodId}</td>
                      <td>₹{item.totalAmount}</td>
                      <td><span className={`${styles.statusBadge} ${styles[item.status?.toLowerCase()]}`}>{item.status}</span></td>
                      <td>{new Date(item.createdAt).toLocaleDateString('en-IN')}</td>
                    </>
                  )}
                  
                  {selectedCollection === 'members' && (
                    <>
                      <td>{item.ownerName}</td>
                      <td>{item.wing}-{item.roomNo}</td>
                      <td>{item.contact}</td>
                      <td>{item.areaSqFt} sq ft</td>
                    </>
                  )}
                  
                  {selectedCollection === 'transactions' && (
                    <>
                      <td>{item.memberId?.wing}-{item.memberId?.roomNo}</td>
                      <td>{item.type}</td>
                      <td>₹{item.amount}</td>
                      <td>{new Date(item.date).toLocaleDateString('en-IN')}</td>
                    </>
                  )}
                  
                  {selectedCollection === 'billingheads' && (
                    <>
                      <td>{item.headName}</td>
                      <td>{item.calculationType}</td>
                      <td>₹{item.defaultAmount}</td>
                      <td>{item.isActive ? '✅' : '❌'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : selectedSociety ? (
        <div className={styles.emptyState}>
          <p>No data found in this collection</p>
        </div>
      ) : (
        <div className={styles.emptyState}>
          <p>👆 Select a society to view data</p>
        </div>
      )}
    </div>
  );
}
