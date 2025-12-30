import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
import Member from '@/models/Member';
import Bill from '@/models/Bill';
import jwt from 'jsonwebtoken';
import { getAdminModels } from '@/lib/admin-models';

export async function GET(request) {
  try {
    // ✅ Simple JWT validation (no API key required)
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.substring(7);

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    } catch (error) {
      console.error('Token verification failed:', error.message);
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Check if SuperAdmin
    if (decoded.role !== 'SuperAdmin') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Fetch stats
    await connectDB();
    const { Export } = await getAdminModels();

    const [societyCount, memberCount, billCount, exportCount] = await Promise.all([
      Society.countDocuments({ isDeleted: false }),
      Member.countDocuments({}),
      Bill.countDocuments({}),
      Export.countDocuments({ isRestored: false }),
    ]);

    return NextResponse.json({
      success: true,
      societies: societyCount,
      members: memberCount,
      bills: billCount,
      exports: exportCount,
    });

  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats', details: error.message },
      { status: 500 }
    );
  }
}
