type Props = { size?: number; className?: string };

export function DocIcon({ size = 28, className = "" }: Props) {
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
      <rect width="28" height="28" rx="5" fill="#0082F1" />
      <rect x="6" y="7" width="16" height="3" rx="1.5" fill="white" />
      <rect x="6" y="13" width="16" height="3" rx="1.5" fill="white" />
      <rect x="6" y="19" width="12" height="3" rx="1.5" fill="white" />
    </svg>
  );
}
