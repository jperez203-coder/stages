type Props = { size?: number; className?: string };

export function TaskTabIcon({ size = 22, className = "" }: Props) {
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
      <rect width="22" height="22" rx="5" fill="#488E5A" />
      <rect x="4" y="3" width="13.1765" height="16" rx="2" fill="white" />
      <path
        d="M7.76465 7.70587H13.4117M7.76465 11.4706H13.4117M7.76465 15.2353H11.5294"
        stroke="#488E5A"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
