import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import BillingHead from '@/models/BillingHead';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';

export async function PUT(request, { params }) {
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

    if (decoded.role === 'Accountant') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { id } = params;
    const updates = await request.json();

    const head = await BillingHead.findOne({
      _id: id,
      societyId: decoded.societyId,
      isDeleted: false
    });

    if (!head) {
      return NextResponse.json({ error: 'Billing head not found' }, { status: 404 });
    }

    // Update allowed fields
    const allowedUpdates = ['headName', 'calculationType', 'defaultAmount', 'isActive', 'order'];
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        head[key] = updates[key];
      }
    });

    head.lastModifiedAt = new Date();
    head.lastModifiedBy = decoded.userId;
    
    await head.save();

    return NextResponse.json({
      success: true,
      message: 'Billing head updated successfully',
      head
    });

  } catch (error) {
    console.error('Update billing head error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}
