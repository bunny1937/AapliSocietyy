import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import connectDB from '@/lib/mongodb';
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

    const formData = await request.formData();
    const file = formData.get('file');
    const type = formData.get('type'); // 'logo' or 'signature'

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG allowed' }, { status: 400 });
    }

    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'File must be less than 2MB' }, { status: 400 });
    }

    // Convert to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create directory
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'bills');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // Generate filename
    const ext = file.name.split('.').pop();
    const filename = `${decoded.societyId}-${type}-${Date.now()}.${ext}`;
    const filePath = join(uploadsDir, filename);

    // Save file
    await writeFile(filePath, buffer);

    const publicUrl = `/uploads/bills/${filename}`;

    console.log(`✅ Uploaded ${type}:`, publicUrl);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      type,
      filename
    });

  } catch (error) {
    console.error('❌ Upload image error:', error);
    return NextResponse.json({
      error: 'Upload failed',
      details: error.message
    }, { status: 500 });
  }
}
