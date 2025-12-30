'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, adminKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      // Save admin token (separate from society users)
      localStorage.setItem('admin_token', data.token);
      localStorage.setItem('admin_user', JSON.stringify(data.user));

      // Redirect to admin dashboard
      router.push('/admin/dashboard');

    } catch (err) {
      setError('Network error');
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      background: '#000'
    }}>
      <div style={{ 
        background: '#1a1a1a', 
        padding: '40px', 
        borderRadius: '8px',
        maxWidth: '400px',
        width: '100%'
      }}>
        <h1 style={{ color: '#fff', marginBottom: '30px', textAlign: 'center' }}>
          🔐 Admin Access
        </h1>

        {error && (
          <div style={{ 
            background: '#ff000020', 
            color: '#ff6b6b', 
            padding: '12px', 
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ color: '#aaa', display: 'block', marginBottom: '8px' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px',
                background: '#2a2a2a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ color: '#aaa', display: 'block', marginBottom: '8px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px',
                background: '#2a2a2a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ color: '#aaa', display: 'block', marginBottom: '8px' }}>
              Admin Key
            </label>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              required
              placeholder="Enter admin secret key"
              style={{
                width: '100%',
                padding: '12px',
                background: '#2a2a2a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              background: loading ? '#555' : '#4CAF50',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
