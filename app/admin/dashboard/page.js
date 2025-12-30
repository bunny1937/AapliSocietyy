'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import styles from './AdminDashboard.module.css';
import { adminApi } from '@/lib/admin-api';

export default function AdminDashboard() {
  const [admin, setAdmin] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const router = useRouter();

  // Check auth on mount
  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    const user = localStorage.getItem('admin_user');

    if (!token || !user) {
      router.push('/admin/login');
      return;
    }

    setAdmin(JSON.parse(user));
  }, [router]);

  // ✅ Cached query - Only fetches once per 5 minutes
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-societies'],
    queryFn: adminApi.fetchSocieties,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    enabled: !!admin, // Only fetch when admin is authenticated
  });

  const societies = data?.societies || [];
  
  // Calculate stats
  const stats = {
    totalSocieties: societies.length,
    totalMembers: societies.reduce((sum, s) => sum + (s.stats?.members || 0), 0),
    totalBills: societies.reduce((sum, s) => sum + (s.stats?.bills || 0), 0),
    activeSocieties: societies.filter(s => s.subscription?.status === 'Active').length,
  };

  // Filter societies
  const filteredSocieties = societies.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.contactEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.registrationNo?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || s.subscription?.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/admin/login');
  };

  if (!admin) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (isLoading) {
    return <div className={styles.loading}>Loading societies...</div>;
  }

  if (error) {
    return <div className={styles.error}>Error loading data: {error.message}</div>;
  }

  return (
    <div className={styles.container}>
      <nav className={styles.navbar}>
        <div className={styles.navBrand}>
          <h1>🔐 SuperAdmin Panel</h1>
        </div>
        <div className={styles.navRight}>
          <span>{admin.name}</span>
          <button onClick={handleLogout} className={styles.logoutBtn}>
            Logout
          </button>
        </div>
      </nav>

      <div className={styles.content}>
        <div className={styles.header}>
          <h2>Dashboard</h2>
          <p>Managing {stats.totalSocieties} societies · ⚡ Cached data (refreshes every 5 min)</p>
        </div>

        {/* Stats Cards */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>🏢</div>
            <div className={styles.statContent}>
              <h3>Total Societies</h3>
              <p className={styles.statValue}>{stats.totalSocieties}</p>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>✅</div>
            <div className={styles.statContent}>
              <h3>Active</h3>
              <p className={styles.statValue}>{stats.activeSocieties}</p>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>👥</div>
            <div className={styles.statContent}>
              <h3>Total Members</h3>
              <p className={styles.statValue}>{stats.totalMembers}</p>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>📄</div>
            <div className={styles.statContent}>
              <h3>Total Bills</h3>
              <p className={styles.statValue}>{stats.totalBills}</p>
            </div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className={styles.controls}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder="Search societies by name, email, or reg no..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <div className={styles.filters}>
            <button
              className={statusFilter === 'all' ? styles.activeFilter : ''}
              onClick={() => setStatusFilter('all')}
            >
              All ({societies.length})
            </button>
            <button
              className={statusFilter === 'Active' ? styles.activeFilter : ''}
              onClick={() => setStatusFilter('Active')}
            >
              Active ({societies.filter(s => s.subscription?.status === 'Active').length})
            </button>
            <button
              className={statusFilter === 'Trial' ? styles.activeFilter : ''}
              onClick={() => setStatusFilter('Trial')}
            >
              Trial ({societies.filter(s => s.subscription?.status === 'Trial').length})
            </button>
            <button
              className={statusFilter === 'Suspended' ? styles.activeFilter : ''}
              onClick={() => setStatusFilter('Suspended')}
            >
              Suspended ({societies.filter(s => s.subscription?.status === 'Suspended').length})
            </button>
          </div>
        </div>

        {/* Societies Table */}
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Society Name</th>
                <th>Registration No</th>
                <th>Contact</th>
                <th>Members</th>
                <th>Bills</th>
                <th>Transactions</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSocieties.map((society) => (
                <tr key={society._id}>
                  <td className={styles.societyName}>{society.name}</td>
                  <td>{society.registrationNo || '-'}</td>
                  <td>
                    <div className={styles.contactInfo}>
                      <div>{society.contactEmail || '-'}</div>
                      <div className={styles.phone}>{society.contactPhone || '-'}</div>
                    </div>
                  </td>
                  <td>{society.stats?.members || 0}</td>
                  <td>{society.stats?.bills || 0}</td>
                  <td>{society.stats?.transactions || 0}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[society.subscription?.status || 'Trial']}`}>
                      {society.subscription?.status || 'Trial'}
                    </span>
                  </td>
                  <td>{society.subscription?.planType || 'Free'}</td>
                  <td>
                    <button
                      onClick={() => router.push(`/admin/societies/${society._id}`)}
                      className={styles.viewBtn}
                    >
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredSocieties.length === 0 && (
            <div className={styles.empty}>
              No societies found matching your filters
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
