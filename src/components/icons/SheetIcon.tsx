type Props = { size?: number; className?: string };

export function SheetIcon({ size = 28, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block" }}
    >
      <rect width="28" height="28" rx="5" fill="#16A05D" />
      <rect x="5" y="7.03516" width="18" height="15" rx="2" stroke="white" strokeWidth="2" />
      <rect x="6" y="11.0352" width="16" height="2" fill="white" />
      <rect x="6" y="16.0352" width="16" height="2" fill="white" />
      <rect x="13" y="8.03516" width="2" height="13" fill="white" />
    </svg>
  );
}
