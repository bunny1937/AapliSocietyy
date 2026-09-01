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
    const gate = await authorize(request, 'audit.log.read');
    if (!gate.ok) return gate.response;
  }
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const { AdminLog } = await getAdminModels();
    let query = {};
    if (filter !== 'all') {
      query.action = filter;
    }
    const logs = await AdminLog.find(query)
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    return NextResponse.json({
      success: true,
      logs,
    });
  } catch (error) {
    console.error('Admin logs error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}
