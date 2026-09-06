"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MoreHorizontal, Star, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import { DocEditor, repairMergedBlocks, type DocContent } from "@/components/documents/DocEditor";
import { SheetEditor, type SheetContent } from "@/components/documents/SheetEditor";
import { DocIcon } from "@/components/icons/DocIcon";
import { SheetIcon } from "@/components/icons/SheetIcon";

/**
 * /w/[slug]/d/[doc-id] — minimal doc/sheet editor.
 *
 * Client component (same pattern as settings/team/page.tsx): fetches the
 * document row directly via the browser Supabase client and lets RLS
 * (documents_select: is_workspace_member) decide access — no separate
 * workspace-membership check needed here. A doc-id that doesn't exist or
 * that RLS hides comes back as "not found," which is the correct UX either
 * way (no data leak about which case it was).
 *
 * Autosave: title + content debounce 800ms after the last edit, then a
 * single PATCH-style update. No manual save button — matches the rest of
 * the app's autosave conventions (stage/task edits).
 *
 * Header is a two-row layout per Figma V2:
 *   1. Breadcrumb bar (folder name / icon + title, star toggle, "..." menu)
 *   2. Big editable title + body, centered in the content column
 *
 * Starring is per-user (document_stars table, 20260906120000) — not a
 * shared flag on the document. The sidebar's "Starred" section is still a
 * static placeholder (no schema wired to it yet); this only persists the
 * toggle itself, per Jordan's explicit ask. Wiring the Starred section to
 * actually list these is a separate follow-up.
 */

type DocumentRow = {
  id: string;
  workspace_id: string;
  folder_id: string;
  title: string;
  type: "doc" | "sheet";
  content: DocContent | SheetContent;
};

type LoadState = "loading" | "ready" | "not_found" | "error";

export default function DocumentPage() {
  const params = useParams();
  const router = useRouter();
  const session = useSession();
  const slug = typeof params?.slug === "string" ? params.slug : null;
  const docId =
    typeof params?.["doc-id"] === "string" ? (params["doc-id"] as string) : null;

  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [isStarred, setIsStarred] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace(`/auth/signin?next=/w/${slug ?? ""}/d/${docId ?? ""}`);
    }
  }, [session.status, router, slug, docId]);

  useEffect(() => {
    if (session.status !== "authenticated" || !docId) return;
    let cancelled = false;
    void (async () => {
      const [docRes, starRes] = await Promise.all([
        supabase
          .from("documents")
          .select(
            "id, workspace_id, folder_id, title, type, content, folder:sidebar_folders(name)",
          )
          .eq("id", docId)
          .maybeSingle(),
        supabase
          .from("document_stars")
          .select("document_id")
          .eq("document_id", docId)
          .eq("user_id", session.user.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      if (docRes.error) {
        console.error("[document] fetch failed:", docRes.error.message);
        setLoadState("error");
        return;
      }
      if (!docRes.data) {
        setLoadState("not_found");
        return;
      }
      const folderRaw = docRes.data.folder as unknown;
      const folderObj = (Array.isArray(folderRaw) ? folderRaw[0] : folderRaw) as
        | { name: string }
        | undefined;
      const docRow = docRes.data as DocumentRow;
      // Legacy docs saved before blocks carried a stable `id` (needed for
      // reliable Enter/Backspace — see DocEditor.tsx) get one assigned on
      // load. Harmless no-op for docs that already have ids. Also repairs
      // blocks saved before the paste fix, where a multi-paragraph paste
      // landed as one block with paragraphs merged together internally —
      // that's what made Enter (correctly splitting at the caret) still
      // land inside existing text instead of a blank line, since the
      // "after" half was itself still several paragraphs glued together.
      if (docRow.type === "doc") {
        const raw = docRow.content as DocContent;
        const withIds = (raw.blocks?.length ? raw.blocks : [{ type: "p" as const, text: "" }]).map((b) => ({
          id: (b as { id?: string }).id ?? crypto.randomUUID(),
          type: b.type,
          text: b.text,
        }));
        docRow.content = { blocks: repairMergedBlocks(withIds) };
      }
      setDoc(docRow);
      setFolderName(folderObj?.name ?? null);
      setTitle(docRes.data.title);
      setIsStarred(Boolean(starRes.data));
      setLoadState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [session.status, docId]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(
    (patch: { title?: string; content?: DocContent | SheetContent }) => {
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (!docId) return;
        const { error } = await supabase.from("documents").update(patch).eq("id", docId);
        if (error) {
          console.error("[document] save failed:", error.message);
          setSaveState("idle");
          return;
        }
        setSaveState("saved");
      }, 800);
    },
    [docId],
  );

  const handleTitleChange = (value: string) => {
    setTitle(value);
    scheduleSave({ title: value || "Untitled" });
  };

  const handleContentChange = (content: DocContent | SheetContent) => {
    if (!doc) return;
    setDoc({ ...doc, content });
    scheduleSave({ content });
  };

  const toggleStar = async () => {
    if (!doc || session.status !== "authenticated") return;
    const next = !isStarred;
    setIsStarred(next);
    const { error } = next
      ? await supabase
          .from("document_stars")
          .insert({ document_id: doc.id, user_id: session.user.id, workspace_id: doc.workspace_id })
      : await supabase
          .from("document_stars")
          .delete()
          .eq("document_id", doc.id)
          .eq("user_id", session.user.id);
    if (error) {
      console.error("[document] star toggle failed:", error.message);
      setIsStarred(!next);
    }
  };

  const handleDelete = async () => {
    if (!doc) return;
    setMenuOpen(false);
    if (!confirm(`Delete "${title || "Untitled"}"? This can't be undone.`)) return;
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) {
      console.error("[document] delete failed:", error.message);
      return;
    }
    router.push(slug ? `/w/${slug}` : "/");
  };

  if (loadState === "loading" || session.status === "loading") {
    return <div className="dotted-grid flex-1" />;
  }

  if (loadState === "not_found") {
    return (
      <div className="dotted-grid flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-[14px]" style={{ color: "#71717A" }}>
            This document doesn&apos;t exist or you don&apos;t have access to it.
          </p>
          <button
            type="button"
            onClick={() => router.push(slug ? `/w/${slug}` : "/")}
            className="btn-ghost mt-4"
          >
            Back to workspace
          </button>
        </div>
      </div>
    );
  }

  if (loadState === "error" || !doc) {
    return (
      <div className="dotted-grid flex-1 flex items-center justify-center">
        <p className="text-[14px]" style={{ color: "#F43F5E" }}>
          Couldn&apos;t load this document.
        </p>
      </div>
    );
  }

  return (
    <div className="dotted-grid flex-1 flex flex-col min-h-0">
      {/* Breadcrumb bar — folder / icon + title on the left, star + "..." on
          the right. Full width, separated from the content column below by
          a hairline border (matches the panel's own border color). Outside
          the scrollable region below (flex-shrink-0, no overflow of its
          own) so it stays pinned while the document body scrolls. */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 24,
          paddingRight: 16,
          borderBottom: "1px solid #2D2E30",
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => router.push(slug ? `/w/${slug}` : "/")}
            className="transition-colors flex-shrink-0"
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#71717A" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
          >
            {folderName ?? "Home"}
          </button>
          <span style={{ color: "#71717A", fontSize: 14, fontWeight: 500, flexShrink: 0 }}>/</span>
          {doc.type === "doc" ? (
            <DocIcon size={16} className="flex-shrink-0" />
          ) : (
            <SheetIcon size={16} className="flex-shrink-0" />
          )}
          <span className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "#E4E4E7" }}>
            {title || "Untitled"}
          </span>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <span className="text-[11px] mr-1.5" style={{ color: "#71717A" }}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
          </span>

          <button
            type="button"
            onClick={toggleStar}
            aria-label={isStarred ? "Unstar" : "Star"}
            aria-pressed={isStarred}
            className="flex items-center justify-center rounded transition-colors"
            style={{ width: 28, height: 28, background: "transparent", border: "none", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Star
              size={15}
              color={isStarred ? "#F59E0B" : "#979393"}
              fill={isStarred ? "#F59E0B" : "none"}
            />
          </button>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
              aria-expanded={menuOpen}
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 28, height: 28, background: "transparent", border: "none", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <MoreHorizontal size={15} color="#979393" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0"
                  style={{ zIndex: 10 }}
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  className="absolute"
                  style={{
                    right: 0,
                    top: "calc(100% + 4px)",
                    minWidth: 140,
                    background: "#212124",
                    border: "1px solid #2D2E30",
                    borderRadius: 8,
                    overflow: "hidden",
                    zIndex: 20,
                  }}
                >
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="w-full flex items-center gap-2 transition-colors text-left"
                    style={{ padding: "8px 10px", background: "transparent", border: "none", cursor: "pointer", fontSize: 13, color: "#F43F5E" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#28282C")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-[1180px] px-20 py-10 w-full">
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled"
            className="w-full outline-none bg-transparent"
            style={{ fontSize: 26, fontWeight: 700, color: "#E4E4E7" }}
          />

          <div className="mt-6">
            {doc.type === "doc" ? (
              <DocEditor content={doc.content as DocContent} onChange={handleContentChange} />
            ) : (
              <SheetEditor content={doc.content as SheetContent} onChange={handleContentChange} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
