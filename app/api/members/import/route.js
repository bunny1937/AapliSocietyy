import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Member from "@/models/Member";
import User from "@/models/User";
import { parseMemberExcel } from "@/lib/excel-handler";
import bcrypt from "bcryptjs";
import AuditLog from "@/models/AuditLog";

function generatePassword() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    if (decoded.role === "Accountant") {
      return NextResponse.json(
        {
          error: "Insufficient permissions",
        },
        { status: 403 }
      );
    }

    const { filename, fileData } = await request.json();

    if (!fileData) {
      return NextResponse.json(
        { error: "No file data provided" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(fileData, "base64");
    const parseResult = await parseMemberExcel(buffer);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: parseResult.error,
          details: parseResult.details,
        },
        { status: 400 }
      );
    }

    const members = parseResult.members;

    // Check for duplicates
    const existingMembers = await Member.find({
      societyId: decoded.societyId,
    }).select("roomNo wing");

    const existingFlats = new Set(
      existingMembers.map((m) => `${m.wing}-${m.roomNo}`)
    );

    const duplicatesInFile = new Set();
    const duplicatesInDb = [];

    members.forEach((member, index) => {
      const key = `${member.wing}-${member.roomNo}`;

      if (duplicatesInFile.has(key)) {
        duplicatesInDb.push({
          row: index + 2,
          roomNo: member.roomNo,
          wing: member.wing,
          reason: "Duplicate in upload file",
        });
      }

      if (existingFlats.has(key)) {
        duplicatesInDb.push({
          row: index + 2,
          roomNo: member.roomNo,
          wing: member.wing,
          reason: "Already exists in database",
        });
      }

      duplicatesInFile.add(key);
    });

    if (duplicatesInDb.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Duplicate flats detected",
          duplicates: duplicatesInDb,
        },
        { status: 400 }
      );
    }

    const createdMembers = [];
    const userCredentials = [];
    const errors = [];

    for (let i = 0; i < members.length; i++) {
      try {
        const memberData = members[i];
        const password = generatePassword();
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create member with roomNo
        const member = await Member.create({
          roomNo: memberData.roomNo, // ← CHANGED
          wing: memberData.wing,
          ownerName: memberData.ownerName,
          areaSqFt: memberData.areaSqFt,
          contact: memberData.contact,
          societyId: decoded.societyId,
          openingBalance: memberData.openingBalance || 0,
        });

        // Create user
        const user = await User.create({
          name: memberData.ownerName,
          email: memberData.email,
          password: hashedPassword,
          role: "Member",
          societyId: decoded.societyId,
          memberId: member._id,
          isActive: true,
        });

        createdMembers.push({
          id: member._id,
          roomNo: member.roomNo,
          wing: member.wing,
          ownerName: member.ownerName,
        });

        userCredentials.push({
          roomNo: memberData.roomNo,
          wing: memberData.wing,
          ownerName: memberData.ownerName,
          email: memberData.email,
          password,
        });
      } catch (err) {
        errors.push({
          row: i + 2,
          roomNo: members[i].roomNo,
          error: err.message,
        });
      }
    }

    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "IMPORT_MEMBERS",
      newData: {
        importedCount: createdMembers.length,
        failedCount: errors.length,
      },
      timestamp: new Date(),
    });

    return NextResponse.json(
      {
        success: createdMembers.length > 0,
        message: `Imported ${createdMembers.length} members${
          errors.length > 0 ? ` (${errors.length} failed)` : ""
        }`,
        createdMembers,
        userCredentials,
        errors: errors.length > 0 ? errors : undefined,
      },
      { status: createdMembers.length > 0 ? 201 : 207 }
    );
  } catch (error) {
    console.error("Member import error:", error);
    return NextResponse.json(
      {
        error: "Import failed",
        details: error.message,
      },
      { status: 500 }
    );
  }
}
