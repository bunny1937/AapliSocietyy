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
