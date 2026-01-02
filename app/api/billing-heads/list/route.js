import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import BillingHead from '@/models/BillingHead';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';

export async function GET(request) {
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

    const heads = await BillingHead.find({
      societyId: decoded.societyId,
      isDeleted: false
    }).sort({ order: 1 }).lean();

    return NextResponse.json({
      success: true,
      heads
    });

  } catch (error) {
    console.error('❌ List billing heads error:', error);
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
}
