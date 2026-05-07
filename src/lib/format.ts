import type { DeadlineStatus } from "@/types/stages";

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function getDeadlineStatus(
  deadline: number | string | null | undefined,
): DeadlineStatus | null {
  if (!deadline) return null;
  const now = Date.now();
  const ts = typeof deadline === "number" ? deadline : new Date(deadline).getTime();
  if (isNaN(ts)) return null;
  if (ts < now) return "overdue";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (ts < tomorrow.getTime()) return "today";
  const threeDaysOut = new Date(today);
  threeDaysOut.setDate(threeDaysOut.getDate() + 3);
  if (ts < threeDaysOut.getTime()) return "soon";
  return "future";
}

export type DeadlineColorSet = {
  bg: string;
  border: string;
  text: string;
  icon: string;
};

export function getDeadlineColors(status: DeadlineStatus | null): DeadlineColorSet {
  switch (status) {
    case "overdue":
      return { bg: "#F4335E1A", border: "#F4335E66", text: "#F87171", icon: "#F4335E" };
    case "today":
      return { bg: "#F59E0B1A", border: "#F59E0B66", text: "#FBBF24", icon: "#F59E0B" };
    case "soon":
      return { bg: "#108CE91A", border: "#108CE966", text: "#7EC2F4", icon: "#108CE9" };
    case "future":
      return { bg: "#36363A", border: "#4A4A50", text: "#A1A1AA", icon: "#A1A1AA" };
    default:
      return { bg: "#36363A", border: "#4A4A50", text: "#A1A1AA", icon: "#A1A1AA" };
  }
}

export function formatDeadline(
  deadline: number | string | null | undefined,
  opts: { short?: boolean } = {},
): string {
  if (!deadline) return "";
  const ts = typeof deadline === "number" ? deadline : new Date(deadline).getTime();
  if (isNaN(ts)) return "";
  const d = new Date(ts);
  const isMidnight = d.getHours() === 0 && d.getMinutes() === 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const itemDay = new Date(d);
  itemDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((itemDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  let datePart: string;
  if (opts.short && diffDays === 0) datePart = "Today";
  else if (opts.short && diffDays === 1) datePart = "Tomorrow";
  else if (opts.short && diffDays === -1) datePart = "Yesterday";
  else datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  if (isMidnight) return datePart;
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

export function toDatetimeLocal(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(str: string): number | null {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.getTime();
}
