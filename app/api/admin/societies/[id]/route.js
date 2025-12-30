import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
import Member from '@/models/Member';
import Bill from '@/models/Bill';
import Transaction from '@/models/Transaction';
import jwt from 'jsonwebtoken';

export async function GET(request, { params }) {
  try {
    // Validate JWT
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
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    await connectDB();

    const { id: societyId } = await params; 

    // Fetch society
    const society = await Society.findById(societyId).lean();

    if (!society) {
      return NextResponse.json({ error: 'Society not found' }, { status: 404 });
    }

    // Get stats
    const [memberCount, billCount, transactionCount] = await Promise.all([
      Member.countDocuments({ societyId }),
      Bill.countDocuments({ societyId }),
      Transaction.countDocuments({ societyId })
    ]);

    return NextResponse.json({
      success: true,
      society: {
        ...society,
        stats: {
          members: memberCount,
          bills: billCount,
          transactions: transactionCount
        }
      }
    });

  } catch (error) {
    console.error('Society fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
