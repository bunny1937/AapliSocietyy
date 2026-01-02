import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
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

    const { template, logoUrl, signatureUrl } = await request.json();

    if (!template) {
      return NextResponse.json({ error: 'Template data required' }, { status: 400 });
    }

    // Save template as JSON structure
    const society = await Society.findByIdAndUpdate(
      decoded.societyId,
      {
        $set: {
          'billTemplate.type': 'custom',
          'billTemplate.design': template, // JSON structure
          'billTemplate.logoUrl': logoUrl,
          'billTemplate.signatureUrl': signatureUrl,
          'billTemplate.updatedAt': new Date(),
          'billTemplate.updatedBy': decoded.userId
        }
      },
      { new: true }
    );

    if (!society) {
      return NextResponse.json({ error: 'Society not found' }, { status: 404 });
    }

    console.log('✅ Bill template saved for:', society.name);

    return NextResponse.json({
      success: true,
      message: 'Template saved successfully',
      template: society.billTemplate
    });

  } catch (error) {
    console.error('❌ Save template error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}
