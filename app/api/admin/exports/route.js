import { NextResponse } from 'next/server';
import { validateAdminRequest } from '@/lib/admin-middleware';
import { getAdminModels } from '@/lib/admin-models';
import { authorize } from '@/lib/rbac/authorize';
export async function GET(request) {
  // Superadmin first — see app/api/admin/data-browser/route.js for why.
  // authorize() reads the society-scoped `token` cookie; a superadmin holds
  // `admin_token` and has no society context, so gating on it first returns
  // 401 for the platform owner.
  const validation = validateAdminRequest(request);
  if (!validation.valid) {
    const gate = await authorize(request, 'society.data.export');
    if (!gate.ok) return gate.response;
  }
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const { Export } = await getAdminModels();
    let query = {};
    if (filter !== 'all') {
      query.collection = filter;
    }
    const exports = await Export.find(query)
      .sort({ deletedAt: -1 })
      .limit(100)
      .lean();
    return NextResponse.json({
      success: true,
      exports,
    });
  } catch (error) {
    console.error('Admin exports error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch exports' },
      { status: 500 }
    );
  }
}
