import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
import Member from '@/models/Member';
import Transaction from '@/models/Transaction';
import Bill from '@/models/Bill';
import User from '@/models/User';
import AuditLog from '@/models/AuditLog';
import BillingHead from '@/models/BillingHead';
import Receipt from '@/models/Receipt';
import ExcelJS from 'exceljs';
import { requireRoles, SOCIETY_ADMIN_ROLES } from '@/lib/authz';
import { authorize } from '@/lib/rbac/authorize';
const MAX_EXPORT_ROWS = 10000;
const modelMap = {
  society: Society,
  members: Member,
  transactions: Transaction,
  bills: Bill,
  receipts: Receipt,
  users: User,
  auditlogs: AuditLog,
  billingheads: BillingHead
};
export async function GET(request, { params }) {
  try {
    const gate = await authorize(request, "society.data.export");
    if (!gate.ok) return gate.response;
    await connectDB();    const decoded = gate.context;
    const { entity } =  await params;
    const Model = modelMap[entity];
    if (!Model) {
      return NextResponse.json({ error: 'Invalid entity' }, { status: 400 });
    }
    const searchParams = new URL(request.url).searchParams;
    const format = searchParams.get('format') || 'excel';
    const query = {};
    if (entity !== 'society') {
      query.societyId = decoded.societyId;
    } else {
      query._id = decoded.societyId;
    }
    const total = await Model.countDocuments(query);
    if (total > MAX_EXPORT_ROWS) {
      return NextResponse.json({
        error: `Export too large (${total} rows). Max ${MAX_EXPORT_ROWS}. Use date filters to narrow the export.`
      }, { status: 400 });
    }
    const data = await Model.find(query).lean();
    // Audit log — record every export
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: 'EXPORT_DATA',
      newData: { entity, format, rowCount: data.length },
      timestamp: new Date(),
    });
    // JSON Export
    if (format === 'json') {
      return new NextResponse(JSON.stringify(data, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${entity}_${new Date().toISOString()}.json"`
        }
      });
    }
    // Excel Export
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(entity);
      if (data.length > 0) {
        // Get all unique keys from all objects
        const allKeys = [...new Set(data.flatMap(obj => Object.keys(obj)))];
        const columns = allKeys
          .filter(key => key !== '__v')
          .map(key => ({
            header: key,
            key: key,
            width: 15
          }));
        worksheet.columns = columns;
        // Style header
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2563EB' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        // Add data
        data.forEach(item => {
          const row = {};
          allKeys.forEach(key => {
            if (key !== '__v') {
              const value = item[key];
              row[key] = typeof value === 'object' && value !== null 
                ? JSON.stringify(value) 
                : value;
            }
          });
          worksheet.addRow(row);
        });
      }
      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${entity}_${new Date().toISOString()}.xlsx"`
        }
      });
    }
    // PDF Export (basic implementation)
    if (format === 'pdf') {
      // For now, return JSON with instructions to implement PDF
      return NextResponse.json({ 
        error: 'PDF export not yet implemented. Please use Excel or JSON export.',
        data: data 
      }, { status: 501 });
    }
    return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
