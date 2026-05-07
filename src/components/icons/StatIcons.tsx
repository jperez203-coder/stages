type Props = { size?: number; color?: string };

export function ClientsIcon({ size = 22, color = "#3BA5EE" }: Props) {
  return (
    <svg width={size} height={size} viewBox="60 60 214 214" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <circle cx="167" cy="125" r="42" stroke={color} strokeWidth="20" />
      <path d="M97 245 C 97 200, 132 180, 167 180 C 202 180, 237 200, 237 245" stroke={color} strokeWidth="20" strokeLinecap="round" />
    </svg>
  );
}

export function ClockIcon({ size = 22, color = "#F59E0C" }: Props) {
  return (
    <svg width={size} height={size} viewBox="60 60 214 214" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <circle cx="167" cy="167" r="85" stroke={color} strokeWidth="20" />
      <path d="M167 118.426V166.747C167 166.885 167.112 166.997 167.25 166.997H203.429" stroke={color} strokeWidth="20" strokeLinecap="round" />
    </svg>
  );
}

export function ChartIcon({ size = 22, color = "#15B981" }: Props) {
  return (
    <svg width={size} height={size} viewBox="20 80 270 180" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <path d="M251.149 120.333L158.37 214.609C157.978 215.007 157.336 215.007 156.944 214.609L111.623 168.557C111.231 168.159 110.589 168.159 110.198 168.557L32.9999 247" stroke={color} strokeWidth="25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M190 99.8327L274.736 100.268L264.369 184.369" stroke={color} strokeWidth="25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
