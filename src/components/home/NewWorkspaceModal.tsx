"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { WorkspaceIcon } from "@/components/icons/WorkspaceIcon";

type Props = {
  onCreate: (name: string) => void;
  onCancel: () => void;
};

export function NewWorkspaceModal({ onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  const submit = () => { if (name.trim()) onCreate(name.trim()); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div className="panel-card p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[13px] text-zinc-400">Workspace</div>
            <h2 className="text-xl font-semibold mt-1">Create a new workspace</h2>
          </div>
          <button onClick={onCancel} className="icon-btn"><X size={14} /></button>
        </div>
        <p className="text-[13px] text-zinc-500 mt-3 mb-4 leading-relaxed">
          Workspaces let you group separate sets of clients — for example, one for each agency you
          run, or different brands you manage.
        </p>
        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">Workspace name</span>
        </label>
        <div
          className="flex items-center gap-2 mb-5"
          style={{
            background: "#212124",
            border: "1px solid #36363A",
            borderRadius: "8px",
            padding: "8px 10px",
          }}
        >
          <WorkspaceIcon size={20} />
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Acme Agency"
            className="flex-1"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#E4E4E7",
              fontSize: "14px",
            }}
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={!name.trim()} className="btn-primary">
            Create Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
