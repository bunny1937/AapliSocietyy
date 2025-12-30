const API_BASE = '/api/admin';

export const adminApi = {
  async fetchSocieties() {
    const token = localStorage.getItem('admin_token');
    const res = await fetch(`${API_BASE}/societies`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  },

  async fetchSociety(id) {
    const token = localStorage.getItem('admin_token');
    const res = await fetch(`${API_BASE}/societies/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  },

  async fetchData(societyId, collection) {
    const token = localStorage.getItem('admin_token');
    const res = await fetch(`${API_BASE}/data-browser?societyId=${societyId}&collection=${collection}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  },

  async updateSociety(societyId, updates) {
    const token = localStorage.getItem('admin_token');
    const res = await fetch(`${API_BASE}/societies`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ societyId, updates }),
    });
    if (!res.ok) throw new Error('Failed to update');
    return res.json();
  }
};
