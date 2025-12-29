import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import Member from '@/models/Member';
import User from '@/models/User';
import AuditLog from '@/models/AuditLog';

export async function DELETE(request, { params }) {
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

    if (decoded.role === 'Accountant' || decoded.role === 'Member') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { entity } = await params;
    const { searchParams } = new URL(request.url);
    const ids = searchParams.get('ids')?.split(',') || [];

    if (ids.length === 0) {
      return NextResponse.json({ error: 'No IDs provided' }, { status: 400 });
    }

    let Model;
    if (entity === 'members') {
      Model = Member;
    } else if (entity === 'users') {
      Model = User;
    } else {
      return NextResponse.json({ error: 'Invalid entity' }, { status: 400 });
    }

    // Perform bulk delete
    const result = await Model.deleteMany({
      _id: { $in: ids },
      societyId: decoded.societyId
    });

    // If deleting members, also delete associated users
    if (entity === 'members') {
      await User.deleteMany({
        memberId: { $in: ids }
      });
    }

    // Audit log
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: 'DELETE_MEMBER',  
      newData: {
        entity: entity,
        deletedCount: result.deletedCount,
        bulkDelete: true,
        deletedIds: ids
      },
      timestamp: new Date()
    });

    return NextResponse.json({
      success: true,
      message: `Deleted ${result.deletedCount} ${entity}`,
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('Delete error:', error);
    return NextResponse.json({
      error: 'Delete failed',
      details: error.message
    }, { status: 500 });
  }
}
