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

const modelMap = {
  society: Society,
  members: Member,
  transactions: Transaction,
  bills: Bill,
  users: User,
  auditlogs: AuditLog,
  billingheads: BillingHead
};

export async function DELETE(request, { params }) {
  try {
    await connectDB();
    
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { entity } =  await params;
    const Model = modelMap[entity];
    
    if (!Model) {
      return NextResponse.json({ error: 'Invalid entity' }, { status: 400 });
    }

    // Prevent deleting society entity
    if (entity === 'society') {
      return NextResponse.json({ 
        error: 'Cannot reset society data. Please delete individual fields instead.' 
      }, { status: 403 });
    }

    // Delete all records for this society
    const result = await Model.deleteMany({
      societyId: decoded.societyId
    });

    // Log the reset action
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: 'RESET_ENTITY',
      oldData: { entity, deletedCount: result.deletedCount },
      timestamp: new Date()
    });

    return NextResponse.json({ 
      success: true, 
      deleted: result.deletedCount,
      message: `Successfully reset ${entity}. Deleted ${result.deletedCount} records.`
    });

  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ 
      error: 'Reset failed', 
      details: error.message 
    }, { status: 500 });
  }
}
