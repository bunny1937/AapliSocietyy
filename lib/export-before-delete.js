import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

/**
 * Export data to Excel file before deletion
 * Saves to: exports/{societyId}/{collection}/{date}/deleted_data.xlsx
 */
export async function exportBeforeDelete(data, metadata) {
  const {
    societyId,
    collection,
    deletedBy,
    deletionReason
  } = metadata;

  try {
    // Create exports directory structure
    const timestamp = new Date().toISOString().split('T')[0]; // 2025-12-30
    const exportDir = path.join(
      process.cwd(),
      'exports',
      societyId.toString(),
      collection,
      timestamp
    );

    // Create directory if doesn't exist
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Deleted Data');

    // Add metadata sheet
    const metaSheet = workbook.addWorksheet('Metadata');
    metaSheet.addRow(['Deletion Date', new Date().toISOString()]);
    metaSheet.addRow(['Deleted By', deletedBy.toString()]);
    metaSheet.addRow(['Reason', deletionReason]);
    metaSheet.addRow(['Collection', collection]);
    metaSheet.addRow(['Society ID', societyId.toString()]);
    metaSheet.addRow(['Total Records', data.length]);

    // Add data to main sheet
    if (data.length > 0) {
      // Get all unique keys from all objects
      const allKeys = new Set();
      data.forEach(item => {
        Object.keys(item).forEach(key => allKeys.add(key));
      });

      const headers = Array.from(allKeys);
      worksheet.addRow(headers);

      // Add data rows
      data.forEach(item => {
        const row = headers.map(header => {
          const value = item[header];
          
          // Handle different data types
          if (value === null || value === undefined) return '';
          if (value instanceof Date) return value.toISOString();
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        });
        worksheet.addRow(row);
      });

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9D9D9' }
      };
    }

    // Generate filename with timestamp
    const filename = `deleted_${collection}_${Date.now()}.xlsx`;
    const filepath = path.join(exportDir, filename);

    // Save file
    await workbook.xlsx.writeFile(filepath);

    console.log(`✅ Exported ${data.length} records to: ${filepath}`);

    return {
      success: true,
      filepath,
      filename,
      recordCount: data.length
    };

  } catch (error) {
    console.error('Export before delete error:', error);
    throw error;
  }
}

/**
 * Export to JSON format (alternative)
 */
export async function exportToJSON(data, metadata) {
  const {
    societyId,
    collection,
    deletedBy,
    deletionReason
  } = metadata;

  try {
    const timestamp = new Date().toISOString().split('T')[0];
    const exportDir = path.join(
      process.cwd(),
      'exports',
      societyId.toString(),
      collection,
      timestamp
    );

    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const exportData = {
      metadata: {
        deletionDate: new Date().toISOString(),
        deletedBy: deletedBy.toString(),
        reason: deletionReason,
        collection,
        societyId: societyId.toString(),
        totalRecords: data.length
      },
      data
    };

    const filename = `deleted_${collection}_${Date.now()}.json`;
    const filepath = path.join(exportDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));

    console.log(`✅ Exported ${data.length} records to: ${filepath}`);

    return {
      success: true,
      filepath,
      filename,
      recordCount: data.length
    };

  } catch (error) {
    console.error('Export to JSON error:', error);
    throw error;
  }
}
