'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import styles from '@/styles/GenerateBills.module.css';

export default function GenerateBillsPage() {
  const queryClient = useQueryClient();
  
  const [billMonth, setBillMonth] = useState(new Date().getMonth());
  const [billYear, setBillYear] = useState(new Date().getFullYear());
  const [dueDate, setDueDate] = useState('');
  
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Set default due date (10th of next month)
  useEffect(() => {
    const nextMonth = new Date(billYear, billMonth + 1, 10);
    setDueDate(nextMonth.toISOString().split('T')[0]);
  }, [billMonth, billYear]);

  // Fetch data
  const { data: societyData } = useQuery({
    queryKey: ['society-config'],
    queryFn: () => apiClient.get('/api/society/config')
  });

  const { data: membersData } = useQuery({
    queryKey: ['members-list'],
    queryFn: () => apiClient.get('/api/members/list')
  });

  const { data: billingHeadsData } = useQuery({
    queryKey: ['billing-heads'],
    queryFn: () => apiClient.get('/api/billing-heads/list')
  });

  const { data: templateData } = useQuery({
    queryKey: ['bill-template-full'],
    queryFn: () => apiClient.get('/api/bill-template/get-full')
  });

  // Calculate interest
  const calculateInterest = (principal, daysOverdue, rate, method, gracePeriod) => {
    if (principal <= 0) return 0;
    if (daysOverdue <= gracePeriod) return 0;

    const effectiveDays = daysOverdue - gracePeriod;
    const rateDecimal = rate / 100;

    if (method === 'SIMPLE') {
      // Simple Interest: P * R * T / 365
      return (principal * rateDecimal * effectiveDays) / 365;
    } else {
      // Compound Interest: P * [(1 + r/n)^(n*t) - 1]
      // Assuming monthly compounding (n = 12)
      const n = 12;
      const t = effectiveDays / 365;
      return principal * (Math.pow(1 + rateDecimal / n, n * t) - 1);
    }
  };

  // Generate preview with FULL calculations
  const generatePreview = async () => {
    if (!membersData?.members || membersData.members.length === 0) {
      alert('❌ No members found!');
      return;
    }

    if (!dueDate) {
      alert('❌ Please select due date');
      return;
    }

    const society = societyData?.society || {};
    const config = society.config || {};
    const members = membersData.members;
    const heads = billingHeadsData?.heads || [];

    const maintenanceRate = parseFloat(config.maintenanceRate) || 0;
    const sinkingFundRate = parseFloat(config.sinkingFundRate) || 0;
    const repairFundRate = parseFloat(config.repairFundRate) || 0;
    const fixedCharges = config.fixedCharges || {};
    
    // Interest config
    const interestRate = parseFloat(config.interestRate) || 21;
    const gracePeriodDays = parseInt(config.gracePeriodDays) || 10;
    const interestMethod = config.interestCalculationMethod || 'COMPOUND';
    const serviceTaxRate = parseFloat(config.serviceTaxRate) || 0;

    const billPeriodId = `${billYear}-${String(billMonth + 1).padStart(2, '0')}`;

    // Fetch previous balances for all members
    const previousBalancesResponse = await apiClient.post('/api/bills/get-previous-balances', {
      memberIds: members.map(m => m._id)
    });

    const previousBalances = previousBalancesResponse.balances || {};
// ADD THIS DEBUG LOG
    const preview = members.map(member => {
      const area = member.areaSqFt || member.carpetAreaSqft || 0;
      const flatNo = member.roomNo || member.flatNo || '';
      const memberId = member._id;

      // Get previous balance data
      const prevData = previousBalances[memberId] || {
        balance: 0,
        daysOverdue: 0,
        lastBillDate: null
      };

      // Calculate interest if there's previous balance
      const interestAmount = calculateInterest(
        prevData.balance,
        prevData.daysOverdue,
        interestRate,
        interestMethod,
        gracePeriodDays
      );

      // Current month charges
      const charges = [];
      
      charges.push({ 
        name: 'Maintenance', 
        rate: maintenanceRate,
        calculation: `${area} × ${maintenanceRate}`,
        perSqFt: true,
        amount: area * maintenanceRate 
      });
      
      charges.push({ 
        name: 'Sinking Fund', 
        rate: sinkingFundRate,
        calculation: `${area} × ${sinkingFundRate}`,
        perSqFt: true,
        amount: area * sinkingFundRate 
      });
      
      charges.push({ 
        name: 'Repair Fund', 
        rate: repairFundRate,
        calculation: `${area} × ${repairFundRate}`,
        perSqFt: true,
        amount: area * repairFundRate 
      });

      charges.push({ 
        name: 'Water', 
        fixed: true,
        amount: parseFloat(fixedCharges.water) || 0 
      });
      
      charges.push({ 
        name: 'Security', 
        fixed: true,
        amount: parseFloat(fixedCharges.security) || 0 
      });
      
      charges.push({ 
        name: 'Electricity', 
        fixed: true,
        amount: parseFloat(fixedCharges.electricity) || 0 
      });

      // Custom heads
      heads.forEach(head => {
        if (head.calculationType === 'Fixed') {
          charges.push({ 
            name: head.headName, 
            fixed: true,
            amount: parseFloat(head.defaultAmount) || 0 
          });
        } else if (head.calculationType === 'Per Sq Ft') {
          charges.push({ 
            name: head.headName,
            rate: head.defaultAmount,
            calculation: `${area} × ${head.defaultAmount}`,
            perSqFt: true,
            amount: area * parseFloat(head.defaultAmount) || 0 
          });
        }
      });

      // Filter out zero charges
      const activeCharges = charges.filter(c => c.amount > 0);

      // Calculate totals
      const subtotal = activeCharges.reduce((sum, c) => sum + c.amount, 0);
      const serviceTax = serviceTaxRate > 0 ? (subtotal * serviceTaxRate) / 100 : 0;
      const currentBillTotal = subtotal + serviceTax;
      const grandTotal = prevData.balance + interestAmount + currentBillTotal;
console.log('🔍 Building preview for', member.roomNo, {
  previousBalance: prevData.balance,
  interestAmount,
  currentBillTotal,
  grandTotal
});

      return {
        memberId,
        member: `${member.wing || ''}-${flatNo}`,
        memberName: member.ownerName || 'Unknown',
        memberContact: member.contact || '',
        area,
        
        // Previous balance data
        previousBalance: prevData.balance || 0,
  previousBalanceDays: prevData.daysOverdue || 0,
  lastBillDate: prevData.oldestUnpaidDate,
  unpaidBills: prevData.unpaidBills || [],              // ← ADD THIS
  recentTransactions: prevData.recentTransactions || [], // ← ADD THIS
          
        // Interest
        interestRate,
        interestMethod,
        gracePeriodDays,
        interestAmount: Math.round(interestAmount * 100) / 100,
        
        // Current charges
        charges: activeCharges,
        subtotal,
        serviceTax,
        serviceTaxRate,
        currentBillTotal,
        
        // Grand total
        grandTotal
      };
    });

    setPreviewData(preview);
    setPreviewIndex(0);
    setShowPreview(true);
  };

  // Confirm and generate bills
  const generateMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post('/api/bills/generate-final', {
        billMonth,
        billYear,
        dueDate,
        bills: previewData
      });
    },
    onSuccess: (data) => {
      alert(`✅ Generated ${data.count} bills successfully!`);
      setShowPreview(false);
      queryClient.invalidateQueries(['bills-list']);
    },
    onError: (error) => {
      alert('Failed to generate bills: ' + error.message);
    }
  });

  // Render bill HTML
const renderBillHTML = (billData) => {
  const template = templateData?.template;
  
  // If uploaded PDF exists, show PDF preview
 if (template?.type === 'uploaded-pdf' && template?.pdfUrl) {
  const hasFormFields = template.hasFormFields || false;
  const fieldCount = template.detectedFields?.length || 0;
  
  return `
    <div style="text-align: center;">
      <div style="background: #f9fafb; padding: 2rem; border-radius: 8px; margin-bottom: 1rem;">
        <p style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #374151;">
          <strong>📄 Bill will be generated using your uploaded PDF template</strong>
        </p>
        <p style="margin: 0; font-size: 0.95rem; color: #6b7280;">
          ${hasFormFields 
            ? `✅ Auto-detected ${fieldCount} fillable fields`
            : 'ℹ️ Data will be overlaid on PDF'
          }
        </p>
      </div>

      <!-- Show data that will be filled -->
      <div style="background: white; padding: 2rem; border-radius: 8px; border: 2px solid #e5e7eb; text-align: left;">
        <h3 style="margin: 0 0 1.5rem 0; color: #1f2937; border-bottom: 2px solid #4f46e5; padding-bottom: 0.75rem;">
          Data to be filled in PDF:
        </h3>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">
          <div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Member Name</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">${billData.memberName}</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Flat No</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">${billData.member}</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Area</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">${billData.area} sq ft</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Bill Period</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">${billYear}-${String(billMonth + 1).padStart(2, '0')}</div>
          </div>
        </div>

        <h4 style="margin: 0 0 1rem 0; color: #374151; font-size: 1rem;">Current Month Charges:</h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 0.75rem; text-align: left; border: 1px solid #e5e7eb; font-size: 0.875rem;">Sr.</th>
              <th style="padding: 0.75rem; text-align: left; border: 1px solid #e5e7eb; font-size: 0.875rem;">Particulars</th>
              <th style="padding: 0.75rem; text-align: right; border: 1px solid #e5e7eb; font-size: 0.875rem;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${billData.charges.map((charge, idx) => `
              <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f9fafb'};">
                <td style="padding: 0.75rem; border: 1px solid #e5e7eb;">${idx + 1}</td>
                <td style="padding: 0.75rem; border: 1px solid #e5e7eb;">${charge.name}</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid #e5e7eb; font-weight: 600;">
                  ${charge.amount.toFixed(2)}
                </td>
              </tr>
            `).join('')}
            <tr style="background: #dbeafe; font-weight: 700;">
              <td colspan="2" style="padding: 1rem; text-align: right; border: 1px solid #e5e7eb; color: #1e40af;">
                Current Month Total
              </td>
              <td style="padding: 1rem; text-align: right; border: 1px solid #e5e7eb; color: #1e40af; font-size: 1.2rem;">
                ₹${billData.currentBillTotal.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        <!-- PREVIOUS BALANCE MOVED HERE - AFTER CHARGES -->
        ${billData.previousBalance !== 0 ? `
          <div style="background: ${billData.previousBalance > 0 ? '#fee2e2' : '#d1fae5'}; border-left: 4px solid ${billData.previousBalance > 0 ? '#dc2626' : '#059669'}; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: ${billData.previousBalance > 0 ? '#991b1b' : '#065f46'};">
              ${billData.previousBalance > 0 ? '⚠️ Previous Outstanding Balance' : '✅ Advance Payment (Credit)'}
            </h4>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
              <div>
                <div style="font-size: 0.875rem; color: ${billData.previousBalance > 0 ? '#7f1d1d' : '#065f46'}; margin-bottom: 0.5rem;">
                  ${billData.previousBalance > 0 ? 'Amount Owed' : 'Advance Credit'}
                </div>
                <div style="font-size: 1.75rem; font-weight: 700; color: ${billData.previousBalance > 0 ? '#dc2626' : '#059669'};">
                  ₹${Math.abs(billData.previousBalance).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <div style="font-size: 0.875rem; color: ${billData.previousBalance > 0 ? '#7f1d1d' : '#065f46'}; margin-bottom: 0.5rem;">
                  Days ${billData.previousBalance > 0 ? 'Overdue' : 'in Credit'}
                </div>
                <div style="font-size: 1.75rem; font-weight: 700; color: ${billData.previousBalance > 0 ? '#dc2626' : '#059669'};">
                  ${billData.previousBalanceDays} days
                </div>
              </div>
            </div>

            ${billData.interestAmount > 0 ? `
              <div style="background: #7f1d1d; color: white; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                  <div style="font-size: 0.95rem; font-weight: 600;">💰 Interest Charged</div>
                  <div style="font-size: 1.5rem; font-weight: 700;">₹${billData.interestAmount.toLocaleString('en-IN')}</div>
                </div>
                <div style="font-size: 0.8rem; opacity: 0.9; line-height: 1.5;">
                  Rate: ${billData.interestRate}% p.a. (${billData.interestMethod})<br/>
                  Grace: ${billData.gracePeriodDays} days | Overdue: ${billData.previousBalanceDays} days<br/>
                  Chargeable: ${Math.max(0, billData.previousBalanceDays - billData.gracePeriodDays)} days
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- GRAND TOTAL -->
        <div style="background: #dbeafe; padding: 1.5rem; border-radius: 8px; border: 3px solid #1e40af; margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-size: 1.2rem; font-weight: 700; color: #1e40af;">
              TOTAL AMOUNT PAYABLE
            </div>
            <div style="font-size: 1.8rem; font-weight: 700; color: #1e40af;">
              ₹${billData.grandTotal.toFixed(2)}
            </div>
          </div>
          ${billData.previousBalance !== 0 ? `
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 2px solid #1e40af; font-size: 0.85rem; color: #1e40af;">
              ${billData.previousBalance > 0 ? `Previous: ₹${billData.previousBalance.toFixed(2)}` : `Credit: -₹${Math.abs(billData.previousBalance).toFixed(2)}`}
              ${billData.interestAmount > 0 ? ` + Interest: ₹${billData.interestAmount.toFixed(2)}` : ''}
              + Current: ₹${billData.currentBillTotal.toFixed(2)}
            </div>
          ` : ''}
        </div>

        <div style="background: #f9fafb; padding: 1rem; border-radius: 8px; border: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 0.875rem; color: #6b7280; text-align: center;">
            Click "Generate All Bills" to create PDF bills using your template
          </p>
        </div>
      </div>

      <!-- Show PDF Template Preview -->
      <div style="margin-top: 2rem; border: 2px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <div style="background: #1f2937; color: white; padding: 1rem; font-weight: 600;">
          📄 Your PDF Template (data will be filled here)
        </div>
        <iframe
          src="${template.pdfUrl}"
          style="width: 100%; height: 800px; border: none; background: white;"
        />
      </div>
    </div>
  `;
}


  // If uploaded image
  if (template?.type === 'uploaded-image' && template?.imageUrl) {
    return `
      <div style="text-align: center;">
        <div style="background: #f9fafb; padding: 2rem; border-radius: 8px; margin-bottom: 1rem;">
          <p style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #374151;">
            <strong>🖼️ Bill will be generated using your uploaded image template</strong>
          </p>
          <p style="margin: 0; font-size: 0.95rem; color: #6b7280;">
            Data will be overlaid on the image
          </p>
        </div>

        <!-- Show Image Template -->
        <div style="margin-top: 2rem; border: 2px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <div style="background: #1f2937; color: white; padding: 1rem; font-weight: 600;">
            🖼️ Your Image Template (data will be overlaid)
          </div>
          <img src="${template.imageUrl}" style="width: 100%; height: auto;" />
        </div>
      </div>
    `;
  }

  // Otherwise use custom design template
  const society = societyData?.society || {};
  const design = template?.design || {
    headerBg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    headerColor: '#ffffff',
    societyNameSize: 28,
    addressSize: 14,
    billTitleSize: 22,
    billTitleAlign: 'center',
    tableHeaderBg: '#4f46e5',
    tableHeaderColor: '#ffffff',
    tableRowBg1: '#ffffff',
    tableRowBg2: '#f9fafb',
    tableBorderColor: '#e5e7eb',
    totalBg: '#dbeafe',
    totalColor: '#1e40af',
    totalSize: 20,
    footerSize: 10,
    footerText: [
      'Payment should be made on or before due date',
      'Interest will be charged on overdue payments',
      'This is a computer-generated bill'
    ],
    showSignature: true,
    signatureLabel: 'Authorized Signatory'
  };
  
  const logoUrl = template?.logoUrl || '';
  const signatureUrl = template?.signatureUrl || '';
  
  return `
    <div style="max-width: 800px; margin: 0 auto; padding: 40px; font-family: Arial, sans-serif; background: white; border: 1px solid #e5e7eb; border-radius: 8px;">
      <!-- Header -->
      <div style="background: ${design.headerBg}; color: ${design.headerColor}; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
        ${logoUrl ? `<img src="${logoUrl}" style="width: 80px; margin-bottom: 15px;" />` : ''}
        <h1 style="margin: 0; font-size: ${design.societyNameSize}px;">${society.name || 'Society Name'}</h1>
        <p style="margin: 5px 0 0 0; font-size: ${design.addressSize}px; opacity: 0.9;">${society.address || ''}</p>
      </div>

      <!-- Bill Title -->
      <h2 style="text-align: ${design.billTitleAlign}; font-size: ${design.billTitleSize}px; margin: 0 0 20px 0; color: #1f2937;">
        MAINTENANCE BILL
      </h2>

      <!-- Bill Info -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
        <div><strong>Bill Period:</strong> ${billYear}-${String(billMonth + 1).padStart(2, '0')}</div>
        <div><strong>Bill Date:</strong> ${new Date().toLocaleDateString('en-IN')}</div>
        <div><strong>Member:</strong> ${billData.member}</div>
        <div><strong>Due Date:</strong> ${new Date(dueDate).toLocaleDateString('en-IN')}</div>
        <div><strong>Name:</strong> ${billData.memberName}</div>
        <div><strong>Area:</strong> ${billData.area} sq ft</div>
      </div>

      <!-- Previous Balance Section - SAME AS ABOVE -->
${Math.abs(billData.previousBalance) > 0 ? `
        <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 1rem 0; color: #991b1b;">⚠️ Previous Outstanding Balance</h4>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid #fca5a5;">
            <div>
              <div style="font-size: 0.875rem; color: #7f1d1d; margin-bottom: 0.5rem;">Total Outstanding</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #dc2626;">₹${billData.previousBalance.toLocaleString('en-IN')}</div>
            </div>
            <div>
              <div style="font-size: 0.875rem; color: #7f1d1d; margin-bottom: 0.5rem;">Days Overdue</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #dc2626;">${billData.previousBalanceDays || 0} days</div>
            </div>
          </div>

          ${billData.unpaidBills && billData.unpaidBills.length > 0 ? `
            <div style="margin-bottom: 1.5rem;">
              <h5 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: #7f1d1d; font-weight: 600;">📋 Unpaid Bills:</h5>
              <table style="width: 100%; font-size: 0.875rem; border-collapse: collapse;">
                <thead>
                  <tr style="background: #fca5a5;">
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid #dc2626; color: #7f1d1d;">Period</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid #dc2626; color: #7f1d1d;">Amount</th>
                    <th style="padding: 0.5rem; text-align: center; border: 1px solid #dc2626; color: #7f1d1d;">Due Date</th>
                    <th style="padding: 0.5rem; text-align: center; border: 1px solid #dc2626; color: #7f1d1d;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${billData.unpaidBills.map(bill => `
                    <tr style="background: white;">
                      <td style="padding: 0.5rem; border: 1px solid #fca5a5; font-weight: 600;">${bill.billPeriodId}</td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; font-weight: 600; color: #dc2626;">₹${bill.amount.toFixed(2)}</td>
                      <td style="padding: 0.5rem; text-align: center; border: 1px solid #fca5a5; font-size: 0.8rem;">${new Date(bill.dueDate).toLocaleDateString('en-IN')}</td>
                      <td style="padding: 0.5rem; text-align: center; border: 1px solid #fca5a5;">
                        <span style="background: #dc2626; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${bill.status}</span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}

          ${billData.recentTransactions && billData.recentTransactions.length > 0 ? `
            <div style="margin-bottom: 1.5rem;">
              <h5 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: #7f1d1d; font-weight: 600;">📊 Recent Transactions:</h5>
              <table style="width: 100%; font-size: 0.8rem; border-collapse: collapse;">
                <thead>
                  <tr style="background: #fca5a5;">
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid #dc2626; color: #7f1d1d;">Date</th>
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid #dc2626; color: #7f1d1d;">Description</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid #dc2626; color: #7f1d1d;">Debit</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid #dc2626; color: #7f1d1d;">Credit</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid #dc2626; color: #7f1d1d;">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  ${billData.recentTransactions.slice(0, 5).map(txn => `
                    <tr style="background: white;">
                      <td style="padding: 0.5rem; border: 1px solid #fca5a5; font-size: 0.75rem;">${new Date(txn.date).toLocaleDateString('en-IN')}</td>
                      <td style="padding: 0.5rem; border: 1px solid #fca5a5;">
                        ${txn.description || txn.category}
                        ${txn.billPeriod ? `<br/><span style="font-size: 0.7rem; color: #7f1d1d;">(${txn.billPeriod})</span>` : ''}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; color: ${txn.type === 'Debit' ? '#dc2626' : '#9ca3af'}; font-weight: ${txn.type === 'Debit' ? '600' : '400'};">
                        ${txn.type === 'Debit' ? '₹' + txn.amount.toFixed(2) : '-'}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; color: ${txn.type === 'Credit' ? '#059669' : '#9ca3af'}; font-weight: ${txn.type === 'Credit' ? '600' : '400'};">
                        ${txn.type === 'Credit' ? '₹' + txn.amount.toFixed(2) : '-'}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; font-weight: 600; color: ${txn.balance >= 0 ? '#059669' : '#dc2626'};">
                        ₹${txn.balance.toFixed(2)}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}

          ${billData.interestAmount > 0 ? `
            <div style="background: #7f1d1d; color: white; padding: 1rem; border-radius: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <div style="font-size: 0.95rem; font-weight: 600;">💰 Interest Charged</div>
                <div style="font-size: 1.5rem; font-weight: 700;">₹${billData.interestAmount.toLocaleString('en-IN')}</div>
              </div>
              <div style="font-size: 0.8rem; opacity: 0.9; line-height: 1.5;">
                Rate: ${billData.interestRate}% p.a. (${billData.interestMethod})<br/>
                Grace: ${billData.gracePeriodDays} days | Overdue: ${billData.previousBalanceDays} days<br/>
                Chargeable: ${Math.max(0, billData.previousBalanceDays - billData.gracePeriodDays)} days
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- Current Charges Table -->
      <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #374151; font-weight: 600;">Current Month Charges</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: ${design.tableHeaderBg}; color: ${design.tableHeaderColor};">
            <th style="padding: 12px; text-align: left; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Sr.</th>
            <th style="padding: 12px; text-align: left; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Particulars</th>
            <th style="padding: 12px; text-align: center; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Calculation</th>
            <th style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${billData.charges.map((charge, idx) => `
            <tr style="background: ${idx % 2 === 0 ? design.tableRowBg1 : design.tableRowBg2};">
              <td style="padding: 10px; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">${idx + 1}</td>
              <td style="padding: 10px; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">
                <strong>${charge.name}</strong>
              </td>
              <td style="padding: 10px; text-align: center; border: 1px solid ${design.tableBorderColor}; font-size: 12px; color: #6b7280;">
                ${charge.calculation || (charge.fixed ? 'Fixed' : '-')}
              </td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 13px;">
                ${charge.amount.toFixed(2)}
              </td>
            </tr>
          `).join('')}
          <tr style="background: #f9fafb;">
            <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 14px;">Subtotal</td>
            <td style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 700; font-size: 14px;">
              ${billData.subtotal.toFixed(2)}
            </td>
          </tr>
          ${billData.serviceTax > 0 ? `
            <tr style="background: #f9fafb;">
              <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Service Tax (${billData.serviceTaxRate}%)</td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 13px;">
                ${billData.serviceTax.toFixed(2)}
              </td>
            </tr>
          ` : ''}
          <tr style="background: ${design.totalBg}; font-weight: 700;">
            <td colspan="3" style="padding: 14px; text-align: right; border: 1px solid ${design.tableBorderColor}; color: ${design.totalColor}; font-size: 15px;">
              CURRENT BILL TOTAL
            </td>
            <td style="padding: 14px; text-align: right; border: 1px solid ${design.tableBorderColor}; color: ${design.totalColor}; font-size: 16px;">
              ₹${billData.currentBillTotal.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Grand Total -->
      <div style="background: ${design.totalBg}; padding: 25px; border-radius: 8px; margin-bottom: 30px; border: 3px solid ${design.totalColor};">
        <div style="margin-bottom: 15px;">
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">Calculation:</div>
          <div style="font-size: 13px; color: #374151; line-height: 1.6;">
${Math.abs(billData.previousBalance) > 0 ? `
              <div>Previous Balance: <strong>₹${billData.previousBalance.toFixed(2)}</strong></div>
            ` : ''}
            ${billData.interestAmount > 0 ? `
              <div>Interest: <strong>+₹${billData.interestAmount.toFixed(2)}</strong></div>
            ` : ''}
            <div>Current Bill: <strong>+₹${billData.currentBillTotal.toFixed(2)}</strong></div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 15px; border-top: 2px solid ${design.totalColor};">
          <div style="font-size: 16px; font-weight: 700; color: ${design.totalColor};">
            TOTAL AMOUNT PAYABLE
          </div>
          <div style="font-size: ${design.totalSize}px; font-weight: 700; color: ${design.totalColor};">
            ₹${billData.grandTotal.toFixed(2)}
          </div>
        </div>
      </div>

      <!-- Footer Instructions -->
      ${design.footerText && design.footerText.length > 0 ? `
        <div style="border-top: 2px solid #e5e7eb; padding-top: 20px; margin-bottom: 30px;">
          <strong style="display: block; margin-bottom: 10px; color: #1f2937;">Terms & Conditions:</strong>
          <ol style="margin: 0; padding-left: 20px; font-size: ${design.footerSize}px; color: #6b7280; line-height: 1.8;">
            ${design.footerText.map(text => `<li style="margin-bottom: 5px;">${text}</li>`).join('')}
          </ol>
        </div>
      ` : ''}

      <!-- Signature -->
      ${design.showSignature ? `
        <div style="text-align: right; margin-top: 40px;">
          ${signatureUrl ? `
            <img src="${signatureUrl}" style="width: 150px; height: auto; margin-bottom: 10px;" />
          ` : `
            <div style="height: 60px; border-bottom: 2px solid #000; width: 200px; margin-left: auto; margin-bottom: 10px;"></div>
          `}
          <div style="font-size: 12px; color: #6b7280; font-weight: 600;">${design.signatureLabel || 'Authorized Signatory'}</div>
        </div>
      ` : ''}

      <!-- Generation Info -->
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 10px; color: #9ca3af;">
        Generated on ${new Date().toLocaleString('en-IN')} | Computer Generated Bill
      </div>
    </div>
  `;
};



  const currentBill = previewData?.[previewIndex];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>⚡ Generate Bills</h1>
          <p>Preview each bill with interest calculations before generating</p>
        </div>
      </div>

      {/* Stats Banner */}
      {membersData?.members && (
        <div className={styles.statsBanner}>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{membersData.members.length}</div>
            <div className={styles.statLabel}>Total Members</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{billingHeadsData?.heads?.length || 0}</div>
            <div className={styles.statLabel}>Billing Heads</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{societyData?.society?.config?.interestRate || 0}%</div>
            <div className={styles.statLabel}>Interest Rate</div>
          </div>
        </div>
      )}

      {/* Form */}
      <div className={styles.formCard}>
        <h2>📅 Select Billing Period</h2>
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Bill Month</label>
            <select
              value={billMonth}
              onChange={(e) => setBillMonth(parseInt(e.target.value))}
              className={styles.select}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>
                  {new Date(2000, i).toLocaleString('default', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Bill Year</label>
            <input
              type="number"
              value={billYear}
              onChange={(e) => setBillYear(parseInt(e.target.value))}
              className={styles.input}
              min="2020"
              max="2030"
            />
          </div>

          <div className={styles.formGroup}>
            <label>Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={styles.input}
            />
          </div>
        </div>

        <div className={styles.formActions}>
          <button onClick={generatePreview} className="btn btn-primary btn-lg" style={{ minWidth: '300px' }}>
            👁️ Preview All Bills with Interest
          </button>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && previewData && currentBill && (
        <div className={styles.modal} onClick={() => setShowPreview(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2>📄 Bill Preview - {currentBill.member}</h2>
                <p style={{ margin: '5px 0 0 0', color: '#6b7280', fontSize: '0.95rem' }}>
                  {currentBill.memberName} | {currentBill.area} sq ft
                  {currentBill.previousBalance > 0 && (
                    <span style={{ color: '#dc2626', fontWeight: '600', marginLeft: '15px' }}>
                      ⚠️ Has Outstanding: ₹{currentBill.previousBalance.toLocaleString('en-IN')}
                    </span>
                  )}
                </p>
              </div>
              <button onClick={() => setShowPreview(false)} className={styles.closeBtn}>
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              <div dangerouslySetInnerHTML={{ __html: renderBillHTML(currentBill) }} />
            </div>

            <div className={styles.modalFooter}>
              <div className={styles.navigation}>
                <button
                  onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                  disabled={previewIndex === 0}
                  className="btn btn-secondary"
                >
                  ← Previous
                </button>
                <span className={styles.pageInfo}>
                  <strong>{previewIndex + 1}</strong> of <strong>{previewData.length}</strong>
                </span>
                <button
                  onClick={() => setPreviewIndex(Math.min(previewData.length - 1, previewIndex + 1))}
                  disabled={previewIndex === previewData.length - 1}
                  className="btn btn-secondary"
                >
                  Next →
                </button>
              </div>

              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="btn btn-success btn-lg"
                style={{ minWidth: '250px' }}
              >
                {generateMutation.isPending ? '⏳ Generating...' : `✅ Generate All ${previewData.length} Bills`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
