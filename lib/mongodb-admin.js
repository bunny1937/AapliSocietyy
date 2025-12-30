import mongoose from 'mongoose';

let adminConnection = null;

/**
 * ISOLATED admin database connection
 * NO society users can access this
 */
async function connectAdminDB() {
  // ✅ SECURITY: Only allow in server-side (never client)
  if (typeof window !== 'undefined') {
    throw new Error('Admin DB access forbidden from client');
  }

  // ✅ SECURITY: Require admin secret key
  if (!process.env.ADMIN_SECRET_KEY) {
    throw new Error('Admin secret key not configured');
  }

  if (adminConnection && adminConnection.readyState === 1) {
    return adminConnection;
  }

  try {
    const ADMIN_URI = process.env.MONGODB_ADMIN_URI;
    
    if (!ADMIN_URI) {
      throw new Error('Admin DB URI not configured');
    }

    adminConnection = await mongoose.createConnection(ADMIN_URI, {
      dbName: 'aapli_society_admin', // ✅ Separate database
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 5, // Limit connections
      minPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log('🔐 Admin Database Connected (Secure)');
    return adminConnection;
    
  } catch (error) {
    console.error('❌ Admin DB connection failed:', error);
    throw error;
  }
}

export default connectAdminDB;
