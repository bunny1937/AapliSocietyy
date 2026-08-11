import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { requireRoles, SOCIETY_ADMIN_ROLES } from '@/lib/authz';
import { storeUploadedFile } from '@/lib/file-store';
import { authorize } from '@/lib/rbac/authorize';

export const runtime = 'nodejs';
export async function POST(request) {
  const gate = await authorize(request, "billing.template.upload");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();    const decoded = gate.context;
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
    // Magic-byte validation (guard against MIME spoofing)
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    if (!isJpeg && !isPng) {
      return NextResponse.json({ error: 'File content does not match declared type' }, { status: 400 });
    }
    // Store in MongoDB (Vercel serverless FS is read-only -> EROFS).
    const ext = file.name.split('.').pop();
    const filename = `${decoded.societyId}-${type}-${Date.now()}.${ext}`;
    const stored = await storeUploadedFile({
      societyId: decoded.societyId,
      kind: `bill-${type}`,
      filename,
      contentType: file.type,
      buffer,
      createdBy: decoded.userId,
    });
    const publicUrl = stored.url;
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