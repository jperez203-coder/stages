/**
 * Top-of-dashboard greeting block. Server component — no hooks needed.
 *
 * Layout per spec + figma color refresh (2026-05-19):
 *   "Hey [firstname]! 👋"  — h1 32px weight 500. Wrapped in a highlighted
 *                            span: bg #263D5F, text color #7FA7D9.
 *   "What can we get done today?"  — 22px, color #979393
 *   "Monday, May 18"  — 14px, color #979393
 *
 * Date is rendered server-side in the server's timezone. For most users
 * this lines up with their local date; the edge case (e.g. 11pm Pacific
 * on Sunday → server UTC says Monday) shows the wrong weekday for a few
 * hours. Acceptable for MVP — same TZ caveat as the My Tasks sort.
 *
 * Greeting parsing happens in the page (display_name → first word with
 * trim + /\s+/ split + first-letter capitalize). firstName === null
 * means "Hey there!" fallback.
 */

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export function DashboardGreeting({ firstName }: { firstName: string | null }) {
  const greeting = firstName ? `Hey ${firstName}! 👋` : "Hey there! 👋";
  const dateLabel = DATE_FMT.format(new Date());

  // Type scale (2026-05-19 polish round, refined 2026-05-20):
  //   * greeting headline: 40/500 (weight notched down from 600 — feels
  //     less shouty against the highlighted background)
  //   * subhead: 34/500 (bumped up from 30, closing the gap)
  //   * date: 18/500
  //   * locked invariant: greeting > subhead. Currently 40 vs 34 = 6px gap.
  //   * date color = #6B6B6B (one notch darker than subhead's #979393)
  //   * highlight box border-radius 0 (square corners)
  return (
    <header>
      <h1
        className="leading-tight"
        style={{ fontSize: 40, fontWeight: 500 }}
      >
        <span
          style={{
            background: "#263D5F",
            color: "#7FA7D9",
            padding: "4px 14px",
            borderRadius: 0,
            display: "inline-block",
          }}
        >
          {greeting}
        </span>
      </h1>
      <p
        className="mt-3"
        style={{ fontSize: 34, fontWeight: 500, color: "#979393" }}
      >
        What can we get done today?
      </p>
      <p
        className="mt-1"
        style={{ fontSize: 18, fontWeight: 500, color: "#6B6B6B" }}
      >
        {dateLabel}
      </p>
    </header>
  );
}
