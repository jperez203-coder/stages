import { CheckCircle2 } from "lucide-react";

type Props = {
  message: string;
  type?: "success" | "info";
};

const COLORS = {
  success: { bg: "#15B98115", border: "#15B98144", icon: "#15B981", text: "#34D399" },
  info: { bg: "#108CE915", border: "#108CE944", icon: "#3BA5EE", text: "#7EC2F4" },
};

export function Toast({ message, type = "success" }: Props) {
  const c = COLORS[type] || COLORS.success;
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 fade-in"
      style={{
        background: "#1A1A1C",
        border: `1px solid ${c.border}`,
        borderRadius: "10px",
        padding: "12px 16px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        maxWidth: "min(420px, calc(100vw - 32px))",
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0 rounded-full"
        style={{ width: "20px", height: "20px", background: c.bg, color: c.icon }}
      >
        <CheckCircle2 size={14} strokeWidth={2.5} />
      </div>
      <div className="text-[13px] font-medium" style={{ color: c.text }}>
        {message}
      </div>
    </div>
  );
}
