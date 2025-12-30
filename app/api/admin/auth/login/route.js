import { NextResponse } from 'next/server';
import { getAdminModels } from '@/lib/admin-models';
import jwt from 'jsonwebtoken';
import { checkRateLimit, clearRateLimit } from '@/lib/admin-middleware';

export async function POST(request) {
  try {
    const { email, password, adminKey } = await request.json();

    // ✅ SECURITY 1: Require admin secret key in request body
    if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
      console.warn('🚨 Admin login attempt without valid admin key');
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // ✅ SECURITY 2: Rate limiting
    const rateLimit = checkRateLimit(email);
    if (rateLimit.blocked) {
      const remainingTime = Math.ceil((rateLimit.resetAt - Date.now()) / 60000);
      return NextResponse.json(
        { 
          error: `Too many attempts. Try again in ${remainingTime} minutes.`,
          blockedUntil: rateLimit.resetAt
        },
        { status: 429 }
      );
    }

    // ✅ SECURITY 3: Validate credentials
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password required' },
        { status: 400 }
      );
    }

    const { SuperAdmin, AdminLog } = await getAdminModels();

    // Find admin in ADMIN database
    const admin = await SuperAdmin.findOne({ email, isActive: true });

    if (!admin) {
      console.warn(`🚨 Failed admin login attempt: ${email}`);
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // ✅ SECURITY 4: Verify password
    const isMatch = await admin.comparePassword(password);

    if (!isMatch) {
      console.warn(`🚨 Wrong password for admin: ${email}`);
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // ✅ SUCCESS: Clear rate limit
    clearRateLimit(email);

    // Update login info
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    admin.lastLogin = new Date();
    admin.loginHistory.push({
      timestamp: new Date(),
      ipAddress,
      userAgent,
    });
    await admin.save();

    // Log login
    await AdminLog.create({
      adminId: admin._id,
      adminName: admin.name,
      action: 'LOGIN',
      ipAddress,
      userAgent,
      timestamp: new Date(),
    });

    // ✅ SECURITY 5: Generate token with ADMIN-specific secret
    const token = jwt.sign(
      {
        userId: admin._id,
        email: admin.email,
        role: 'SuperAdmin',
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: '8h' } // Token expires in 8 hours
    );

    console.log(`✅ Admin logged in: ${email}`);

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: 'SuperAdmin',
      },
    });

  } catch (error) {
    console.error('❌ Admin login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
