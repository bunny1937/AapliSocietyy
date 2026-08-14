import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import Member from '@/models/Member';
import AuditLog from '@/models/AuditLog';
import { authorizeAny } from "@/lib/rbac/authorize";
// This action lives inside the DB Manager page's toolkit, so its own
// permission (society.databaseManager manage tier) is accepted alongside
// the direct member-edit permission.
const FIX_DUPLICATES_IDS = ["member.member.update", "society.data.import", "society.data.reset"];
export async function POST(request) {
  try {
    const gate = await authorizeAny(request, FIX_DUPLICATES_IDS);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Legacy "Admin only" role check removed: authorizeAny() above is the
    // real gate now — it correctly allows any RBAC role granted this, not
    // just the literal legacy string "Admin".
    // Find all members with duplicate membershipNumber
    const duplicates = await Member.aggregate([
      {
        $match: {
          societyId: decoded.societyId,
          membershipNumber: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$membershipNumber',
          count: { $sum: 1 },
          members: { $push: { id: '$_id', flatNo: '$flatNo', wing: '$wing' } }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);
    if (duplicates.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No duplicates found',
        fixed: 0
      });
    }
    const fixed = [];
    // Fix each duplicate group
    for (const dup of duplicates) {
      // Keep first member, reassign others
      for (let i = 1; i < dup.members.length; i++) {
        const member = await Member.findById(dup.members[i].id);
        if (member) {
          // Find next available number
          const lastMember = await Member
            .findOne({ societyId: decoded.societyId })
            .sort({ membershipNumber: -1 })
            .select('membershipNumber')
            .lean();
          let nextNumber = 1;
          if (lastMember?.membershipNumber) {
            const match = lastMember.membershipNumber.match(/MEM-(\d+)/);
            if (match) {
              nextNumber = parseInt(match[1]) + 1;
            }
          }
          const oldNumber = member.membershipNumber;
          const newNumber = `MEM-${String(nextNumber).padStart(4, '0')}`;
          member.membershipNumber = newNumber;
          await member.save();
          fixed.push({
            flatNo: member.fullFlatId,
            oldNumber,
            newNumber
          });
        }
      }
    }
    // Audit log
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: 'UPDATE_MEMBER',
      newData: {
        action: 'fix_duplicate_membership_numbers',
        fixedCount: fixed.length
      },
      timestamp: new Date()
    });
   return NextResponse.json({
  success: true,
  message: fixed.length > 0 
    ? `Fixed ${fixed.length} duplicate membership numbers` 
    : 'No duplicates found',
  fixed: fixed || [],  // ✅ Always return array
  fixedCount: fixed.length
});
  } catch (error) {
    console.error('Fix duplicates error:', error);
    return NextResponse.json({
      error: 'Failed to fix duplicates'
    }, { status: 500 });
  }
}
// GET endpoint to view duplicates
export async function GET(request) {
  const gate = await authorizeAny(request, FIX_DUPLICATES_IDS);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const duplicates = await Member.aggregate([
      {
        $match: {
          societyId: decoded.societyId,
          membershipNumber: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$membershipNumber',
          count: { $sum: 1 },
          members: { 
            $push: { 
              id: '$_id', 
              flatNo: '$flatNo', 
              wing: '$wing',
              ownerName: '$ownerName' 
            } 
          }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);
    return NextResponse.json({
      success: true,
      duplicates,
      totalDuplicateGroups: duplicates.length,
      totalAffectedMembers: duplicates.reduce((sum, d) => sum + d.count, 0)
    });
  } catch (error) {
    console.error('Check duplicates error:', error);
    return NextResponse.json({
      error: 'Failed to check duplicates'
    }, { status: 500 });
  }
}
