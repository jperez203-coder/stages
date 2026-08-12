import type { FunnelStep } from "@/lib/admin-metrics";

/**
 * Tapered funnel visualization (the "Monad-style" wedge chart Jordan
 * referenced) — sits above the plain step-list on /admin/metrics, which
 * keeps the exact numbers. This component owns only the shape.
 *
 * Shape math note: a funnel should never WIDEN — each stage is a subset
 * of the one before it. Right after tracking went live, "Visited signup
 * page" reads a true 0 while later steps (signed up, etc.) are real —
 * naively normalizing the whole shape against that 0 either divides by
 * zero, or (if you fall back to a later step's count as the baseline)
 * draws a diamond that BULGES OUT between the zero step and the first
 * real one, which reads as broken, not "no data yet."
 *
 * Fix: any leading run of zero-count steps is drawn as its own flat,
 * hatched "pending" band (not folded into the taper math at all) —
 * visually "we don't have this measurement," not "definitively zero."
 * The real wedge starts at the first non-zero step and is additionally
 * clamped to be monotonically non-increasing from there, so a future
 * data blip can't re-introduce a bulge either. Once signup-page visits
 * start accumulating, baselineIdx becomes 0 and the pending band
 * disappears on its own — no code change needed then.
 *
 * The percentage TEXT under each divider is untouched by any of this —
 * it still comes straight from FunnelStep (pctOfFirst / pctOfPrevious),
 * so it honestly reads "—" when not yet meaningful.
 */
export function AcquisitionFunnelChart({ steps }: { steps: FunnelStep[] }) {
  const n = steps.length;
  const counts = steps.map((s) => s.count);
  const baselineIdx = counts.findIndex((c) => c > 0);
  const hasData = baselineIdx !== -1;

  const viewW = 100;
  const viewH = 40;
  const centerY = viewH / 2;
  const halfH = viewH / 2 - 2;
  const boundaryX = (b: number) => (b / n) * viewW;

  let wedgePolygonPoints = "";
  if (hasData) {
    const baseline = counts[baselineIdx];
    // Fractions only defined from baselineIdx onward; monotonically
    // clamped so a later uptick can never draw wider than an earlier step.
    const fractions: number[] = new Array(n).fill(0);
    for (let i = baselineIdx; i < n; i++) {
      const raw = Math.min(1, counts[i] / baseline);
      fractions[i] = i === baselineIdx ? 1 : Math.min(raw, fractions[i - 1]);
    }

    // Boundaries baselineIdx..n for the real portion of the shape:
    // boundary(baselineIdx) is flat at 1 (start of the taper), boundary
    // b thereafter sits at fractions[b-1] — same "taper happens across
    // the entering column" rule as before, just scoped to real data.
    const wedgeBoundaries: { x: number; h: number }[] = [
      { x: boundaryX(baselineIdx), h: fractions[baselineIdx] },
    ];
    for (let b = baselineIdx + 1; b <= n; b++) {
      wedgeBoundaries.push({ x: boundaryX(b), h: fractions[Math.min(b - 1, n - 1)] });
    }

    const top = wedgeBoundaries.map((p) => `${p.x},${centerY - p.h * halfH}`);
    const bottom = wedgeBoundaries
      .map((p) => `${p.x},${centerY + p.h * halfH}`)
      .reverse();
    wedgePolygonPoints = [...top, ...bottom].join(" ");
  }

  // Pending region: any leading columns with zero recorded data (today,
  // just "Visited signup page"). Flat hatched band, not a taper.
  const pendingWidth = hasData ? baselineIdx : n;
  const pendingRect =
    pendingWidth > 0
      ? {
          x: 0,
          width: boundaryX(pendingWidth),
          y: centerY - 0.55 * halfH,
          height: 1.1 * halfH,
        }
      : null;

  return (
    <div style={{ position: "relative", paddingTop: 28, paddingBottom: 34 }}>
      {/* Column headers — left-aligned at each column's start */}
      <div style={{ position: "relative", height: 18 }}>
        {steps.map((s, i) => (
          <span
            key={s.label}
            className="text-[12px]"
            style={{
              position: "absolute",
              left: `${(i / n) * 100}%`,
              color: "#E4E4E7",
              maxWidth: `${(1 / n) * 100}%`,
              paddingRight: 8,
            }}
          >
            {s.label}
          </span>
        ))}
      </div>

      {/* The wedge itself */}
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 140, display: "block" }}
      >
        <defs>
          <linearGradient id="funnelWedgeGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#108CE9" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#108CE9" stopOpacity="0.25" />
          </linearGradient>
          <pattern
            id="funnelPendingHatch"
            width="3"
            height="3"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="3" height="3" fill="#212124" />
            <line x1="0" y1="0" x2="0" y2="3" stroke="#4A4A50" strokeWidth="1" />
          </pattern>
        </defs>
        {Array.from({ length: n + 1 }, (_, b) => b).map((b) => (
          <line
            key={b}
            x1={boundaryX(b)}
            x2={boundaryX(b)}
            y1={0}
            y2={viewH}
            stroke="#36363A"
            strokeWidth={0.3}
          />
        ))}
        {pendingRect && (
          <rect
            x={pendingRect.x}
            y={pendingRect.y}
            width={pendingRect.width}
            height={pendingRect.height}
            fill="url(#funnelPendingHatch)"
            stroke="#4A4A50"
            strokeWidth={0.25}
            strokeDasharray="1.2,1"
          />
        )}
        {wedgePolygonPoints && (
          <polygon points={wedgePolygonPoints} fill="url(#funnelWedgeGradient)" />
        )}
      </svg>

      {/* Divider annotations — one per transition into a later step */}
      <div style={{ position: "relative", height: 34 }}>
        {steps.slice(1).map((s, idx) => {
          const b = idx + 1; // boundary index for this transition
          return (
            <div
              key={s.label}
              style={{
                position: "absolute",
                left: `${(b / n) * 100}%`,
                transform: "translateX(-50%)",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              <div className="text-[15px] font-semibold text-white">
                {s.pctOfFirst !== null ? `${s.pctOfFirst}%` : "—"}
              </div>
              <div className="text-[11px]" style={{ color: "#71717A" }}>
                {s.count.toLocaleString()}
                {s.pctOfPrevious !== null ? ` · ${s.pctOfPrevious}% prev.` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
