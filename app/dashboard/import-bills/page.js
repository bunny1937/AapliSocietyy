'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import styles from '@/styles/ImportBills.module.css';

export default function ImportBillsPage() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState(1);
  const queryClient = useQueryClient();

  const validateMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/bills/import?action=preview', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!res.ok) throw new Error('Validation failed');
      return res.json();
    },
    onSuccess: (data) => {
      setPreview(data);
      setStep(2);
    }
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/bills/import?action=confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: preview.batchId })
      });
      if (!res.ok) throw new Error('Import failed');
      return res.json();
    },
    onSuccess: () => {
      alert('✅ Bills imported successfully!');
      setStep(3);
      queryClient.invalidateQueries(['bills-list']);
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

  const downloadTemplate = () => {
    const template = `Member ID,Wing,Room No,Bill Month,Bill Year,Total Amount,Due Date,Maintenance,Sinking Fund,Repair Fund,Notes
670e123456789abc,A,101,0,2024,5000,2024-01-10,3000,1500,500,Regular bill
670e123456789abc,A,101,1,2024,5200,2024-02-10,3000,1500,700,Repair fund increased`;
    
    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bills_import_template.csv';
    a.click();
  };

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1>Import Bills from Excel</h1>
        <p>Upload 5 years of data for 100+ members with real-time validation</p>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className={styles.uploadCard}>
          <div className={styles.instructions}>
            <h3>📋 Instructions</h3>
            <ul>
              <li>Download template and fill with your data</li>
              <li>Columns: Member ID, Wing, Room No, Bill Month (0-11), Bill Year, Total Amount, Due Date</li>
              <li>Can include 5 years of bills for 70-100+ members</li>
              <li>System will check for duplicates and validate all data</li>
            </ul>
            <button onClick={downloadTemplate} className="btn btn-secondary">
              📥 Download Template
            </button>
          </div>

          <div className={styles.uploadZone}>
            <input 
              type="file" 
              accept=".xlsx,.xls" 
              onChange={handleFileChange}
              id="fileInput"
              style={{ display: 'none' }}
            />
            <label htmlFor="fileInput" className={styles.uploadLabel}>
              {file ? `✓ ${file.name}` : '📂 Click to select Excel file'}
            </label>
          </div>

          <button 
            onClick={() => validateMutation.mutate(file)}
            disabled={!file || validateMutation.isPending}
            className="btn btn-primary"
          >
            {validateMutation.isPending ? '🔄 Validating...' : '🔍 Upload & Preview'}
          </button>
        </div>
      )}

      {/* Step 2: Preview & Validation */}
      {step === 2 && preview && (
        <div className={styles.previewCard}>
          <div className={styles.statsGrid}>
            <div className={styles.statBox} style={{borderColor: '#10B981'}}>
              <span className={styles.statNumber}>{preview.valid}</span>
              <span className={styles.statLabel}>✅ Valid</span>
            </div>
            <div className={styles.statBox} style={{borderColor: '#F59E0B'}}>
              <span className={styles.statNumber}>{preview.warnings}</span>
              <span className={styles.statLabel}>⚠️ Warnings</span>
            </div>
            <div className={styles.statBox} style={{borderColor: '#EF4444'}}>
              <span className={styles.statNumber}>{preview.errors}</span>
              <span className={styles.statLabel}>❌ Errors</span>
            </div>
            <div className={styles.statBox} style={{borderColor: '#F97316'}}>
              <span className={styles.statNumber}>{preview.duplicates}</span>
              <span className={styles.statLabel}>🔁 Duplicates</span>
            </div>
          </div>

          {/* Duplicate Check */}
          {preview.duplicates > 0 && (
            <div className={styles.alertBox} style={{backgroundColor: '#FEF3C7', borderLeft: '4px solid #F59E0B'}}>
              <h4>⚠️ Duplicate Bills Found</h4>
              <p>{preview.duplicates} bills already exist in the database:</p>
              <ul>
                {preview.duplicateList?.slice(0, 5).map((d, i) => (
                  <li key={i}>{d.member} - {d.period} (Row {d.rowNumber})</li>
                ))}
              </ul>
              {preview.duplicateList?.length > 5 && <p>...and {preview.duplicateList.length - 5} more</p>}
            </div>
          )}

          {/* Errors */}
          {preview.errors > 0 && (
            <div className={styles.alertBox} style={{backgroundColor: '#FEE2E2', borderLeft: '4px solid #EF4444'}}>
              <h4>❌ Errors Found ({preview.errors})</h4>
              <ul>
                {preview.errorList?.slice(0, 10).map((e, i) => (
                  <li key={i}>Row {e.rowNumber}: {e.message}</li>
                ))}
              </ul>
              <p><strong>Fix these errors before importing</strong></p>
            </div>
          )}

          {/* Preview Table */}
          <div className={styles.tableContainer}>
            <h3>Preview (First 20 rows)</h3>
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
                      {row.status === 'Valid' && '✅'}
                      {row.status === 'Warning' && '⚠️'}
                      {row.status === 'Error' && '❌'}
                    </td>
                    <td>{row.member}</td>
                    <td>{row.period}</td>
                    <td>₹{row.amount}</td>
                    <td className={styles.issueCell}>
                      {row.issues?.map((issue, j) => (
                        <div key={j} className={styles.issue}>{issue}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.actionButtons}>
            <button onClick={() => {setStep(1); setPreview(null);}} className="btn btn-secondary">
              ← Go Back
            </button>
            <button 
              onClick={() => confirmMutation.mutate()}
              disabled={preview.errors > 0 || confirmMutation.isPending}
              className="btn btn-success"
            >
              {confirmMutation.isPending ? 'Importing...' : `✓ Confirm Import (${preview.valid} bills)`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Success */}
      {step === 3 && (
        <div className={styles.successCard}>
          <div className={styles.successIcon}>✅</div>
          <h2>Import Successful!</h2>
          <p>{preview?.valid} bills imported successfully</p>
          <button onClick={() => window.location.href = '/dashboard/billing-grid'} className="btn btn-primary">
            View Bills
          </button>
        </div>
      )}
    </div>
  );
}
