type Props = { size?: number; className?: string; style?: React.CSSProperties };

/**
 * Sidebar expand/collapse arrow — Figma V2's custom triangle glyph
 * (replaces lucide's ChevronRight/ChevronDown). `open=false` renders the
 * closed (pointing-right) state, `open=true` the expanded (pointing-down)
 * state. `size` scales by the icon's own natural width; height follows its
 * native aspect ratio since the two states aren't square (10:13 closed,
 * 12:10 open).
 */
export function SidebarChevron({ open, size = 10, className, style }: Props & { open: boolean }) {
  return open ? (
    <svg
      width={size}
      height={(size * 10) / 12}
      viewBox="0 0 12 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      <path
        d="M4.89366 8.82967L0.254884 2.20285C-0.394638 1.27496 0.269177 -8.85647e-07 1.40181 -8.36138e-07L10.024 -4.59251e-07C11.1566 -4.09742e-07 11.8204 1.27496 11.1709 2.20285L6.53212 8.82967C6.13402 9.39839 5.29176 9.39838 4.89366 8.82967Z"
        fill="#A4A4A4"
      />
    </svg>
  ) : (
    <svg
      width={size}
      height={(size * 13) / 10}
      viewBox="0 0 10 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      <path
        d="M8.93333 6.90352L2.24 11.9235C1.31707 12.6157 0 11.9572 0 10.8035L0 1.40351C0 0.249852 1.31707 -0.408683 2.24 0.283515L8.93333 5.30352C9.46667 5.70352 9.46667 6.50352 8.93333 6.90352Z"
        fill="#A4A4A4"
      />
    </svg>
  );
}
