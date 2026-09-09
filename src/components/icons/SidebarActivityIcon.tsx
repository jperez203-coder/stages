type Props = { size?: number; className?: string; color?: string };

/**
 * Exact Figma "Activity" (bell) icon for the sidebar nav row. Native
 * viewBox is 23x25 (not square), so `size` sets the height and width is
 * derived proportionally — same pattern as SidebarHomeIcon. `color`
 * overrides the baked-in fill/stroke — NavRow passes white for the
 * active row, #BCBAB6 (the default, matching the fill Jordan supplied)
 * otherwise.
 */
export function SidebarActivityIcon({ size = 16, className = "", color = "#BCBAB6" }: Props) {
  const height = size;
  const width = (size * 23) / 25;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 23 25"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block" }}
    >
      <path
        d="M4.40059 7.07325C4.78734 3.6151 7.71121 1 11.1909 1C14.6706 1 17.5945 3.6151 17.9812 7.07325L18.2835 9.77595C18.329 10.1823 18.3517 10.3855 18.3843 10.5851C18.5268 11.4577 18.813 12.3005 19.2313 13.0795C19.327 13.2577 19.4326 13.4327 19.644 13.7827L20.3587 14.9661C21.1707 16.3106 21.5767 16.9829 21.2897 17.4914C21.0027 18 20.2174 18 18.6466 18H3.73519C2.16447 18 1.37912 18 1.09214 17.4914C0.805172 16.9829 1.21117 16.3106 2.02317 14.9661L2.73783 13.7827C2.94919 13.4327 3.05488 13.2577 3.15058 13.0795C3.56879 12.3005 3.85499 11.4577 3.99754 10.5851C4.03016 10.3855 4.05288 10.1823 4.09833 9.77595L4.40059 7.07325Z"
        fill={color}
        stroke={color}
        strokeWidth="2"
      />
      <path
        d="M6.19092 19C6.19092 19.6566 6.30731 20.3068 6.53346 20.9134C6.75961 21.52 7.09107 22.0712 7.50894 22.5355C7.9268 22.9998 8.42288 23.3681 8.96884 23.6194C9.51481 23.8707 10.1 24 10.6909 24C11.2819 24 11.867 23.8707 12.413 23.6194C12.959 23.3681 13.455 22.9998 13.8729 22.5355C14.2908 22.0712 14.6222 21.52 14.8484 20.9134C15.0745 20.3068 15.1909 19.6566 15.1909 19"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
