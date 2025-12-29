import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import Member from '@/models/Member';
import User from '@/models/User';
import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import AuditLog from '@/models/AuditLog';
import { readFile, unlink } from 'fs/promises';

function generatePassword() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

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

    const { tempFilePath } = await request.json();

    if (!tempFilePath) {
      return NextResponse.json({ error: 'No temp file specified' }, { status: 400 });
    }

    // Read temp file
    const buffer = await readFile(tempFilePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const firstSheet = workbook.worksheets[0];
    const isEnhancedTemplate = firstSheet.name.includes('Basic Info');

    let result;
    if (isEnhancedTemplate) {
      result = await processEnhancedImport(workbook, decoded);
    } else {
      result = await processSimpleImport(workbook, decoded);
    }

    // Delete temp file
    await unlink(tempFilePath);

    // Audit log
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: 'IMPORT_MEMBERS',
      newData: {
        importedCount: result.createdMembers.length,
        importType: isEnhancedTemplate ? 'enhanced' : 'simple'
      },
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Confirm import error:', error);
    return NextResponse.json({ 
      error: 'Import failed', 
      details: error.message 
    }, { status: 500 });
  }
}

// ... (Keep your existing processEnhancedImport and processSimpleImport functions)
