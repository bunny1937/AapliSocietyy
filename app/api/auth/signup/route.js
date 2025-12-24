import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Society from "@/models/Society";
import { signToken } from "@/lib/jwt";

export async function POST(request) {
  try {
    await connectDB();

    const { name, email, password, role, societyName, registrationNo } =
      await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 409 }
      );
    }

    let societyId;
    if (role === "Admin" && societyName) {
      const society = await Society.create({
        name: societyName,
        registrationNo: registrationNo || "",
        address: "",
      });
      societyId = society._id;
    } else {
      return NextResponse.json(
        { error: "Society information required for Admin role" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: role || "Secretary",
      societyId,
    });

    const token = signToken({
      userId: user._id,
      email: user.email,
      role: user.role,
      societyId: user.societyId,
    });

    return NextResponse.json(
      {
        message: "User created successfully",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          societyId: user.societyId,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
