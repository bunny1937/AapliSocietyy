import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Bill from '@/models/Bill';
import User from '@/models/User';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';
import { exportToAdminDB, logAdminActivity } from '@/lib/export-to-admin-db';

export async function POST(request) {
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

    const { billIds, reason } = await request.json();

    if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
      return NextResponse.json(
        { error: 'Bill IDs are required' },
        { status: 400 }
      );
    }

    if (!reason || reason.trim() === '') {
      return NextResponse.json(
        { error: 'Deletion reason is required' },
        { status: 400 }
      );
    }

    // Get user info
    const user = await User.findById(decoded.userId).lean();

    // ✅ STEP 1: FETCH BILLS TO DELETE
    const billsToDelete = await Bill.find({
      _id: { $in: billIds },
      societyId: decoded.societyId,
    }).lean();

    if (billsToDelete.length === 0) {
      return NextResponse.json(
        { error: 'No bills found to delete' },
        { status: 404 }
      );
    }

    // ✅ STEP 2: EXPORT TO ADMIN.EXPORTS COLLECTION (BEFORE DELETING)
    const exportResult = await exportToAdminDB(billsToDelete, {
      collection: 'bills',
      societyId: decoded.societyId,
      deletedBy: decoded.userId,
      deletedByName: user.name,
      deletedByRole: user.role,
      deletionReason: reason,
    });

    // ✅ STEP 3: SOFT DELETE (mark as deleted)
    await Bill.updateMany(
      { _id: { $in: billIds } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: decoded.userId,
        },
      }
    );

    // ✅ STEP 4: LOG ADMIN ACTIVITY
    await logAdminActivity({
      adminId: decoded.userId,
      adminName: user.name,
      action: 'DELETE_DATA',
      targetSociety: {
        societyId: decoded.societyId,
        societyName: 'Society Name', // Add from context
      },
      details: {
        collection: 'bills',
        recordCount: billsToDelete.length,
        reason,
      },
    });

    console.log(`✅ Deleted ${billsToDelete.length} bills`);

    return NextResponse.json({
      success: true,
      message: `${billsToDelete.length} bills deleted and exported to admin database`,
      deleted: billsToDelete.length,
      exportId: exportResult.exportId,
    });
  } catch (error) {
    console.error('Delete bills error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
