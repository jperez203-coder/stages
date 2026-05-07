import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  label: string;
  value: number;
  accent: string;
};

export function Stat({ icon, label, value, accent }: Props) {
  return (
    <div
      className="flex items-center gap-4 transition-colors"
      style={{
        background: "#2C2C2F",
        border: "1px solid #36363A",
        borderRadius: "12px",
        padding: "18px 20px",
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "10px",
          background: accent + "1F",
          color: accent,
          border: `1px solid ${accent}33`,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-zinc-400 truncate">{label}</div>
        <div className="text-2xl font-semibold mt-0.5">{value}</div>
      </div>
    </div>
  );
}
