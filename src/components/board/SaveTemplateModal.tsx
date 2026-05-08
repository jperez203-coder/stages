"use client";

import { useState } from "react";
import { Bookmark, X } from "lucide-react";
import type { Client } from "@/types/stages";

type Props = {
  client: Client;
  onSave: (name: string, includeTasks: boolean) => void;
  onClose: () => void;
};

function SaveTemplateOption({
  selected,
  onSelect,
  title,
  subtitle,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left flex items-start gap-3 p-3 rounded-lg transition-all"
      style={{
        background: selected ? "#1C1C26" : "#1A1A1C",
        border: `1px solid ${selected ? "#108CE9" : "#36363A"}`,
        boxShadow: selected ? "0 0 0 3px rgba(16,140,233,0.15)" : "none",
        cursor: "pointer",
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          border: `2px solid ${selected ? "#108CE9" : "#4A4A50"}`,
          background: selected ? "#108CE9" : "transparent",
        }}
      >
        {selected && (
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "white" }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[11px] mt-0.5" style={{ color: "#979393" }}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}

export function SaveTemplateModal({ client, onSave, onClose }: Props) {
  const [name, setName] = useState(`${client.name} template`);
  const [includeTasks, setIncludeTasks] = useState(true);
  const totalTasks = client.stages.reduce((a, s) => a + s.tasks.length, 0);

  const submit = () => {
    if (name.trim()) onSave(name.trim(), includeTasks);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div className="panel-card p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[13px]" style={{ color: "#979393" }}>Save as template</div>
            <h2 className="text-xl font-semibold mt-1">Reuse this pipeline</h2>
          </div>
          <button onClick={onClose} className="icon-btn"><X size={14} /></button>
        </div>

        <p
          className="text-[13px] mt-3 mb-5 leading-relaxed"
          style={{ color: "#979393" }}
        >
          Save this pipeline&apos;s structure to your templates so you can spin up new pipelines
          just like it.
        </p>

        <label className="block mb-4">
          <span className="text-[13px] block mb-1.5" style={{ color: "#979393" }}>
            Template name
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="field"
            placeholder="My pipeline template"
          />
        </label>

        <div className="mb-5">
          <div className="text-[13px] mb-2" style={{ color: "#979393" }}>
            What to include
          </div>
          <div className="space-y-2">
            <SaveTemplateOption
              selected={!includeTasks}
              onSelect={() => setIncludeTasks(false)}
              title="Stage names only"
              subtitle={`${client.stages.length} stages · clean structure to fill in later`}
            />
            <SaveTemplateOption
              selected={includeTasks}
              onSelect={() => setIncludeTasks(true)}
              title="Stages + tasks"
              subtitle={`${client.stages.length} stages · ${totalTasks} tasks · full reusable workflow`}
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="btn-primary"
          >
            <Bookmark size={13} strokeWidth={2.5} /> Save Template
          </button>
        </div>
      </div>
    </div>
  );
}
