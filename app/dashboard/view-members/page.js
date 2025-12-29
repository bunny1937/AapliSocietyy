'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import styles from '@/styles/ViewMembers.module.css';

export default function ViewMembersPage() {
  const [selectedMember, setSelectedMember] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterOwnership, setFilterOwnership] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['members-detailed'],
    queryFn: async () => {
      const response = await fetch('/api/members/list?limit=1000', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    }
  });

  const members = data?.members || [];

  // Filter members
  const filteredMembers = members.filter(member => {
    const matchesSearch = 
      member.flatNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.wing?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.ownerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.contactNumber?.includes(searchTerm) ||
      member.emailPrimary?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = filterStatus === 'all' || member.membershipStatus === filterStatus;
    const matchesOwnership = filterOwnership === 'all' || member.ownershipType === filterOwnership;
    
    return matchesSearch && matchesStatus && matchesOwnership;
  });

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loader}>
          <div className={styles.spinner}></div>
          <p>Loading members...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>👥 View All Members</h1>
        <p className={styles.subtitle}>Complete member directory with detailed information</p>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <input
          type="text"
          placeholder="🔍 Search by flat, name, phone, email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles.searchInput}
        />

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className={styles.select}
        >
          <option value="all">All Status</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="Suspended">Suspended</option>
          <option value="Blocked">Blocked</option>
        </select>

        <select
          value={filterOwnership}
          onChange={(e) => setFilterOwnership(e.target.value)}
          className={styles.select}
        >
          <option value="all">All Ownership</option>
          <option value="Owner-Occupied">Owner-Occupied</option>
          <option value="Rented">Rented</option>
          <option value="Vacant">Vacant</option>
          <option value="Under-Dispute">Under-Dispute</option>
        </select>

        <div className={styles.resultCount}>
          {filteredMembers.length} of {members.length} members
        </div>
      </div>

      {/* Members Grid */}
      <div className={styles.membersGrid}>
        {filteredMembers.map(member => (
          <div
            key={member._id}
            className={styles.memberCard}
            onClick={() => setSelectedMember(member)}
          >
            <div className={styles.cardHeader}>
              <div className={styles.flatNumber}>
                {member.wing ? `${member.wing}-` : ''}{member.flatNo}
              </div>
              <div className={`${styles.badge} ${styles[`badge${member.membershipStatus}`]}`}>
                {member.membershipStatus}
              </div>
            </div>

            <h3 className={styles.memberName}>{member.ownerName}</h3>
            
            <div className={styles.cardDetails}>
              <div className={styles.detailRow}>
                <span className={styles.icon}>📞</span>
                <span>{member.contactNumber}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.icon}>📧</span>
                <span className={styles.email}>{member.emailPrimary}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.icon}>🏠</span>
                <span>{member.flatType} • {member.carpetAreaSqft} sq.ft</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.icon}>👤</span>
                <span>{member.ownershipType}</span>
              </div>
            </div>

            <button className={styles.viewButton}>
              View Full Details →
            </button>
          </div>
        ))}
      </div>

      {filteredMembers.length === 0 && (
        <div className={styles.emptyState}>
          <p>No members found matching your filters</p>
        </div>
      )}

      {/* Detailed Dialog */}
      {selectedMember && (
        <div className={styles.dialogOverlay} onClick={() => setSelectedMember(null)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.dialogHeader}>
              <h2>
                Complete Details - {selectedMember.wing ? `${selectedMember.wing}-` : ''}
                {selectedMember.flatNo}
              </h2>
              <button
                className={styles.closeButton}
                onClick={() => setSelectedMember(null)}
              >
                ✕
              </button>
            </div>

            <div className={styles.dialogContent}>
              {/* Basic Info */}
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>🏢 Flat Information</h3>
                <div className={styles.grid}>
                  <div className={styles.field}>
                    <label>Flat Number</label>
                    <div>{selectedMember.flatNo}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Wing</label>
                    <div>{selectedMember.wing || 'N/A'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Floor</label>
                    <div>{selectedMember.floor || 'N/A'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Flat Type</label>
                    <div>{selectedMember.flatType}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Carpet Area</label>
                    <div>{selectedMember.carpetAreaSqft} sq.ft</div>
                  </div>
                  <div className={styles.field}>
                    <label>Built-up Area</label>
                    <div>{selectedMember.builtUpAreaSqft || 'N/A'} sq.ft</div>
                  </div>
                  <div className={styles.field}>
                    <label>Ownership Type</label>
                    <div><span className={styles.badge}>{selectedMember.ownershipType}</span></div>
                  </div>
                  <div className={styles.field}>
                    <label>Possession Date</label>
                    <div>{selectedMember.possessionDate ? new Date(selectedMember.possessionDate).toLocaleDateString() : 'N/A'}</div>
                  </div>
                </div>
              </section>

              {/* Owner Info */}
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>👤 Owner Information</h3>
                <div className={styles.grid}>
                  <div className={styles.field}>
                    <label>Owner Name</label>
                    <div>{selectedMember.ownerName}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Contact Number</label>
                    <div>{selectedMember.contactNumber}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Alternate Contact</label>
                    <div>{selectedMember.alternateContact || 'N/A'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>WhatsApp</label>
                    <div>{selectedMember.whatsappNumber || 'N/A'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Primary Email</label>
                    <div>{selectedMember.emailPrimary}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Secondary Email</label>
                    <div>{selectedMember.emailSecondary || 'N/A'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>PAN Card</label>
                    <div>{selectedMember.panCard || 'N/A'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Aadhaar</label>
                    <div>{selectedMember.aadhaar || 'N/A'}</div>
                  </div>
                </div>
              </section>

              {/* Family Members */}
              {selectedMember.familyMembers && selectedMember.familyMembers.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>👨‍👩‍👧‍👦 Family Members</h3>
                  <div className={styles.familyGrid}>
                    {selectedMember.familyMembers.map((family, idx) => (
                      <div key={idx} className={styles.familyCard}>
                        <div><strong>{family.name}</strong></div>
                        <div>{family.relation} • {family.age} years</div>
                        {family.occupation && <div>{family.occupation}</div>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Parking Slots */}
              {selectedMember.parkingSlots && selectedMember.parkingSlots.length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>🚗 Parking Slots</h3>
                  {selectedMember.parkingSlots.map((slot, idx) => (
                    <div key={idx} className={styles.parkingCard}>
                      <strong>{slot.slotNumber}</strong> - {slot.type} - {slot.vehicleType}
                    </div>
                  ))}
                </section>
              )}

{/* Owner History - FIXED */}
{selectedMember.ownerHistory && selectedMember.ownerHistory.length > 0 && (
  <section className={styles.section}>
    <h3 className={styles.sectionTitle}>📜 Ownership Timeline</h3>
    
    <div className={styles.infoBox}>
      <strong>Current Owner:</strong> {selectedMember.ownerName} 
      <span style={{ 
        marginLeft: '1rem', 
        color: '#10B981',
        fontWeight: 600 
      }}>
        ● Active
      </span>
    </div>
    
    {selectedMember.ownerHistory.length > 0 && (
      <>
        <h4 style={{ 
          marginTop: '1.5rem', 
          marginBottom: '1rem', 
          fontSize: '0.9rem', 
          color: '#6B7280',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          Previous Owners
        </h4>
        
        <div className={styles.timeline}>
          {selectedMember.ownerHistory
            .sort((a, b) => (b.ownerSequence || 0) - (a.ownerSequence || 0))
            .map((owner, idx) => (
              <div key={idx} className={styles.timelineItem}>
                <div className={styles.timelineDot} />
                
                <div className={styles.timelineContent}>
                  {/* Header */}
                  <div className={styles.timelineHeader}>
                    <span className={styles.sequenceBadge}>
                      Owner #{owner.ownerSequence || (selectedMember.ownerHistory.length - idx)}
                    </span>
                    <strong style={{ marginLeft: '0.75rem', fontSize: '1.05rem' }}>
                      {owner.ownerName}
                    </strong>
                  </div>
                  
                  {/* Dates */}
                  <div className={styles.timelineDate} style={{ marginTop: '0.5rem' }}>
                    {owner.ownershipStartDate && (
                      <span style={{ fontWeight: 500 }}>
                        📅 {new Date(owner.ownershipStartDate).toLocaleDateString('en-IN', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </span>
                    )}
                    {owner.ownershipEndDate && (
                      <>
                        <span style={{ margin: '0 0.75rem', color: '#9CA3AF' }}>→</span>
                        <span style={{ fontWeight: 500 }}>
                          {new Date(owner.ownershipEndDate).toLocaleDateString('en-IN', { 
                            year: 'numeric', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </span>
                      </>
                    )}
                    {owner.durationMonths && (
                      <span style={{ 
                        marginLeft: '1rem', 
                        padding: '0.25rem 0.5rem',
                        backgroundColor: '#F3F4F6',
                        borderRadius: '6px',
                        color: '#4B5563', 
                        fontSize: '0.85rem',
                        fontWeight: 500
                      }}>
                        {Math.floor(owner.durationMonths / 12)}y {owner.durationMonths % 12}m
                      </span>
                    )}
                  </div>
                  
                  {/* Contact & ID Details */}
                  <div className={styles.ownerDetails} style={{ marginTop: '1rem' }}>
                    {owner.contactNumber && (
                      <div className={styles.detailItem}>
                        <span className={styles.detailIcon}>📞</span>
                        {owner.contactNumber}
                      </div>
                    )}
                    {owner.emailPrimary && (
                      <div className={styles.detailItem}>
                        <span className={styles.detailIcon}>📧</span>
                        <span style={{ fontSize: '0.9rem' }}>{owner.emailPrimary}</span>
                      </div>
                    )}
                    {owner.panCard && (
                      <div className={styles.detailItem}>
                        <span className={styles.detailIcon}>🆔</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {owner.panCard}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {/* Financial Details */}
                  {(owner.purchaseAmount || owner.saleAmount) && (
                    <div style={{
                      marginTop: '1rem',
                      padding: '1rem',
                      backgroundColor: '#FEF3C7',
                      borderRadius: '8px',
                      border: '1px solid #FCD34D'
                    }}>
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '0.75rem'
                      }}>
                        {owner.purchaseAmount && (
                          <div>
                            <div style={{ 
                              fontSize: '0.75rem', 
                              color: '#92400E', 
                              marginBottom: '0.25rem',
                              fontWeight: 600
                            }}>
                              💰 Purchase Price
                            </div>
                            <div style={{ 
                              fontWeight: 700, 
                              color: '#78350F', 
                              fontSize: '1rem' 
                            }}>
                              ₹{Number(owner.purchaseAmount).toLocaleString('en-IN')}
                            </div>
                          </div>
                        )}
                        
                        {owner.saleAmount && (
                          <div>
                            <div style={{ 
                              fontSize: '0.75rem', 
                              color: '#92400E', 
                              marginBottom: '0.25rem',
                              fontWeight: 600
                            }}>
                              💵 Sale Price
                            </div>
                            <div style={{ 
                              fontWeight: 700, 
                              color: '#78350F', 
                              fontSize: '1rem' 
                            }}>
                              ₹{Number(owner.saleAmount).toLocaleString('en-IN')}
                            </div>
                          </div>
                        )}
                        
                        {owner.purchaseAmount && owner.saleAmount && (
                          <div>
                            <div style={{ 
                              fontSize: '0.75rem', 
                              color: '#92400E', 
                              marginBottom: '0.25rem',
                              fontWeight: 600
                            }}>
                              📈 Profit/Loss
                            </div>
                            <div style={{ 
                              fontWeight: 700, 
                              fontSize: '1rem',
                              color: owner.saleAmount >= owner.purchaseAmount ? '#059669' : '#DC2626'
                            }}>
                              {owner.saleAmount >= owner.purchaseAmount ? '+' : ''}
                              ₹{Math.abs(Number(owner.saleAmount) - Number(owner.purchaseAmount)).toLocaleString('en-IN')}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </>
    )}
  </section>
)}


             {/* Tenant History */}
{selectedMember.tenantHistory && selectedMember.tenantHistory.length > 0 && (
  <section className={styles.section}>
    <h3 className={styles.sectionTitle}>🏠 Tenant History</h3>
    <div className={styles.timeline}>
      {selectedMember.tenantHistory
        .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
        .map((tenant, idx) => (
          <div 
            key={idx} 
            className={`${styles.timelineItem} ${tenant.isCurrent ? styles.currentTenant : ''}`}
          >
            <div 
              className={styles.timelineDot} 
              style={{ 
                backgroundColor: tenant.isCurrent ? '#10B981' : '#6B7280',
                boxShadow: tenant.isCurrent ? '0 0 0 4px rgba(16, 185, 129, 0.2)' : 'none'
              }}
            />
            <div className={styles.timelineContent}>
              <div className={styles.timelineHeader}>
                <span className={styles.sequenceBadge}>
                  Tenant #{tenant.tenantSequence || (idx + 1)}
                </span>
                <strong style={{ marginLeft: '0.5rem' }}>{tenant.name}</strong>
                {tenant.isCurrent && (
                  <span 
                    className={styles.currentBadge}
                    style={{
                      marginLeft: 'auto',
                      background: '#10B981',
                      color: 'white',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: '600'
                    }}
                  >
                    ● Current
                  </span>
                )}
              </div>
              <div className={styles.timelineDate}>
                <span>
                  📅 {new Date(tenant.startDate).toLocaleDateString('en-IN', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </span>
                <span style={{ margin: '0 0.5rem' }}>→</span>
                {tenant.endDate ? (
                  <span>
                    {new Date(tenant.endDate).toLocaleDateString('en-IN', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </span>
                ) : (
                  <span style={{ color: '#10B981', fontWeight: '600' }}>Present</span>
                )}
              </div>
              <div className={styles.ownerDetails}>
                {tenant.contactNumber && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>📞</span>
                    {tenant.contactNumber}
                  </div>
                )}
                {tenant.email && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>📧</span>
                    {tenant.email}
                  </div>
                )}
                {tenant.panCard && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>🆔</span>
                    PAN: {tenant.panCard}
                  </div>
                )}
                {tenant.depositAmount && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>💵</span>
                    Deposit: ₹{Number(tenant.depositAmount).toLocaleString('en-IN')}
                  </div>
                )}
                {tenant.rentPerMonth && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>💰</span>
                    Rent: ₹{Number(tenant.rentPerMonth).toLocaleString('en-IN')}/month
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
    </div>
  </section>
)}
              {/* Financial Info */}
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>💰 Financial Information</h3>
                <div className={styles.grid}>
                  <div className={styles.field}>
                    <label>Opening Balance</label>
                    <div className={selectedMember.openingBalance >= 0 ? styles.credit : styles.debit}>
                      ₹{Math.abs(selectedMember.openingBalance || 0).toLocaleString()}
                      {selectedMember.openingBalance >= 0 ? ' (CR)' : ' (DR)'}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label>Membership Number</label>
                    <div>{selectedMember.membershipNumber || 'N/A'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Voting Rights</label>
                    <div>{selectedMember.hasVotingRights ? '✅ Yes' : '❌ No'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Status</label>
                    <div><span className={`${styles.badge} ${styles[`badge${selectedMember.membershipStatus}`]}`}>
                      {selectedMember.membershipStatus}
                    </span></div>
                  </div>
                </div>
              </section>

              {/* System Info */}
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>⚙️ System Information</h3>
                <div className={styles.grid}>
                  <div className={styles.field}>
                    <label>Created At</label>
                    <div>{new Date(selectedMember.createdAt).toLocaleString()}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Last Updated</label>
                    <div>{new Date(selectedMember.updatedAt).toLocaleString()}</div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
