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
      <path
        d="M15.1716 5H11C9.11438 5 8.17157 5 7.58579 5.58579C7 6.17157 7 7.11438 7 9V19C7 20.8856 7 21.8284 7.58579 22.4142C8.17157 23 9.11438 23 11 23H17C18.8856 23 19.8284 23 20.4142 22.4142C21 21.8284 21 20.8856 21 19V10.8284C21 10.4197 21 10.2153 20.9239 10.0315C20.8478 9.84776 20.7032 9.70324 20.4142 9.41421L16.5858 5.58579C16.2968 5.29676 16.1522 5.15224 15.9685 5.07612C15.7847 5 15.5803 5 15.1716 5Z"
        stroke="white"
        strokeWidth="2"
      />
      <path
        d="M15 5V9C15 9.94281 15 10.4142 15.2929 10.7071C15.5858 11 16.0572 11 17 11H21"
        stroke="white"
        strokeWidth="2"
      />
      <rect x="10" y="14" width="8" height="2" fill="white" />
      <rect x="10" y="17" width="8" height="2" fill="white" />
    </svg>
  );
}
