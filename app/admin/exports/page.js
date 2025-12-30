'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './Exports.module.css';

export default function AdminExports() {
  const [exports, setExports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.push('/admin/login');
      return;
    }
    fetchExports(token);
  }, [router, filter]);

  const fetchExports = async (token) => {
    try {
      const res = await fetch(`/api/admin/exports?filter=${filter}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setExports(data.exports || []);
      }
    } catch (error) {
      console.error('Failed to fetch exports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (exportId) => {
    if (!confirm('Restore this deleted data?')) return;

    const token = localStorage.getItem('admin_token');

    try {
      const res = await fetch('/api/admin/exports/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ exportId }),
      });

      if (res.ok) {
        alert('Data restored successfully!');
        fetchExports(token);
      } else {
        alert('Failed to restore data');
      }
    } catch (error) {
      alert('Error restoring data');
    }
  };

  const getDaysRemaining = (expireDate) => {
    const days = Math.ceil((new Date(expireDate) - new Date()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>🗑️ Deleted Data Exports</h1>
          <p>View and restore deleted data (90-day retention)</p>
        </div>
        <button onClick={() => router.push('/admin/dashboard')} className={styles.backBtn}>
          ← Back to Dashboard
        </button>
      </div>

      <div className={styles.filters}>
        <button
          className={filter === 'all' ? styles.activeFilter : ''}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={filter === 'bills' ? styles.activeFilter : ''}
          onClick={() => setFilter('bills')}
        >
          Bills
        </button>
        <button
          className={filter === 'members' ? styles.activeFilter : ''}
          onClick={() => setFilter('members')}
        >
          Members
        </button>
        <button
          className={filter === 'transactions' ? styles.activeFilter : ''}
          onClick={() => setFilter('transactions')}
        >
          Transactions
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading exports...</div>
      ) : exports.length === 0 ? (
        <div className={styles.empty}>No deleted data found</div>
      ) : (
        <div className={styles.table}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Collection</th>
                <th>Society</th>
                <th>Deleted By</th>
                <th>Reason</th>
                <th>Records</th>
                <th>Expires In</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((exp) => (
                <tr key={exp._id}>
                  <td>{new Date(exp.deletedAt).toLocaleDateString()}</td>
                  <td>
                    <span className={styles.badge}>{exp.collection}</span>
                  </td>
                  <td>{exp.societyName}</td>
                  <td>{exp.deletedBy.userName}</td>
                  <td>{exp.deletionReason}</td>
                  <td>{exp.recordCount}</td>
                  <td>
                    <span className={styles.daysRemaining}>
                      {getDaysRemaining(exp.willExpireAt)} days
                    </span>
                  </td>
                  <td>
                    {exp.isRestored ? (
                      <span className={styles.restored}>Restored</span>
                    ) : (
                      <span className={styles.active}>Active</span>
                    )}
                  </td>
                  <td>
                    {!exp.isRestored && (
                      <button
                        onClick={() => handleRestore(exp._id)}
                        className={styles.restoreBtn}
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
