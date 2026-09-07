"use client";
import { useEffect, useState } from "react";
import DashboardLayout from "components/DashboardLayout";
import { useVisibleAdminNavigation } from "components/adminNavigation";
export default function AdminLayout({ children }) {
  // Commercial module visibility. One cheap read of the society's flags; a
  // failure leaves the group hidden and never blocks the admin shell.
  const [commercialEnabled, setCommercialEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/commercial/flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.flags?.enabled) setCommercialEnabled(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const { visibleNavigation } = useVisibleAdminNavigation({ commercialEnabled });

  return (
    <DashboardLayout
      role="Admin"
      navigation={visibleNavigation}
      title="AapliSociety"
      subtitle="Admin Panel"
    >
      {children}
    </DashboardLayout>
  );
}
