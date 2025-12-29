import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import Member from '@/models/Member';
import ExcelJS from 'exceljs';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';

export async function POST(request) {
  try {
    await connectDB();
    
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    
    if (decoded.role === 'Accountant') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save temporarily
    const tempDir = join(process.cwd(), 'temp');
    const tempFilePath = join(tempDir, `preview-${Date.now()}.xlsx`);
    await writeFile(tempFilePath, buffer);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const firstSheet = workbook.worksheets[0];
    const isEnhancedTemplate = firstSheet.name.includes('Basic Info');

    // Parse all sheets
    const sheets = {};
    workbook.worksheets.forEach(sheet => {
      const rows = [];
      sheet.eachRow((row, rowNumber) => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cells.push({
            value: cell.value,
            address: cell.address,
            row: rowNumber,
            col: colNumber
          });
        });
        rows.push(cells);
      });
      sheets[sheet.name] = rows;
    });

    // Validate and mark issues
    const validation = await validateExcelData(workbook, decoded.societyId, isEnhancedTemplate);

    return NextResponse.json({
      success: true,
      previewId: Date.now().toString(),
      tempFilePath,
      sheets,
      validation,
      isEnhancedTemplate
    });

  } catch (error) {
    console.error('Preview error:', error);
    return NextResponse.json({ 
      error: 'Preview failed', 
      details: error.message 
    }, { status: 500 });
  }
}

async function validateExcelData(workbook, societyId, isEnhanced) {
  const issues = [];
  const warnings = [];
  const validCount = { valid: 0, errors: 0, warnings: 0, duplicates: 0 };

  const basicSheet = workbook.getWorksheet(isEnhanced ? '1. Basic Info (Required)' : workbook.worksheets[0].name);
  
  if (!basicSheet) {
    return { issues: [{ type: 'CRITICAL', message: 'Basic Info sheet not found' }], validCount };
  }

  // Get existing members for duplicate check
  const existingMembers = await Member.find({ societyId }).select('flatNo wing emailPrimary contactNumber');
  const existingFlats = new Set(existingMembers.map(m => `${m.wing || ''}-${m.flatNo}`));
  const existingEmails = new Set(existingMembers.map(m => m.emailPrimary));
  const existingPhones = new Set(existingMembers.map(m => m.contactNumber));

  // Parse headers
  const headerRow = basicSheet.getRow(1);
  const headers = [];
  headerRow.eachCell((cell) => {
    headers.push(String(cell.value).trim());
  });

  // Track duplicates within file
  const fileFlats = new Set();
  const fileEmails = new Set();
  const filePhones = new Set();

  // Validate each row
  basicSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const rowData = {};
    const rowIssues = [];

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) {
        rowData[header] = cell.value;
      }
    });

    const flatNo = String(rowData['flatNo'] || '').trim();
    const wing = String(rowData['wing'] || '').trim();
    const ownerName = String(rowData['ownerName'] || '').trim();
    const contactNumber = String(rowData['contactNumber'] || '').trim();
    const emailPrimary = String(rowData['emailPrimary'] || '').trim();
    const carpetAreaSqft = rowData['carpetAreaSqft'];

    if (!flatNo || flatNo === 'INSTRUCTIONS:') return;

    // Validation checks
    const cellIssues = {};

    // 1. Required field validation
    if (!flatNo) {
      cellIssues['flatNo'] = { type: 'ERROR', message: 'Flat number is required' };
      validCount.errors++;
    }

    if (!ownerName) {
      cellIssues['ownerName'] = { type: 'ERROR', message: 'Owner name is required' };
      validCount.errors++;
    }

    if (!emailPrimary) {
      cellIssues['emailPrimary'] = { type: 'ERROR', message: 'Email is required' };
      validCount.errors++;
    } else if (!emailPrimary.includes('@')) {
      cellIssues['emailPrimary'] = { type: 'ERROR', message: 'Invalid email format' };
      validCount.errors++;
    }

    if (!contactNumber) {
      cellIssues['contactNumber'] = { type: 'ERROR', message: 'Contact number is required' };
      validCount.errors++;
    } else if (contactNumber.length < 10) {
      cellIssues['contactNumber'] = { type: 'ERROR', message: 'Contact must be at least 10 digits' };
      validCount.errors++;
    }

    if (!carpetAreaSqft || carpetAreaSqft <= 0) {
      cellIssues['carpetAreaSqft'] = { type: 'ERROR', message: 'Valid area required (must be > 0)' };
      validCount.errors++;
    }

    // 2. Duplicate checks - DATABASE
    const flatKey = `${wing}-${flatNo}`;
    if (existingFlats.has(flatKey)) {
      cellIssues['flatNo'] = { type: 'DUPLICATE_DB', message: `Flat ${flatKey} already exists in database` };
      validCount.duplicates++;
    }

    if (existingEmails.has(emailPrimary)) {
      cellIssues['emailPrimary'] = { type: 'DUPLICATE_DB', message: 'Email already exists in database' };
      validCount.duplicates++;
    }

    if (existingPhones.has(contactNumber)) {
      cellIssues['contactNumber'] = { type: 'DUPLICATE_DB', message: 'Phone already exists in database' };
      validCount.duplicates++;
    }

    // 3. Duplicate checks - WITHIN FILE
    if (fileFlats.has(flatKey)) {
      cellIssues['flatNo'] = { type: 'DUPLICATE_FILE', message: `Duplicate flat ${flatKey} in this file (row ${rowNumber})` };
      validCount.duplicates++;
    } else {
      fileFlats.add(flatKey);
    }

    if (fileEmails.has(emailPrimary)) {
      cellIssues['emailPrimary'] = { type: 'DUPLICATE_FILE', message: `Duplicate email in file` };
      validCount.duplicates++;
    } else {
      fileEmails.add(emailPrimary);
    }

    if (filePhones.has(contactNumber)) {
      cellIssues['contactNumber'] = { type: 'DUPLICATE_FILE', message: `Duplicate phone in file` };
      validCount.duplicates++;
    } else {
      filePhones.add(contactNumber);
    }

    // 4. Optional field warnings
    if (!wing) {
      cellIssues['wing'] = { type: 'WARNING', message: 'Wing not specified (will be empty)' };
      validCount.warnings++;
    }

    if (Object.keys(cellIssues).length === 0) {
      validCount.valid++;
    }

    if (Object.keys(cellIssues).length > 0) {
      issues.push({
        sheet: basicSheet.name,
        row: rowNumber,
        flatNo,
        cellIssues
      });
    }
  });

  return {
    issues,
    warnings,
    validCount,
    summary: {
      total: validCount.valid + validCount.errors + validCount.duplicates,
      valid: validCount.valid,
      errors: validCount.errors,
      warnings: validCount.warnings,
      duplicates: validCount.duplicates,
      canImport: validCount.errors === 0 && validCount.duplicates === 0
    }
  };
}
