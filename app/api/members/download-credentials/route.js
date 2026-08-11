import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import jwt from 'jsonwebtoken';
import { authorize } from "@/lib/rbac/authorize";
// Auth: admin_token cookie (superadmin) or regular JWT cookie (admin/member)
export async function POST(request) {
  try {
    const gate = await authorize(request, "member.member.downloadCredentials");
    if (!gate.ok) return gate.response;
    // Accept: regular JWT (admin/member cookie) OR superadmin admin_token cookie
    const adminToken = request.cookies.get("admin_token")?.value;
    const regularToken = getTokenFromRequest(request);
    let authorized = false;
    if (regularToken && verifyToken(regularToken)) {
      authorized = true;
    } else if (adminToken) {
      try {
        jwt.verify(adminToken, process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
        authorized = true;
      } catch { /* invalid */ }
    }
    if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { credentials } = await request.json();
    if (!credentials || credentials.length === 0) {
      return NextResponse.json({ error: 'No credentials provided' }, { status: 400 });
    }
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('User Credentials');
    // Add header with styling
    worksheet.columns = [
      { header: 'Flat No', key: 'flatNo', width: 12 },
      { header: 'Wing', key: 'wing', width: 10 },
      { header: 'Owner Name', key: 'ownerName', width: 30 },
      { header: 'Username', key: 'username', width: 25 },
      { header: 'Email', key: 'email', width: 35 },
      { header: 'Password', key: 'password', width: 20 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Setup Link', key: 'setCredentialsUrl', width: 70 },
    ];
    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }
    };
    // Add data
    credentials.forEach(cred => {
      worksheet.addRow({
        flatNo: cred.flatNo,
        wing: cred.wing || '',
        ownerName: cred.ownerName,
        username: cred.username || '',
        email: cred.email,
        password: cred.password,
       status: cred.isNewUser ? 'New Account' : 'Existing Account',
  setCredentialsUrl: cred.setCredentialsUrl || '',
});
    });
    // Add instructions at the bottom
    worksheet.addRow([]);
const instructionRow = worksheet.addRow(['INSTRUCTIONS:', '', '', '', '', '', '', '']);
    instructionRow.font = { bold: true, color: { argb: 'FFDC2626' } };
    worksheet.addRow(['1. Members login with Username (or email) + Password']);
    worksheet.addRow(['2. "Existing Account" rows — password unchanged, use their original password']);
    worksheet.addRow(['3. Share new account credentials with members via email/WhatsApp']);
    worksheet.addRow(['4. Advise members to change their password after first login']);
    worksheet.addRow(['5. Keep this file secure and do not share publicly']);
    worksheet.addRow(['6. Setup links expire 7 days after import — re-import or resend if they lapse']);
    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    // Return as downloadable file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=User_Credentials_${Date.now()}.xlsx`
      }
    });
  } catch (error) {
    console.error('Download credentials error:', error);
    return NextResponse.json({ 
      error: 'Download failed', 
      details: error.message 
    }, { status: 500 });
  }
}
