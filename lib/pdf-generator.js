import PDFDocument from "pdfkit";
import { PDFPage, PDFDocument as PDFLibDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import { PDF_FIELD_POSITIONS, TABLE_CONFIG } from "./pdf-fields-config";

export class FlexiblePDFGenerator {
  constructor(templatePath) {
    this.templatePath = templatePath;
  }

  async generateBill(billData) {
    try {
      // Read existing PDF template
      const templateBuffer = fs.readFileSync(this.templatePath);
      const pdfDoc = await PDFLibDocument.load(templateBuffer);

      // Get first page
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();

      // Create overlay PDF with data
      const overlayDoc = new PDFDocument({
        size: [width, height],
        margin: 0,
        bufferPages: true,
      });

      // Add text fields
      this._addTextField(overlayDoc, "companyName", billData.companyName);
      this._addTextField(overlayDoc, "invoiceNumber", billData.invoiceNumber);
      this._addTextField(overlayDoc, "customerName", billData.customerName);
      this._addTextField(
        overlayDoc,
        "customerAddress",
        billData.customerAddress
      );
      this._addTextField(overlayDoc, "customerPhone", billData.customerPhone);
      this._addTextField(overlayDoc, "billDate", billData.billDate);
      this._addTextField(overlayDoc, "dueDate", billData.dueDate);

      // Add table
      if (billData.items && billData.items.length > 0) {
        this._addTable(overlayDoc, billData.items);
      }

      // Add amounts
      this._addTextField(overlayDoc, "subtotal", `₹ ${billData.subtotal}`);
      this._addTextField(overlayDoc, "tax", `₹ ${billData.tax || 0}`);
      this._addTextField(overlayDoc, "total", `₹ ${billData.total}`);

      // Add payment details
      if (billData.paymentDetails) {
        this._addTextField(
          overlayDoc,
          "paymentDetails",
          billData.paymentDetails
        );
      }

      // Convert overlay to buffer
      const overlayBuffer = await new Promise((resolve) => {
        const chunks = [];
        overlayDoc.on("data", (chunk) => chunks.push(chunk));
        overlayDoc.on("end", () => resolve(Buffer.concat(chunks)));
        overlayDoc.end();
      });

      // Merge overlay with template
      const overlayPdf = await PDFLibDocument.load(overlayBuffer);
      const overlayPage = overlayPdf.getPages()[0];

      // Embed overlay on template
      firstPage.drawPage(overlayPage);

      // Save final PDF
      const finalBuffer = await pdfDoc.save();
      return finalBuffer;
    } catch (error) {
      console.error("PDF Generation Error:", error);
      throw error;
    }
  }

  _addTextField(doc, fieldKey, value) {
    const config = PDF_FIELD_POSITIONS[fieldKey];
    if (!config || !value) return;

    doc.fontSize(config.fontSize || 11);

    if (config.fontWeight === "bold") {
      doc.font("Helvetica-Bold");
    } else {
      doc.font("Helvetica");
    }

    if (config.align === "right") {
      doc.text(value, config.x - (config.maxWidth || 0), config.y, {
        width: config.maxWidth || 150,
        align: "right",
      });
    } else if (config.align === "center") {
      doc.text(value, config.x, config.y, {
        width: config.maxWidth || 150,
        align: "center",
      });
    } else {
      doc.text(value, config.x, config.y, {
        width: config.maxWidth || 250,
      });
    }
  }

  _addTable(doc, items) {
    const tableConfig = TABLE_CONFIG;
    const startPos = PDF_FIELD_POSITIONS.tableStart;

    let currentY = startPos.y;
    const pageHeight = doc.page.height;
    const bottomMargin = 100;

    // Draw header
    this._drawTableHeader(doc, startY, tableConfig);
    currentY += tableConfig.headerHeight;

    // Draw rows
    items.forEach((item, index) => {
      // Check if we need new page
      if (currentY + tableConfig.rowHeight + bottomMargin > pageHeight) {
        doc.addPage();
        currentY = startPos.y;
        this._drawTableHeader(doc, currentY, tableConfig);
        currentY += tableConfig.headerHeight;
      }

      this._drawTableRow(doc, currentY, item, tableConfig, index + 1);
      currentY += tableConfig.rowHeight;
    });
  }

  _drawTableHeader(doc, y, config) {
    doc.fontSize(config.headerFontSize);
    doc.font("Helvetica-Bold");

    let x = PDF_FIELD_POSITIONS.tableStart.x;

    config.columns.forEach((col) => {
      doc.text(col.header, x, y, {
        width: col.width,
        align: col.align,
        height: config.headerHeight,
        valign: "center",
      });
      x += col.width;
    });

    // Draw border
    doc.lineWidth(0.5);
    doc
      .rect(
        PDF_FIELD_POSITIONS.tableStart.x,
        y,
        config.columns.reduce((sum, col) => sum + col.width, 0),
        config.headerHeight
      )
      .stroke();
  }

  _drawTableRow(doc, y, item, config, rowNumber) {
    doc.fontSize(config.fontSize);
    doc.font("Helvetica");

    let x = PDF_FIELD_POSITIONS.tableStart.x;
    const columns = [
      rowNumber.toString(),
      item.description || "",
      item.hsnCode || "",
      item.quantity || "",
      item.rate ? `₹ ${item.rate}` : "",
      item.amount ? `₹ ${item.amount}` : "",
    ];

    config.columns.forEach((col, idx) => {
      doc.text(columns[idx] || "", x, y, {
        width: col.width,
        align: col.align,
        height: config.rowHeight,
        valign: "center",
      });
      x += col.width;
    });
  }
}
