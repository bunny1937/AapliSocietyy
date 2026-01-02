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

    const templateData = await request.json();

    // Update society with new template
    const society = await Society.findByIdAndUpdate(
      decoded.societyId,
      {
        $set: {
          billTemplate: {
            type: templateData.type || 'default',
            pdfUrl: templateData.pdfUrl || null,
            hasFormFields: templateData.hasFormFields || false,
            detectedFields: templateData.detectedFields || [],
            imageUrl: templateData.imageUrl || null,
            design: templateData.design || null,
            logoUrl: templateData.logoUrl || null,
            signatureUrl: templateData.signatureUrl || null,
            uploadedAt: new Date(),
            uploadedBy: decoded.userId
          }
        }
      },
      { new: true, runValidators: true }
    );

    if (!society) {
      return NextResponse.json({ error: 'Society not found' }, { status: 404 });
    }

    console.log('✅ Bill template saved:', {
      type: templateData.type,
      pdfUrl: templateData.pdfUrl,
      hasFormFields: templateData.hasFormFields,
      fieldCount: templateData.detectedFields?.length || 0
    });

    return NextResponse.json({
      success: true,
      message: 'Template saved successfully',
      template: society.billTemplate
    });

  } catch (error) {
    console.error('❌ Save template error:', error);
    return NextResponse.json({
      error: 'Failed to save template',
      details: error.message
    }, { status: 500 });
  }
}
