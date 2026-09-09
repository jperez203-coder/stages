"use client";

import { cloneElement, isValidElement, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DocIcon } from "@/components/icons/DocIcon";
import { SheetIcon } from "@/components/icons/SheetIcon";
import { SidebarChevron } from "@/components/icons/SidebarChevron";
import { SidebarHomeIcon } from "@/components/icons/SidebarHomeIcon";
import { SidebarActivityIcon } from "@/components/icons/SidebarActivityIcon";
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
  const pathname = usePathname();
  const homeHref = workspaceSlug ? `/w/${workspaceSlug}` : "/";
  const activityHref = workspaceSlug ? `/w/${workspaceSlug}/activity` : "/";
  // Home is only "active" on the exact workspace root — every other
  // /w/[slug]/* route (tasks, activity, a pipeline, a doc) has its own
  // nav row (or none yet) and shouldn't leave Home looking selected.
  // Home covers its own sub-tabs too (Dashboard/Task/Projects/Clients —
  // see HomeTabs.tsx), so the sidebar row stays highlighted while on any
  // of them, not just the bare workspace root.
  const homeSubTabs = ["tasks", "projects", "clients"];
  const isHomeActive =
    pathname === homeHref || homeSubTabs.some((tab) => pathname === `${homeHref}/${tab}`);
  const isActivityActive = pathname === activityHref || (pathname?.startsWith(`${activityHref}/`) ?? false);
  const [folders, setFolders] = useState<SidebarFolder[]>([]);
  const [documents, setDocuments] = useState<SidebarDocument[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [openFolderMenu, setOpenFolderMenu] = useState<string | null>(null);
  const [openDocMenu, setOpenDocMenu] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [foldersOpen, setFoldersOpen] = useState(true);

  useEffect(() => {
    if (!openFolderMenu && !openDocMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-row-menu]")) {
        setOpenFolderMenu(null);
        setOpenDocMenu(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [openFolderMenu, openDocMenu]);
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
        ? { blocks: [{ id: crypto.randomUUID(), type: "p", text: "" }] }
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

  // Deleting a folder cascades to its documents at the DB level
  // (documents.folder_id references sidebar_folders(id) on delete cascade —
  // see 20260904120000_sidebar_folders_and_documents.sql), so the confirm
  // copy says so explicitly rather than silently losing docs.
  const deleteFolder = async (folder: SidebarFolder) => {
    setOpenFolderMenu(null);
    const docCount = documents.filter((d) => d.folder_id === folder.id).length;
    const warning =
      docCount > 0
        ? `Delete "${folder.name}"? This will also delete the ${docCount} doc${docCount === 1 ? "" : "s"} inside it. This cannot be undone.`
        : `Delete "${folder.name}"? This cannot be undone.`;
    if (!confirm(warning)) return;
    const { error } = await supabase.from("sidebar_folders").delete().eq("id", folder.id);
    if (error) {
      console.error("[sidebar] deleteFolder failed:", error.message);
      return;
    }
    setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    setDocuments((prev) => prev.filter((d) => d.folder_id !== folder.id));
  };

  const deleteDocument = async (doc: SidebarDocument) => {
    setOpenDocMenu(null);
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      console.error("[sidebar] deleteDocument failed:", error.message);
      return;
    }
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
  };

  return (
    <aside
      className="flex-shrink-0 flex flex-col overflow-y-auto font-poppins font-normal"
      style={{
        width: 236,
        background: "#181818",
        borderRight: "1px solid #36363A",
        padding: "10px 10px 16px 10px",
      }}
    >
      <NavRow
        icon={<SidebarHomeIcon size={16} />}
        label="Home"
        href={homeHref}
        active={isHomeActive}
      />
      <NavRow
        icon={<SidebarActivityIcon size={16} />}
        label="Activity"
        href={activityHref}
        active={isActivityActive}
      />

      <div style={{ marginTop: 16 }}>
        <SectionHeader label="Recents" collapsed />
      </div>
      <SectionHeader label="Starred" collapsed />
      <SectionHeader label="Private" collapsed />

      <button
        type="button"
        onClick={() => setProjectsOpen((prev) => !prev)}
        className="w-full flex items-center gap-[10px] rounded-md transition-colors text-left"
        style={{ padding: "6px 8px", marginTop: 16, background: "transparent", border: "none", cursor: "pointer" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <span className="flex items-center justify-center" style={{ width: 15, flexShrink: 0 }}>
          <SidebarChevron open={projectsOpen} size={7} />
        </span>
        <span className="text-[14px] font-normal" style={{ color: "#71717A" }}>
          Projects
        </span>
      </button>
      {projectsOpen && (pipelines.length === 0 ? (
        <div className="px-2 py-1.5 text-[13px]" style={{ color: "#71717A" }}>
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
              className="text-[14px] truncate"
              style={{ color: "#E4E4E7" }}
            >
              {p.name}
            </span>
          </Link>
        ))
      ))}

      <div className="flex items-center justify-between gap-1" style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={() => setFoldersOpen((prev) => !prev)}
          className="flex-1 flex items-center gap-[10px] rounded-md transition-colors text-left min-w-0"
          style={{ padding: "6px 8px", background: "transparent", border: "none", cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span className="flex items-center justify-center" style={{ width: 15, flexShrink: 0 }}>
            <SidebarChevron open={foldersOpen} size={7} />
          </span>
          <span className="text-[14px] font-normal" style={{ color: "#71717A" }}>
            Folders
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setFoldersOpen(true);
            setCreatingFolder(true);
          }}
          aria-label="New folder"
          className="flex items-center justify-center rounded transition-colors flex-shrink-0"
          style={{ width: 20, height: 20, marginRight: 8, background: "transparent", border: "none", cursor: "pointer", color: "#71717A" }}
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
          className="text-[14px] outline-none"
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

      {foldersOpen && loadState === "error" && (
        <div className="px-2 py-1.5 text-[13px]" style={{ color: "#F43F5E" }}>
          Couldn&apos;t load folders
        </div>
      )}

      {foldersOpen && folders.map((folder) => {
        const isOpen = expandedFolders.has(folder.id);
        const folderDocs = documents.filter((d) => d.folder_id === folder.id);
        return (
          <div key={folder.id}>
            <div
              data-row-menu
              className="group relative w-full flex items-center rounded-md transition-colors"
              style={{ padding: "6px 8px", background: "transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <button
                type="button"
                onClick={() => toggleFolder(folder.id)}
                className="flex-1 flex items-center gap-[9px] text-left min-w-0"
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
              >
                {/* Chevron sits in a 16px-wide box (matching DocIcon/
                    SheetIcon's own width below) so the FOLDER NAME text and
                    the DOC TITLE text underneath it start at the same X —
                    the chevron itself is only 7px, so without this the
                    smaller icon left the name reading noticeably further
                    left than the doc titles it's grouping. */}
                <span className="flex items-center justify-center" style={{ width: 17, flexShrink: 0 }}>
                  <SidebarChevron open={isOpen} size={7} />
                </span>
                {/* No `uppercase` here — unlike the static "Projects"/
                    "Folders" section labels, this is the user's own typed
                    folder name and should render exactly as typed (only
                    forced to caps if the user actually typed it in caps). */}
                <span
                  className="text-[14px] truncate"
                  style={{ color: "#71717A", letterSpacing: "0.04em" }}
                >
                  {folder.name}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenFolderMenu((prev) => (prev === folder.id ? null : folder.id));
                }}
                className="flex items-center justify-center rounded transition-opacity flex-shrink-0"
                style={{
                  width: 20,
                  height: 20,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#BCBAB6",
                  opacity: openFolderMenu === folder.id ? 1 : undefined,
                }}
                title="Folder options"
              >
                <span className={openFolderMenu === folder.id ? "" : "opacity-0 group-hover:opacity-100 transition-opacity"}>
                  <MoreHorizontal size={14} />
                </span>
              </button>
              {openFolderMenu === folder.id && (
                <div
                  className="absolute z-10 rounded-md"
                  style={{
                    top: "calc(100% + 2px)",
                    right: 4,
                    background: "#18181B",
                    border: "1px solid #2D2E30",
                    minWidth: 160,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                    padding: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFolder(folder);
                    }}
                    className="w-full flex items-center gap-2 rounded text-left text-[13px] transition-colors"
                    style={{ padding: "6px 8px", background: "transparent", border: "none", cursor: "pointer", color: "#F43F5E" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Trash2 size={13} />
                    Delete folder
                  </button>
                </div>
              )}
            </div>
            {isOpen && (
              <>
                {folderDocs.map((doc) => {
                  const docHref = workspaceSlug ? `/w/${workspaceSlug}/d/${doc.id}` : "#";
                  const isDocActive = pathname === docHref;
                  return (
                  <div
                    key={doc.id}
                    data-row-menu
                    className="group relative flex items-center rounded-md transition-colors"
                    style={{ padding: "6px 8px", background: isDocActive ? "#232326" : "transparent" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = isDocActive ? "#232326" : "transparent")}
                  >
                    <Link
                      href={docHref}
                      className="flex-1 flex items-center gap-[9px] min-w-0"
                    >
                      {doc.type === "doc" ? (
                        <DocIcon size={17} className="flex-shrink-0" />
                      ) : (
                        <SheetIcon size={17} className="flex-shrink-0" />
                      )}
                      <span className="text-[14px] truncate" style={{ color: isDocActive ? "#FFFFFF" : "#BCBAB6" }}>
                        {doc.title}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setOpenDocMenu((prev) => (prev === doc.id ? null : doc.id));
                      }}
                      className="flex items-center justify-center rounded transition-opacity flex-shrink-0"
                      style={{
                        width: 20,
                        height: 20,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "#BCBAB6",
                        opacity: openDocMenu === doc.id ? 1 : undefined,
                      }}
                      title="Document options"
                    >
                      <span className={openDocMenu === doc.id ? "" : "opacity-0 group-hover:opacity-100 transition-opacity"}>
                        <MoreHorizontal size={14} />
                      </span>
                    </button>
                    {openDocMenu === doc.id && (
                      <div
                        className="absolute z-10 rounded-md"
                        style={{
                          top: "calc(100% + 2px)",
                          right: 4,
                          background: "#18181B",
                          border: "1px solid #2D2E30",
                          minWidth: 160,
                          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                          padding: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteDocument(doc);
                          }}
                          className="w-full flex items-center gap-2 rounded text-left text-[13px] transition-colors"
                          style={{ padding: "6px 8px", background: "transparent", border: "none", cursor: "pointer", color: "#F43F5E" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
                <div className="flex items-center gap-3" style={{ padding: "4px 8px 8px 8px" }}>
                  <button
                    type="button"
                    onClick={() => createDocument(folder.id, "doc")}
                    className="flex items-center gap-1 text-[13px] transition-colors"
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "#71717A" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
                  >
                    <Plus size={11} /> Doc
                  </button>
                  <button
                    type="button"
                    onClick={() => createDocument(folder.id, "sheet")}
                    className="flex items-center gap-1 text-[13px] transition-colors"
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
  const tint = active ? "#FFFFFF" : "#BCBAB6";
  return (
    <Link
      href={href}
      className="flex items-center gap-[10px] rounded-md transition-colors"
      style={{
        padding: "6px 8px",
        background: active ? "#2C2C2F" : "transparent",
        color: tint,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "#232326";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* -2px nudge: the icon's SVG viewBox centers slightly lower than
          the label's text line-box, so flex's items-center alone left it
          reading as sitting too low next to "Home". Icon color injected
          via cloneElement since `icon` arrives as an already-built
          element, not a component reference — white when this row is
          the active route, #BCBAB6 otherwise. */}
      <span className="flex items-center" style={{ marginTop: -2 }}>
        {isValidElement<{ color?: string }>(icon) ? cloneElement(icon, { color: tint }) : icon}
      </span>
      <span className="text-[14px] font-normal">{label}</span>
    </Link>
  );
}

function SectionHeader({ label, collapsed }: { label: string; collapsed?: boolean }) {
  return (
    <div
      className="flex items-center gap-[10px] rounded-md transition-colors"
      style={{ padding: "7px 8px" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* Chevron sits in the same fixed-width box as the Home/Activity
          icon span above so this label starts at the exact same X as
          those rows' text, matching NavRow's icon-width + gap-[10px]. */}
      <span className="flex items-center justify-center" style={{ width: 15, flexShrink: 0 }}>
        <SidebarChevron open={false} size={7} style={{ opacity: collapsed ? 1 : 0 }} />
      </span>
      <span className="text-[14px] font-normal" style={{ color: "#71717A" }}>
        {label}
      </span>
    </div>
  );
}
