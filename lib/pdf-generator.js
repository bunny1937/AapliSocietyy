import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export async function generateBillPDF(bill, member, society) {
  const doc = new jsPDF();

  doc.setFontSize(20);
  doc.setFont(undefined, "bold");
  doc.text(society.name, 105, 20, { align: "center" });

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  if (society.address) {
    doc.text(society.address, 105, 28, { align: "center" });
  }
  if (society.registrationNo) {
    doc.text(`Reg. No: ${society.registrationNo}`, 105, 34, {
      align: "center",
    });
  }

  doc.setLineWidth(0.5);
  doc.line(20, 40, 190, 40);

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text("MAINTENANCE BILL", 105, 50, { align: "center" });

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");

  let y = 65;

  doc.text(`Bill Period: ${bill.billPeriodId}`, 20, y);
  doc.text(
    `Bill Date: ${new Date(bill.generatedAt).toLocaleDateString("en-IN")}`,
    130,
    y
  );
  y += 8;
  doc.text(
    `Due Date: ${new Date(bill.dueDate).toLocaleDateString("en-IN")}`,
    130,
    y
  );
  y += 15;

  doc.setFont(undefined, "bold");
  doc.text("Member Details:", 20, y);
  y += 8;
  doc.setFont(undefined, "normal");
  doc.text(`Name: ${member.ownerName}`, 20, y);
  y += 6;
  doc.text(
    `Flat: ${member.wing ? `${member.wing}-` : ""}${member.roomNo}`,
    20,
    y
  );
  y += 6;
  doc.text(`Area: ${member.areaSqFt} sq.ft`, 20, y);
  if (member.contact) {
    y += 6;
    doc.text(`Contact: ${member.contact}`, 20, y);
  }

  y += 15;
  doc.setLineWidth(0.3);
  doc.line(20, y, 190, y);

  y += 10;
  doc.setFont(undefined, "bold");
  doc.text("Particulars", 25, y);
  doc.text("Amount (₹)", 160, y, { align: "right" });
  y += 5;
  doc.line(20, y, 190, y);

  y += 8;
  doc.setFont(undefined, "normal");

  if (bill.breakdown.maintenance > 0) {
    doc.text("Maintenance Charges", 25, y);
    doc.text(bill.breakdown.maintenance.toFixed(2), 170, y, { align: "right" });
    y += 7;
  }

  if (bill.breakdown.sinkingFund > 0) {
    doc.text("Sinking Fund", 25, y);
    doc.text(bill.breakdown.sinkingFund.toFixed(2), 170, y, { align: "right" });
    y += 7;
  }

  if (bill.breakdown.repairFund > 0) {
    doc.text("Repair Fund", 25, y);
    doc.text(bill.breakdown.repairFund.toFixed(2), 170, y, { align: "right" });
    y += 7;
  }

  if (bill.breakdown.fixedCharges > 0) {
    doc.text("Fixed Charges", 25, y);
    doc.text(bill.breakdown.fixedCharges.toFixed(2), 170, y, {
      align: "right",
    });
    y += 7;
  }

  if (bill.charges && bill.charges.size > 0) {
    for (const [label, amount] of bill.charges.entries()) {
      if (amount > 0) {
        doc.text(label, 25, y);
        doc.text(amount.toFixed(2), 170, y, { align: "right" });
        y += 7;
      }
    }
  }

  if (bill.breakdown.previousArrears > 0) {
    y += 3;
    doc.setFont(undefined, "bold");
    doc.text("Previous Arrears", 25, y);
    doc.text(bill.breakdown.previousArrears.toFixed(2), 170, y, {
      align: "right",
    });
    y += 7;
    doc.setFont(undefined, "normal");
  }

  if (bill.breakdown.interestOnArrears > 0) {
    doc.setTextColor(220, 38, 38);
    doc.text("Interest on Arrears", 25, y);
    doc.text(bill.breakdown.interestOnArrears.toFixed(2), 170, y, {
      align: "right",
    });
    doc.setTextColor(0, 0, 0);
    y += 7;
  }

  if (bill.breakdown.serviceTax > 0) {
    y += 3;
    doc.text("Service Tax", 25, y);
    doc.text(bill.breakdown.serviceTax.toFixed(2), 170, y, { align: "right" });
    y += 7;
  }

  y += 3;
  doc.setLineWidth(0.3);
  doc.line(20, y, 190, y);

  y += 8;
  doc.setFont(undefined, "bold");
  doc.setFontSize(12);
  doc.text("Total Amount Payable", 25, y);
  doc.text(`₹ ${bill.totalAmount.toFixed(2)}`, 170, y, { align: "right" });

  y += 15;
  doc.setFontSize(9);
  doc.setFont(undefined, "italic");
  doc.text("Please pay by the due date to avoid interest charges.", 105, y, {
    align: "center",
  });

  y += 10;
  doc.setFont(undefined, "normal");
  doc.text("For any queries, contact the society office.", 105, y, {
    align: "center",
  });

  return doc;
}

export function downloadBillPDF(bill, member, society) {
  const doc = generateBillPDF(bill, member, society);
  doc.save(
    `Bill_${member.wing || "NoWing"}_${member.roomNo}_${bill.billPeriodId}.pdf`
  );
}

export async function generateReceiptPDF(transaction, member, society) {
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text("PAYMENT RECEIPT", 105, 20, { align: "center" });

  doc.setFontSize(14);
  doc.text(society.name, 105, 35, { align: "center" });

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");

  let y = 55;
  doc.text(`Receipt No: ${transaction.transactionId}`, 20, y);
  doc.text(
    `Date: ${new Date(transaction.date).toLocaleDateString("en-IN")}`,
    130,
    y
  );

  y += 20;
  doc.setFont(undefined, "bold");
  doc.text("Received From:", 20, y);
  y += 8;
  doc.setFont(undefined, "normal");
  doc.text(`Name: ${member.ownerName}`, 20, y);
  y += 6;
  doc.text(
    `Flat: ${member.wing ? `${member.wing}-` : ""}${member.roomNo}`,
    20,
    y
  );

  y += 20;
  doc.setFont(undefined, "bold");
  doc.text("Payment Details:", 20, y);
  y += 8;
  doc.setFont(undefined, "normal");
  doc.text(`Amount: ₹ ${transaction.amount.toFixed(2)}`, 20, y);
  y += 6;
  doc.text(`Payment Mode: ${transaction.paymentMode}`, 20, y);
  y += 6;
  doc.text(`Description: ${transaction.description}`, 20, y);

  y += 20;
  doc.setFont(undefined, "bold");
  doc.setFontSize(12);
  doc.text(`Total: ₹ ${transaction.amount.toFixed(2)}`, 20, y);

  y += 30;
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.text("Authorized Signatory", 150, y);
  doc.line(140, y + 5, 190, y + 5);

  return doc;
}

export function downloadReceiptPDF(transaction, member, society) {
  const doc = generateReceiptPDF(transaction, member, society);
  doc.save(`Receipt_${transaction.transactionId}.pdf`);
}
