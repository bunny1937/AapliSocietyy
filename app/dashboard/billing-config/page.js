'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import styles from '@/styles/BillingConfig.module.css';

export default function BillingConfigPage() {
  const queryClient = useQueryClient();
  
  const [defaultCharges, setDefaultCharges] = useState({
    maintenance: 0,
    sinkingFund: 0,
    repairFund: 0,
    water: 0,
    security: 0,
    electricity: 0
  });

  const [customCharges, setCustomCharges] = useState([]);
  const [livePreview, setLivePreview] = useState([]);

  // Fetch data
  const { data: societyData } = useQuery({
    queryKey: ['society-config'],
    queryFn: () => apiClient.get('/api/society/config')
  });

  const { data: billingHeadsData } = useQuery({
    queryKey: ['billing-heads'],
    queryFn: () => apiClient.get('/api/billing-heads/list')
  });

  const { data: membersData } = useQuery({
    queryKey: ['members-list'],
    queryFn: () => apiClient.get('/api/members/list')
  });

  // Load society config
  useEffect(() => {
    if (societyData?.society) {
      const config = societyData.society.config || {};
      const fixed = config.fixedCharges || {};
      
      setDefaultCharges({
        maintenance: config.maintenanceRate || 0,
        sinkingFund: config.sinkingFundRate || 0,
        repairFund: config.repairFundRate || 0,
        water: fixed.water || 0,
        security: fixed.security || 0,
        electricity: fixed.electricity || 0
      });
    }
  }, [societyData]);

  // Load billing heads
  useEffect(() => {
    if (billingHeadsData?.heads) {
      const active = billingHeadsData.heads
        .filter(h => h.isActive && !h.isDeleted)
        .map(h => ({
          id: h._id,
          name: h.headName,
          calculationType: h.calculationType,
          defaultAmount: h.defaultAmount,
          isExisting: true
        }));
      setCustomCharges(active);
    }
  }, [billingHeadsData]);

  // 🔥 AUTO-UPDATE PREVIEW whenever data changes
  useEffect(() => {
    updateLivePreview();
  }, [defaultCharges, customCharges, membersData]);

  const updateLivePreview = () => {
    if (!membersData?.members || membersData.members.length === 0) {
      setLivePreview([]);
      return;
    }

    const members = membersData.members;
    const preview = members.map(member => {
      const area = member.areaSqFt || member.carpetAreaSqft || 0;
      const flatNo = member.roomNo || member.flatNo || '';
      
      const calculations = {};
      
      // Per sq ft
      calculations.Maintenance = area * (parseFloat(defaultCharges.maintenance) || 0);
      calculations['Sinking Fund'] = area * (parseFloat(defaultCharges.sinkingFund) || 0);
      calculations['Repair Fund'] = area * (parseFloat(defaultCharges.repairFund) || 0);
      
      // Fixed
      calculations.Water = parseFloat(defaultCharges.water) || 0;
      calculations.Security = parseFloat(defaultCharges.security) || 0;
      calculations.Electricity = parseFloat(defaultCharges.electricity) || 0;
      
      // Custom
      customCharges.forEach(charge => {
        if (!charge.name || !charge.name.trim()) return;
        
        const amount = parseFloat(charge.defaultAmount) || 0;
        if (charge.calculationType === 'Fixed') {
          calculations[charge.name] = amount;
        } else if (charge.calculationType === 'Per Sq Ft') {
          calculations[charge.name] = area * amount;
        }
      });
      
      const total = Object.values(calculations).reduce((sum, val) => sum + val, 0);
      
      return {
        member: `${member.wing || ''}-${flatNo}`,
        memberName: member.ownerName || 'Unknown',
        area,
        ...calculations,
        total
      };
    });

    setLivePreview(preview);
  };

  // Save
  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiClient.put('/api/society/update', {
        config: {
          maintenanceRate: parseFloat(defaultCharges.maintenance) || 0,
          sinkingFundRate: parseFloat(defaultCharges.sinkingFund) || 0,
          repairFundRate: parseFloat(defaultCharges.repairFund) || 0,
          fixedCharges: {
            water: parseFloat(defaultCharges.water) || 0,
            security: parseFloat(defaultCharges.security) || 0,
            electricity: parseFloat(defaultCharges.electricity) || 0
          }
        }
      });

      for (const charge of customCharges) {
        if (!charge.name || !charge.name.trim()) continue;

        if (charge.isExisting) {
          await apiClient.put(`/api/billing-heads/${charge.id}/update`, {
            headName: charge.name.trim(),
            calculationType: charge.calculationType,
            defaultAmount: parseFloat(charge.defaultAmount) || 0
          });
        } else {
          await apiClient.post('/api/billing-heads/create', {
            headName: charge.name.trim(),
            calculationType: charge.calculationType,
            defaultAmount: parseFloat(charge.defaultAmount) || 0,
            isActive: true
          });
        }
      }
    },
    onSuccess: () => {
      alert('✅ Configuration saved!');
      queryClient.invalidateQueries(['society-config']);
      queryClient.invalidateQueries(['billing-heads']);
    },
    onError: (error) => {
      alert('Failed to save: ' + error.message);
    }
  });

  const addCustomCharge = () => {
    setCustomCharges([
      ...customCharges,
      {
        id: `temp-${Date.now()}`,
        name: '',
        calculationType: 'Fixed',
        defaultAmount: 0,
        isExisting: false
      }
    ]);
  };

  const updateCharge = (id, field, value) => {
    setCustomCharges(customCharges.map(c =>
      c.id === id ? { ...c, [field]: value } : c
    ));
  };

  const deleteCharge = async (id) => {
    const charge = customCharges.find(c => c.id === id);
    
    if (charge.isExisting) {
      if (!confirm(`Delete "${charge.name}"?`)) return;
      try {
        await apiClient.delete(`/api/billing-heads/${id}/delete`);
        queryClient.invalidateQueries(['billing-heads']);
      } catch (error) {
        alert('Failed to delete: ' + error.message);
      }
    }
    
    setCustomCharges(customCharges.filter(c => c.id !== id));
  };

  // Get all column names for table
  const allColumns = ['Member', 'Name', 'Area', 'Maintenance', 'Sinking Fund', 'Repair Fund', 'Water', 'Security', 'Electricity'];
  customCharges.forEach(c => {
    if (c.name && c.name.trim()) allColumns.push(c.name);
  });
  allColumns.push('Total');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>⚙️ Billing Configuration</h1>
          <p>Configure charges and see live calculations for all members</p>
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="btn btn-primary"
        >
          {saveMutation.isPending ? '⏳ Saving...' : '💾 Save Configuration'}
        </button>
      </div>

      {/* Config Sections */}
      <div className={styles.configSections}>
        {/* Default Charges */}
        <div className={styles.section}>
          <h2>📊 Per Sq Ft Charges</h2>
          <div className={styles.chargesGrid}>
            <div className={styles.chargeCard}>
              <label>Maintenance</label>
              <input
                type="number"
                step="0.01"
                value={defaultCharges.maintenance}
                onChange={(e) => setDefaultCharges({...defaultCharges, maintenance: e.target.value})}
                className={styles.input}
              />
              <span className={styles.unit}>₹/sq ft</span>
            </div>

            <div className={styles.chargeCard}>
              <label>Sinking Fund</label>
              <input
                type="number"
                step="0.01"
                value={defaultCharges.sinkingFund}
                onChange={(e) => setDefaultCharges({...defaultCharges, sinkingFund: e.target.value})}
                className={styles.input}
              />
              <span className={styles.unit}>₹/sq ft</span>
            </div>

            <div className={styles.chargeCard}>
              <label>Repair Fund</label>
              <input
                type="number"
                step="0.01"
                value={defaultCharges.repairFund}
                onChange={(e) => setDefaultCharges({...defaultCharges, repairFund: e.target.value})}
                className={styles.input}
              />
              <span className={styles.unit}>₹/sq ft</span>
            </div>
          </div>
        </div>

        {/* Fixed Charges */}
        <div className={styles.section}>
          <h2>💰 Fixed Charges</h2>
          <div className={styles.chargesGrid}>
            <div className={styles.chargeCard}>
              <label>Water</label>
              <input
                type="number"
                step="0.01"
                value={defaultCharges.water}
                onChange={(e) => setDefaultCharges({...defaultCharges, water: e.target.value})}
                className={styles.input}
              />
              <span className={styles.unit}>₹ per flat</span>
            </div>

            <div className={styles.chargeCard}>
              <label>Security</label>
              <input
                type="number"
                step="0.01"
                value={defaultCharges.security}
                onChange={(e) => setDefaultCharges({...defaultCharges, security: e.target.value})}
                className={styles.input}
              />
              <span className={styles.unit}>₹ per flat</span>
            </div>

            <div className={styles.chargeCard}>
              <label>Electricity</label>
              <input
                type="number"
                step="0.01"
                value={defaultCharges.electricity}
                onChange={(e) => setDefaultCharges({...defaultCharges, electricity: e.target.value})}
                className={styles.input}
              />
              <span className={styles.unit}>₹ per flat</span>
            </div>
          </div>
        </div>

        {/* Custom Charges */}
        <div className={styles.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2>🎯 Custom Charges</h2>
            <button onClick={addCustomCharge} className="btn btn-success">
              + Add Charge
            </button>
          </div>

          {customCharges.length === 0 ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
              No custom charges. Click "+ Add Charge" to create one.
            </p>
          ) : (
            <div className={styles.customChargesList}>
              {customCharges.map((charge, index) => (
                <div key={charge.id} className={styles.customChargeRow}>
                  <div className={styles.rowNumber}>{index + 1}</div>
                  
                  <input
                    type="text"
                    placeholder="Charge name (e.g., Parking, Amenities)"
                    value={charge.name}
                    onChange={(e) => updateCharge(charge.id, 'name', e.target.value)}
                    className={styles.input}
                    style={{ flex: 2 }}
                  />

                  <select
                    value={charge.calculationType}
                    onChange={(e) => updateCharge(charge.id, 'calculationType', e.target.value)}
                    className={styles.select}
                    style={{ flex: 1 }}
                  >
                    <option value="Fixed">Fixed</option>
                    <option value="Per Sq Ft">Per Sq Ft</option>
                  </select>

                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={charge.defaultAmount}
                    onChange={(e) => updateCharge(charge.id, 'defaultAmount', e.target.value)}
                    className={styles.input}
                    style={{ flex: 1 }}
                  />

                  <button
                    onClick={() => deleteCharge(charge.id)}
                    className={styles.deleteBtn}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 🔥 LIVE MATRIX - ALWAYS VISIBLE */}
      <div className={styles.liveMatrixSection}>
        <h2>📊 Live Billing Matrix</h2>
        <p>Updates automatically as you change values above</p>
        
        {livePreview.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
            No members found. Import members first.
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.liveTable}>
              <thead>
                <tr>
                  {allColumns.map(col => (
                    <th key={col} className={col === 'Total' ? styles.totalColumn : ''}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {livePreview.slice(0, 10).map((row, idx) => (
                  <tr key={idx}>
                    <td><strong>{row.member}</strong></td>
                    <td>{row.memberName}</td>
                    <td>{row.area} sq ft</td>
                    <td>₹{row.Maintenance?.toFixed(2)}</td>
                    <td>₹{row['Sinking Fund']?.toFixed(2)}</td>
                    <td>₹{row['Repair Fund']?.toFixed(2)}</td>
                    <td>₹{row.Water?.toFixed(2)}</td>
                    <td>₹{row.Security?.toFixed(2)}</td>
                    <td>₹{row.Electricity?.toFixed(2)}</td>
                    {customCharges.map(c => c.name && (
                      <td key={c.id}>₹{row[c.name]?.toFixed(2) || '0.00'}</td>
                    ))}
                    <td className={styles.totalCell}>
                      <strong>₹{row.total?.toFixed(2)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {livePreview.length > 10 && (
              <div style={{ textAlign: 'center', padding: '1rem', color: '#6b7280' }}>
                Showing 10 of {livePreview.length} members
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
