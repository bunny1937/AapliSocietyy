"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
export default function RouteLoadingBar() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;
    // Start
    setVisible(true);
    setProgress(15);
    clearInterval(timerRef.current);
    // Simulate incremental progress
    timerRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 85) { clearInterval(timerRef.current); return 85; }
        return p + Math.random() * 12;
      });
    }, 200);
    // Complete after a tick — route rendered
    const completeTimer = setTimeout(() => {
      clearInterval(timerRef.current);
      setProgress(100);
      setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 300);
    }, 400);
    return () => {
      clearInterval(timerRef.current);
      clearTimeout(completeTimer);
    };
  }, [pathname]);
  if (!visible && progress === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "3px",
        zIndex: 99999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background: "linear-gradient(90deg, var(--primary) 0%, var(--accent) 60%, var(--accent-tint) 100%)",
          borderRadius: "0 3px 3px 0",
          transition: progress === 100
            ? "width 0.2s ease-out, opacity 0.3s ease-out"
            : "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
          opacity: progress === 100 ? 0 : 1,
          boxShadow: "0 0 10px rgba(107, 142, 239, 0.6), 0 0 20px rgba(107, 142, 239, 0.3)",
        }}
      />
    </div>
  );
}
