import mongoose from "mongoose";
import { configureMongoDns } from "./mongodb-dns";

// Second, isolated connection to the staging cluster — only ever opened by
// superadmin db-sync tooling (app/api/superadmin/db-sync/route.js). Never
// touches the app's main global.mongoose connection (lib/mongodb.js) used
// by real traffic, so this is safe to open/close independent of it.
let stagingConnection = null;
let stagingConnectionPromise = null;

async function connectStagingDB() {
  if (typeof window !== "undefined") {
    throw new Error("Staging DB access forbidden from client");
  }
  const STAGING_URI = process.env.MONGODB_STAGING_URI;
  if (!STAGING_URI) {
    throw new Error(
      "MONGODB_STAGING_URI not configured — add the staging cluster connection string as an env var.",
    );
  }
  if (stagingConnection && stagingConnection.readyState === 1) {
    return stagingConnection;
  }
  if (stagingConnectionPromise) {
    return stagingConnectionPromise;
  }
  try {
    configureMongoDns(STAGING_URI);
    const connection = mongoose.createConnection(STAGING_URI, {
      bufferCommands: false,
      maxPoolSize: 3,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 20000,
      retryWrites: true,
    });
    stagingConnectionPromise = connection.asPromise().then(() => {
      stagingConnection = connection;
      return stagingConnection;
    }).catch((err) => {
      stagingConnection = null;
      stagingConnectionPromise = null;
      throw err;
    });
    return await stagingConnectionPromise;
  } catch (error) {
    stagingConnection = null;
    stagingConnectionPromise = null;
    throw error;
  }
}

export default connectStagingDB;
