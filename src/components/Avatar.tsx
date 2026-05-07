type Props = {
  email: string;
  title?: string;
  /** Size unit — final dimensions are `size * 4`px. Defaults to 7 (28px). */
  size?: number;
  shape?: "square" | "round";
};

const COLORS = ["#3BA5EE", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4", "#F43F5E"];

function colorFor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function Avatar({ email, title, size = 7, shape = "square" }: Props) {
  const safeEmail = email || "";
  const initial = (safeEmail || "?").charAt(0).toUpperCase();
  const color = colorFor(safeEmail);
  const radius = shape === "square" ? Math.max(6, size * 0.9) : 9999;
  return (
    <div
      title={title || email}
      className="flex items-center justify-center font-semibold flex-shrink-0"
      style={{
        width: size * 4,
        height: size * 4,
        fontSize: size * 1.5,
        background: color + "33",
        color,
        border: shape === "square" ? "none" : `2px solid #212124`,
        borderRadius: radius,
      }}
    >
      {initial}
    </div>
  );
}
