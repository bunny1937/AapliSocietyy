"use client";
// This page was folded into the unified /admin/payments dashboard (see
// app/admin/payments/page.js — "Received" tab). Kept as a redirect so old
// links/bookmarks to /admin/payments-received still land somewhere useful.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PaymentsReceivedRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/payments");
  }, [router]);
  return null;
}
