type Props = { size?: number; className?: string; color?: string };

/**
 * Exact Figma "Select Project" placeholder icon for CreateTaskModal's
 * project picker button — a generic project/list glyph on a colored
 * square, shown only before a real project is chosen (once one is picked,
 * the button shows that pipeline's own emoji instead). Native viewBox is
 * 22x22 (square), so `size` sets both width and height directly. `color`
 * overrides the baked-in tile fill (default matches Figma's #6B60C9).
 */
export function ProjectPickerIcon({ size = 22, className = "", color = "#6B60C9" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block" }}
    >
      <rect width="22" height="22" rx="5" fill={color} />
      <path
        d="M5 4V12C5 13.8856 5 14.8284 5.58579 15.4142C6.17157 16 7.11438 16 9 16H13.8"
        stroke="white"
        strokeWidth="2"
      />
      <path
        d="M5 6.39993C5 7.51997 5 8.08 5.21799 8.50779C5.40973 8.88414 5.71569 9.19011 6.09202 9.38185C6.51985 9.59983 7.07988 9.59983 8.2 9.59983H10.6"
        stroke="white"
        strokeWidth="2"
      />
      <rect x="13.8" y="8" width="3.2" height="3.2" rx="1.6" transform="rotate(90 13.8 8)" fill="white" stroke="white" strokeWidth="2" />
      <rect x="17" y="14.3999" width="3.2" height="3.2" rx="1.6" transform="rotate(90 17 14.3999)" fill="white" stroke="white" strokeWidth="2" />
    </svg>
  );
}
