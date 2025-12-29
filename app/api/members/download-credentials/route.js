import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

export async function POST(request) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

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
      { header: 'Email', key: 'email', width: 35 },
      { header: 'Password', key: 'password', width: 15 }
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
        email: cred.email,
        password: cred.password
      });
    });

    // Add instructions at the bottom
    worksheet.addRow([]);
    const instructionRow = worksheet.addRow(['INSTRUCTIONS:', '', '', '', '']);
    instructionRow.font = { bold: true, color: { argb: 'FFDC2626' } };
    
    worksheet.addRow(['1. Share these credentials with respective members via email/WhatsApp']);
    worksheet.addRow(['2. Advise members to change their password after first login']);
    worksheet.addRow(['3. Keep this file secure and do not share publicly']);

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
