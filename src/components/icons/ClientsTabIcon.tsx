type Props = { size?: number; className?: string };

export function ClientsTabIcon({ size = 22, className = "" }: Props) {
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
      <path
        d="M0 10C0 5.28595 0 2.92893 1.46447 1.46447C2.92893 0 5.28595 0 10 0H12C16.714 0 19.0711 0 20.5355 1.46447C22 2.92893 22 5.28595 22 10V12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22H10C5.28595 22 2.92893 22 1.46447 20.5355C0 19.0711 0 16.714 0 12V10Z"
        fill="#7B7B7B"
      />
      <circle cx="10.6855" cy="7.5" r="3.5" fill="white" />
      <path
        d="M11.0713 12.4023C14.1947 12.4023 16.7697 14.5436 17.1426 17.3096C15.9673 17.9973 14.1861 18.001 11.0703 18.001C7.95653 18.001 6.17526 17.9979 5 17.3115C5.3719 14.5447 7.94726 12.4025 11.0713 12.4023Z"
        fill="white"
      />
    </svg>
  );
}
