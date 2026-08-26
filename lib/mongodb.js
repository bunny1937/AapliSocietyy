import mongoose from "mongoose";
import { configureMongoDns } from "./mongodb-dns.js";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Please define MONGODB_URI in .env.local");
}

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      // ## Why these came down from 30s
      //
      // The old values (30s selection x 4 retries + backoff) meant a single
      // bad cold start could keep a serverless function alive for ~123
      // seconds doing nothing but waiting on a socket. On Fluid compute you
      // are billed for provisioned memory the entire time, which is what
      // produced 6.5 GB-Hrs against ~17k invocations.
      //
      // Atlas in the same region answers in <100ms when healthy. 5s is a
      // generous ceiling; anything slower is a real outage, and failing fast
      // with a 503 the client can retry is both cheaper and better UX than a
      // two-minute hang.
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      // Long enough for a heavy aggregation, short enough that a dead socket
      // does not pin an instance for 45s.
      socketTimeoutMS: 20000,
      // Fluid runs many instances; the pool size multiplies by instance count.
      // 10 per instance x 3 warm instances already exceeded what M0 should be
      // asked to hold.
      maxPoolSize: 5,
      minPoolSize: 0,
      // Hand sockets back instead of holding them open between bursts. This is
      // the single line that drops the idle connection count in Atlas.
      maxIdleTimeMS: 30000,
      retryWrites: true,
      w: "majority",
      // Read-after-write on the same request must see its own write. The
      // "photo uploaded but did not appear" class of bug is a read landing on
      // a secondary before replication caught up.
      readPreference: "primary",
    };
    configureMongoDns(MONGODB_URI);

    // Retry transient DNS/handshake blips instead of throwing a 500 on the
    // first miss. Two attempts covers the genuine blip case; attempts 3 and 4
    // only ever fired during real outages, where they added ~60s of billed
    // wait time to a request that was going to fail anyway.
    const connectWithRetry = async (attempts = 2) => {
      let lastErr;
      for (let i = 1; i <= attempts; i++) {
        try {
          return await mongoose.connect(MONGODB_URI, opts);
        } catch (e) {
          lastErr = e;
          console.warn(
            `MongoDB connect attempt ${i}/${attempts} failed: ${e.code || e.message}`,
          );
          if (i < attempts) {
            await new Promise((r) => setTimeout(r, 500 * i));
          }
        }
      }
      throw lastErr;
    };

    cached.promise = connectWithRetry()
      .then((mongoose) => {
        console.log("MongoDB Connected");
        return mongoose;
      })
      .catch((e) => {
        // Reset so the NEXT request can try again from scratch instead of
        // reusing a rejected promise forever.
        cached.promise = null;
        throw e;
      });
  }
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  // PROD-07: 21+ files rely on session.withTransaction(), which requires a
  // replica set. Fail fast on a standalone mongod instead of failing at the
  // first voucher post / bill generation / payment record.
  if (!cached.replicaSetChecked) {
    cached.replicaSetChecked = true;
    try {
      const info = await cached.conn.connection.db.admin().command({ isMaster: 1 });
      if (!info.setName) {
        cached.replicaSetChecked = false;
        cached.conn = null;
        cached.promise = null;
        throw new Error(
          "MongoDB is not running as a replica set (no setName from isMaster). " +
          "This app requires a replica set for multi-document transactions " +
          "(vouchers, bill generation, payments, bulk import, member activation).",
        );
      }
    } catch (e) {
      if (e.message?.startsWith("MongoDB is not running as a replica set")) throw e;
      // isMaster itself failing shouldn't block startup — surface it as a warning.
      console.warn("Replica-set check failed to run:", e.message);
    }
  }

  return cached.conn;
}

export default connectDB;
