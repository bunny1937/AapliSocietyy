'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import styles from '@/styles/ViewBills.module.css';

export default function ViewBillsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewingBill, setViewingBill] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');

  // Fetch all generated bills
  const { data: billsData, isLoading } = useQuery({
    queryKey: ['view-bills', selectedPeriod, filterStatus],
    queryFn: async () => {
      let url = '/api/billing/generated';
      const params = new URLSearchParams();
      if (selectedPeriod !== 'all') params.append('period', selectedPeriod);
      if (filterStatus !== 'all') params.append('status', filterStatus);
      if (params.toString()) url += `?${params.toString()}`;
      return apiClient.get(url);
    }
  });

  const bills = billsData?.bills || [];
console.log('First bill data:', billsData?.bills[0]);

  // Get unique periods
  const periods = [...new Set(bills.map(b => b.billPeriodId))].sort().reverse();

  // Filter bills
  const filteredBills = bills.filter(bill => {
    const matchesSearch = 
      bill.memberId?.flatNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bill.memberId?.ownerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bill.memberId?.wing?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  // Download single bill
const downloadBill = async (bill) => {
  try {
    const response = await fetch(`/api/bills/download?id=${bill._id}`, {
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Download failed');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Bill-${bill.memberId?.wing}-${bill.memberId?.flatNo}-${bill.billPeriodId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download error:', error);
    alert('Failed to download bill. Please try again.');
  }
};


 // Download all filtered bills
const downloadAllBills = async () => {
  if (filteredBills.length === 0) {
    alert('No bills to download');
    return;
  }

  for (const bill of filteredBills) {
    try {
      await downloadBill(bill);
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Failed to download bill:', bill._id);
    }
  }
};


  // Export bills data to Excel
  const exportToExcel = async () => {
    try {
      const response = await fetch('/api/billing/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          period: selectedPeriod !== 'all' ? selectedPeriod : null
        })
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Bills-${selectedPeriod}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('Failed to export bills');
      console.error(error);
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1>📄 View Bills</h1>
          <p>All generated bills with quick preview and download</p>
        </div>
        <div className={styles.headerActions}>
          <button onClick={exportToExcel} className="btn btn-secondary">
            📊 Export to Excel
          </button>
          <button onClick={downloadAllBills} className="btn btn-primary">
            ⬇️ Download All ({filteredBills.length})
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filtersCard}>
        <div className={styles.filterRow}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder="🔍 Search by flat, name, or wing..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className={styles.select}
          >
            <option value="all">All Periods</option>
            {periods.map(period => (
              <option key={period} value={period}>{period}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={styles.select}
          >
            <option value="all">All Status</option>
            <option value="Paid">Paid</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Partial">Partial</option>
            <option value="Overdue">Overdue</option>
          </select>

          <div className={styles.resultCount}>
            {filteredBills.length} Bills
          </div>
        </div>
      </div>

      {/* Bills Grid */}
      {isLoading ? (
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>Loading bills...</p>
        </div>
      ) : filteredBills.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📭</div>
          <h3>No bills found</h3>
          <p>Try adjusting your filters or generate new bills</p>
        </div>
      ) : (
        <div className={styles.billsGrid}>
          {filteredBills.map((bill) => (
            <div key={bill._id} className={styles.billCard}>
              {/* Thumbnail Preview */}
              <div className={styles.billThumbnail}>
                <div className={styles.thumbnailHeader}>
                  <div className={styles.societyName}>
                    {bill.societyId?.name || 'Society'}
                  </div>
                  <div className={styles.billNumber}>
                    #{bill.billPeriodId}
                  </div>
                </div>
                
                <div className={styles.thumbnailBody}>
                  <div className={styles.memberInfo}>
                    <div className={styles.flatNumber}>
{bill.memberId?.wing}-{bill.memberId?.flatNo}                    </div>
                    <div className={styles.memberName}>
                      {bill.memberId?.ownerName}
                    </div>
                  </div>

                  <div className={styles.amountSection}>
                    <div className={styles.amountLabel}>Total Amount</div>
                    <div className={styles.amount}>
                      ₹{bill.totalAmount?.toLocaleString('en-IN')}
                    </div>
                  </div>

                  <div className={styles.statusRow}>
                    <span className={`${styles.statusBadge} ${styles[bill.status?.toLowerCase()]}`}>
                      {bill.status}
                    </span>
                    <span className={styles.dueDate}>
                      Due: {new Date(bill.dueDate).toLocaleDateString('en-IN', { 
                        day: '2-digit', 
                        month: 'short' 
                      })}
                    </span>
                  </div>
                </div>

                <div className={styles.thumbnailFooter}>
                  <div className={styles.chargesSummary}>
                    {bill.charges && Object.entries(bill.charges).slice(0, 3).map(([key, value]) => (
                      <div key={key} className={styles.chargeLine}>
                        <span>{key}:</span>
                        <span>₹{value}</span>
                      </div>
                    ))}
                    {bill.charges && Object.keys(bill.charges).length > 3 && (
                      <div className={styles.moreCharges}>
                        +{Object.keys(bill.charges).length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className={styles.billActions}>
                <button
                  onClick={() => setViewingBill(bill)}
                  className={styles.actionBtn}
                  title="View Full Bill"
                >
                  👁️ View
                </button>
               <button
  onClick={() => downloadBill(bill)}
  className={styles.actionBtn}
  title="Download PDF"
>
  ⬇️ Download
</button>

                <button
                  onClick={() => {
                    const url = `/api/billing/share/${bill._id}`;
                    navigator.clipboard.writeText(window.location.origin + url);
                    alert('Share link copied to clipboard!');
                  }}
                  className={styles.actionBtn}
                  title="Share Link"
                >
                  🔗 Share
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full Bill Viewer Modal */}
      {viewingBill && (
        <div className={styles.modal} onClick={() => setViewingBill(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2>Bill Details</h2>
                <p>{viewingBill.memberId?.wing}-{viewingBill.memberId?.flatNo} • {viewingBill.memberId?.ownerName}</p>
              </div>
              <button onClick={() => setViewingBill(null)} className={styles.closeBtn}>
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Full Bill Display */}
              <div className={styles.fullBill}>
                <div className={styles.billHeader}>
                  <div className={styles.billLogo}>
                    <h3>{viewingBill.societyId?.name}</h3>
                    <p>{viewingBill.societyId?.address}</p>
                  </div>
                  <div className={styles.billMeta}>
                    <div><strong>Bill No:</strong> {viewingBill.billPeriodId}-{viewingBill.memberId?.flatNo}</div>
                    <div><strong>Date:</strong> {new Date(viewingBill.createdAt).toLocaleDateString('en-IN')}</div>
                    <div><strong>Due Date:</strong> {new Date(viewingBill.dueDate).toLocaleDateString('en-IN')}</div>
                  </div>
                </div>

                <div className={styles.billTo}>
                  <h4>Bill To:</h4>
                  <p><strong>{viewingBill.memberId?.ownerName}</strong></p>
                  <p>Flat: {viewingBill.memberId?.wing}-{viewingBill.memberId?.flatNo}</p>
                  <p>Area: {viewingBill.memberId?.areaSqFt} sq ft</p>
                  {viewingBill.memberId?.contact && (
                    <p>Contact: {viewingBill.memberId?.contact}</p>
                  )}
                </div>

                <table className={styles.billTable}>
                  <thead>
                    <tr>
                      <th>Sr.</th>
                      <th>Particulars</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingBill.charges && Object.entries(viewingBill.charges).map(([key, value], idx) => (
                      <tr key={key}>
                        <td>{idx + 1}</td>
                        <td>{key}</td>
                        <td>₹{value.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={styles.subtotal}>
                      <td colSpan="2"><strong>Subtotal</strong></td>
                      <td><strong>₹{viewingBill.totalAmount?.toLocaleString('en-IN')}</strong></td>
                    </tr>
                    {viewingBill.amountPaid > 0 && (
                      <tr className={styles.paid}>
                        <td colSpan="2"><strong>Amount Paid</strong></td>
                        <td><strong>₹{viewingBill.amountPaid?.toLocaleString('en-IN')}</strong></td>
                      </tr>
                    )}
                    <tr className={styles.balance}>
                      <td colSpan="2"><strong>Balance</strong></td>
                      <td><strong>₹{viewingBill.balanceAmount?.toLocaleString('en-IN')}</strong></td>
                    </tr>
                  </tfoot>
                </table>

                {viewingBill.notes && (
                  <div className={styles.notes}>
                    <strong>Notes:</strong> {viewingBill.notes}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.modalFooter}>
            <button
  onClick={() => downloadBill(viewingBill)}
  className="btn btn-primary"
>
  ⬇️ Download PDF
</button>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
