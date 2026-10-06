"use client";

import { usePageAgentScope } from "@/lib/client/store";

/** Placeholder — replaced by the real dashboard. */
export default function DashboardPage() {
  usePageAgentScope({ mode: "all" });
  return <div className="p-6">דשבורד</div>;
}
