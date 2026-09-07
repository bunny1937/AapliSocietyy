import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/admin-middleware";
import connectDB from "@/lib/mongodb";
import connectStagingDB from "@/lib/mongodb-staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mongo internal collections we never want to list/copy.
const SYSTEM_PREFIX = "system.";

async function listUserCollections(db) {
  const collections = await db.listCollections().toArray();
  return collections
    .map((c) => c.name)
    .filter((name) => !name.startsWith(SYSTEM_PREFIX))
    .sort();
}

// GET — status/diff: every collection in the test (source) db, doc count
// there vs staging, and how many docs staging is missing (by _id).
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    const [testConn, stagingConn] = await Promise.all([
      connectDB(),
      connectStagingDB(),
    ]);
    const testDb = testConn.connection.db;
    const stagingDb = stagingConn.db;

    const testNames = await listUserCollections(testDb);
    const stagingNames = new Set(await listUserCollections(stagingDb));

    const collections = await Promise.all(
      testNames.map(async (name) => {
        const testCount = await testDb.collection(name).estimatedDocumentCount();
        const existsInStaging = stagingNames.has(name);
        const stagingCount = existsInStaging
          ? await stagingDb.collection(name).estimatedDocumentCount()
          : 0;

        // Cheap diff: compare _id sets. Fine at this app's data volumes;
        // if any collection grows huge this should switch to a hash-based
        // diff instead of pulling every _id.
        let missing = Math.max(testCount - stagingCount, 0);
        if (existsInStaging && testCount > 0) {
          const [testIds, stagingIds] = await Promise.all([
            testDb.collection(name).find({}, { projection: { _id: 1 } }).toArray(),
            stagingDb.collection(name).find({}, { projection: { _id: 1 } }).toArray(),
          ]);
          const stagingIdSet = new Set(stagingIds.map((d) => String(d._id)));
          missing = testIds.filter((d) => !stagingIdSet.has(String(d._id))).length;
        } else if (!existsInStaging) {
          missing = testCount;
        }

        return {
          name,
          testCount,
          stagingCount,
          missing,
          inSync: missing === 0,
        };
      }),
    );

    return NextResponse.json({
      collections,
      totalMissing: collections.reduce((sum, c) => sum + c.missing, 0),
    });
  } catch (error) {
    console.error("db-sync status failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — one-click copy. Skips any doc whose _id already exists in staging;
// only inserts what's missing. Never touches/overwrites existing staging
// docs, never deletes anything.
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    const [testConn, stagingConn] = await Promise.all([
      connectDB(),
      connectStagingDB(),
    ]);
    const testDb = testConn.connection.db;
    const stagingDb = stagingConn.db;

    const testNames = await listUserCollections(testDb);

    const results = [];
    for (const name of testNames) {
      const [allDocs, stagingIds] = await Promise.all([
        testDb.collection(name).find({}).toArray(),
        stagingDb.collection(name).find({}, { projection: { _id: 1 } }).toArray(),
      ]);
      const stagingIdSet = new Set(stagingIds.map((d) => String(d._id)));
      const toInsert = allDocs.filter((d) => !stagingIdSet.has(String(d._id)));

      let inserted = 0;
      if (toInsert.length > 0) {
        const res = await stagingDb
          .collection(name)
          .insertMany(toInsert, { ordered: false });
        inserted = res.insertedCount;
      }
      results.push({ name, inserted, skipped: allDocs.length - toInsert.length });
    }

    return NextResponse.json({
      ok: true,
      results,
      totalInserted: results.reduce((sum, r) => sum + r.inserted, 0),
    });
  } catch (error) {
    console.error("db-sync copy failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
