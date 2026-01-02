import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import BillingHead from '@/models/BillingHead';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';

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

    if (decoded.role === 'Accountant') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { headName, calculationType, defaultAmount, order } = await request.json();

    // Validate input
    if (!headName || !calculationType || defaultAmount === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['Fixed', 'Per Sq Ft', 'Percentage'].includes(calculationType)) {
      return NextResponse.json({ error: 'Invalid calculation type' }, { status: 400 });
    }

    // Check for duplicate
    const existing = await BillingHead.findOne({
      societyId: decoded.societyId,
      headName: headName.trim(),
      isDeleted: false
    });

    if (existing) {
      return NextResponse.json({ error: 'Billing head with this name already exists' }, { status: 409 });
    }

    // Get max order if not provided
    let orderValue = order;
    if (orderValue === undefined) {
      const maxOrder = await BillingHead.findOne({ societyId: decoded.societyId })
        .sort({ order: -1 })
        .select('order')
        .lean();
      orderValue = maxOrder ? maxOrder.order + 1 : 0;
    }

    const billingHead = await BillingHead.create({
      headName: headName.trim(),
      calculationType,
      defaultAmount: parseFloat(defaultAmount),
      order: orderValue,
      societyId: decoded.societyId,
      isActive: true,
      canBeArchived: true
    });

    return NextResponse.json({
      success: true,
      message: 'Billing head created successfully',
      head: billingHead
    }, { status: 201 });

  } catch (error) {
    console.error('Create billing head error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}
