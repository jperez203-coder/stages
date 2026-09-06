type Props = { size?: number; className?: string };

export function ProjectsTabIcon({ size = 22, className = "" }: Props) {
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
      <rect width="22" height="22" rx="5" fill="#6B60C9" />
      <path d="M5 3.99963V11.9996C5 13.8853 5 14.8281 5.58579 15.4138C6.17157 15.9996 7.11438 15.9996 9 15.9996H13.8" stroke="white" strokeWidth="2" />
      <path
        d="M5 6.39966C5 7.51976 5 8.07982 5.21799 8.50764C5.40973 8.88396 5.71569 9.18992 6.09202 9.38167C6.51984 9.59966 7.0799 9.59966 8.2 9.59966H10.6"
        stroke="white"
        strokeWidth="2"
      />
      <rect x="13.8" y="7.99963" width="3.2" height="3.2" rx="1.6" transform="rotate(90 13.8 7.99963)" fill="white" stroke="white" strokeWidth="2" />
      <rect x="17" y="14.3997" width="3.2" height="3.2" rx="1.6" transform="rotate(90 17 14.3997)" fill="white" stroke="white" strokeWidth="2" />
    </svg>
  );
}
