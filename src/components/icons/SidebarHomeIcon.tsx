type Props = { size?: number; className?: string; color?: string };

/**
 * Exact Figma "Home" icon for the sidebar nav row, replacing lucide's
 * Home. Native viewBox is 22x24 (not square), so `size` sets the height
 * and width is derived proportionally — same pattern as the other
 * Figma-supplied icon components (e.g. TaskTabIcon). `color` overrides
 * the baked-in fill — NavRow passes white for the active row, #BCBAB6
 * (the default, matching the fill Jordan supplied) otherwise.
 */
export function SidebarHomeIcon({ size = 16, className = "", color = "#BCBAB6" }: Props) {
  const height = size;
  const width = (size * 22) / 24;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 22 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block" }}
    >
      <path
        d="M7 23.5837H1.5C0.671573 23.5837 0 22.9122 0 22.0837V8.8203C0 8.35575 0.21524 7.91742 0.582829 7.63337L10.0562 0.313078C10.6087 -0.113879 11.3827 -0.103103 11.9232 0.339069L21.4499 8.13362C21.7981 8.41852 22 8.84466 22 9.29456V22.0837C22 22.9122 21.3284 23.5837 20.5 23.5837H15C14.1716 23.5837 13.5 22.9122 13.5 22.0837V17.0837C13.5 16.2553 12.8284 15.5837 12 15.5837H10C9.17157 15.5837 8.5 16.2553 8.5 17.0837V22.0837C8.5 22.9122 7.82843 23.5837 7 23.5837Z"
        fill={color}
      />
    </svg>
  );
}
