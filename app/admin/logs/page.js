'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './Logs.module.css';

export default function AdminLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.push('/admin/login');
      return;
    }
    fetchLogs(token);
  }, [router, filter]);

  const fetchLogs = async (token) => {
    try {
      const res = await fetch(`/api/admin/logs?filter=${filter}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (action) => {
    const icons = {
      LOGIN: '🔐',
      LOGOUT: '🚪',
      DELETE_DATA: '🗑️',
      RESTORE_DATA: '♻️',
      VIEW_DATA: '👁️',
      UPDATE_CONFIG: '⚙️',
      CREATE_SOCIETY: '🏢',
      DELETE_SOCIETY: '❌',
    };
    return icons[action] || '📝';
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>📝 Admin Activity Logs</h1>
          <p>Track all administrative actions</p>
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
          All Actions
        </button>
        <button
          className={filter === 'LOGIN' ? styles.activeFilter : ''}
          onClick={() => setFilter('LOGIN')}
        >
          Logins
        </button>
        <button
          className={filter === 'DELETE_DATA' ? styles.activeFilter : ''}
          onClick={() => setFilter('DELETE_DATA')}
        >
          Deletions
        </button>
        <button
          className={filter === 'UPDATE_CONFIG' ? styles.activeFilter : ''}
          onClick={() => setFilter('UPDATE_CONFIG')}
        >
          Updates
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading logs...</div>
      ) : logs.length === 0 ? (
        <div className={styles.empty}>No logs found</div>
      ) : (
        <div className={styles.timeline}>
          {logs.map((log) => (
            <div key={log._id} className={styles.logEntry}>
              <div className={styles.logIcon}>{getActionIcon(log.action)}</div>
              <div className={styles.logContent}>
                <div className={styles.logHeader}>
                  <span className={styles.logAction}>{log.action}</span>
                  <span className={styles.logTime}>
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className={styles.logDetails}>
                  <span>By: {log.adminName}</span>
                  {log.targetSociety && (
                    <span>Society: {log.targetSociety.societyName}</span>
                  )}
                  {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                </div>
                {log.details && (
                  <div className={styles.logMeta}>
                    {JSON.stringify(log.details, null, 2)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
