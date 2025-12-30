import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Bill from '@/models/Bill';
import Member from '@/models/Member';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';

let tempStorage = {};

export async function POST(request) {
  try {
    await connectDB();
    
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // STEP 1: PREVIEW
    if (action === 'preview') {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(bytes));
      const worksheet = workbook.worksheets[0];

      const headers = [];
      worksheet.getRow(1).eachCell((cell) => {
        headers.push(String(cell.value).trim());
      });

      const required = ['Member ID', 'Bill Month', 'Bill Year', 'Total Amount'];
      const missing = required.filter(r => !headers.includes(r));
      if (missing.length > 0) {
        return NextResponse.json({ error: `Missing columns: ${missing.join(', ')}` }, { status: 400 });
      }

      const members = await Member.find({ societyId: decoded.societyId }).lean();
      const memberMap = new Map(members.map(m => [m._id.toString(), m]));

      const existingBills = await Bill.find({ 
        societyId: decoded.societyId 
      }).select('memberId billMonth billYear billPeriodId').lean();
      
      const existingSet = new Set(
        existingBills.map(b => `${b.memberId}-${b.billMonth}-${b.billYear}`)
      );

      const rows = [];
      let valid = 0, warnings = 0, errors = 0, duplicates = 0;
      const duplicateList = [];
      const errorList = [];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const rowData = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          rowData[header] = cell.value;
        });

        const issues = [];
        let status = 'Valid';

        const memberId = rowData['Member ID']?.toString().trim();
        if (!memberId) {
          issues.push('Member ID missing');
          status = 'Error';
        } else if (!memberMap.has(memberId)) {
          issues.push('Member ID not found');
          status = 'Error';
        }

        const billMonth = parseInt(rowData['Bill Month']);
        const billYear = parseInt(rowData['Bill Year']);
        
        if (isNaN(billMonth) || billMonth < 0 || billMonth > 11) {
          issues.push('Invalid Bill Month (0-11)');
          status = 'Error';
        }
        
        if (isNaN(billYear) || billYear < 2000 || billYear > 2100) {
          issues.push('Invalid Bill Year');
          status = 'Error';
        }

        const billKey = `${memberId}-${billMonth}-${billYear}`;
        if (existingSet.has(billKey)) {
          issues.push('Duplicate bill exists');
          status = 'Error';
          duplicates++;
          const member = memberMap.get(memberId);
          duplicateList.push({
            member: member ? `${member.wing}-${member.roomNo}` : 'Unknown',
            period: `${billYear}-${String(billMonth + 1).padStart(2, '0')}`,
            rowNumber
          });
        }

        const amount = parseFloat(rowData['Total Amount']);
        if (isNaN(amount) || amount <= 0) {
          issues.push('Invalid amount');
          status = 'Error';
        }

        if (status === 'Error') {
          errors++;
          errorList.push({ rowNumber, message: issues.join(', ') });
        } else if (status === 'Warning') {
          warnings++;
        } else {
          valid++;
        }

        const member = memberMap.get(memberId);
        rows.push({
          rowNumber,
          status,
          member: member ? `${member.wing}-${member.roomNo}` : 'Unknown',
          period: `${billYear}-${String(billMonth + 1).padStart(2, '0')}`,
          amount: amount || 0,
          issues,
          data: rowData
        });
      });

      const batchId = uuidv4();
      tempStorage[batchId] = { rows, decoded };

      return NextResponse.json({
        batchId,
        total: rows.length,
        valid,
        warnings,
        errors,
        duplicates,
        duplicateList: duplicateList.slice(0, 50),
        errorList: errorList.slice(0, 50),
        rows
      });
    }

    // STEP 2: CONFIRM
    if (action === 'confirm') {
      const { batchId } = await request.json();
      const cached = tempStorage[batchId];
      
      if (!cached) {
        return NextResponse.json({ error: 'Session expired' }, { status: 400 });
      }

      const { rows, decoded: cachedDecoded } = cached;
      const validRows = rows.filter(r => r.status === 'Valid');
      
      // ✅ FIX: Build charges Map from Excel columns
      const billsToInsert = validRows.map(row => {
        const charges = new Map();
        
        // Add all charge columns to charges Map
        if (row.data['Maintenance']) charges.set('Maintenance', parseFloat(row.data['Maintenance']));
        if (row.data['Sinking Fund']) charges.set('Sinking Fund', parseFloat(row.data['Sinking Fund']));
        if (row.data['Repair Fund']) charges.set('Repair Fund', parseFloat(row.data['Repair Fund']));
        if (row.data['Water Charges']) charges.set('Water Charges', parseFloat(row.data['Water Charges']));
        if (row.data['Security Charges']) charges.set('Security Charges', parseFloat(row.data['Security Charges']));
        if (row.data['Interest']) charges.set('Interest on Arrears', parseFloat(row.data['Interest']));
        
        // Add any other dynamic columns that aren't standard fields
        Object.keys(row.data).forEach(key => {
          if (!['Member ID', 'Bill Month', 'Bill Year', 'Total Amount', 'Due Date', 'Notes'].includes(key)) {
            if (!charges.has(key) && row.data[key]) {
              charges.set(key, parseFloat(row.data[key]) || 0);
            }
          }
        });

        return {
          billPeriodId: `${row.data['Bill Year']}-${String(parseInt(row.data['Bill Month']) + 1).padStart(2, '0')}`,
          billMonth: parseInt(row.data['Bill Month']),
          billYear: parseInt(row.data['Bill Year']),
          memberId: row.data['Member ID'],
          societyId: cachedDecoded.societyId,
          charges, // ✅ Single source of truth
          totalAmount: parseFloat(row.data['Total Amount']),
          amountPaid: 0,
          balanceAmount: parseFloat(row.data['Total Amount']),
          dueDate: row.data['Due Date'] || new Date(),
          status: 'Unpaid', // ✅ Explicit status
          importedFrom: 'Excel',
          importBatchId: batchId,
          importMetadata: {
            fileName: 'imported_file.xlsx',
            rowNumber: row.rowNumber,
            validationStatus: 'Valid'
          },
          generatedBy: cachedDecoded.userId
        };
      });

      await Bill.insertMany(billsToInsert);
      delete tempStorage[batchId];

      return NextResponse.json({
        success: true,
        imported: billsToInsert.length,
        message: `${billsToInsert.length} bills imported successfully`
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
