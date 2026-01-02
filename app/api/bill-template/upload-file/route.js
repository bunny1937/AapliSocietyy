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
    const type = formData.get('type');

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Validate file type
    const validTypes = {
      pdf: ['application/pdf'],
      image: ['image/jpeg', 'image/jpg', 'image/png'],
      logo: ['image/jpeg', 'image/jpg', 'image/png'],
      signature: ['image/jpeg', 'image/jpg', 'image/png']
    };

    if (!validTypes[type]?.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    // Size limit: 5MB for PDF, 2MB for images
    const maxSize = type === 'pdf' ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ 
        error: `File too large. Max ${maxSize / 1024 / 1024}MB` 
      }, { status: 400 });
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
    console.error('❌ Upload file error:', error);
    return NextResponse.json({
      error: 'Upload failed',
      details: error.message
    }, { status: 500 });
  }
}
