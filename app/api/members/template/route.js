import { NextResponse } from 'next/server';
import { generateEnhancedMemberTemplate } from '@/lib/excel-handler';

export async function GET() {
  try {
    const buffer = await generateEnhancedMemberTemplate();
    
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="member_import_template_detailed.xlsx"'
      }
    });
  } catch (error) {
    console.error('Template generation error:', error);
    return NextResponse.json({ error: 'Failed to generate template' }, { status: 500 });
  }
}
