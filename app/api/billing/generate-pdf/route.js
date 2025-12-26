import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "fs";
import path from "path";
import Society from "@/models/Society";
import BillingHead from "@/models/BillingHead";
import Member from "@/models/Member";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await request.json();
    const {
      memberId,
      billPeriod,
      billDate,
      dueDate,
      items, // Billing heads with amounts
      subtotal,
      tax,
      currentBillTotal,
      interestCharged,
      previousBalance,
      totalPayable,
    } = body;

    // Fetch data
    const society = await Society.findById(decoded.societyId);
    const member = await Member.findById(memberId);

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    let pdfDoc;
    let useTemplate = false;

    // **CHECK FOR UPLOADED TEMPLATE**
    if (
      society?.billTemplate?.type === "uploaded" &&
      society?.billTemplate?.filePath
    ) {
      const templatePath = path.join(
        process.cwd(),
        "public",
        society.billTemplate.filePath
      );

      if (fs.existsSync(templatePath)) {
        console.log("✅ Loading uploaded template:", templatePath);
        const templateBytes = fs.readFileSync(templatePath);
        pdfDoc = await PDFDocument.load(templateBytes);
        useTemplate = true;

        const form = pdfDoc.getForm();
        const fields = form.getFields();

        console.log(`📄 Template has ${fields.length} form fields`);

        // **FILL FORM FIELDS (if they exist)**
        if (fields.length > 0) {
          const fieldMappings = {
            // Society Info
            companyName: society?.name || "",
            "Your company name": society?.name || "",
            company: society?.name || "",

            address: society?.address || "",
            "Your address": society?.address || "",

            // Bill Info
            invoiceNumber: `INV-${billPeriod}-${member.roomNo}`,
            "Invoice number": `INV-${billPeriod}-${member.roomNo}`,

            billDate: billDate,
            "Bill date": billDate,
            date: billDate,

            dueDate: dueDate,
            "Due Date": dueDate,

            billPeriod: billPeriod,

            // Customer Info
            customerName: member.ownerName,
            "Customer name": member.ownerName,
            name: member.ownerName,

            customerAddress: `${member.wing}-${member.roomNo}`,
            "Customer address": `${member.wing}-${member.roomNo}`,
            flatNo: `${member.wing}-${member.roomNo}`,

            customerPhone: member.contact || "",
            "Customer phone": member.contact || "",
            phone: member.contact || "",

            area: `${member.areaSqFt} sq ft`,

            // Amounts
            subtotal: subtotal.toFixed(2),
            "Sub total": subtotal.toFixed(2),

            tax: tax.toFixed(2),
            Tax: tax.toFixed(2),

            currentBillTotal: currentBillTotal.toFixed(2),
            "CURRENT BILL TOTAL": currentBillTotal.toFixed(2),

            interestCharged: interestCharged.toFixed(2),
            Interest: interestCharged.toFixed(2),

            previousBalance: previousBalance.toFixed(2),
            "Previous Balance": previousBalance.toFixed(2),

            total: totalPayable.toFixed(2),
            Total: totalPayable.toFixed(2),
            "TOTAL PAYABLE": totalPayable.toFixed(2),
          };

          // Fill fields
          fields.forEach((field) => {
            const fieldName = field.getName();
            const value = fieldMappings[fieldName];

            try {
              if (field.constructor.name === "PDFTextField" && value) {
                field.setText(value.toString());
                console.log(`✅ Filled: ${fieldName} = ${value}`);
              }
            } catch (err) {
              console.log(`⚠️ Could not fill ${fieldName}:`, err.message);
            }
          });

          // Fill table rows (items)
          items.forEach((item, index) => {
            const rowIndex = index + 1;

            // Try different field name patterns
            const patterns = [
              `description_${rowIndex}`,
              `Description[${index}]`,
              `description${rowIndex}`,
              `item_${rowIndex}`,
            ];

            patterns.forEach((pattern) => {
              try {
                const descField = form.getTextField(pattern);
                if (descField) descField.setText(item.description);
              } catch {}
            });

            const amountPatterns = [
              `amount_${rowIndex}`,
              `Amount[${index}]`,
              `amount${rowIndex}`,
            ];

            amountPatterns.forEach((pattern) => {
              try {
                const amountField = form.getTextField(pattern);
                if (amountField)
                  amountField.setText(`₹${item.amount.toFixed(2)}`);
              } catch {}
            });
          });

          // DON'T flatten - keep editable for user
          // form.flatten(); // REMOVE THIS
        }

        // **IF NO FORM FIELDS → OVERLAY DATA**
        else {
          console.log("⚠️ No form fields. Overlaying data on template...");
          await overlayDataOnTemplate(pdfDoc, {
            society,
            member,
            billPeriod,
            billDate,
            dueDate,
            items,
            subtotal,
            tax,
            currentBillTotal,
            interestCharged,
            previousBalance,
            totalPayable,
          });
        }
      }
    }

    // **NO TEMPLATE → CREATE CUSTOM BILL**
    if (!useTemplate) {
      console.log("🆕 No template found. Creating default bill...");
      pdfDoc = await createDefaultBill({
        society,
        member,
        billPeriod,
        billDate,
        dueDate,
        items,
        subtotal,
        tax,
        currentBillTotal,
        interestCharged,
        previousBalance,
        totalPayable,
      });
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Bill-${member.wing}-${member.roomNo}-${billPeriod}.pdf"`,
      },
    });
  } catch (error) {
    console.error("❌ PDF Generation Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// **HELPER: Overlay data on non-fillable PDF**
async function overlayDataOnTemplate(pdfDoc, data) {
  const {
    society,
    member,
    billPeriod,
    billDate,
    dueDate,
    items,
    subtotal,
    tax,
    currentBillTotal,
    interestCharged,
    previousBalance,
    totalPayable,
  } = data;

  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Header
  page.drawText(society?.name || "Society Name", {
    x: width / 2 - 80,
    y: height - 180,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  // Bill Period & Flat
  page.drawText(`Bill Period: ${billPeriod}`, {
    x: 50,
    y: height - 220,
    size: 10,
    font,
  });
  page.drawText(`Flat: ${member.wing}-${member.roomNo}`, {
    x: width - 200,
    y: height - 220,
    size: 10,
    font: boldFont,
  });

  // Dates & Member Info
  page.drawText(`Bill Date: ${billDate}`, {
    x: 50,
    y: height - 240,
    size: 10,
    font,
  });
  page.drawText(`Name: ${member.ownerName}`, {
    x: width - 250,
    y: height - 240,
    size: 10,
    font,
  });

  page.drawText(`Due Date: ${dueDate}`, {
    x: 50,
    y: height - 260,
    size: 10,
    font,
  });
  page.drawText(`Area: ${member.areaSqFt} sq ft`, {
    x: width - 250,
    y: height - 260,
    size: 10,
    font,
  });

  // Table
  let tableY = height - 310;
  page.drawText("Sr", { x: 50, y: tableY, size: 10, font: boldFont });
  page.drawText("Description", { x: 100, y: tableY, size: 10, font: boldFont });
  page.drawText("Amount (₹)", {
    x: width - 150,
    y: tableY,
    size: 10,
    font: boldFont,
  });

  tableY -= 25;
  items.forEach((item, index) => {
    page.drawText(`${index + 1}`, { x: 50, y: tableY, size: 9, font });
    page.drawText(item.description, { x: 100, y: tableY, size: 9, font });
    page.drawText(`₹${item.amount.toFixed(2)}`, {
      x: width - 150,
      y: tableY,
      size: 9,
      font,
    });
    tableY -= 20;
  });

  // Totals
  tableY -= 10;
  page.drawText("Subtotal", { x: width - 250, y: tableY, size: 10, font });
  page.drawText(`₹${subtotal.toFixed(2)}`, {
    x: width - 150,
    y: tableY,
    size: 10,
    font,
  });

  tableY -= 20;
  page.drawText("Tax (2%)", { x: width - 250, y: tableY, size: 10, font });
  page.drawText(`₹${tax.toFixed(2)}`, {
    x: width - 150,
    y: tableY,
    size: 10,
    font,
  });

  tableY -= 25;
  page.drawText("CURRENT BILL TOTAL", {
    x: width - 250,
    y: tableY,
    size: 11,
    font: boldFont,
  });
  page.drawText(`₹${currentBillTotal.toFixed(2)}`, {
    x: width - 150,
    y: tableY,
    size: 11,
    font: boldFont,
    color: rgb(0.8, 0, 0),
  });

  if (interestCharged > 0) {
    tableY -= 30;
    page.drawText("Interest Charged", {
      x: width - 250,
      y: tableY,
      size: 10,
      font,
    });
    page.drawText(`₹${interestCharged.toFixed(2)}`, {
      x: width - 150,
      y: tableY,
      size: 10,
      font,
      color: rgb(0.8, 0, 0),
    });
  }

  tableY -= 35;
  page.drawText("TOTAL PAYABLE", {
    x: width - 250,
    y: tableY,
    size: 12,
    font: boldFont,
  });
  page.drawText(`₹${totalPayable.toFixed(2)}`, {
    x: width - 150,
    y: tableY,
    size: 12,
    font: boldFont,
    color: rgb(0.8, 0, 0),
  });
}

// **HELPER: Create default bill from scratch**
async function createDefaultBill(data) {
  const {
    society,
    member,
    billPeriod,
    billDate,
    dueDate,
    items,
    subtotal,
    tax,
    currentBillTotal,
    interestCharged,
    previousBalance,
    totalPayable,
  } = data;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Same layout as overlay function
  await overlayDataOnTemplate(pdfDoc, data);

  return pdfDoc;
}
