"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import {
  RequestFamilyMember,
  RequestRemoveFamilyMember,
  RequestParkingSlot,
  RequestRemoveParkingSlot,
} from "./_ChangeRequests";
export default function MemberProfilePage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [banner, setBanner] = useState(null); // { tone: "ok" | "error", text }
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => apiClient.get("/api/member/profile"),
    // NOTE: useQuery's `onSuccess` was removed in react-query v5, so seeding
    // the form here silently never ran and `form` stayed {}. The form is now
    // seeded when the person presses Edit, from the data already on screen.
  });
  // What is already pending, so the family/parking request widgets never let
  // someone ask for the same change twice.
  const editRequestsQuery = useQuery({
    queryKey: ["my-profile-edit-requests"],
    queryFn: () => apiClient.get("/api/member/profile-edit-requests"),
  });
  const pendingRequests = editRequestsQuery.data?.requests ?? [];
  const refetchRequests = () =>
    queryClient.invalidateQueries({ queryKey: ["my-profile-edit-requests"] });
  const saveMutation = useMutation({
    mutationFn: (updates) => apiClient.put("/api/member/profile", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      setEditing(false);
      setBanner({ tone: "ok", text: "Your contact details have been updated." });
    },
    // The server's own words, in the page — not a browser alert() the person
    // has to dismiss before they can see which field was wrong.
    onError: (e) =>
      setBanner({
        tone: "error",
        text: e?.message || "Those details could not be saved. Please try again.",
      }),
  });

  const startEditing = () => {
    setForm({
      whatsappNumber: data?.member?.whatsappNumber || "",
      alternateContact: data?.member?.alternateContact || "",
      emailSecondary: data?.member?.emailSecondary || "",
    });
    setBanner(null);
    setEditing(true);
  };
  if (isLoading)
    return (
      <div style={{ padding: "3rem", textAlign: "center" }}>
        <div className="loading-spinner" style={{ margin: "0 auto" }}></div>
      </div>
    );
  const member = data?.member;
  const society = data?.society;
  // A tenant viewing this page must see THEIR OWN identity/contact, not the
  // flat owner's — member is the shared flat record, and the tenant's own
  // details live in member.currentTenant.
  const isTenantViewer = data?.viewerOccupancyType === "Tenant";
  const tenantSelf = isTenantViewer ? member?.currentTenant : null;
  const displayName = tenantSelf?.name || member?.ownerName;
  const displayContact = tenantSelf?.contactNumber || member?.contactNumber;
  const displayEmail = tenantSelf?.email || member?.emailPrimary;
  if (!member)
    return (
      <div style={{ padding: "2rem", color: "#6B7280", lineHeight: 1.6 }}>
        {loadError
          ? // The real reason, so "my profile is blank" is answerable.
            `Your profile could not be loaded: ${loadError.message}`
          : "Your profile has not been set up yet. Please contact your society office."}
      </div>
    );
  const InfoRow = ({ label, value, highlight }) =>
    value ? (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 0",
          borderBottom: "1px solid #F3F4F6",
          fontSize: "14px",
        }}
      >
        <span style={{ color: "#6B7280", minWidth: "160px" }}>{label}</span>
        <span
          style={{
            fontWeight: highlight ? "700" : "600",
            color: highlight ? "#1E40AF" : "#1F2937",
            textAlign: "right",
          }}
        >
          {value}
        </span>
      </div>
    ) : null;
  const Section = ({ title, icon, children }) => (
    <div className={styles.contentCard} style={{ marginBottom: "1.5rem" }}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          {icon} {title}
        </h2>
      </div>
      <div style={{ padding: "0 1.5rem 1.5rem" }}>{children}</div>
    </div>
  );
  return (
    <div>
      <div
        className={styles.pageHeader}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1 className={styles.pageTitle}>My Profile</h1>
          <p className={styles.pageSubtitle}>
            {society?.name} — Member Information
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {editing ? (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setEditing(false);
                  setBanner(null);
                }}
                disabled={saveMutation.isPending}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : "Save changes"}
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" onClick={startEditing}>
              ✏️ Edit contact info
            </button>
          )}
        </div>
      </div>
      {banner && (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          style={{
            marginBottom: "1rem",
            padding: "0.7rem 0.9rem",
            borderRadius: 8,
            fontSize: 14,
            lineHeight: 1.55,
            background: banner.tone === "error" ? "#FEF2F2" : "#ECFDF5",
            border: `1px solid ${banner.tone === "error" ? "#FECACA" : "#A7F3D0"}`,
            color: banner.tone === "error" ? "#991B1B" : "#065F46",
          }}
        >
          {banner.text}
        </div>
      )}
      {/* Identity Card */}
      <div
        style={{
          background: "linear-gradient(135deg, #1e40af, #3b82f6)",
          color: "white",
          borderRadius: "12px",
          padding: "28px 32px",
          marginBottom: "1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div
            style={{ fontSize: "24px", fontWeight: "700", marginBottom: "6px" }}
          >
            {displayName}
          </div>
          <div style={{ fontSize: "14px", opacity: 0.85 }}>
            {member.membershipNumber} • {member.membershipStatus}
          </div>
          <div style={{ fontSize: "13px", opacity: 0.75, marginTop: "4px" }}>
            {society?.name}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "32px", fontWeight: "700" }}>
            {member.wing}-{member.flatNo}
          </div>
          <div style={{ fontSize: "13px", opacity: 0.85 }}>
            {member.flatType} • {member.carpetAreaSqft} sq ft
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7, marginTop: "4px" }}>
            {member.ownershipType}
          </div>
        </div>
      </div>
      {/* Basic Info */}
      <Section title="Flat Details" icon="🏠">
        <InfoRow
          label="Flat No."
          value={`${member.wing}-${member.flatNo}`}
          highlight
        />
        <InfoRow
          label="Floor"
          value={member.floor !== undefined ? `Floor ${member.floor}` : null}
        />
        <InfoRow label="Flat Type" value={member.flatType} />
        <InfoRow label="Ownership Type" value={member.ownershipType} />
        <InfoRow
          label="Carpet Area"
          value={
            member.carpetAreaSqft ? `${member.carpetAreaSqft} sq ft` : null
          }
        />
        {member.builtUpAreaSqft && (
          <InfoRow
            label="Built-up Area"
            value={`${member.builtUpAreaSqft} sq ft`}
          />
        )}
        {member.possessionDate && (
          <InfoRow
            label="Possession Date"
            value={new Date(member.possessionDate).toLocaleDateString("en-IN")}
          />
        )}
        <InfoRow label="Membership No." value={member.membershipNumber} />
        <InfoRow label="Status" value={member.membershipStatus} />
        <InfoRow
          label="Voting Rights"
          value={member.hasVotingRights ? "Yes" : "No"}
        />
      </Section>
      {/* Contact Info */}
      <Section title="Contact Information" icon="📞">
        <InfoRow label="Primary Contact" value={displayContact} />
        <InfoRow label="Primary Email" value={displayEmail} />
        {editing ? (
          <>
            <div
              style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}
            >
              <label
                style={{
                  fontSize: "13px",
                  color: "#6B7280",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                WhatsApp Number
              </label>
              <input
                className="input"
                value={form.whatsappNumber}
                onChange={(e) =>
                  setForm({ ...form, whatsappNumber: e.target.value })
                }
                placeholder="WhatsApp number"
              />
            </div>
            <div
              style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}
            >
              <label
                style={{
                  fontSize: "13px",
                  color: "#6B7280",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                Alternate Contact
              </label>
              <input
                className="input"
                value={form.alternateContact}
                onChange={(e) =>
                  setForm({ ...form, alternateContact: e.target.value })
                }
                placeholder="Alternate phone"
              />
            </div>
            <div
              style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}
            >
              <label
                style={{
                  fontSize: "13px",
                  color: "#6B7280",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                Secondary Email
              </label>
              <input
                className="input"
                value={form.emailSecondary}
                onChange={(e) =>
                  setForm({ ...form, emailSecondary: e.target.value })
                }
                placeholder="Secondary email"
              />
            </div>
          </>
        ) : (
          <>
            <InfoRow label="WhatsApp" value={member.whatsappNumber} />
            <InfoRow
              label="Alternate Contact"
              value={member.alternateContact}
            />
            <InfoRow label="Secondary Email" value={member.emailSecondary} />
          </>
        )}
      </Section>
      {/* Identity Documents — show only if data exists */}
      {(member.panCard || member.aadhaar) && (
        <Section title="Identity Documents" icon="🪪">
          {member.panCard && (
            <InfoRow label="PAN Card" value={member.panCard} />
          )}
          {member.aadhaar && (
            <InfoRow
              label="Aadhaar"
              value={`XXXX XXXX ${member.aadhaar.slice(-4)}`}
            />
          )}
        </Section>
      )}
      {/* Parking Slots — a wrong slot changes a bill, so add/remove goes
          through admin approval rather than a direct edit here. Always
          rendered (with a real empty state) rather than vanishing when
          the flat has none, per "serve everything" — a resident with no
          slots still needs to see how to request one. */}
      <Section title="Parking Slots" icon="🚗">
        {(member.parkingSlots?.length ?? 0) === 0 && (
          <div style={{ padding: "10px 0", fontSize: 14, color: "#6B7280" }}>
            No parking slots recorded for this flat yet.
          </div>
        )}
        {(member.parkingSlots || []).map((slot, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: "16px",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid #F3F4F6",
              fontSize: "14px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontWeight: "600",
                color: "#1F2937",
                minWidth: "100px",
              }}
            >
              {slot.slotNumber}
            </span>
            <span
              style={{
                background: "#DBEAFE",
                color: "#1E40AF",
                padding: "2px 10px",
                borderRadius: "12px",
                fontSize: "12px",
              }}
            >
              {slot.type}
            </span>
            <span
              style={{
                background: "#F3F4F6",
                color: "#374151",
                padding: "2px 10px",
                borderRadius: "12px",
                fontSize: "12px",
              }}
            >
              {slot.vehicleType}
            </span>
            <span style={{ marginLeft: "auto" }}>
              <RequestRemoveParkingSlot
                slotNumber={slot.slotNumber}
                requests={pendingRequests}
                onSent={refetchRequests}
              />
            </span>
          </div>
        ))}
        <RequestParkingSlot requests={pendingRequests} onSent={refetchRequests} />
      </Section>
      {/* Family Members — same reasoning as Parking: always rendered with a
          real empty state, add/remove goes through admin approval. */}
      <Section title="Family Members" icon="👨‍👩‍👧‍👦">
        {(member.familyMembers?.length ?? 0) === 0 && (
          <div style={{ padding: "10px 0", fontSize: 14, color: "#6B7280" }}>
            No family members recorded for this flat yet.
          </div>
        )}
        {(member.familyMembers || []).map((fm, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid #F3F4F6",
              fontSize: "14px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div>
              <span style={{ fontWeight: "600", color: "#1F2937" }}>
                {fm.name}
              </span>
              {fm.relation && (
                <span
                  style={{
                    color: "#6B7280",
                    marginLeft: "8px",
                    fontSize: "13px",
                  }}
                >
                  ({fm.relation})
                </span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: "12px",
                fontSize: "13px",
                color: "#6B7280",
                alignItems: "center",
              }}
            >
              {fm.age && <span>Age: {fm.age}</span>}
              {fm.occupation && <span>{fm.occupation}</span>}
              {fm.contactNumber && <span>{fm.contactNumber}</span>}
              <RequestRemoveFamilyMember
                familyMemberId={fm._id}
                requests={pendingRequests}
                onSent={refetchRequests}
              />
            </div>
          </div>
        ))}
        <RequestFamilyMember requests={pendingRequests} onSent={refetchRequests} />
      </Section>
      {/* Current Tenant */}
      {member.ownershipType === "Rented" && member.currentTenant && (
        <Section title="Current Tenant" icon="🏠">
          <InfoRow label="Tenant Name" value={member.currentTenant.name} />
          <InfoRow label="Contact" value={member.currentTenant.contactNumber} />
          <InfoRow
            label="Start Date"
            value={
              member.currentTenant.startDate
                ? new Date(member.currentTenant.startDate).toLocaleDateString(
                    "en-IN",
                  )
                : null
            }
          />
          <InfoRow
            label="Rent/Month"
            value={
              member.currentTenant.rentPerMonth
                ? `₹${member.currentTenant.rentPerMonth.toLocaleString("en-IN")}`
                : null
            }
          />
          <InfoRow
            label="Deposit"
            value={
              member.currentTenant.depositAmount
                ? `₹${member.currentTenant.depositAmount.toLocaleString("en-IN")}`
                : null
            }
          />
        </Section>
      )}
      {/* Emergency Contact */}
      {member.emergencyContact?.name && (
        <Section title="Emergency Contact" icon="🆘">
          <InfoRow label="Name" value={member.emergencyContact.name} />
          <InfoRow label="Relation" value={member.emergencyContact.relation} />
          <InfoRow label="Phone" value={member.emergencyContact.phoneNumber} />
        </Section>
      )}
      {/* Society Info */}
      <Section title="Society Information" icon="🏢">
        <InfoRow label="Society Name" value={society?.name} />
        <InfoRow label="Address" value={society?.address} />
        <InfoRow
          label="Maintenance Rate"
          value={
            society?.config?.maintenanceRate
              ? `₹${society.config.maintenanceRate}/sq.ft`
              : null
          }
        />
        <InfoRow
          label="Interest Rate"
          value={
            society?.config?.interestRate
              ? `${society.config.interestRate}% p.a.`
              : null
          }
        />
        <InfoRow
          label="Grace Period"
          value={
            society?.config?.gracePeriodDays
              ? `${society.config.gracePeriodDays} days`
              : null
          }
        />
        <InfoRow
          label="Bill Due Day"
          value={
            society?.config?.billDueDay
              ? `${society.config.billDueDay}th of every month`
              : null
          }
        />
      </Section>
    </div>
  );
}
