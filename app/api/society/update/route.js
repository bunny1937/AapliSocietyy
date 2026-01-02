import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
import AuditLog from '@/models/AuditLog';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';

export async function PUT(request) {
  try {
    await connectDB();
    
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'Admin' && decoded.role !== 'Secretary') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    console.log('📥 Update request body:', JSON.stringify(body, null, 2));

    // Find existing society
    const oldSociety = await Society.findById(decoded.societyId);
    if (!oldSociety) {
      return NextResponse.json({ error: 'Society not found' }, { status: 404 });
    }

    // Update society - NO VALIDATION, just update
    const updatedSociety = await Society.findByIdAndUpdate(
      decoded.societyId,
      { $set: body },
      { new: true, runValidators: false } // DISABLED validators
    );

    console.log('✅ Society updated:', updatedSociety.name);

    // Audit log
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "UPDATE_SOCIETY_CONFIG",
      oldData: oldSociety,
      newData: updatedSociety,
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: 'Society configuration updated successfully',
      society: updatedSociety
    });

  } catch (error) {
    console.error('❌ Update society config error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}
