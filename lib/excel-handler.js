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
