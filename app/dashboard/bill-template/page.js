"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";

export default function BillTemplateEditor() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [uploadedTemplates, setUploadedTemplates] = useState([]);

  const { data: savedTemplate } = useQuery({
    queryKey: ["bill-template"],
    queryFn: () => apiClient.get("/api/billing/template"),
    onSuccess: (data) => {
      if (data?.template?.type === "uploaded") {
        setUploadedTemplates([data.template]);
      }
    },
  });
  const [selectedTemplate, setSelectedTemplate] = useState("modern");
  const [templateData, setTemplateData] = useState({
    societyName: "",
    societyAddress: "",
    footer: [
      "Payment should be made on or before 15th of every month",
      "Interest @ 21% will be charged on dues",
      "Pay crossed cheque in favour of the society",
      "This is computer generated bill, signature not required",
    ],
    showReceipt: true,
    headerColor: "#1F2937",
    borderColor: "#000000",
  });

  // Fetch society data
  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });

  const society = societyData?.society;

  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/billing/upload-template", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }

      return response.json();
    },
    onSuccess: (data) => {
      console.log("Upload response:", data); // DEBUG

      if (!data.fileUrl) {
        alert("❌ Upload failed: No file URL returned");
        return;
      }

      alert("✅ Template uploaded successfully!");

      // Add to uploaded templates list with the fileUrl
      setUploadedTemplates([
        {
          id: "uploaded",
          name: data.fileName || "Uploaded Template",
          desc: "Your uploaded bill format",
          fileUrl: data.fileUrl, // This is critical!
        },
      ]);

      // Auto-select it
      setSelectedTemplate("uploaded");

      queryClient.invalidateQueries(["bill-template"]);
    },
    onError: (error) => {
      console.error("Upload error:", error);
      alert(`❌ Upload failed: ${error.message}`);
    },
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (data) => apiClient.post("/api/billing/template", data),
    onSuccess: () => {
      alert("✅ Template saved successfully!");
      queryClient.invalidateQueries(["bill-template"]);
    },
    onError: (error) => {
      alert(`❌ Error: ${error.message}`);
    },
  });

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    if (!allowedTypes.includes(file.type)) {
      alert("Only PDF, JPG, or PNG files are allowed");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("File size must be less than 5MB");
      return;
    }

    uploadMutation.mutate(file);
  };

  const handleSaveCustomTemplate = () => {
    const html = generateHtmlFromTemplate(selectedTemplate, templateData);
    saveMutation.mutate({
      name: "Custom Template",
      html,
      type: "custom",
      templateData,
    });
  };

  const updateTemplateData = (key, value) => {
    setTemplateData((prev) => ({ ...prev, [key]: value }));
  };

  const updateFooterItem = (index, value) => {
    const newFooter = [...templateData.footer];
    newFooter[index] = value;
    setTemplateData((prev) => ({ ...prev, footer: newFooter }));
  };

  const addFooterItem = () => {
    setTemplateData((prev) => ({
      ...prev,
      footer: [...prev.footer, "New instruction"],
    }));
  };

  const removeFooterItem = (index) => {
    setTemplateData((prev) => ({
      ...prev,
      footer: prev.footer.filter((_, i) => i !== index),
    }));
  };

  const renderPreview = () => {
    // If uploaded template is selected, show it directly
    if (selectedTemplate === "uploaded" && uploadedTemplates.length > 0) {
      const uploaded = uploadedTemplates[0];
      console.log("Rendering uploaded template:", uploaded); // DEBUG

      if (!uploaded.fileUrl) {
        return `<div style="padding: 40px; text-align: center; color: #DC2626;">❌ Error: No file URL found</div>`;
      }

      // Check if it's a PDF
      const isPdf = uploaded.fileUrl.endsWith(".pdf");

      return `
      <div style="text-align: center; padding: 20px; background: #F9FAFB; border-radius: 8px; margin-bottom: 20px;">
        <p style="margin: 0; color: #059669; font-weight: 600;">📤 Your Uploaded Template</p>
        <p style="margin: 5px 0 0 0; font-size: 14px; color: #6B7280;">This will be used for all bills</p>
      </div>
      ${
        isPdf
          ? `<embed src="${uploaded.fileUrl}" type="application/pdf" width="100%" height="1200px" style="border: 2px solid #000; border-radius: 8px;" />`
          : `<img src="${uploaded.fileUrl}" style="width: 100%; border: 2px solid #000; border-radius: 8px;" />`
      }
    `;
    }

    const html = generateHtmlFromTemplate(selectedTemplate, templateData);

    // Sample data with INTEREST
    const sampleData = {
      "{{societyName}}":
        templateData.societyName || society?.name || "Sample Society Name",
      "{{societyAddress}}":
        templateData.societyAddress ||
        society?.address ||
        "123, Main Street, Mumbai - 400001",
      "{{memberName}}": "Arjun Rastogi",
      "{{memberWing}}": "A",
      "{{memberRoomNo}}": "1310",
      "{{memberArea}}": "1800",
      "{{memberContact}}": "9876543210",
      "{{billPeriod}}": "2024-01",
      "{{billDate}}": "26/12/2025",
      "{{dueDate}}": "10/01/2024",
      "{{totalAmount}}": "₹9,435.00",
      "{{previousBalance}}": "₹2,500.00 DR",
      "{{interestAmount}}": "₹525.00",
      "{{interestDays}}": "25",
      "{{interestRate}}": "21",
      "{{currentBalance}}": "₹12,460.00 DR",
    };

    let previewHtml = html;
    Object.entries(sampleData).forEach(([key, value]) => {
      previewHtml = previewHtml.replace(new RegExp(key, "g"), value);
    });

    // Sample billing table with INTEREST row
    const sampleTable = `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background-color: #f3f4f6;">
          <th style="border: 1px solid #000; padding: 10px; text-align: left;">Sr.</th>
          <th style="border: 1px solid #000; padding: 10px; text-align: left;">Description</th>
          <th style="border: 1px solid #000; padding: 10px; text-align: right;">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border: 1px solid #ddd; padding: 10px;">1</td>
          <td style="border: 1px solid #ddd; padding: 10px;">Maintenance</td>
          <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">₹3,600.00</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 10px;">2</td>
          <td style="border: 1px solid #ddd; padding: 10px;">Sinking Fund</td>
          <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">₹3,600.00</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 10px;">3</td>
          <td style="border: 1px solid #ddd; padding: 10px;">Repair Fund</td>
          <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">₹1,800.00</td>
        </tr>
        <tr>
          <td style="border: 1px solid #ddd; padding: 10px;">4</td>
          <td style="border: 1px solid #ddd; padding: 10px;">Fixed Charges</td>
          <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">₹250.00</td>
        </tr>
        <tr style="background-color: #f9fafb;">
          <td colspan="2" style="border: 1px solid #000; padding: 10px; text-align: right;"><strong>Subtotal</strong></td>
          <td style="border: 1px solid #000; padding: 10px; text-align: right;"><strong>₹9,250.00</strong></td>
        </tr>
        <tr style="background-color: #f9fafb;">
          <td colspan="2" style="border: 1px solid #000; padding: 10px; text-align: right;"><strong>Tax (2%)</strong></td>
          <td style="border: 1px solid #000; padding: 10px; text-align: right;"><strong>₹185.00</strong></td>
        </tr>
        <tr style="font-weight: bold; background-color: #FEF3C7; font-size: 16px;">
          <td colspan="2" style="border: 2px solid #000; padding: 12px; text-align: right;">CURRENT BILL TOTAL</td>
          <td style="border: 2px solid #000; padding: 12px; text-align: right; color: #DC2626;">₹9,435.00</td>
        </tr>
        <tr style="background-color: #FEE2E2;">
          <td style="border: 1px solid #DC2626; padding: 10px;">5</td>
          <td style="border: 1px solid #DC2626; padding: 10px; color: #DC2626;"><strong>Interest Charged (21% p.a.)</strong><br/><span style="font-size: 11px;">Payment overdue by 25 days after 10/01/2024</span></td>
          <td style="border: 1px solid #DC2626; padding: 10px; text-align: right; color: #DC2626; font-weight: bold;">₹525.00</td>
        </tr>
        <tr style="font-weight: bold; background-color: #DC2626; color: white; font-size: 18px;">
          <td colspan="2" style="border: 2px solid #000; padding: 15px; text-align: right;">TOTAL PAYABLE (Including Interest)</td>
          <td style="border: 2px solid #000; padding: 15px; text-align: right;">₹12,460.00</td>
        </tr>
      </tbody>
    </table>
  `;

    previewHtml = previewHtml.replace("{{BILLING_TABLE}}", sampleTable);

    return previewHtml;
  };

  return (
    <div>
      {/* PAGE HEADER */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>🎨 Bill Template Designer</h1>
          <p className={styles.pageSubtitle}>
            Customize your bill template or upload existing one
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="btn btn-secondary"
          >
            {uploadMutation.isPending ? "Uploading..." : "📤 Upload Bill"}
          </button>
          <button
            onClick={handleSaveCustomTemplate}
            disabled={saveMutation.isPending}
            className="btn btn-primary"
          >
            {saveMutation.isPending ? "Saving..." : "💾 Save Template"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "400px 1fr",
          gap: ".5rem",
        }}
      >
        {/* LEFT SIDE - Customize */}
        <div>
          <div className={styles.contentCard}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>🎯 Choose Template</h2>
            </div>
            <div style={{ padding: ".5rem" }}>
              <div
                style={{ display: "grid", gap: "1rem", marginBottom: "2rem" }}
              >
                {/* UPLOADED TEMPLATES FIRST */}
                {uploadedTemplates.map((template) => (
                  <div
                    key={template.id}
                    onClick={() => setSelectedTemplate(template.id)}
                    style={{
                      padding: "1rem",
                      border: `3px solid ${
                        selectedTemplate === template.id ? "#10B981" : "#E5E7EB"
                      }`,
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor:
                        selectedTemplate === template.id ? "#D1FAE5" : "white",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <span style={{ fontSize: "1.5rem" }}>📤</span>
                      <div>
                        <div style={{ fontWeight: "600", color: "#059669" }}>
                          {template.name}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>
                          {template.desc}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* PRE-MADE TEMPLATES */}
                {[
                  {
                    id: "modern",
                    name: "Modern Professional",
                    desc: "Clean design with colored header",
                  },
                  {
                    id: "classic",
                    name: "Classic Traditional",
                    desc: "Traditional format with borders",
                  },
                  {
                    id: "minimal",
                    name: "Minimal Simple",
                    desc: "Simple straightforward layout",
                  },
                ].map((template) => (
                  <div
                    key={template.id}
                    onClick={() => setSelectedTemplate(template.id)}
                    style={{
                      padding: "1rem",
                      border: `3px solid ${
                        selectedTemplate === template.id ? "#3B82F6" : "#E5E7EB"
                      }`,
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor:
                        selectedTemplate === template.id ? "#EFF6FF" : "white",
                    }}
                  >
                    <div style={{ fontWeight: "600", marginBottom: "0.25rem" }}>
                      {template.name}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>
                      {template.desc}
                    </div>
                  </div>
                ))}
              </div>

              {/* Society Name */}
              <div style={{ marginBottom: "1rem" }}>
                <label
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: "600",
                    display: "block",
                    marginBottom: "0.5rem",
                  }}
                >
                  Society Name
                </label>
                <input
                  type="text"
                  value={templateData.societyName}
                  onChange={(e) =>
                    updateTemplateData("societyName", e.target.value)
                  }
                  className="input"
                  placeholder="Auto-fill from settings"
                />
              </div>

              {/* Society Address */}
              <div style={{ marginBottom: "1rem" }}>
                <label
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: "600",
                    display: "block",
                    marginBottom: "0.5rem",
                  }}
                >
                  Society Address
                </label>
                <textarea
                  value={templateData.societyAddress}
                  onChange={(e) =>
                    updateTemplateData("societyAddress", e.target.value)
                  }
                  className="input"
                  rows="2"
                  placeholder="Auto-fill from settings"
                />
              </div>

              {/* Header Color */}
              <div style={{ marginBottom: "1rem" }}>
                <label
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: "600",
                    display: "block",
                    marginBottom: "0.5rem",
                  }}
                >
                  Header Color
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {["#1F2937", "#7C3AED", "#DC2626", "#059669", "#2563EB"].map(
                    (color) => (
                      <button
                        key={color}
                        onClick={() => updateTemplateData("headerColor", color)}
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "6px",
                          backgroundColor: color,
                          border:
                            templateData.headerColor === color
                              ? "3px solid #3B82F6"
                              : "2px solid #E5E7EB",
                          cursor: "pointer",
                        }}
                      />
                    )
                  )}
                </div>
              </div>

              {/* Footer Instructions */}
              <div style={{ marginBottom: "1rem" }}>
                <label
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: "600",
                    display: "block",
                    marginBottom: "0.5rem",
                  }}
                >
                  Footer Instructions
                </label>
                {templateData.footer.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      marginBottom: "0.5rem",
                    }}
                  >
                    <input
                      type="text"
                      value={item}
                      onChange={(e) => updateFooterItem(idx, e.target.value)}
                      className="input"
                      style={{ flex: 1, fontSize: "0.75rem" }}
                    />
                    <button
                      onClick={() => removeFooterItem(idx)}
                      style={{
                        padding: "0.5rem",
                        backgroundColor: "#FEE2E2",
                        color: "#DC2626",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={addFooterItem}
                  style={{
                    padding: "0.5rem",
                    backgroundColor: "#F3F4F6",
                    border: "2px dashed #D1D5DB",
                    borderRadius: "6px",
                    cursor: "pointer",
                    width: "100%",
                    fontSize: "0.75rem",
                  }}
                >
                  + Add
                </button>
              </div>

              {/* Show Receipt */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={templateData.showReceipt}
                  onChange={(e) =>
                    updateTemplateData("showReceipt", e.target.checked)
                  }
                  style={{ width: "18px", height: "18px" }}
                />
                Include receipt section
              </label>
            </div>
          </div>
        </div>

        {/* RIGHT SIDE - LIVE PREVIEW */}
        <div>
          <div className={styles.contentCard}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>👁️ Live Preview</h2>
              <span style={{ fontSize: "0.875rem", color: "#6B7280" }}>
                Sample: A-1310 (Arjun Rastogi)
              </span>
            </div>
            <div
              style={{
                padding: "2rem",
                backgroundColor: "#F9FAFB",
                maxHeight: "calc(100vh - 200px)",
                overflowY: "auto",
              }}
              dangerouslySetInnerHTML={{ __html: renderPreview() }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper function to generate HTML from template
function generateHtmlFromTemplate(templateId, data) {
  const templates = {
    modern: `
<div style="width: 1000px; margin: 0 auto; padding: 40px; font-family: Arial, sans-serif; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
  <div style="background-color: ${
    data.headerColor
  }; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 32px; letter-spacing: 2px;">BILL</h1>
    <h2 style="margin: 10px 0 5px 0; font-size: 24px;">{{societyName}}</h2>
    <p style="margin: 0; font-size: 14px; opacity: 0.9;">{{societyAddress}}</p>
  </div>

  <div style="border: 3px solid ${data.borderColor}; border-top: none;">
    <div style="display: flex; justify-content: space-between; padding: 20px; background-color: #F9FAFB; border-bottom: 2px solid #E5E7EB;">
      <div>
        <p style="margin: 5px 0;"><strong>Bill Period:</strong> {{billPeriod}}</p>
        <p style="margin: 5px 0;"><strong>Bill Date:</strong> {{billDate}}</p>
        <p style="margin: 5px 0;"><strong>Due Date:</strong> {{dueDate}}</p>
      </div>
      <div style="text-align: right;">
        <p style="margin: 5px 0;"><strong>Flat:</strong> {{memberWing}}-{{memberRoomNo}}</p>
        <p style="margin: 5px 0;"><strong>Name:</strong> {{memberName}}</p>
        <p style="margin: 5px 0;"><strong>Area:</strong> {{memberArea}} sq.ft</p>
      </div>
    </div>

    <div style="padding: 20px;">
      {{BILLING_TABLE}}
    </div>

    <div style="padding: 20px; background-color: #F9FAFB; border-top: 2px solid #E5E7EB;">
      <div style="display: flex; justify-content: space-between; margin: 10px 0; font-size: 18px;">
        <strong>Current Bill:</strong>
        <strong>{{totalAmount}}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin: 10px 0;">
        <strong>Previous Balance:</strong>
        <strong>{{previousBalance}}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin: 10px 0; padding-top: 10px; border-top: 2px solid #000; font-size: 20px;">
        <strong>TOTAL PAYABLE:</strong>
        <strong style="color: ${data.headerColor};">{{currentBalance}}</strong>
      </div>
    </div>

    ${
      data.showReceipt
        ? `
    <div style="margin: 20px; padding: 20px; border-top: 3px dashed #000;">
      <h3 style="text-align: center; margin: 0 0 15px 0;">RECEIPT</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px;">
        <p><strong>Rec. No.:</strong> _________________</p>
        <p style="text-align: right;"><strong>Date:</strong> _________________</p>
        <p><strong>Received From:</strong> {{memberName}}</p>
        <p style="text-align: right;"><strong>Flat:</strong> {{memberWing}}-{{memberRoomNo}}</p>
        <p><strong>Amount:</strong> ₹ _________________</p>
        <p style="text-align: right;"><strong>Mode:</strong> _________________</p>
      </div>
    </div>
    `
        : ""
    }

    <div style="padding: 15px 20px; border-top: 2px solid #E5E7EB; background-color: #FFFBEB;">
      <ol style="margin: 0; padding-left: 20px; font-size: 12px;">
        ${data.footer.map((item) => `<li>${item}</li>`).join("")}
      </ol>
    </div>
  </div>
</div>
    `,
    classic: `
<div style="width: 800px; margin: 0 auto; padding: 30px; font-family: 'Times New Roman', serif; background: white; border: 5px double #000;">
  <div style="text-align: center; border-bottom: 3px solid #000; padding-bottom: 20px; margin-bottom: 20px;">
    <h1 style="margin: 0; font-size: 36px; text-decoration: underline;">BILL</h1>
    <h2 style="margin: 10px 0 5px 0; font-size: 28px;">{{societyName}}</h2>
    <p style="margin: 0; font-size: 14px;">{{societyAddress}}</p>
  </div>

  <table style="width: 100%; margin-bottom: 20px; border: 2px solid #000;">
    <tr>
      <td style="padding: 10px; border: 1px solid #000;"><strong>Bill Period:</strong> {{billPeriod}}</td>
      <td style="padding: 10px; border: 1px solid #000; text-align: right;"><strong>Flat No.:</strong> {{memberWing}}-{{memberRoomNo}}</td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #000;"><strong>Name:</strong> {{memberName}}</td>
      <td style="padding: 10px; border: 1px solid #000; text-align: right;"><strong>Area:</strong> {{memberArea}} sq.ft</td>
    </tr>
  </table>

  {{BILLING_TABLE}}

  <div style="margin-top: 20px; padding: 15px; border: 2px solid #000; background-color: #F9FAFB;">
    <div style="display: flex; justify-content: space-between; margin: 5px 0; font-size: 16px;">
      <strong>Previous Balance:</strong>
      <strong>{{previousBalance}}</strong>
    </div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0; font-size: 16px;">
      <strong>Current Bill:</strong>
      <strong>{{totalAmount}}</strong>
    </div>
    <div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 2px solid #000; font-size: 20px;">
      <strong>TOTAL PAYABLE:</strong>
      <strong>{{currentBalance}}</strong>
    </div>
  </div>

  ${
    data.showReceipt
      ? `
  <div style="margin-top: 30px; padding-top: 20px; border-top: 3px dashed #000;">
    <h3 style="text-align: center; margin: 0 0 15px 0; text-decoration: underline;">RECEIPT</h3>
    <table style="width: 100%; border: 2px solid #000;">
      <tr>
        <td style="padding: 10px; border: 1px solid #000;">Rec. No.: ______</td>
        <td style="padding: 10px; border: 1px solid #000; text-align: right;">Date: ______</td>
      </tr>
      <tr>
        <td style="padding: 10px; border: 1px solid #000;">Received From: {{memberName}}</td>
        <td style="padding: 10px; border: 1px solid #000; text-align: right;">Flat: {{memberWing}}-{{memberRoomNo}}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 10px; border: 1px solid #000;">Amount: ₹ _________________</td>
      </tr>
    </table>
  </div>
  `
      : ""
  }

  <div style="margin-top: 20px; padding: 15px; border: 2px solid #000;">
    <strong>Terms & Conditions:</strong>
    <ol style="margin: 10px 0; padding-left: 20px; font-size: 12px;">
      ${data.footer.map((item) => `<li>${item}</li>`).join("")}
    </ol>
  </div>
</div>
    `,
    minimal: `
<div style="width: 800px; margin: 0 auto; padding: 40px; font-family: Arial, sans-serif; background: white;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="margin: 0; font-size: 36px; color: ${
      data.headerColor
    };">{{societyName}}</h1>
    <p style="margin: 5px 0; font-size: 14px; color: #6B7280;">{{societyAddress}}</p>
    <h2 style="margin: 20px 0 10px 0; font-size: 28px; color: #000;">BILL</h2>
    <p style="margin: 0; font-size: 16px; color: #6B7280;">Period: {{billPeriod}}</p>
  </div>

  <div style="margin-bottom: 20px; padding: 15px; background-color: #F9FAFB; border-left: 4px solid ${
    data.headerColor
  };">
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span><strong>Flat:</strong> {{memberWing}}-{{memberRoomNo}}</span>
      <span><strong>Area:</strong> {{memberArea}} sq.ft</span>
    </div>
    <div style="margin: 5px 0;"><strong>Member:</strong> {{memberName}}</div>
    <div style="display: flex; justify-content: space-between; margin: 5px 0;">
      <span><strong>Bill Date:</strong> {{billDate}}</span>
      <span><strong>Due Date:</strong> {{dueDate}}</span>
    </div>
  </div>

  {{BILLING_TABLE}}

  <div style="margin-top: 30px; padding: 20px; background-color: #F3F4F6;">

    <div style="display: flex; justify-content: space-between; margin: 10px 0; font-size: 16px;">
      <span>Previous Balance:</span>
      <strong>{{previousBalance}}</strong>
    </div>
    <!-- ADD INTEREST SECTION -->
  <div style="display: flex; justify-content: space-between; margin: 10px 0; padding: 10px; background-color: #FEE2E2; border-radius: 6px;">
    <div>
      <strong style="color: #DC2626;">Interest Charged ({{interestRate}}% p.a.)</strong>
      <br/>
      <span style="font-size: 12px; color: #991B1B;">Overdue by {{interestDays}} days</span>
    </div>
    <strong style="color: #DC2626;">{{interestAmount}}</strong>
  </div>
    <div style="display: flex; justify-content: space-between; margin: 10px 0; font-size: 16px;">
      <span>Current Bill:</span>
      <strong>{{totalAmount}}</strong>
    </div>
    <div style="display: flex; justify-content: space-between; margin-top: 15px; padding-top: 15px; border-top: 2px solid #000; font-size: 22px; color: ${
      data.headerColor
    };">
      <strong>Total Payable:</strong>
      <strong>{{currentBalance}}</strong>
    </div>
  </div>

  ${
    data.showReceipt
      ? `
  <div style="margin-top: 40px; padding: 20px; border: 2px dashed #D1D5DB;">
    <div style="text-align: center; margin-bottom: 15px; font-size: 18px; font-weight: bold;">RECEIPT</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
      <div>Rec. No.: __________</div>
      <div style="text-align: right;">Date: __________</div>
      <div>From: {{memberName}}</div>
      <div style="text-align: right;">Flat: {{memberWing}}-{{memberRoomNo}}</div>
      <div>Amount: ₹ __________</div>
      <div style="text-align: right;">Mode: __________</div>
    </div>
  </div>
  `
      : ""
  }

  <div style="margin-top: 30px; padding: 15px; background-color: #FFFBEB; border-radius: 8px;">
    <ul style="margin: 0; padding-left: 20px; font-size: 11px; color: #78350F;">
      ${data.footer.map((item) => `<li>${item}</li>`).join("")}
    </ul>
  </div>
</div>
    `,
  };

  return templates[templateId] || templates.modern;
}
