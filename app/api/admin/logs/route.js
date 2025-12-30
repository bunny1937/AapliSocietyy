import { NextResponse } from 'next/server';
import { validateAdminRequest } from '@/lib/admin-middleware';
import { getAdminModels } from '@/lib/admin-models';

export async function GET(request) {
  const validation = validateAdminRequest(request);
  
  if (!validation.valid) {
    return validation;
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
