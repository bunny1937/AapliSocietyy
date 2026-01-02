'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import styles from '@/styles/BillTemplate.module.css';

// 3 DEFAULT TEMPLATES
const DEFAULT_TEMPLATES = {
  modern: {
    name: 'Modern',
    design: {
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
        'Interest will be charged on overdue payments as per society rules',
        'This is a computer-generated bill'
      ],
      showSignature: true,
      signatureLabel: 'Authorized Signatory'
    }
  },
  classic: {
    name: 'Classic',
    design: {
      headerBg: '#f9fafb',
      headerColor: '#1f2937',
      societyNameSize: 24,
      addressSize: 12,
      billTitleSize: 20,
      billTitleAlign: 'center',
      tableHeaderBg: '#1f2937',
      tableHeaderColor: '#ffffff',
      tableRowBg1: '#ffffff',
      tableRowBg2: '#ffffff',
      tableBorderColor: '#000000',
      totalBg: '#f3f4f6',
      totalColor: '#1f2937',
      totalSize: 18,
      footerSize: 10,
      footerText: [
        'Please make payment by due date to avoid interest charges',
        'For any queries, contact society office',
        'Thank you for your cooperation'
      ],
      showSignature: true,
      signatureLabel: 'Secretary'
    }
  },
  minimal: {
    name: 'Minimal',
    design: {
      headerBg: '#ffffff',
      headerColor: '#000000',
      societyNameSize: 22,
      addressSize: 11,
      billTitleSize: 18,
      billTitleAlign: 'left',
      tableHeaderBg: '#000000',
      tableHeaderColor: '#ffffff',
      tableRowBg1: '#ffffff',
      tableRowBg2: '#ffffff',
      tableBorderColor: '#000000',
      totalBg: '#000000',
      totalColor: '#ffffff',
      totalSize: 16,
      footerSize: 9,
      footerText: [
        'Pay by due date',
        'Contact office for queries'
      ],
      showSignature: false,
      signatureLabel: ''
    }
  }
};

export default function BillTemplateDesigner() {
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState('select'); // select, design, upload
  const [selectedTemplate, setSelectedTemplate] = useState('modern');
  const [template, setTemplate] = useState(DEFAULT_TEMPLATES.modern.design);
  
  // Upload states
  const [uploadedPDF, setUploadedPDF] = useState(null);
  const [pdfHasFormFields, setPdfHasFormFields] = useState(false);
  const [detectedFields, setDetectedFields] = useState([]);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [uploadedLogo, setUploadedLogo] = useState(null);
  const [uploadedSignature, setUploadedSignature] = useState(null);
  
   // PDF Editor states
  const [showPDFEditor, setShowPDFEditor] = useState(false);
  const [pdfFields, setPdfFields] = useState([]);
  const [selectedField, setSelectedField] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

 
  // Fetch society
  const { data: societyData } = useQuery({
    queryKey: ['society-config'],
    queryFn: () => apiClient.get('/api/society/config')
  });

   const { data: billingHeadsData } = useQuery({
    queryKey: ['billing-heads'],
    queryFn: () => apiClient.get('/api/billing-heads/list')
  });

  // Fetch saved template
  const { data: savedTemplateData } = useQuery({
    queryKey: ['bill-template-full'],
    queryFn: () => apiClient.get('/api/bill-template/get-full')
  });

  // Load saved template
  useEffect(() => {
    if (savedTemplateData?.template) {
      const saved = savedTemplateData.template;
      
      if (saved.type === 'custom' && saved.design) {
        setActiveTab('design');
        setTemplate(saved.design);
      } else if (saved.type === 'uploaded-pdf' && saved.pdfUrl) {
        setActiveTab('upload');
        setUploadedPDF(saved.pdfUrl);
        setPdfFields(saved.pdfFields || []);
      } else if (saved.type === 'uploaded-image' && saved.imageUrl) {
        setActiveTab('upload');
        setUploadedImage(saved.imageUrl);
      }
      
      setUploadedLogo(saved.logoUrl);
      setUploadedSignature(saved.signatureUrl);
    }
  }, [savedTemplateData]);

  // Save template mutation
  useEffect(() => {
    if (savedTemplateData?.template) {
      const saved = savedTemplateData.template;
      
      if (saved.type === 'custom' && saved.design) {
        setActiveTab('design');
        setTemplate(saved.design);
      } else if (saved.type === 'uploaded-pdf' && saved.pdfUrl) {
        setActiveTab('upload');
        setUploadedPDF(saved.pdfUrl);
        setPdfHasFormFields(saved.hasFormFields || false);
        setDetectedFields(saved.detectedFields || []);
      } else if (saved.type === 'uploaded-image' && saved.imageUrl) {
        setActiveTab('upload');
        setUploadedImage(saved.imageUrl);
      }
      
      setUploadedLogo(saved.logoUrl);
      setUploadedSignature(saved.signatureUrl);
    }
  }, [savedTemplateData]);

  // Save template mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      let templateData = {};
      
      if (activeTab === 'select' || activeTab === 'design') {
        templateData = {
          type: 'custom',
          design: template,
          logoUrl: uploadedLogo,
          signatureUrl: uploadedSignature
        };
      } else if (activeTab === 'upload') {
        if (uploadedPDF) {
          templateData = {
            type: 'uploaded-pdf',
            pdfUrl: uploadedPDF,
            hasFormFields: pdfHasFormFields,
            detectedFields,
            logoUrl: uploadedLogo,
            signatureUrl: uploadedSignature
          };
        } else if (uploadedImage) {
          templateData = {
            type: 'uploaded-image',
            imageUrl: uploadedImage,
            logoUrl: uploadedLogo,
            signatureUrl: uploadedSignature
          };
        }
      }
      
      return apiClient.post('/api/bill-template/save-full', templateData);
    },
    onSuccess: () => {
      alert('✅ Template saved successfully!');
      queryClient.invalidateQueries(['bill-template-full']);
    },
    onError: (error) => {
      alert('Failed to save: ' + error.message);
    }
  });

  // SMART PDF UPLOAD - Auto-detect form fields
  const handlePDFUpload = async (file) => {
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/bill-template/upload-pdf-smart', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      
      setUploadedPDF(data.url);
      setPdfHasFormFields(data.hasFormFields);
      setDetectedFields(data.detectedFields || []);

      if (data.hasFormFields) {
        alert(`✅ PDF uploaded! Auto-detected ${data.detectedFields.length} fillable fields.\n\nSystem will auto-fill these when generating bills.`);
      } else {
        alert('✅ PDF uploaded! No fillable fields detected.\n\nSystem will overlay data on PDF.');
      }
    } catch (error) {
      alert('Upload failed: ' + error.message);
    }
  };

  // Upload other files
  const handleFileUpload = async (file, type) => {
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
      const response = await fetch('/api/bill-template/upload-file', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      
      if (type === 'image') {
        setUploadedImage(data.url);
      } else if (type === 'logo') {
        setUploadedLogo(data.url);
      } else if (type === 'signature') {
        setUploadedSignature(data.url);
      }

      alert(`✅ ${type} uploaded successfully!`);
    } catch (error) {
      alert('Upload failed: ' + error.message);
    }
  };

  // Apply default template
  const applyDefaultTemplate = (key) => {
    setSelectedTemplate(key);
    setTemplate(DEFAULT_TEMPLATES[key].design);
    setActiveTab('design');
  };

  // Update template field
  const updateTemplate = (key, value) => {
    setTemplate({ ...template, [key]: value });
  };

  // Add/Remove footer text
  const addFooterLine = () => {
    setTemplate({
      ...template,
      footerText: [...template.footerText, 'New instruction']
    });
  };

  const updateFooterLine = (index, value) => {
    const newFooter = [...template.footerText];
    newFooter[index] = value;
    setTemplate({ ...template, footerText: newFooter });
  };

  const removeFooterLine = (index) => {
    setTemplate({
      ...template,
      footerText: template.footerText.filter((_, i) => i !== index)
    });
  };

  // Generate preview HTML (same as before, but with dynamic billing heads)
  const generatePreviewHTML = () => {
    const society = societyData?.society || {};
    const config = society.config || {};
    const heads = billingHeadsData?.heads || [];
    
    // Build charges from billing heads
    const charges = [];
    charges.push({ name: 'Maintenance', amount: 3600, rate: 3, perSqFt: true });
    charges.push({ name: 'Sinking Fund', amount: 1200, rate: 1, perSqFt: true });
    charges.push({ name: 'Repair Fund', amount: 600, rate: 0.5, perSqFt: true });
    
    // Add custom heads
    heads.forEach(head => {
      if (head.calculationType === 'Fixed') {
        charges.push({ name: head.headName, amount: head.defaultAmount, fixed: true });
      } else if (head.calculationType === 'Per Sq Ft') {
        charges.push({ 
          name: head.headName, 
          amount: 1200 * head.defaultAmount, 
          rate: head.defaultAmount,
          perSqFt: true 
        });
      }
    });
// Full preview HTML (same as before)
     return `
      <div style="max-width: 800px; margin: 0 auto; padding: 40px; font-family: Arial, sans-serif; background: white;">
        <!-- Header -->
        <div style="background: ${template.headerBg}; color: ${template.headerColor}; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
          ${uploadedLogo ? `<img src="${uploadedLogo}" style="width: 80px; margin-bottom: 15px;" />` : ''}
          <h1 style="margin: 0; font-size: ${template.societyNameSize}px;">${sampleData.societyName}</h1>
          <p style="margin: 5px 0 0 0; font-size: ${template.addressSize}px; opacity: 0.9;">${sampleData.societyAddress}</p>
        </div>

        <!-- Bill Title -->
        <h2 style="text-align: ${template.billTitleAlign}; font-size: ${template.billTitleSize}px; margin: 0 0 20px 0;">
          MAINTENANCE BILL
        </h2>

        <!-- Bill Info -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
          <div><strong>Bill Period:</strong> ${sampleData.billPeriod}</div>
          <div><strong>Bill Date:</strong> ${sampleData.billDate}</div>
          <div><strong>Member:</strong> ${sampleData.flatNo}</div>
          <div><strong>Due Date:</strong> ${sampleData.dueDate}</div>
          <div><strong>Name:</strong> ${sampleData.memberName}</div>
          <div><strong>Area:</strong> ${sampleData.area} sq ft</div>
        </div>

        <!-- Previous Balance Section -->
        ${sampleData.previousBalance > 0 ? `
          <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 15px 0; color: #991b1b; font-size: 16px;">⚠️ Previous Outstanding</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <div style="font-size: 12px; color: #7f1d1d; margin-bottom: 5px;">Previous Balance</div>
                <div style="font-size: 20px; font-weight: 700; color: #dc2626;">₹${sampleData.previousBalance.toLocaleString('en-IN')}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #7f1d1d; margin-bottom: 5px;">Days Overdue</div>
                <div style="font-size: 20px; font-weight: 700; color: #dc2626;">${sampleData.daysOverdue} days</div>
              </div>
            </div>
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #fca5a5;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 12px; color: #7f1d1d; margin-bottom: 5px;">
                    Interest @ ${sampleData.interestRate}% p.a. (${sampleData.interestMethod})
                  </div>
                  <div style="font-size: 11px; color: #991b1b;">
                    Grace: ${sampleData.gracePeriodDays} days | Overdue: ${sampleData.daysOverdue} days
                  </div>
                </div>
                <div style="font-size: 18px; font-weight: 700; color: #dc2626;">
                  ₹${sampleData.interestAmount.toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Current Charges Table -->
        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #374151;">Current Month Charges</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background: ${template.tableHeaderBg}; color: ${template.tableHeaderColor};">
              <th style="padding: 12px; text-align: left; border: 1px solid ${template.tableBorderColor};">Sr.</th>
              <th style="padding: 12px; text-align: left; border: 1px solid ${template.tableBorderColor};">Particulars</th>
              <th style="padding: 12px; text-align: center; border: 1px solid ${template.tableBorderColor};">Rate</th>
              <th style="padding: 12px; text-align: right; border: 1px solid ${template.tableBorderColor};">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${sampleData.charges.map((charge, idx) => `
              <tr style="background: ${idx % 2 === 0 ? template.tableRowBg1 : template.tableRowBg2};">
                <td style="padding: 10px; border: 1px solid ${template.tableBorderColor};">${idx + 1}</td>
                <td style="padding: 10px; border: 1px solid ${template.tableBorderColor};">
                  ${charge.name}
                  ${charge.perSqFt ? `<span style="font-size: 11px; color: #6b7280;"> (${sampleData.area} sq ft)</span>` : ''}
                </td>
                <td style="padding: 10px; text-align: center; border: 1px solid ${template.tableBorderColor}; font-size: 13px; color: #6b7280;">
                  ${charge.perSqFt ? `₹${charge.rate}/sq ft` : charge.fixed ? 'Fixed' : '-'}
                </td>
                <td style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor}; font-weight: 600;">
                  ${charge.amount.toLocaleString('en-IN')}
                </td>
              </tr>
            `).join('')}
            <tr style="background: #f9fafb; font-weight: 600;">
              <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor};">Subtotal</td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor};">
                ${sampleData.subtotal.toLocaleString('en-IN')}
              </td>
            </tr>
            <tr style="background: #f9fafb;">
              <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor};">Service Tax (2%)</td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${template.tableBorderColor}; font-weight: 600;">
                ${sampleData.serviceTax.toLocaleString('en-IN')}
              </td>
            </tr>
            <tr style="background: #dbeafe; font-weight: 700; font-size: 16px;">
              <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid ${template.tableBorderColor}; color: #1e40af;">
                CURRENT BILL TOTAL
              </td>
              <td style="padding: 12px; text-align: right; border: 1px solid ${template.tableBorderColor}; color: #1e40af;">
                ₹${sampleData.currentBillTotal.toLocaleString('en-IN')}
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Grand Total -->
        <div style="background: ${template.totalBg}; padding: 25px; border-radius: 8px; margin-bottom: 30px; border: 2px solid ${template.totalColor};">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 14px; color: ${template.totalColor}; margin-bottom: 5px;">TOTAL AMOUNT PAYABLE</div>
              <div style="font-size: 12px; color: #6b7280;">
                (Previous: ₹${(sampleData.previousBalance + sampleData.interestAmount).toLocaleString('en-IN')} + Current: ₹${sampleData.currentBillTotal.toLocaleString('en-IN')})
              </div>
            </div>
            <div style="font-size: ${template.totalSize}px; font-weight: 700; color: ${template.totalColor};">
              ₹${sampleData.grandTotal.toLocaleString('en-IN')}
            </div>
          </div>
        </div>

        <!-- Footer Instructions -->
        ${template.footerText && template.footerText.length > 0 ? `
          <div style="border-top: 2px solid #e5e7eb; padding-top: 20px; margin-bottom: 30px;">
            <strong style="display: block; margin-bottom: 10px;">Terms & Conditions:</strong>
            <ol style="margin: 0; padding-left: 20px; font-size: ${template.footerSize}px; color: #6b7280;">
              ${template.footerText.map(text => `<li style="margin-bottom: 5px;">${text}</li>`).join('')}
            </ol>
          </div>
        ` : ''}

        <!-- Signature -->
        ${template.showSignature ? `
          <div style="text-align: right; margin-top: 40px;">
            ${uploadedSignature ? `
              <img src="${uploadedSignature}" style="width: 150px; margin-bottom: 10px;" />
            ` : `
              <div style="height: 60px; border-bottom: 2px solid #000; width: 200px; margin-left: auto; margin-bottom: 10px;"></div>
            `}
            <div style="font-size: 12px; color: #6b7280;">${template.signatureLabel || 'Authorized Signatory'}</div>
          </div>
        ` : ''}
      </div>
    `;
  };

  // Open PDF Editor
  const openPDFEditor = () => {
    if (!uploadedPDF) {
      alert('Please upload a PDF first');
      return;
    }
    setShowPDFEditor(true);
  };

  // Add field to PDF
  const addFieldToPDF = (fieldName) => {
    const newField = {
      id: Date.now(),
      name: fieldName,
      x: 50,
      y: 50,
      width: 150,
      height: 30,
      fontSize: 12,
      fontColor: '#000000'
    };
    setPdfFields([...pdfFields, newField]);
    setSelectedField(newField.id);
  };

  // Update field position
  const updateFieldPosition = (fieldId, x, y) => {
    setPdfFields(pdfFields.map(field => 
      field.id === fieldId ? { ...field, x, y } : field
    ));
  };

  // Update field properties
  const updateFieldProperty = (fieldId, property, value) => {
    setPdfFields(pdfFields.map(field => 
      field.id === fieldId ? { ...field, [property]: value } : field
    ));
  };

  // Delete field
  const deleteField = (fieldId) => {
    setPdfFields(pdfFields.filter(field => field.id !== fieldId));
    if (selectedField === fieldId) {
      setSelectedField(null);
    }
  };

  

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>🎨 Bill Template Designer</h1>
          <p>Professional bill template with interest calculation</p>
        </div>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="btn btn-primary"
        >
          {saveMutation.isPending ? '⏳ Saving...' : '💾 Save Template'}
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'select' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('select')}
        >
          📋 Choose Template
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'design' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('design')}
        >
          🎨 Customize Design
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'upload' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          📤 Upload Custom PDF/Image
        </button>
      </div>

      {/* Tab 1: Select Default Template */}
      {activeTab === 'select' && (
        <div className={styles.templateGrid}>
          {Object.entries(DEFAULT_TEMPLATES).map(([key, value]) => (
            <div key={key} className={styles.templateCard} onClick={() => applyDefaultTemplate(key)}>
              <div className={styles.templatePreview}>
                <div style={{ 
                  background: value.design.headerBg,
                  color: value.design.headerColor,
                  padding: '15px',
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}>
                  {value.name} Template
                </div>
                <div style={{ padding: '15px', fontSize: '12px' }}>
                  <div style={{ 
                    background: value.design.tableHeaderBg,
                    color: value.design.tableHeaderColor,
                    padding: '8px',
                    marginBottom: '5px'
                  }}>
                    Table Header
                  </div>
                  <div style={{ padding: '8px', background: value.design.tableRowBg1 }}>Row 1</div>
                  <div style={{ padding: '8px', background: value.design.tableRowBg2 }}>Row 2</div>
                  <div style={{
                    background: value.design.totalBg,
                    color: value.design.totalColor,
                    padding: '10px',
                    marginTop: '10px',
                    fontWeight: 'bold'
                  }}>
                    Total: ₹10,000
                  </div>
                </div>
              </div>
              <button className="btn btn-primary btn-sm">
                Use {value.name}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tab 2: Design Customization */}
      {activeTab === 'design' && (
        <div className={styles.workspace}>
          {/* Controls - SAME AS BEFORE but more organized */}
          <div className={styles.controlPanel}>
            {/* Your existing controls... */}
          </div>

          {/* Preview with FULL DATA */}
          <div className={styles.previewPanel}>
            <h2>👁️ Live Preview (with Interest & Previous Balance)</h2>
            <div className={styles.previewWrapper}>
              <div dangerouslySetInnerHTML={{ __html: generatePreviewHTML() }} />
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Upload PDF - SMART VERSION */}
      {activeTab === 'upload' && (
        <div className={styles.uploadSection}>
          <div className={styles.uploadCard}>
            <h3>📄 Upload Your PDF Bill Template</h3>
            <p style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
              Upload your society's existing PDF bill format.<br/>
              <strong>System will automatically:</strong>
            </p>
            <ul style={{ textAlign: 'left', marginBottom: '1.5rem', lineHeight: '1.8' }}>
              <li>✅ Detect if PDF has fillable form fields</li>
              <li>✅ Auto-fill member name, flat no, charges, totals</li>
              <li>✅ Use your billing heads from configuration</li>
              <li>✅ Calculate interest & previous balance</li>
              <li>✅ No manual field mapping needed!</li>
            </ul>
            
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => handlePDFUpload(e.target.files[0])}
              style={{ marginBottom: '1rem' }}
            />
            
            {uploadedPDF && (
              <div className={styles.uploadedPreview}>
                <p style={{ color: '#059669', fontWeight: '600', marginBottom: '1rem' }}>
                  ✅ PDF Template Uploaded Successfully!
                </p>
                
                {pdfHasFormFields ? (
                  <div style={{ background: '#d1fae5', padding: '1.5rem', borderRadius: '8px', marginBottom: '1rem' }}>
                    <p style={{ margin: '0 0 0.75rem 0', fontWeight: '600', color: '#065f46' }}>
                      🎉 Great! Your PDF has {detectedFields.length} fillable fields:
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem' }}>
                      {detectedFields.map((field, idx) => (
                        <div key={idx} style={{ 
                          background: 'white', 
                          padding: '0.5rem', 
                          borderRadius: '4px',
                          fontSize: '0.875rem',
                          fontWeight: '500',
                          color: '#374151'
                        }}>
                          {field}
                        </div>
                      ))}
                    </div>
                    <p style={{ margin: '1rem 0 0 0', fontSize: '0.875rem', color: '#065f46' }}>
                      System will auto-fill these when generating bills
                    </p>
                  </div>
                ) : (
                  <div style={{ background: '#fef3c7', padding: '1.5rem', borderRadius: '8px', marginBottom: '1rem' }}>
                    <p style={{ margin: 0, fontWeight: '600', color: '#92400e' }}>
                      ℹ️ No fillable fields detected. System will overlay data on PDF.
                    </p>
                  </div>
                )}

                <iframe
                  src={uploadedPDF}
                  style={{
                    width: '100%',
                    height: '600px',
                    border: '2px solid #e5e7eb',
                    borderRadius: '8px',
                    marginTop: '1rem'
                  }}
                />
              </div>
            )}
          </div>

          <div className={styles.uploadCard}>
            <h3>🖼️ Or Upload Image Template</h3>
            <p>Upload bill as JPG/PNG. System will overlay text on it.</p>
            <input
              type="file"
              accept=".jpg,.jpeg,.png"
              onChange={(e) => handleFileUpload(e.target.files[0], 'image')}
            />
            {uploadedImage && (
              <div className={styles.uploadedPreview}>
                <img src={uploadedImage} alt="Template" style={{ maxWidth: '100%', borderRadius: '8px' }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
