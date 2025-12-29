import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Society from "@/models/Society";
import { signToken } from "@/lib/jwt";

export async function POST(request) {
  try {
    await connectDB();

    const body = await request.json();
    
    const {
      // Admin Details
      fullName,
      email,
      password,
      
      // Society Basic Info
      societyName,
      registrationNo,
      dateOfRegistration,
      address,
      panNo,
      tanNo,
      
      // Contact Details
      personOfContact,
      contactEmail,
      contactPhone,
      
      // Configuration
      maintenanceRate,
      sinkingFundRate,
      repairFundRate,
      interestRate,
      gracePeriodDays,
      billDueDay,
      
      // Fixed Charges
      waterCharge,
      securityCharge,
      electricityCharge
    } = body;

    // Validation
    if (!fullName || !email || !password) {
      return NextResponse.json(
        { error: "Admin name, email and password are required" },
        { status: 400 }
      );
    }

    if (!societyName || !address) {
      return NextResponse.json(
        { error: "Society name and address are required" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      );
    }

    // Check if society registration number already exists
    if (registrationNo) {
      const existingSociety = await Society.findOne({ registrationNo });
      if (existingSociety) {
        return NextResponse.json(
          { error: "Society with this registration number already exists" },
          { status: 409 }
        );
      }
    }

    // Create Society with complete details
    const society = await Society.create({
      // Basic Information
      name: societyName,
      registrationNo: registrationNo || undefined,
      dateOfRegistration: dateOfRegistration ? new Date(dateOfRegistration) : undefined,
      address: address,
      panNo: panNo || undefined,
      tanNo: tanNo || undefined,
      
      // Contact Details
      personOfContact: personOfContact || undefined,
      contactEmail: contactEmail || email, // Use admin email as fallback
      contactPhone: contactPhone || undefined,
      
      // Configuration
      config: {
        maintenanceRate: parseFloat(maintenanceRate) || 0,
        sinkingFundRate: parseFloat(sinkingFundRate) || 0,
        repairFundRate: parseFloat(repairFundRate) || 0,
        interestRate: parseFloat(interestRate) || 0,
        gracePeriodDays: parseInt(gracePeriodDays) || 10,
        billDueDay: parseInt(billDueDay) || 10,
        interestCalculationMethod: "COMPOUND",
        interestCompoundingFrequency: "MONTHLY",
        
        // Fixed Charges
        fixedCharges: {
          water: parseFloat(waterCharge) || 0,
          security: parseFloat(securityCharge) || 0,
          electricity: parseFloat(electricityCharge) || 0
        }
      }
    });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create Admin User
    const user = await User.create({
      name: fullName,
      email: email,
      password: hashedPassword,
      role: "Admin",
      societyId: society._id,
      isActive: true
    });

    // Generate JWT token
    const token = signToken({
      userId: user._id,
      email: user.email,
      role: user.role,
      societyId: user.societyId,
    });

    // Set cookie
    const response = NextResponse.json(
      {
        success: true,
        message: "Account created successfully",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          societyId: user.societyId,
        },
        society: {
          id: society._id,
          name: society.name,
          registrationNo: society.registrationNo
        }
      },
      { status: 201 }
    );

    // Set HTTP-only cookie for token
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    });

    return response;

  } catch (error) {
    console.error("Signup error:", error);
    
    // Handle specific errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return NextResponse.json(
        { error: `${field} already exists` },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}
