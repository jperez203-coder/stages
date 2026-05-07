type Props = { size?: number; className?: string };

export function WorkspaceIcon({ size = 20, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="60 60 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block" }}
    >
      <rect x="98" y="60" width="27" height="201" rx="13.5" fill="#DF1E5A" />
      <rect x="195" y="60" width="27" height="201" rx="13.5" fill="#E273C1" />
      <rect x="63" y="102" width="194" height="20" rx="10" fill="#21B159" />
      <rect x="63" y="188" width="194" height="20" rx="10" fill="#36C5EF" />
    </svg>
  );
}
