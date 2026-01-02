import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Bill from '@/models/Bill';
import Society from '@/models/Society';
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

    const { billMonth, billYear, dueDate, bills } = await request.json();

    if (billMonth === undefined || !billYear || !dueDate || !bills) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const billPeriodId = `${billYear}-${String(billMonth + 1).padStart(2, '0')}`;

    // Check for duplicates
    const existing = await Bill.findOne({
      societyId: decoded.societyId,
      billPeriodId
    });

    if (existing) {
      return NextResponse.json({ 
        error: `Bills for ${billPeriodId} already exist` 
      }, { status: 409 });
    }

    // Just create bills with data - NO PDF generation
    const billsToCreate = bills.map(bill => {
      const charges = {};
      bill.charges.forEach(c => {
        charges[c.name] = c.amount;
      });

      if (bill.interestAmount > 0) {
        charges['Interest on Arrears'] = bill.interestAmount;
      }

      return {
        billPeriodId,
        billMonth,
        billYear,
        memberId: bill.memberId,
        societyId: decoded.societyId,
        
        // Charges breakdown
        charges,
        
        // Amounts
        previousBalance: bill.previousBalance,
        interestAmount: bill.interestAmount,
        subtotal: bill.subtotal,
        serviceTax: bill.serviceTax,
        currentBillTotal: bill.currentBillTotal,
        totalAmount: bill.grandTotal,
        balanceAmount: bill.grandTotal,
        amountPaid: 0,
        
        // Dates
        dueDate: new Date(dueDate),
        generatedAt: new Date(),
        generatedBy: decoded.userId,
        
        // Status
        status: 'Unpaid'
      };
    });

    const createdBills = await Bill.insertMany(billsToCreate);

    console.log(`✅ Generated ${createdBills.length} bills for ${billPeriodId}`);

    return NextResponse.json({
      success: true,
      message: `Generated ${createdBills.length} bills successfully`,
      billPeriodId,
      count: createdBills.length
    });

  } catch (error) {
    console.error('❌ Generate final bills error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}
