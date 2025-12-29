import ExcelJS from "exceljs";

export async function generateMemberTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Members");

  worksheet.columns = [
    { header: "flatno", key: "flatno", width: 12 },
    { header: "wing", key: "wing", width: 8 },
    { header: "name", key: "name", width: 25 },
    { header: "role", key: "role", width: 12 },
    { header: "email", key: "email", width: 30 },
    { header: "mobileno", key: "mobileno", width: 15 },
    { header: "areasqft", key: "areasqft", width: 12 },
    { header: "balance", key: "balance", width: 12 },
    { header: "config", key: "config", width: 12 },
  ];

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2563EB" },
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

export function validateExcelStructure(headers) {
  const requiredColumns = [
    "flatno",
    "wing",
    "name",
    "email",
    "mobileno",
    "areasqft",
  ];
  const errors = [];

  requiredColumns.forEach((col) => {
    if (!headers.includes(col)) {
      errors.push(`Missing required column: "${col}"`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    headers,
  };
}

export async function parseMemberExcel(buffer) {
  try {
    const workbook = new ExcelJS.Workbook();

    const parsePromise = workbook.xlsx.load(buffer);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("File parsing timeout")), 30000)
    );

    await Promise.race([parsePromise, timeoutPromise]);

    if (workbook.worksheets.length === 0) {
      return { success: false, error: "Excel file is empty or corrupted" };
    }

    const worksheet = workbook.worksheets[0];

    if (worksheet.rowCount > 1001) {
      return {
        success: false,
        error: "File too large. Maximum 1000 members allowed per upload.",
      };
    }

    if (worksheet.rowCount < 2) {
      return {
        success: false,
        error:
          "Excel sheet is empty. Please add member data below the headers.",
      };
    }

    const headerRow = worksheet.getRow(1);
    const headers = [];

    headerRow.eachCell((cell) => {
      const headerValue = String(cell.value || "")
        .trim()
        .toLowerCase();
      if (headerValue) {
        headers.push(headerValue);
      }
    });

    const structureValidation = validateExcelStructure(headers);
    if (!structureValidation.isValid) {
      return {
        success: false,
        error: "Excel structure validation failed",
        details: structureValidation.errors,
      };
    }

    const columnMap = {};
    headers.forEach((header, index) => {
      columnMap[header] = index + 1;
    });

    const members = [];
    const rowErrors = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const errors = [];

      const getCell = (columnName) => {
        const colIndex = columnMap[columnName];
        if (!colIndex) return "";
        const cell = row.getCell(colIndex);
        return String(cell.value || "").trim();
      };

      const flatno = getCell("flatno");
      const wing = getCell("wing");
      const name = getCell("name");
      const role = getCell("role");
      const email = getCell("email");
      const mobileno = getCell("mobileno");
      const areasqftRaw = getCell("areasqft");
      const balanceRaw = getCell("balance");
      const config = getCell("config");

      if (!flatno) {
        errors.push("flatno is required");
      }

      if (!name) {
        errors.push("name is required");
      }

      if (!email) {
        errors.push("email is required");
      } else if (!email.includes("@")) {
        errors.push("email must be valid");
      }

      if (!areasqftRaw) {
        errors.push("areasqft is required");
      } else {
        const areasqft = parseFloat(areasqftRaw);
        if (isNaN(areasqft)) {
          errors.push(`areasqft must be a number, found: "${areasqftRaw}"`);
        } else if (areasqft <= 0) {
          errors.push(`areasqft must be > 0, found: ${areasqft}`);
        }
      }

      if (!mobileno) {
        errors.push("mobileno is required");
      } else if (mobileno.length < 10) {
        errors.push("mobileno must be at least 10 digits");
      }

      if (errors.length > 0) {
        rowErrors.push({
          row: rowNumber,
          errors: errors,
        });
      } else {
        // ⬇️ CHANGED: Map flatno → roomNo for Member model
        members.push({
          roomNo: flatno.substring(0, 50), // ← CHANGED from flatNo
          wing: wing.substring(0, 10),
          ownerName: name.substring(0, 100),
          role: role.substring(0, 20),
          email: email.substring(0, 100),
          contact: mobileno.substring(0, 20),
          areaSqFt: parseFloat(areasqftRaw),
          openingBalance: balanceRaw ? parseFloat(balanceRaw) : 0,
          config: config.substring(0, 50),
        });
      }
    });

    if (rowErrors.length > 0) {
      return {
        success: false,
        error: "Row validation failed",
        details: rowErrors.map(
          (err) => `Row ${err.row}: ${err.errors.join(", ")}`
        ),
      };
    }

    return { success: true, members };
  } catch (error) {
    console.error("Excel parsing error:", error);
    return {
      success: false,
      error: "Excel parsing error. Please ensure the file is valid .xlsx.",
    };
  }
}

export async function generateCredentialsExcel(credentialsData) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Login Credentials");

  worksheet.columns = [
    { header: "Flat No", key: "roomNo", width: 15 }, // ← CHANGED
    { header: "Wing", key: "wing", width: 8 },
    { header: "Member Name", key: "ownerName", width: 25 },
    { header: "Email", key: "email", width: 30 },
    { header: "Password", key: "password", width: 15 },
    { header: "Portal URL", key: "portalUrl", width: 35 },
  ];

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF10B981" },
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  credentialsData.forEach((cred) => {
    worksheet.addRow({
      roomNo: cred.roomNo, // ← CHANGED from flatNo
      wing: cred.wing,
      ownerName: cred.ownerName,
      email: cred.email,
      password: cred.password,
      portalUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    });
  });

  const instructionsSheet = workbook.addWorksheet("Instructions");
  instructionsSheet.columns = [
    { header: "Instructions", key: "step", width: 60 },
  ];

  const instructions = [
    "1. Use the Email and Password to login to the member portal",
    "2. On first login, please change your password",
    "3. Keep your login credentials confidential",
    "4. If you forget your password, contact the society office",
    "",
    "Portal Features:",
    "- View billing statements",
    "- Track payment history",
    "- Download receipts",
    "- View society announcements",
  ];

  instructions.forEach((instruction) => {
    instructionsSheet.addRow({ step: instruction });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// NEW: Enhanced member template with all detailed fields
export async function generateEnhancedMemberTemplate() {
  const workbook = new ExcelJS.Workbook();
  
  // === SHEET 1: BASIC INFO (Required) ===
  const basicSheet = workbook.addWorksheet('1. Basic Info (Required)');
  
  basicSheet.columns = [
    { header: 'flatNo*', key: 'flatNo', width: 12 },
    { header: 'wing', key: 'wing', width: 8 },
    { header: 'floor', key: 'floor', width: 8 },
    { header: 'ownerName*', key: 'ownerName', width: 25 },
    { header: 'contactNumber*', key: 'contactNumber', width: 15 },
    { header: 'emailPrimary*', key: 'emailPrimary', width: 30 },
    { header: 'carpetAreaSqft*', key: 'carpetAreaSqft', width: 15 },
    { header: 'flatType', key: 'flatType', width: 12 },
    { header: 'ownershipType', key: 'ownershipType', width: 18 },
    { header: 'openingBalance', key: 'openingBalance', width: 15 }
  ];
  
  // Style header
  basicSheet.getRow(1).font = { bold: true };
  basicSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF10B981' }
  };
  basicSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  // Add sample row
  basicSheet.addRow({
    flatNo: '1310',
    wing: 'A',
    floor: 13,
    ownerName: 'Arjun Rastogi',
    contactNumber: '9876543210',
    emailPrimary: 'arjun@example.com',
    carpetAreaSqft: 1800,
    flatType: '2BHK',
    ownershipType: 'Owner-Occupied',
    openingBalance: 0
  });
  
  // Add instructions
  basicSheet.addRow({});
  basicSheet.addRow({ flatNo: 'INSTRUCTIONS:' });
  basicSheet.addRow({ flatNo: '* = Required fields' });
  basicSheet.addRow({ flatNo: 'flatType options: 1BHK, 2BHK, 3BHK, 4BHK, 5BHK+, Studio, Penthouse, Shop, Office' });
  basicSheet.addRow({ flatNo: 'ownershipType: Owner-Occupied, Rented, Vacant, Under-Dispute' });
  
  // === SHEET 2: ADDITIONAL DETAILS (Optional) ===
  const detailsSheet = workbook.addWorksheet('2. Additional Details');
  
  detailsSheet.columns = [
    { header: 'flatNo*', key: 'flatNo', width: 12 },
    { header: 'panCard', key: 'panCard', width: 15 },
    { header: 'aadhaar', key: 'aadhaar', width: 15 },
    { header: 'alternateContact', key: 'alternateContact', width: 15 },
    { header: 'whatsappNumber', key: 'whatsappNumber', width: 15 },
    { header: 'emailSecondary', key: 'emailSecondary', width: 30 },
    { header: 'builtUpAreaSqft', key: 'builtUpAreaSqft', width: 15 },
    { header: 'possessionDate', key: 'possessionDate', width: 15 }
  ];
  
  detailsSheet.getRow(1).font = { bold: true };
  detailsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF3B82F6' }
  };
  detailsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  detailsSheet.addRow({
    flatNo: '1310',
    panCard: 'ABCDE1234F',
    aadhaar: '123456789012',
    alternateContact: '9123456789',
    whatsappNumber: '9876543210',
    emailSecondary: 'arjun.alt@example.com',
    builtUpAreaSqft: 2000,
    possessionDate: '2024-01-15'
  });
  
  // === SHEET 3: PARKING SLOTS ===
  const parkingSheet = workbook.addWorksheet('3. Parking Slots');
  
  parkingSheet.columns = [
    { header: 'flatNo*', key: 'flatNo', width: 12 },
    { header: 'slotNumber', key: 'slotNumber', width: 15 },
    { header: 'type', key: 'type', width: 12 },
    { header: 'vehicleType', key: 'vehicleType', width: 15 }
  ];
  
  parkingSheet.getRow(1).font = { bold: true };
  parkingSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF59E0B' }
  };
  parkingSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  parkingSheet.addRow({
    flatNo: '1310',
    slotNumber: 'P-A-101',
    type: 'Covered',
    vehicleType: 'Four-Wheeler'
  });
  parkingSheet.addRow({
    flatNo: '1310',
    slotNumber: 'P-A-102',
    type: 'Open',
    vehicleType: 'Two-Wheeler'
  });
  
  parkingSheet.addRow({});
  parkingSheet.addRow({ flatNo: 'Type options: Covered, Open, Stilt' });
  parkingSheet.addRow({ flatNo: 'VehicleType: Two-Wheeler, Four-Wheeler' });
  
  // === SHEET 4: FAMILY MEMBERS === (moved from Sheet 5)
const familySheet = workbook.addWorksheet('4. Family Members');
familySheet.columns = [
  { header: 'flatNo*', key: 'flatNo', width: 12 },
  { header: 'name', key: 'name', width: 25 },
  { header: 'relation', key: 'relation', width: 15 },
  { header: 'age', key: 'age', width: 8 },
  { header: 'contactNumber', key: 'contactNumber', width: 15 },
  { header: 'occupation', key: 'occupation', width: 20 }
];
familySheet.getRow(1).font = { bold: true };
familySheet.getRow(1).fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEC4899' }
};
familySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
familySheet.addRow({
  flatNo: '1310',
  name: 'Aarav Rastogi',
  relation: 'Son',
  age: 12,
  contactNumber: '',
  occupation: 'Student'
});

  
 // === SHEET 5: OWNER HISTORY ===
const ownerHistorySheet = workbook.addWorksheet('5. Owner History');
ownerHistorySheet.columns = [
  { header: 'flatNo*', key: 'flatNo', width: 12 },
  { header: 'ownerSequence', key: 'ownerSequence', width: 15 },
  { header: 'ownerName', key: 'ownerName', width: 25 },
  { header: 'contactNumber', key: 'contactNumber', width: 15 },
  { header: 'emailPrimary', key: 'emailPrimary', width: 30 },
  { header: 'panCard', key: 'panCard', width: 15 },
  { header: 'ownershipStartDate', key: 'ownershipStartDate', width: 18 },
  { header: 'ownershipEndDate', key: 'ownershipEndDate', width: 18 },
  { header: 'purchaseAmount', key: 'purchaseAmount', width: 15 },
  { header: 'saleAmount', key: 'saleAmount', width: 15 }
];
ownerHistorySheet.getRow(1).font = { bold: true };
ownerHistorySheet.getRow(1).fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEF4444' }
};
ownerHistorySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ownerHistorySheet.addRow({
  flatNo: '1310',
  ownerSequence: 1,
  ownerName: 'Previous Owner Name',
  contactNumber: '9123456789',
  emailPrimary: 'prev@example.com',
  panCard: 'OLDPN1234A',
  ownershipStartDate: '2015-01-01',
  ownershipEndDate: '2020-06-30',
  purchaseAmount: 2500000,
  saleAmount: 3200000
});
ownerHistorySheet.addRow({});
ownerHistorySheet.addRow({ flatNo: 'NOTE: Only add previous owners (not current owner)' });

  
// === SHEET 6: TENANT HISTORY ===
const tenantHistorySheet = workbook.addWorksheet('6. Tenant History');
tenantHistorySheet.columns = [  // ✅ CORRECT
  { header: 'flatNo*', key: 'flatNo', width: 12 },
  { header: 'tenantSequence', key: 'tenantSequence', width: 15 },
  { header: 'name', key: 'name', width: 25 },
  { header: 'contactNumber', key: 'contactNumber', width: 15 },
  { header: 'email', key: 'email', width: 30 },
  { header: 'panCard', key: 'panCard', width: 15 },
  { header: 'startDate', key: 'startDate', width: 15 },
  { header: 'endDate', key: 'endDate', width: 15 },
  { header: 'depositAmount', key: 'depositAmount', width: 15 },
  { header: 'rentPerMonth', key: 'rentPerMonth', width: 15 },
  { header: 'isCurrent', key: 'isCurrent', width: 12 }
];
tenantHistorySheet.getRow(1).font = { bold: true };
tenantHistorySheet.getRow(1).fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF06B6D4' }
};
tenantHistorySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

// Add past tenant sample
tenantHistorySheet.addRow({
  flatNo: '1311',
  tenantSequence: 1,
  name: 'Past Tenant',
  contactNumber: '9999999998',
  email: 'tenant1@example.com',
  panCard: 'TEN111234A',
  startDate: '2020-01-01',
  endDate: '2022-12-31',
  depositAmount: 50000,
  rentPerMonth: 20000,
  isCurrent: 'No'
});

// Add current tenant sample
tenantHistorySheet.addRow({
  flatNo: '1311',
  tenantSequence: 2,
  name: 'Current Tenant',
  contactNumber: '9999999999',
  email: 'tenant2@example.com',
  panCard: 'TEN221234B',
  startDate: '2023-01-01',
  endDate: '',
  depositAmount: 60000,
  rentPerMonth: 25000,
  isCurrent: 'Yes'
});

tenantHistorySheet.addRow({});
tenantHistorySheet.addRow({ flatNo: 'NOTE: Leave endDate blank for current tenant' });
tenantHistorySheet.addRow({ flatNo: 'isCurrent: Yes or No' });
  
  tenantSheet.columns = [
    { header: 'flatNo*', key: 'flatNo', width: 12 },
    { header: 'name', key: 'name', width: 25 },
    { header: 'contactNumber', key: 'contactNumber', width: 15 },
    { header: 'email', key: 'email', width: 30 },
    { header: 'panCard', key: 'panCard', width: 15 },
    { header: 'startDate', key: 'startDate', width: 15 },
    { header: 'depositAmount', key: 'depositAmount', width: 15 },
    { header: 'rentPerMonth', key: 'rentPerMonth', width: 15 }
  ];
  
  tenantSheet.getRow(1).font = { bold: true };
  tenantSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF06B6D4' }
  };
  tenantSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  tenantSheet.addRow({
    flatNo: '1311',
    name: 'Tenant Name',
    contactNumber: '9999999999',
    email: 'tenant@example.com',
    panCard: 'TENAB1234C',
    startDate: '2024-01-01',
    depositAmount: 50000,
    rentPerMonth: 25000
  });
  
  tenantSheet.addRow({});
  tenantSheet.addRow({ flatNo: 'NOTE: Only fill this sheet if ownershipType = Rented' });
  
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
