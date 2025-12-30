import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Bill from '@/models/Bill';
import Member from '@/models/Member';
import Transaction from '@/models/Transaction';
import BillingHead from '@/models/BillingHead';
import jwt from 'jsonwebtoken';
import { logAdminActivity } from '@/lib/export-to-admin-db';

const COLLECTIONS = {
  bills: Bill,
  members: Member,
  transactions: Transaction,
  billingheads: BillingHead
};

export async function GET(request) {
  try {
    await connectDB();
    
    // ✅ Admin JWT validation
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No token' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded;
    
    try {
      decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    } catch (error) {
      console.error('JWT verification failed:', error.message);
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Check if SuperAdmin
    if (decoded.role !== 'SuperAdmin') {
      return NextResponse.json({ error: 'SuperAdmin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const societyId = searchParams.get('societyId');
    const collection = searchParams.get('collection');

    if (!societyId || !collection || !COLLECTIONS[collection]) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const Model = COLLECTIONS[collection];
    
    // Fetch data
    let data = await Model.find({ societyId })
      .limit(1000)
      .sort({ createdAt: -1 })
      .lean();

    // Populate memberId if exists
    if (collection === 'bills' || collection === 'transactions') {
      data = await Model.find({ societyId })
        .populate('memberId', 'wing roomNo ownerName')
        .limit(1000)
        .sort({ createdAt: -1 })
        .lean();
    }

    // Log activity
    await logAdminActivity({
      adminId: decoded.userId,
      adminName: decoded.email,
      action: 'VIEW_DATA',
      details: {
        resource: `${collection} for society ${societyId}`,
        count: data.length,
      },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    return NextResponse.json({
      success: true,
      data,
      count: data.length,
      collection,
      societyId
    });

  } catch (error) {
    console.error('Data browser fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await connectDB();
    
    // ✅ Admin JWT validation
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No token' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded;
    
    try {
      decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'SuperAdmin') {
      return NextResponse.json({ error: 'SuperAdmin access required' }, { status: 403 });
    }

    const { action, societyId, collection, ids, reason } = await request.json();

    if (action !== 'delete' || !societyId || !collection || !ids || !reason) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    if (!COLLECTIONS[collection]) {
      return NextResponse.json({ error: 'Invalid collection' }, { status: 400 });
    }

    const Model = COLLECTIONS[collection];

    // Fetch documents to be deleted
    const docsToDelete = await Model.find({ _id: { $in: ids }, societyId }).lean();

    if (docsToDelete.length === 0) {
      return NextResponse.json({ error: 'No documents found to delete' }, { status: 404 });
    }

    // Export to admin database using your existing function
    const { getAdminModels } = await import('@/lib/admin-models');
    const { Export } = await getAdminModels();

    const exportDoc = await Export.create({
      collection,
      societyId,
      societyName: 'Unknown', // You can fetch from Society model if needed
      data: docsToDelete,
      recordCount: docsToDelete.length,
      deletedBy: {
        userId: decoded.userId,
        userName: decoded.email,
        role: 'SuperAdmin'
      },
      deletionReason: reason,
      deletedAt: new Date(),
      willExpireAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      isRestored: false
    });

    // Delete documents
    const deleteResult = await Model.deleteMany({ _id: { $in: ids }, societyId });

    // Log activity
    await logAdminActivity({
      adminId: decoded.userId,
      adminName: decoded.email,
      action: 'DELETE_DATA',
      details: {
        collection,
        societyId,
        deletedCount: deleteResult.deletedCount,
        reason
      },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    return NextResponse.json({
      success: true,
      message: `${deleteResult.deletedCount} items deleted and archived for 90 days`,
      deletedCount: deleteResult.deletedCount,
      exportId: exportDoc._id
    });

  } catch (error) {
    console.error('Delete with export error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
