import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';
import { authorize } from '@/lib/rbac/authorize';
export async function POST(request) {
  const gate = await authorize(request, "billing.template.update");
  if (!gate.ok) return gate.response;
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
    const scope = templateData.scope === 'receipt' ? 'receipt' : 'bill';
    if (scope === 'receipt' && !['default', 'custom', 'uploaded-pdf', 'uploaded-image'].includes(templateData.type || 'custom')) {
      return NextResponse.json(
        { error: 'Unsupported receipt template type' },
        { status: 400 }
      );
    }
    const templateValue = scope === 'receipt'
      ? {
          type: templateData.type || 'custom',
          pdfUrl: templateData.pdfUrl || null,
          hasFormFields: templateData.hasFormFields || false,
          detectedFields: templateData.detectedFields || [],
          pdfFields: templateData.pdfFields || [],
          imageUrl: templateData.imageUrl || null,
          imageFields: templateData.imageFields || [],
          design: templateData.design || null,
          logoUrl: templateData.logoUrl || null,
          signatureUrl: templateData.signatureUrl || null,
          updatedAt: new Date(),
          updatedBy: decoded.userId
        }
      : {
          type: templateData.type || 'default',
          pdfUrl: templateData.pdfUrl || null,
          hasFormFields: templateData.hasFormFields || false,
          detectedFields: templateData.detectedFields || [],
          pdfFields: templateData.pdfFields || [],
          imageUrl: templateData.imageUrl || null,
          imageFields: templateData.imageFields || [],
          design: templateData.design || null,
          logoUrl: templateData.logoUrl || null,
          signatureUrl: templateData.signatureUrl || null,
          uploadedAt: new Date(),
          uploadedBy: decoded.userId
        };
    const targetField = scope === 'receipt' ? 'receiptTemplate' : 'billTemplate';
    // Save only after the client has shown the live preview/editor.
    const society = await Society.findByIdAndUpdate(
      decoded.societyId,
      { $set: { [targetField]: templateValue } },
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
      message: `${scope === 'receipt' ? 'Receipt' : 'Bill'} template saved successfully`,
      scope,
      template: society[targetField]
    });
  } catch (error) {
    console.error('❌ Save template error:', error);
    return NextResponse.json({
      error: 'Failed to save template'
    }, { status: 500 });
  }
}