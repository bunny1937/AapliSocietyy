import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
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

    const society = await Society.findById(decoded.societyId).lean();

    if (!society) {
      return NextResponse.json({ error: 'Society not found' }, { status: 404 });
    }

    // Return saved template or default
    const template = society.billTemplate?.design || null;
    const logoUrl = society.billTemplate?.logoUrl || null;
    const signatureUrl = society.billTemplate?.signatureUrl || null;

    return NextResponse.json({
      success: true,
      template,
      logoUrl,
      signatureUrl
    });

  } catch (error) {
    console.error('❌ Get template error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}
