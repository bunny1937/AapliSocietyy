'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import styles from '@/styles/Admin.module.css';

export default function AdminSocietiesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const queryClient = useQueryClient();

  // Fetch all societies
  const { data: societiesData, isLoading } = useQuery({
    queryKey: ['admin-societies'],
    queryFn: () => apiClient.get('/api/admin/societies')
  });

  const societies = societiesData?.societies || [];

  // Filtered societies
  const filteredSocieties = societies.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'All' || s.subscription?.status === filterStatus;
    return matchesSearch && matchesStatus && !s.isDeleted;
  });

  // Update subscription mutation
  const updateSubscriptionMutation = useMutation({
    mutationFn: ({ societyId, updates }) => 
      apiClient.put('/api/admin/societies', { societyId, updates }),
    onSuccess: () => {
      alert('✅ Subscription updated');
      queryClient.invalidateQueries(['admin-societies']);
    }
  });

  const handlePaymentRecord = (societyId) => {
    const amount = parseFloat(prompt('Enter payment amount:'));
    const method = prompt('Payment method (UPI/Bank/Cash):');
    
    if (!amount || !method) return;

    updateSubscriptionMutation.mutate({
      societyId,
      updates: {
        'subscription.lastPaymentDate': new Date(),
        'subscription.amountPaid': amount,
        'subscription.status': 'Active',
        $push: {
          'subscription.paymentHistory': {
            date: new Date(),
            amount,
            method,
            transactionId: `TXN-${Date.now()}`
          }
        }
      }
    });
  };

  const suspendSociety = (societyId) => {
    if (!confirm('Suspend this society? They will lose access.')) return;
    
    updateSubscriptionMutation.mutate({
      societyId,
      updates: { 'subscription.status': 'Suspended' }
    });
  };

  const activateSociety = (societyId) => {
    updateSubscriptionMutation.mutate({
      societyId,
      updates: { 'subscription.status': 'Active' }
    });
  };

  return (
    <div className={styles.adminContainer}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Society Management</h1>
          <p className={styles.pageSubtitle}>Total: {societies.length} societies</p>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filtersBar}>
        <input
          type="text"
          placeholder="🔍 Search societies..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles.searchInput}
        />
        
        <select 
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Trial">Trial</option>
          <option value="Suspended">Suspended</option>
          <option value="Expired">Expired</option>
        </select>
      </div>

      {/* Stats Cards */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard} style={{borderColor: '#10B981'}}>
          <div className={styles.statNumber}>{societies.filter(s => s.subscription?.status === 'Active').length}</div>
          <div className={styles.statLabel}>Active</div>
        </div>
        <div className={styles.statCard} style={{borderColor: '#F59E0B'}}>
          <div className={styles.statNumber}>{societies.filter(s => s.subscription?.status === 'Trial').length}</div>
          <div className={styles.statLabel}>Trial</div>
        </div>
        <div className={styles.statCard} style={{borderColor: '#EF4444'}}>
          <div className={styles.statNumber}>{societies.filter(s => s.subscription?.status === 'Suspended').length}</div>
          <div className={styles.statLabel}>Suspended</div>
        </div>
        <div className={styles.statCard} style={{borderColor: '#3B82F6'}}>
          <div className={styles.statNumber}>
            ₹{societies.reduce((sum, s) => sum + (s.subscription?.amountPaid || 0), 0).toLocaleString()}
          </div>
          <div className={styles.statLabel}>Total Revenue</div>
        </div>
      </div>

      {/* Societies Table */}
      {isLoading ? (
        <div className={styles.loading}>Loading societies...</div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.adminTable}>
            <thead>
              <tr>
                <th>Society Name</th>
                <th>Registration</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Last Payment</th>
                <th>Next Payment</th>
                <th>Total Paid</th>
                <th>Config Ver.</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSocieties.map(society => (
                <tr key={society._id}>
                  <td>
                    <div className={styles.societyName}>{society.name}</div>
                    <div className={styles.societyId}>{society._id}</div>
                  </td>
                  <td>{society.registrationNo || 'N/A'}</td>
                  <td>
                    <span className={styles.planBadge}>
                      {society.subscription?.planType || 'Free'}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.statusBadge} ${styles[society.subscription?.status?.toLowerCase()]}`}>
                      {society.subscription?.status || 'Trial'}
                    </span>
                  </td>
                  <td>
                    {society.subscription?.lastPaymentDate 
                      ? new Date(society.subscription.lastPaymentDate).toLocaleDateString('en-IN')
                      : 'Never'
                    }
                  </td>
                  <td>
                    {society.subscription?.nextPaymentDate 
                      ? new Date(society.subscription.nextPaymentDate).toLocaleDateString('en-IN')
                      : 'Not set'
                    }
                  </td>
                  <td className={styles.amountCell}>
                    ₹{(society.subscription?.amountPaid || 0).toLocaleString()}
                  </td>
                  <td>v{society.configVersion || 1}</td>
                  <td>
                    <div className={styles.actionButtons}>
                      <button 
                        onClick={() => handlePaymentRecord(society._id)}
                        className={styles.btnSmall}
                        style={{background: '#10B981'}}
                      >
                        💰 Payment
                      </button>
                      
                      {society.subscription?.status === 'Active' ? (
                        <button 
                          onClick={() => suspendSociety(society._id)}
                          className={styles.btnSmall}
                          style={{background: '#EF4444'}}
                        >
                          🚫 Suspend
                        </button>
                      ) : (
                        <button 
                          onClick={() => activateSociety(society._id)}
                          className={styles.btnSmall}
                          style={{background: '#10B981'}}
                        >
                          ✅ Activate
                        </button>
                      )}

                      <button 
                        onClick={() => window.open(`/dashboard/admin/society-details/${society._id}`, '_blank')}
                        className={styles.btnSmall}
                        style={{background: '#3B82F6'}}
                      >
                        📊 Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredSocieties.length === 0 && (
            <div className={styles.emptyState}>
              <p>No societies found matching your filters</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
