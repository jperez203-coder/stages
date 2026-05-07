import { StagesLogo } from "@/components/icons/StagesLogo";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center dotted-grid px-6">
      <div className="fade-in flex flex-col items-center gap-6 text-center">
        <StagesLogo size={64} />
        <h1 className="text-5xl font-extrabold tracking-tight text-stages-text">
          Stages
        </h1>
        <p className="max-w-md text-base leading-relaxed text-stages-muted">
          The operating system for client services businesses.
        </p>
      </div>

      <div className="absolute bottom-6 flex items-center gap-2 text-[11px] text-stages-subtle">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-stages-green" />
        <span>v0.1 · scaffolded — migrating from prototype</span>
      </div>
    </main>
  );
}
