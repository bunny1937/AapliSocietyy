import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Society from '@/models/Society';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';
import { authorizeAny } from '@/lib/rbac/authorize';
// Read by Generate Bills too (template preview), not just Bill Template.
export async function GET(request) {
  const gate = await authorizeAny(request, [
    "billing.template.view",
    "billing.dashboard.view",
  ]);
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
    const society = await Society.findById(decoded.societyId).lean();
    if (!society) {
      return NextResponse.json({ error: 'Society not found' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      template: society.billTemplate || { type: 'default' },
      receiptTemplate: society.receiptTemplate || { type: 'default' }
    });
  } catch (error) {
    console.error('❌ Get template error:', error);
    return NextResponse.json({
      error: 'Failed to fetch template',
      details: error.message
    }, { status: 500 });
  }
}