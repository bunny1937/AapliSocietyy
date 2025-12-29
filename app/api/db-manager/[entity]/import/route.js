import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import Society from '@/models/Society';
import Member from '@/models/Member';
import Transaction from '@/models/Transaction';
import Bill from '@/models/Bill';
import User from '@/models/User';
import AuditLog from '@/models/AuditLog';
import BillingHead from '@/models/BillingHead';
import ExcelJS from 'exceljs';

const modelMap = {
  society: Society,
  members: Member,
  transactions: Transaction,
  bills: Bill,
  users: User,
  auditlogs: AuditLog,
  billingheads: BillingHead
};

export async function POST(request, { params }) {
  try {
    await connectDB();
    
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { entity } =   await params;
    const Model = modelMap[entity];
    
    if (!Model) {
      return NextResponse.json({ error: 'Invalid entity' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    let dataToImport = [];

    // Check file type
    if (file.name.endsWith('.json')) {
      // JSON Import
      const jsonString = buffer.toString('utf-8');
      dataToImport = JSON.parse(jsonString);
    } else if (file.name.endsWith('.xlsx')) {
      // Excel Import
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const headers = [];
      worksheet.getRow(1).eachCell((cell) => {
        headers.push(String(cell.value).trim());
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          const rowData = {};
          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber - 1];
            if (header) {
              rowData[header] = cell.value;
            }
          });
          dataToImport.push(rowData);
        }
      });
    } else {
      return NextResponse.json({ error: 'Unsupported file format. Use .json or .xlsx' }, { status: 400 });
    }

    if (!Array.isArray(dataToImport) || dataToImport.length === 0) {
      return NextResponse.json({ error: 'No data found in file' }, { status: 400 });
    }

    // Add societyId to each record if not society entity
    if (entity !== 'society') {
      dataToImport = dataToImport.map(item => ({
        ...item,
        societyId: decoded.societyId
      }));
    }

    // Insert data
    const result = await Model.insertMany(dataToImport, { ordered: false });

    return NextResponse.json({ 
      success: true, 
      imported: result.length,
      message: `Successfully imported ${result.length} records`
    });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ 
      error: 'Import failed', 
      details: error.message 
    }, { status: 500 });
  }
}
