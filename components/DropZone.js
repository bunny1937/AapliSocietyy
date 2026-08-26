"use client";
import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";
export default function DropZone({
  accept = ".xlsx,.xls",
  onFile,
  file,
  onClear,
  label = "Click or drag & drop Excel file here",
  hint = ".xlsx or .xls — max 5MB",
  icon,
  style = {},
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOver(false);
    }
  };
  const handleInputChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      onFile(f);
      e.target.value = "";
    }
  };
  const baseStyle = {
    border: `2px dashed ${
      dragOver ? "var(--accent)" : file ? "var(--success)" : "var(--border-strong)"
    }`,
    borderRadius: 14,
    padding: "28px 32px",
    textAlign: "center",
    background: dragOver
      ? "rgba(107, 142, 239, 0.06)"
      : file
        ? "rgba(16, 185, 129, 0.05)"
        : "var(--accent-tint)",
    cursor: file ? "default" : "pointer",
    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
    boxShadow: dragOver
      ? "0 0 0 4px rgba(107, 142, 239, 0.15)"
      : "none",
    transform: dragOver ? "scale(1.01)" : "scale(1)",
    ...style,
  };
  return (
    <div
      style={baseStyle}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => !file && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={handleInputChange}
      />
      {file ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <FileSpreadsheet size={24} color="var(--success)" />
          </div>
          <div style={{ fontWeight: 700, color: "var(--success-fg)", fontSize: 14 }}>
            {file.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-4)" }}>
            {(file.size / 1024).toFixed(1)} KB
          </div>
          {onClear && (
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              style={{
                marginTop: 4,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
                background: "transparent",
                border: "1.5px solid var(--border-strong)",
                borderRadius: 8,
                cursor: "pointer",
                color: "var(--fg-4)",
                display: "flex",
                alignItems: "center",
                gap: 5,
                transition: "all 0.15s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "var(--danger)";
                e.currentTarget.style.color = "var(--danger)";
                e.currentTarget.style.background = "var(--danger-bg)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "var(--border-strong)";
                e.currentTarget.style.color = "var(--fg-4)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <X size={12} /> Remove
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: dragOver ? "rgba(107, 142, 239, 0.15)" : "rgba(30, 58, 138, 0.07)",
            border: "1px solid rgba(30, 58, 138, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s",
          }}>
            <Upload size={22} color={dragOver ? "var(--accent)" : "var(--primary)"} />
          </div>
          <div style={{ fontWeight: 600, color: "var(--primary)", fontSize: 14 }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--fg-5)" }}>{hint}</div>
        </div>
      )}
    </div>
  );
}
