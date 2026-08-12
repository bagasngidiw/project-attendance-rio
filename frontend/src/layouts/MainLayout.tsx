import { Outlet } from "react-router-dom";

import Sidebar from "@/components/layout/sidebar/Sidebar";
import Navbar from "@/components/layout/navbar/Navbar";
import BreadCrumbs from "@/components/layout/BreadCrumbs";

export default function MainLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col bg-[var(--brand-background)]">
        <Navbar />

        {/* Only the page area scrolls — the navbar stays pinned above it. */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <BreadCrumbs />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
