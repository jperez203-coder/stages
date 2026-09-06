type Props = { size?: number; className?: string };

export function DashboardTabIcon({ size = 22, className = "" }: Props) {
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
      <rect width="22" height="22" rx="5" fill="#7B7B7B" />
      <rect x="4" y="4" width="5.44444" height="5.44444" rx="1" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="4" y="12.5555" width="5.44444" height="5.44444" rx="1" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="12.5557" y="4" width="5.44444" height="5.44444" rx="1" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="12.5557" y="12.5555" width="5.44444" height="5.44444" rx="1" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
