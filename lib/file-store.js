import connectDB from "@/lib/mongodb";
import UploadedFile from "@/models/UploadedFile";

// Central helper for storing/serving uploaded binaries from MongoDB instead of
// the (read-only on Vercel) serverless filesystem. Returns a short app URL
// (/api/files/<id>) that the rest of the app treats like any other hosted path.
export async function storeUploadedFile({
  societyId,
  kind,
  filename,
  contentType,
  buffer,
  createdBy,
  meta,
}) {
  await connectDB();
  const doc = await UploadedFile.create({
    societyId: societyId || undefined,
    kind,
    filename,
    contentType,
    size: buffer.length,
    data: buffer,
    createdBy: createdBy || undefined,
    meta: meta || {},
  });
  const id = doc._id.toString();
  return { id, url: `/api/files/${id}`, filename, contentType, size: buffer.length };
}

export async function loadUploadedFile(id) {
  await connectDB();
  const cleanId = extractFileId(id) || id;
  const doc = await UploadedFile.findById(cleanId).lean();
  if (!doc) return null;
  const raw = doc.data;
  const buffer = Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(raw && raw.buffer ? raw.buffer : raw || []);
  return {
    buffer,
    contentType: doc.contentType,
    filename: doc.filename,
    size: doc.size,
    societyId: doc.societyId ? String(doc.societyId) : null,
  };
}

// Accepts "/api/files/<24hex>", a bare 24-hex id, or a full URL and returns the
// 24-hex id (or null if none found).
export function extractFileId(url) {
  if (!url) return null;
  const m = String(url).match(/([a-f0-9]{24})/i);
  return m ? m[1] : null;
}
