import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'fs/promises';
import { join } from 'path';
import connectDB from '@/lib/mongodb';
import Bill from '@/models/Bill';
import Society from '@/models/Society';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';

export async function GET(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    const { searchParams } = new URL(request.url);
    const billId = searchParams.get('id');

    if (!billId) {
      return NextResponse.json({ error: 'Bill ID required' }, { status: 400 });
    }

    // Get bill
    const bill = await Bill.findOne({ _id: billId, societyId: decoded.societyId })
    .populate('memberId', 'flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary')
  .lean();

    if (!bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }

    // Get society template
    const society = await Society.findById(decoded.societyId).lean();
    if (!society?.billTemplate?.pdfUrl) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Load template
    const templatePath = join(process.cwd(), 'public', society.billTemplate.pdfUrl);
    const pdfBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Fill the form
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    // Format dates
    const formatDate = (date) => {
      return new Date(date).toLocaleDateString('en-IN', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      });
    };

    // Prepare bill data with EXACT field names
    const billData = {
      // Header
      'Company name': society.name,
      'Address': society.address,
      'GST number': society.gstNumber || 'N/A',
      
      // Invoice Info
      'Invoice number': `INV-${bill._id.toString().slice(-6).toUpperCase()}`,
      'Invoice date_af_date': formatDate(bill.generatedAt || bill.createdAt),
      'Bill date_af_date': formatDate(bill.generatedAt || bill.createdAt),
      'Due date_af_date': formatDate(bill.dueDate),
      
      // Customer Info
      'Customer name': bill.memberId?.ownerName || 'N/A',
      'Customer address': `${bill.memberId?.wing || ''}-${bill.memberId?.flatNo || ''}`,
  'Customer phone': bill.memberId?.contactNumber || '',
      'Customer GST number': 'N/A',
      
      // Amounts
      'Sub Total': (bill.subtotal || bill.currentBillTotal || 0).toFixed(2),
      'Discount': '0',
      'Tax Rate': '0',
      'Tax value': (bill.serviceTax || 0).toFixed(2),
      'Shipping': '0',
      'Previous dues': (bill.previousBalance || 0).toFixed(2),
      'Grand total': bill.totalAmount.toFixed(2),
      
      // Bank details
      'Account holder name': society.bankDetails?.accountHolderName || '',
      'Account number': society.bankDetails?.accountNumber || '',
      'Bank name': society.bankDetails?.bankName || '',
      'IFSC Code': society.bankDetails?.ifscCode || '',
    };

    // Fill product/charges rows
    if (bill.charges) {
      const chargesArray = Object.entries(bill.charges);
      
      chargesArray.forEach(([chargeName, amount], index) => {
        const productNum = index + 1;
        if (productNum <= 6) { // PDF supports up to 6 products
          billData[`Product #${productNum}`] = chargeName;
          billData[`Product #${productNum} amount`] = amount.toFixed(2);
          billData[`Product #${productNum} Rate`] = amount.toFixed(2);
          billData[`Qty #${productNum}`] = '1';
          billData[`HSN code #${productNum}`] = '';
        }
      });
    }

    console.log('📋 Filling PDF with data:', Object.keys(billData).filter(k => billData[k]));

    // Fill all fields
    fields.forEach(field => {
      const fieldName = field.getName();
      const value = billData[fieldName];

      if (value) {
        try {
          field.setText(String(value));
          console.log(`✅ Filled: ${fieldName} = ${value}`);
        } catch (err) {
          console.log(`⚠️ Skip: ${fieldName} - ${err.message}`);
        }
      }
    });

    // Flatten form
    form.flatten();
    const filledPdf = await pdfDoc.save();

    return new NextResponse(filledPdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Bill-${bill.memberId?.wing}-${bill.memberId?.flatNo}-${bill.billPeriodId}.pdf"`
      }
    });

  } catch (error) {
    console.error('❌ Download error:', error);
    return NextResponse.json({ error: 'Failed', details: error.message }, { status: 500 });
  }
}
