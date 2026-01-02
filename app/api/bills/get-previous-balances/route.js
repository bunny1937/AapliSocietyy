import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Bill from '@/models/Bill';
import Transaction from '@/models/Transaction';
import Member from '@/models/Member';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';

export async function POST(request) {
  try {
    await connectDB();
    
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { memberIds } = await request.json();

    if (!memberIds || !Array.isArray(memberIds)) {
      return NextResponse.json({ error: 'Invalid member IDs' }, { status: 400 });
    }

    const balances = {};

    // Fetch all members with opening balance
    const members = await Member.find({
      _id: { $in: memberIds },
      societyId: decoded.societyId
    })
    .select('_id openingBalance')
    .lean();

    const memberMap = {};
    members.forEach(m => {
      memberMap[m._id.toString()] = m.openingBalance || 0;
    });

    // For each member, get balance data
    for (const memberId of memberIds) {
      // Get opening balance from member
      const openingBalance = memberMap[memberId.toString()] || 0;

      // Get last transaction to find current balance
      const lastTxn = await Transaction.findOne({
        memberId,
        societyId: decoded.societyId,
        isReversed: false
      })
      .sort({ date: -1, createdAt: -1 })
      .lean();

      // Current balance = last transaction balance OR opening balance
      const currentBalance = lastTxn?.balanceAfterTransaction ?? openingBalance;

      // Get all unpaid bills
      const unpaidBills = await Bill.find({
        memberId,
        societyId: decoded.societyId,
        status: { $in: ['Unpaid', 'Overdue', 'Partial'] }
      })
      .sort({ billYear: 1, billMonth: 1 })
      .lean();

      // Calculate days overdue from oldest unpaid bill OR from opening balance date
      let daysOverdue = 0;
      let oldestUnpaidDate = null;

      if (unpaidBills.length > 0) {
        const oldestBill = unpaidBills[0];
        oldestUnpaidDate = oldestBill.dueDate || new Date(oldestBill.billYear, oldestBill.billMonth, 10);
        const today = new Date();
        daysOverdue = Math.floor((today - new Date(oldestUnpaidDate)) / (1000 * 60 * 60 * 24));
        daysOverdue = Math.max(0, daysOverdue);
      } else if (openingBalance > 0) {
        // If no unpaid bills but has opening balance, consider it from 90 days ago
        const today = new Date();
        const estimatedDate = new Date(today.getTime() - (90 * 24 * 60 * 60 * 1000));
        oldestUnpaidDate = estimatedDate;
        daysOverdue = 90;
      }

      // Build transaction history for display
      const transactions = await Transaction.find({
        memberId,
        societyId: decoded.societyId,
        isReversed: false
      })
      .sort({ date: -1 })
      .limit(10)
      .select('date type category description amount balanceAfterTransaction billPeriodId')
      .lean();

      balances[memberId] = {
        balance: currentBalance,
        daysOverdue,
        oldestUnpaidDate,
        unpaidBills: unpaidBills.map(b => ({
          billPeriodId: b.billPeriodId,
          amount: b.balanceAmount,
          dueDate: b.dueDate,
          status: b.status
        })),
        recentTransactions: transactions.map(t => ({
          date: t.date,
          type: t.type,
          category: t.category,
          description: t.description,
          amount: t.amount,
          balance: t.balanceAfterTransaction,
          billPeriod: t.billPeriodId
        }))
      };
    }

    return NextResponse.json({
      success: true,
      balances
    });

  } catch (error) {
    console.error('❌ Get previous balances error:', error);
    
    // Fallback
    if (error.message.includes('ENOTFOUND') || error.message.includes('timeout')) {
      console.warn('⚠️ MongoDB unreachable, returning zero balances');
      const { memberIds } = await request.json();
      const balances = {};
      memberIds.forEach(id => {
        balances[id] = { 
          balance: 0, 
          daysOverdue: 0,
          unpaidBills: [],
          recentTransactions: []
        };
      });
      return NextResponse.json({ success: true, balances });
    }
    
    return NextResponse.json({
      error: 'Failed to get previous balances',
      details: error.message
    }, { status: 500 });
  }
}
