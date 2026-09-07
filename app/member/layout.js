import DashboardLayout from "components/DashboardLayout";

// NOTE: DashboardLayout already renders <NotificationBell /> in its top header,
// and the bell now gates its own polling to needful routes (/member, /admin).
// The old `headerExtra={<NotificationBell />}` prop here was a no-op
// (DashboardLayout never read `headerExtra`), so it's removed to avoid a
// confusing second mount if that prop is ever wired up later.
export default function MemberLayout({ children }) {
  const navigation = [
    {
      title: "Overview",
      items: [{ name: "Dashboard", path: "/member/dashboard", icon: "\ud83d\udcca" }],
    },
    {
      title: "My Account",
      items: [
        { name: "My Profile", path: "/member/profile", icon: "\ud83d\udc64" },
        { name: "My Bills", path: "/member/my-bills", icon: "\ud83d\udcc4" },
        { name: "My Ledger", path: "/member/my-ledger", icon: "\ud83d\udcd2" },
        { name: "Make Payment", path: "/member/make-payment", icon: "\ud83d\udcb3" },
        { name: "Receipts", path: "/member/receipts", icon: "\ud83e\uddfe" },
        { name: "Notices", path: "/member/notices", icon: "\ud83d\udce2" },
        { name: "Complaints", path: "/member/complaints", icon: "\ud83d\udcdd" },
        { name: "Visitors", path: "/member/visitors", icon: "\ud83d\udeaa" },
      ],
    },
  ];
  return (
    <DashboardLayout
      role="Member"
      navigation={navigation}
      title="AapliSociety"
      subtitle="Member Panel"
    >
      {children}
    </DashboardLayout>
  );
}
