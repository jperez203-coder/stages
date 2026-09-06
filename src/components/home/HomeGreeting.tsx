"use client";

import { useEffect, useState } from "react";

/**
 * "Good evening, {name}" above the Home tab row (Figma V2) — replaces the
 * old big highlighted "Hey Jordan! 👋 / What can we get done today?" hero
 * (DashboardGreeting.tsx, kept in place but no longer mounted — deferred,
 * not deleted, in case a future spot wants that treatment back).
 *
 * Client component, not server: the greeting word (morning/afternoon/
 * evening) depends on the VIEWER's local time of day, and a server
 * component would use the server's TZ instead (often UTC), showing e.g.
 * "Good morning" to a US user at 8pm. Renders nothing until mounted to
 * avoid a server/client text mismatch flash.
 */
function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function HomeGreeting({ firstName }: { firstName: string | null }) {
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  if (!greeting) return null;

  return (
    <h1 className="font-poppins text-[20px] font-medium" style={{ color: "#E4E4E7" }}>
      {greeting}
      {firstName ? `, ${firstName}` : ""}
    </h1>
  );
}
