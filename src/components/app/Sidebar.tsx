"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home,
  ChevronRight,
  ChevronDown,
  Plus,
  FileText,
  Table as TableIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { HeaderSearchPipeline } from "@/components/app/HeaderSearch";

/**
 * Persistent left sidebar — the Notion-style rail from Figma "Stages UI V2".
 * Mounted inside AppShell alongside the existing top header; this is new
 * layout surface, not a replacement for the header.
 *
 * SCOPE NOTE for this pass: the Figma also shows "Chat" and "Files" as
 * Home-level sidebar items. Today those only exist PER-PIPELINE
 * (/w/[slug]/p/[id]/chat, /files) — there's no cross-project chat inbox or
 * files view yet. Rather than ship dead links or fake functionality, this
 * component omits them until that's actually scoped. Recents/Starred/
 * Private are rendered per Jordan's explicit go-ahead to keep them as
 * static, inert sections for now — no starred/recents/private schema
 * exists yet, so they're visual-only and not wired to anything.
 *
 * Projects list + custom folders/docs ARE fully functional:
 *   - Projects: reuses the SAME pipelines list AppShell already fetches for
 *     header search (passed down as a prop) — no duplicate query. RLS on
 *     `pipelines` (tightened 2026-09-05) already scopes this to exactly
 *     what the signed-in user can see, so no client-side filtering needed.
 *   - Folders/documents: fetched here directly from the new
 *     sidebar_folders/documents tables (workspace-wide, not pipeline-scoped
 *     — see 20260904120000_sidebar_folders_and_documents.sql).
 */

type SidebarFolder = {
  id: string;
  name: string;
  position: number;
};

type SidebarDocument = {
  id: string;
  folder_id: string;
  title: string;
  type: "doc" | "sheet";
};

type Props = {
  workspaceSlug: string | null;
  workspaceId: string | null;
  pipelines: HeaderSearchPipeline[];
};

const PROJECT_ICON_COLORS = ["#F59E0B", "#8B5CF6", "#3BA5EE", "#15B981", "#EC4899", "#F43F5E"];
function pickProjectColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return PROJECT_ICON_COLORS[Math.abs(hash) % PROJECT_ICON_COLORS.length];
}

export function Sidebar({ workspaceSlug, workspaceId, pipelines }: Props) {
  const router = useRouter();
  const [folders, setFolders] = useState<SidebarFolder[]>([]);
  const [documents, setDocuments] = useState<SidebarDocument[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  useEffect(() => {
    if (!workspaceId) {
      setFolders([]);
      setDocuments([]);
      setLoadState("ready");
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    void (async () => {
      const [foldersRes, documentsRes] = await Promise.all([
        supabase
          .from("sidebar_folders")
          .select("id, name, position")
          .eq("workspace_id", workspaceId)
          .order("position", { ascending: true }),
        supabase
          .from("documents")
          .select("id, folder_id, title, type")
          .eq("workspace_id", workspaceId),
      ]);
      if (cancelled) return;
      if (foldersRes.error || documentsRes.error) {
        console.error(
          "[sidebar] folders/documents fetch failed:",
          foldersRes.error?.message,
          documentsRes.error?.message,
        );
        setLoadState("error");
        return;
      }
      setFolders(foldersRes.data ?? []);
      setDocuments(documentsRes.data ?? []);
      // New workspaces start with every folder expanded — nothing to hide yet.
      setExpandedFolders(new Set((foldersRes.data ?? []).map((f) => f.id)));
      setLoadState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !workspaceId) {
      setCreatingFolder(false);
      setNewFolderName("");
      return;
    }
    const nextPosition = folders.length
      ? Math.max(...folders.map((f) => f.position)) + 1
      : 0;
    const { data, error } = await supabase
      .from("sidebar_folders")
      .insert({ workspace_id: workspaceId, name, position: nextPosition })
      .select("id, name, position")
      .single();
    if (error) {
      console.error("[sidebar] createFolder failed:", error.message);
    } else if (data) {
      setFolders((prev) => [...prev, data]);
      setExpandedFolders((prev) => new Set(prev).add(data.id));
    }
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const createDocument = async (folderId: string, type: "doc" | "sheet") => {
    if (!workspaceId) return;
    const defaultContent =
      type === "doc"
        ? { blocks: [{ type: "p", text: "" }] }
        : { columns: ["Column 1", "Column 2"], rows: [] };
    const { data, error } = await supabase
      .from("documents")
      .insert({
        workspace_id: workspaceId,
        folder_id: folderId,
        title: "Untitled",
        type,
        content: defaultContent,
      })
      .select("id, folder_id, title, type")
      .single();
    if (error) {
      console.error("[sidebar] createDocument failed:", error.message);
      return;
    }
    setDocuments((prev) => [...prev, data]);
    if (workspaceSlug) router.push(`/w/${workspaceSlug}/d/${data.id}`);
  };

  return (
    <aside
      className="flex-shrink-0 flex flex-col overflow-y-auto"
      style={{
        width: 236,
        background: "#181818",
        borderRight: "1px solid #36363A",
        padding: "10px 10px 16px 10px",
      }}
    >
      <NavRow
        icon={<Home size={16} />}
        label="Home"
        href={workspaceSlug ? `/w/${workspaceSlug}` : "/"}
        active
      />

      <div style={{ height: 1, background: "#2C2C2F", margin: "10px 6px" }} />

      <SectionHeader label="Recents" collapsed />
      <SectionHeader label="Starred" collapsed />
      <SectionHeader label="Private" collapsed />

      <div style={{ height: 1, background: "#2C2C2F", margin: "10px 6px" }} />

      <div className="flex items-center justify-between px-2 pt-1 pb-0.5">
        <span
          className="text-[11px] font-semibold uppercase"
          style={{ color: "#71717A", letterSpacing: "0.04em" }}
        >
          Projects
        </span>
      </div>
      {pipelines.length === 0 ? (
        <div className="px-2 py-1.5 text-[12px]" style={{ color: "#71717A" }}>
          No projects yet
        </div>
      ) : (
        pipelines.map((p) => (
          <Link
            key={p.id}
            href={workspaceSlug ? `/w/${workspaceSlug}/p/${p.id}` : "#"}
            className="flex items-center gap-[9px] rounded-md transition-colors"
            style={{ padding: "6px 8px" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {p.emoji ? (
              <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{p.emoji}</span>
            ) : (
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: pickProjectColor(p.id),
                  flexShrink: 0,
                }}
              />
            )}
            <span
              className="text-[13px] truncate"
              style={{ color: "#E4E4E7" }}
            >
              {p.name}
            </span>
          </Link>
        ))
      )}

      <div style={{ height: 1, background: "#2C2C2F", margin: "10px 6px" }} />

      <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
        <span
          className="text-[11px] font-semibold uppercase"
          style={{ color: "#71717A", letterSpacing: "0.04em" }}
        >
          Folders
        </span>
        <button
          type="button"
          onClick={() => setCreatingFolder(true)}
          aria-label="New folder"
          className="flex items-center justify-center rounded transition-colors"
          style={{ width: 20, height: 20, background: "transparent", border: "none", cursor: "pointer", color: "#71717A" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Plus size={13} />
        </button>
      </div>

      {creatingFolder && (
        <input
          autoFocus
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onBlur={createFolder}
          onKeyDown={(e) => {
            if (e.key === "Enter") createFolder();
            if (e.key === "Escape") {
              setCreatingFolder(false);
              setNewFolderName("");
            }
          }}
          placeholder="Folder name"
          className="text-[13px] outline-none"
          style={{
            margin: "2px 8px 4px 8px",
            padding: "5px 7px",
            background: "#212124",
            border: "1px solid #108CE9",
            borderRadius: 6,
            color: "#E4E4E7",
          }}
        />
      )}

      {loadState === "error" && (
        <div className="px-2 py-1.5 text-[12px]" style={{ color: "#F43F5E" }}>
          Couldn&apos;t load folders
        </div>
      )}

      {folders.map((folder) => {
        const isOpen = expandedFolders.has(folder.id);
        const folderDocs = documents.filter((d) => d.folder_id === folder.id);
        return (
          <div key={folder.id}>
            <button
              type="button"
              onClick={() => toggleFolder(folder.id)}
              className="w-full flex items-center gap-1.5 rounded-md transition-colors text-left"
              style={{ padding: "6px 8px", background: "transparent", border: "none", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {isOpen ? (
                <ChevronDown size={12} color="#71717A" />
              ) : (
                <ChevronRight size={12} color="#71717A" />
              )}
              <span
                className="text-[11px] font-semibold uppercase truncate"
                style={{ color: "#71717A", letterSpacing: "0.04em" }}
              >
                {folder.name}
              </span>
            </button>
            {isOpen && (
              <>
                {folderDocs.map((doc) => (
                  <Link
                    key={doc.id}
                    href={workspaceSlug ? `/w/${workspaceSlug}/d/${doc.id}` : "#"}
                    className="flex items-center gap-[9px] rounded-md transition-colors"
                    style={{ padding: "6px 8px 6px 24px" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {doc.type === "doc" ? (
                      <FileText size={13} color="#15B981" style={{ flexShrink: 0 }} />
                    ) : (
                      <TableIcon size={13} color="#3BA5EE" style={{ flexShrink: 0 }} />
                    )}
                    <span className="text-[13px] truncate" style={{ color: "#E4E4E7" }}>
                      {doc.title}
                    </span>
                  </Link>
                ))}
                <div className="flex items-center gap-3" style={{ padding: "4px 8px 8px 24px" }}>
                  <button
                    type="button"
                    onClick={() => createDocument(folder.id, "doc")}
                    className="flex items-center gap-1 text-[12px] transition-colors"
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "#71717A" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
                  >
                    <Plus size={11} /> Doc
                  </button>
                  <button
                    type="button"
                    onClick={() => createDocument(folder.id, "sheet")}
                    className="flex items-center gap-1 text-[12px] transition-colors"
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "#71717A" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
                  >
                    <Plus size={11} /> Sheet
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </aside>
  );
}

function NavRow({
  icon,
  label,
  href,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-[10px] rounded-md transition-colors"
      style={{
        padding: "7px 8px",
        background: active ? "#2C2C2F" : "transparent",
        color: "#E4E4E7",
      }}
    >
      {icon}
      <span className="text-[13px] font-medium">{label}</span>
    </Link>
  );
}

function SectionHeader({ label, collapsed }: { label: string; collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" style={{ padding: "7px 8px" }}>
      <ChevronRight size={12} color="#71717A" style={{ opacity: collapsed ? 1 : 0 }} />
      <span className="text-[12px]" style={{ color: "#71717A" }}>
        {label}
      </span>
    </div>
  );
}
