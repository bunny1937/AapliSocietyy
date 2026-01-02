'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import * as XLSX from 'xlsx';
import styles from '@/styles/ImportBills.module.css';

export default function ImportBillsV2Page() {
  const queryClient = useQueryClient();
  
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState(1);

  // Fetch billing config to get dynamic columns
  const { data: configData } = useQuery({
    queryKey: ['billing-config-for-import'],
    queryFn: async () => {
      const [society, heads] = await Promise.all([
        apiClient.get('/api/society/config'),
        apiClient.get('/api/billing-heads/list')
      ]);
      return { society: society.society, heads: heads.heads };
    }
  });

  // Generate dynamic template
  const downloadTemplate = () => {
    if (!configData) {
      alert('Loading configuration...');
      return;
    }

    const society = configData.society;
    const heads = configData.heads;

    // Build template headers
    const headers = [
      'Member ID',
      'Wing',
      'Room No',
      'Bill Month',
      'Bill Year',
      'Due Date',
      'Maintenance',
      'Sinking Fund',
      'Repair Fund',
      'Water',
      'Security',
      'Electricity'
    ];

    // Add custom billing heads
    heads.forEach(head => {
      if (!headers.includes(head.headName)) {
        headers.push(head.headName);
      }
    });

    headers.push('Notes');
    headers.push('Total Amount'); // Calculate or enter manually

    // Create sample row
    const sampleRow = [
      '670e123456789abc', // Member ID
      'A',
      '101',
      '0', // January (0-11)
      '2024',
      '2024-01-10',
      '3000',
      '1500',
      '500',
      '200',
      '150',
      '100'
    ];

    // Add sample values for custom heads
    heads.forEach(head => {
      sampleRow.push('0');
    });

    sampleRow.push('Regular bill'); // Notes
    sampleRow.push('5450'); // Total

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);

    // Set column widths
    ws['!cols'] = headers.map(() => ({ wch: 15 }));

    XLSX.utils.book_append_sheet(wb, ws, 'Bills Template');

    // Add instructions sheet
    const instructionsData = [
      ['Import Bills - Instructions'],
      [''],
      ['Required Columns:'],
      ['- Member ID: Get from Members list'],
      ['- Wing: Building/Wing code'],
      ['- Room No: Flat number'],
      ['- Bill Month: 0-11 (0=Jan, 11=Dec)'],
      ['- Bill Year: e.g., 2024'],
      ['- Due Date: Format YYYY-MM-DD'],
      [''],
      ['Charge Columns:'],
      ['- Maintenance, Sinking Fund, Repair Fund: Per sq ft charges'],
      ['- Water, Security, Electricity: Fixed charges'],
      ...heads.map(h => [`- ${h.headName}: ${h.calculationType}`]),
      [''],
      ['Optional:'],
      ['- Notes: Any remarks'],
      ['- Total Amount: Auto-calculated if blank'],
      [''],
      ['Tips:'],
      ['- All amounts in Rupees'],
      ['- System checks for duplicates'],
      ['- Previous balance auto-added'],
      ['- Fill only required columns, rest can be 0']
    ];

    const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
    wsInstructions['!cols'] = [{ wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    // Download
    XLSX.writeFile(wb, `Bills_Import_Template_${new Date().getTime()}.xlsx`);
  };

  // Validate file
  const validateMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/bills/import-v2?action=preview', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      if (!response.ok) throw new Error('Validation failed');
      return response.json();
    },
    onSuccess: (data) => {
      setPreview(data);
      setStep(2);
    },
    onError: (error) => {
      alert('Validation failed: ' + error.message);
    }
  });

  // Confirm import
  const confirmMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/bills/import-v2?action=confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: preview.batchId })
      });

      if (!response.ok) throw new Error('Import failed');
      return response.json();
    },
    onSuccess: (data) => {
      alert(`✅ ${data.imported} bills imported successfully!`);
      setStep(3);
      queryClient.invalidateQueries(['view-bills']);
    }
  });

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    if (!selectedFile.name.match(/\.(xlsx|xls)$/)) {
      alert('Only Excel files (.xlsx, .xls) are allowed');
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    setFile(selectedFile);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>📥 Import Bills</h1>
        <p>Bulk import bills using Excel template with dynamic columns</p>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className={styles.uploadSection}>
          <div className={styles.instructionsCard}>
            <h3>📋 Instructions</h3>
            <ul>
              <li>Download the template with your current billing configuration</li>
              <li>Template includes all active billing heads from Billing Config</li>
              <li>Fill Member ID, Month (0-11), Year, and charge amounts</li>
              <li>System validates duplicates and calculates totals</li>
              <li>Import up to 1000 bills at once</li>
            </ul>
            
            <button onClick={downloadTemplate} className="btn btn-primary btn-lg">
              📥 Download Dynamic Template
            </button>
          </div>

          <div className={styles.uploadCard}>
            <div className={styles.uploadZone}>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                id="fileInput"
                style={{ display: 'none' }}
              />
              <label htmlFor="fileInput" className={styles.uploadLabel}>
                {file ? (
                  <>
                    <div className={styles.fileIcon}>📄</div>
                    <div className={styles.fileName}>{file.name}</div>
                    <div className={styles.fileSize}>
                      {(file.size / 1024).toFixed(2)} KB
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.uploadIcon}>📤</div>
                    <div>Click to select Excel file</div>
                    <div className={styles.uploadHint}>or drag and drop</div>
                  </>
                )}
              </label>
            </div>

            <button
              onClick={() => validateMutation.mutate(file)}
              disabled={!file || validateMutation.isPending}
              className="btn btn-success btn-lg"
            >
              {validateMutation.isPending ? '🔄 Validating...' : '✅ Upload & Preview'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Preview & Validation */}
      {step === 2 && preview && (
        <div className={styles.previewSection}>
          <div className={styles.statsGrid}>
            <div className={styles.statCard} style={{ borderColor: '#10b981' }}>
              <div className={styles.statNumber}>{preview.valid}</div>
              <div className={styles.statLabel}>✅ Valid</div>
            </div>
            <div className={styles.statCard} style={{ borderColor: '#f59e0b' }}>
              <div className={styles.statNumber}>{preview.warnings}</div>
              <div className={styles.statLabel}>⚠️ Warnings</div>
            </div>
            <div className={styles.statCard} style={{ borderColor: '#ef4444' }}>
              <div className={styles.statNumber}>{preview.errors}</div>
              <div className={styles.statLabel}>❌ Errors</div>
            </div>
            <div className={styles.statCard} style={{ borderColor: '#f97316' }}>
              <div className={styles.statNumber}>{preview.duplicates}</div>
              <div className={styles.statLabel}>🔁 Duplicates</div>
            </div>
          </div>

          {/* Errors */}
          {preview.errors > 0 && (
            <div className={styles.alertBox} style={{ background: '#fee2e2', borderColor: '#ef4444' }}>
              <h4>❌ Errors Found ({preview.errors})</h4>
              <ul>
                {preview.errorList?.slice(0, 10).map((e, i) => (
                  <li key={i}>Row {e.rowNumber}: {e.message}</li>
                ))}
              </ul>
              <p><strong>Fix these errors before importing</strong></p>
            </div>
          )}

          {/* Duplicates */}
          {preview.duplicates > 0 && (
            <div className={styles.alertBox} style={{ background: '#fef3c7', borderColor: '#f59e0b' }}>
              <h4>🔁 Duplicate Bills ({preview.duplicates})</h4>
              <p>These bills already exist in the database:</p>
              <ul>
                {preview.duplicateList?.slice(0, 5).map((d, i) => (
                  <li key={i}>{d.member} - {d.period} (Row {d.rowNumber})</li>
                ))}
              </ul>
            </div>
          )}

          {/* Preview Table */}
          <div className={styles.tableCard}>
            <h3>📊 Preview (First 20 rows)</h3>
            <div className={styles.tableWrapper}>
              <table className={styles.previewTable}>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Status</th>
                    <th>Member</th>
                    <th>Period</th>
                    <th>Amount</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows?.slice(0, 20).map((row, i) => (
                    <tr key={i} className={row.status === 'Error' ? styles.errorRow : ''}>
                      <td>{row.rowNumber}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${styles[row.status.toLowerCase()]}`}>
                          {row.status}
                        </span>
                      </td>
                      <td>{row.member}</td>
                      <td>{row.period}</td>
                      <td>₹{row.amount}</td>
                      <td>
                        {row.issues?.map((issue, j) => (
                          <div key={j} className={styles.issue}>{issue}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className={styles.actionButtons}>
            <button
              onClick={() => {
                setStep(1);
                setPreview(null);
                setFile(null);
              }}
              className="btn btn-secondary"
            >
              ← Go Back
            </button>
            <button
              onClick={() => confirmMutation.mutate()}
              disabled={preview.errors > 0 || confirmMutation.isPending}
              className="btn btn-success btn-lg"
            >
              {confirmMutation.isPending ? '⏳ Importing...' : `✅ Confirm Import (${preview.valid} bills)`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Success */}
      {step === 3 && (
        <div className={styles.successSection}>
          <div className={styles.successIcon}>🎉</div>
          <h2>Import Successful!</h2>
          <p>{preview?.valid} bills imported successfully</p>
          
          <div className={styles.successActions}>
            <button
              onClick={() => window.location.href = '/dashboard/view-bills'}
              className="btn btn-primary btn-lg"
            >
              📄 View Bills
            </button>
            <button
              onClick={() => {
                setStep(1);
                setPreview(null);
                setFile(null);
              }}
              className="btn btn-secondary"
            >
              Import More Bills
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
