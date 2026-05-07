"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { WorkspaceIcon } from "@/components/icons/WorkspaceIcon";
import type { Workspace } from "@/types/stages";

type Props = {
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  onSwitch: (id: string) => void;
  onCreateNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export function WorkspaceSwitcher({
  workspaces, activeWorkspace, onSwitch, onCreateNew, onRename, onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const startEdit = (ws: Workspace) => {
    setEditingId(ws.id);
    setEditValue(ws.name);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue);
    }
    setEditingId(null);
    setEditValue("");
  };

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 transition-colors"
        style={{
          background: "#212124",
          border: "1px solid #36363A",
          borderRadius: "8px",
          padding: "0 12px",
          height: "36px",
          color: "#E4E4E7",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#28282C")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#212124")}
      >
        <WorkspaceIcon size={16} />
        <span className="text-[13px] font-semibold max-w-[140px] truncate">
          {activeWorkspace.name}
        </span>
        <ChevronDown
          size={12}
          className="text-zinc-500"
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 mt-2 fade-in z-50"
          style={{
            width: "280px",
            background: "#1A1A1A",
            border: "1px solid #36363A",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}
        >
          <div className="px-3 py-2.5 border-b border-zinc-800">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">
              Your workspaces
            </div>
          </div>
          <div className="py-1 max-h-[260px] overflow-y-auto scrollbar-thin">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspace.id;
              const isEditing = editingId === ws.id;
              return (
                <div key={ws.id} className="px-2 group">
                  {isEditing ? (
                    <div className="flex items-center gap-2 px-2 py-2">
                      <WorkspaceIcon size={18} />
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditValue("");
                          }
                        }}
                        className="flex-1 text-[13px] font-medium"
                        style={{
                          background: "#212124",
                          border: "1px solid #108CE9",
                          borderRadius: "6px",
                          padding: "4px 8px",
                          color: "#E4E4E7",
                          outline: "none",
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors"
                      style={{ background: isActive ? "#212124" : "transparent" }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = "#1F1F22";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() => {
                        onSwitch(ws.id);
                        setOpen(false);
                      }}
                    >
                      <WorkspaceIcon size={18} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{ws.name}</div>
                      </div>
                      {isActive && (
                        <Check
                          size={13}
                          className="flex-shrink-0"
                          style={{ color: "#3BA5EE" }}
                          strokeWidth={3}
                        />
                      )}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(ws);
                          }}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200"
                          title="Rename"
                        >
                          <Pencil size={11} />
                        </button>
                        {workspaces.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                confirm(
                                  `Delete workspace "${ws.name}"? All clients in this workspace will be removed.`,
                                )
                              ) {
                                onDelete(ws.id);
                                setOpen(false);
                              }
                            }}
                            className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-rose-400"
                            title="Delete"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-zinc-800 p-1">
            <button
              onClick={() => {
                setOpen(false);
                onCreateNew();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium text-zinc-300 transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1F1F22")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{ background: "transparent" }}
            >
              <Plus size={14} strokeWidth={2.5} /> Create new workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
