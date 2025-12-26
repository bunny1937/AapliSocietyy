// This is SUPER flexible - you can adjust positions anytime
export const PDF_FIELD_POSITIONS = {
  // Header fields
  companyName: {
    x: 450,
    y: 50,
    fontSize: 14,
    fontWeight: "bold",
    maxWidth: 150,
    align: "right",
  },
  invoiceNumber: {
    x: 450,
    y: 70,
    fontSize: 12,
    maxWidth: 150,
    align: "right",
  },

  // Bill To section
  customerName: {
    x: 50,
    y: 150,
    fontSize: 11,
    maxWidth: 250,
  },
  customerAddress: {
    x: 50,
    y: 170,
    fontSize: 10,
    maxWidth: 250,
  },
  customerPhone: {
    x: 50,
    y: 210,
    fontSize: 10,
  },

  // Dates
  billDate: {
    x: 450,
    y: 150,
    fontSize: 11,
    align: "right",
  },
  dueDate: {
    x: 450,
    y: 170,
    fontSize: 11,
    align: "right",
  },

  // Table area (dynamically calculated)
  tableStart: {
    x: 50,
    y: 280,
    maxWidth: 500,
    rowHeight: 25,
  },

  // Amounts
  subtotal: {
    x: 450,
    y: 500,
    fontSize: 11,
    align: "right",
  },
  tax: {
    x: 450,
    y: 520,
    fontSize: 11,
    align: "right",
  },
  total: {
    x: 450,
    y: 545,
    fontSize: 13,
    fontWeight: "bold",
    align: "right",
  },

  // Footer
  paymentDetails: {
    x: 50,
    y: 600,
    fontSize: 9,
    maxWidth: 400,
  },
};

// Table column config - VERY flexible
export const TABLE_CONFIG = {
  columns: [
    { header: "ID", width: 40, align: "center" },
    { header: "Description", width: 250, align: "left" },
    { header: "HSN code", width: 80, align: "center" },
    { header: "Quantity", width: 70, align: "center" },
    { header: "Rate", width: 80, align: "right" },
    { header: "Amount", width: 80, align: "right" },
  ],
  headerHeight: 25,
  rowHeight: 20,
  fontSize: 10,
  headerFontSize: 11,
  borderColor: [200, 200, 200],
  headerBgColor: [240, 240, 240],
};
