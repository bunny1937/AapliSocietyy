"use client";
import DashboardLayout from "components/DashboardLayout";
const navigation = [
  {
    title: "Gate",
    items: [
      { name: "Dashboard", path: "/security/dashboard", icon: "🛡️" },
      { name: "New Entry", path: "/security/new-entry", icon: "➕" },
      { name: "Verify Pass", path: "/security/verify-pass", icon: "🎟️" },
      { name: "Visitor Log", path: "/security/logs", icon: "📒" },
    ],
  },
];
export default function SecurityLayout({ children }) {
  return (
    <DashboardLayout
      role="Security"
      navigation={navigation}
      title="Security Panel"
      subtitle="Gate operations"
      withQueryClient={false}
    >
      {children}
    </DashboardLayout>
  );
}
