/**
 * Shared task-bucketing logic. Used by /w/[slug]/my-tasks (step 4 list
 * view) AND the dashboard's My Tasks card (step 2). Both surfaces must
 * bucket consistently — same midnight-today threshold, same boundaries.
 *
 * KNOWN LIMITATION (timezone): same caveat as the dashboard sort.
 * Server-side computation uses the server's local TZ (UTC on Vercel).
 * For users west of UTC, deadlines that fall in their local "today" but
 * after server-UTC midnight will misbucket as "tomorrow"/"this week"
 * instead of "today" during the user's late-evening hours. Pre-launch
 * blocker, locked fix path is a TZ cookie set client-side and read
 * server-side. Tracked in launch-prep checklist.
 */

export type Bucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "later"
  | "noDate";

/**
 * Computes the midnight-today threshold in the server's local TZ.
 * Returns the epoch-ms of today's 00:00. Same algorithm the dashboard
 * uses; keeping them in sync is the whole point of this module.
 */
export function todayStartMs(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Returns the epoch-ms boundaries used for bucket assignment:
 *   today     = midnight today
 *   tomorrow  = midnight tomorrow
 *   weekEnd   = midnight at the end of the current week (today + 7 days)
 *
 * "This week" = deadline ≥ tomorrow's midnight AND < (today + 7 days).
 * Anything ≥ (today + 7 days) is "later".
 */
export function bucketBoundaries(now: Date = new Date()) {
  const today = todayStartMs(now);
  const oneDay = 24 * 60 * 60 * 1000;
  return {
    today,
    tomorrow: today + oneDay,
    weekEnd: today + 7 * oneDay,
  };
}

/**
 * Assigns a deadline to one of six buckets.
 *
 *   null               → "noDate"
 *   < today midnight   → "overdue"
 *   < tomorrow midnight→ "today"
 *   < day-after midnight → "tomorrow"
 *   < today + 7 days   → "thisWeek"
 *   else               → "later"
 */
export function bucketForDeadline(
  deadlineMs: number | null,
  now: Date = new Date(),
): Bucket {
  if (deadlineMs === null) return "noDate";
  const { today, tomorrow, weekEnd } = bucketBoundaries(now);
  if (deadlineMs < today) return "overdue";
  if (deadlineMs < tomorrow) return "today";
  if (deadlineMs < tomorrow + 24 * 60 * 60 * 1000) return "tomorrow";
  if (deadlineMs < weekEnd) return "thisWeek";
  return "later";
}

/**
 * Filter-chip semantics. Two documented asymmetries between buckets and
 * chips, both deliberate:
 *
 *   1. Tomorrow has its own SECTION but no chip — tomorrow tasks fold
 *      under the "This week" chip. Spec'd.
 *   2. Overdue has its own SECTION (red, only renders when populated)
 *      but no chip — overdue tasks fold under the "Today" chip. Rationale:
 *      chips are urgency filters; overdue is max urgency = "deal with
 *      now," which is the same intent as Today. Hiding overdue under
 *      any non-"All" chip click would be backwards (most urgent items
 *      become the most filtered-out). Locked 2026-05-20.
 *
 * With these two folds, each bucket maps to exactly one non-"all" chip
 * and the chip counts always reconcile against All:
 *   All = Today + This week + Later + No date
 */
export type Chip = "all" | "today" | "thisWeek" | "later" | "noDate";

export function bucketMatchesChip(bucket: Bucket, chip: Chip): boolean {
  if (chip === "all") return true;
  // Today chip includes overdue — overdue is max urgency, belongs with
  // "deal with now" tasks rather than filtered out.
  if (chip === "today") return bucket === "overdue" || bucket === "today";
  if (chip === "thisWeek") return bucket === "tomorrow" || bucket === "thisWeek";
  if (chip === "later") return bucket === "later";
  if (chip === "noDate") return bucket === "noDate";
  return false;
}
