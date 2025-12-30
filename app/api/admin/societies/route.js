import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
import Member from '@/models/Member';
import Bill from '@/models/Bill';
import Transaction from '@/models/Transaction';
import jwt from 'jsonwebtoken';
import { logAdminActivity } from '@/lib/export-to-admin-db';

export async function GET(request) {
  try {
    // ✅ Simple JWT validation
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

    await connectDB();

    // Fetch all societies with full details
    const societies = await Society.find({ })
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    // Get counts for each society
    const societiesWithStats = await Promise.all(
      societies.map(async (society) => {
        const [memberCount, billCount, transactionCount] = await Promise.all([
          Member.countDocuments({ societyId: society._id }),
          Bill.countDocuments({ societyId: society._id }),
          Transaction.countDocuments({ societyId: society._id })
        ]);

        return {
          ...society,
          stats: {
            members: memberCount,
            bills: billCount,
            transactions: transactionCount
          }
        };
      })
    );

    // Log activity
    await logAdminActivity({
      adminId: decoded.userId,
      adminName: decoded.email,
      action: 'VIEW_DATA',
      details: {
        resource: 'societies',
        count: societiesWithStats.length,
      },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    return NextResponse.json({
      success: true,
      societies: societiesWithStats,
      total: societiesWithStats.length
    });

  } catch (error) {
    console.error('Admin societies fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  // ✅ STRICT ADMIN VALIDATION
  const validation = validateAdminRequest(request);
  
  if (!validation.valid) {
    return validation;
  }

  const admin = validation.admin;

  try {
    await connectDB();
  console.log('🔍 Connected to database:', mongoose.connection.db.databaseName);
    console.log('🔍 Societies query...');

     

    console.log('🔍 Found societies:', societies.length);
    console.log('🔍 Societies:', societies.map(s => s.name));
    const { societyId, updates } = await request.json();

    const society = await Society.findByIdAndUpdate(
      societyId,
      updates,
      { new: true, runValidators: true }
    );

    if (!society) {
      return NextResponse.json({ error: 'Society not found' }, { status: 404 });
    }

    // ✅ LOG ADMIN ACTIVITY
    await logAdminActivity({
      adminId: admin.userId,
      adminName: admin.email,
      action: 'UPDATE_CONFIG',
      targetSociety: {
        societyId: society._id,
        societyName: society.name,
      },
      details: {
        updates,
      },
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    return NextResponse.json({
      success: true,
      message: 'Society updated successfully',
      society
    });

  } catch (error) {
    console.error('❌ Admin society update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
