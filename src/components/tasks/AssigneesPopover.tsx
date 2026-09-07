"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import type { TaskAssignee } from "@/components/tasks/types";

/**
 * Assignee picker popover for the task detail panel's Assignees property
 * (Figma V2). Multi-select — clicking a row toggles that person on/off
 * `task_assignees` (additive alongside the legacy single `assignee_id`,
 * same as the rest of the Task tab — see
 * 20260906120000_task_priority_status_assignees.sql). No new RLS needed:
 * task_assignees_insert/delete already gate on can_edit_pipeline, matching
 * the canvas TaskDetailPanel's "Assignee — canEditPipeline only" rule.
 *
 * Assignable people = agency members of THIS TASK'S PIPELINE (role !=
 * 'client'), fetched lazily on open via pipeline_memberships + a batched
 * profiles lookup (no direct FK between the two tables for PostgREST to
 * embed, same reason tasks/page.tsx does its own two-step assignee fetch).
 *
 * The "Search or enter email…" box only FILTERS this already-fetched
 * member list by name/email substring — it does not send an invite. Real
 * invite-by-email is a separate, already-existing flow (Team settings /
 * client invites) and out of scope here.
 */

type Props = {
  anchor: HTMLElement | null;
  pipelineId: string;
  taskId: string;
  currentAssignees: TaskAssignee[];
  onChange: (next: TaskAssignee[]) => void;
  onClose: () => void;
};

type Person = { id: string; displayName: string | null; email: string; avatarUrl: string | null };

const POPOVER_WIDTH = 260;
const POPOVER_HEIGHT = 320;
const GAP = 6;
const VIEWPORT_PAD = 16;

export function AssigneesPopover({ anchor, pipelineId, taskId, currentAssignees, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (!anchor) return;
    const compute = () => {
      const a = anchor.getBoundingClientRect();
      const bottomIfBelow = a.bottom + GAP + POPOVER_HEIGHT;
      const flipUp = bottomIfBelow > window.innerHeight - VIEWPORT_PAD;
      const top = flipUp ? Math.max(VIEWPORT_PAD, a.top - GAP - POPOVER_HEIGHT) : a.bottom + GAP;
      const left = Math.min(a.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD);
      setPosition({ top, left: Math.max(VIEWPORT_PAD, left) });
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchor]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (anchor && anchor.contains(e.target as Node)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: memberships, error: membershipErr } = await supabase
        .from("pipeline_memberships")
        .select("user_id, role")
        .eq("pipeline_id", pipelineId)
        .neq("role", "client");
      if (cancelled) return;
      if (membershipErr) {
        console.error("[assignees] membership fetch failed:", membershipErr.message);
        setPeople([]);
        return;
      }
      const userIds = (memberships ?? []).map((m) => m.user_id);
      if (userIds.length === 0) {
        setPeople([]);
        return;
      }
      const { data: profiles, error: profilesErr } = await supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url")
        .in("id", userIds);
      if (cancelled) return;
      if (profilesErr) {
        console.error("[assignees] profiles fetch failed:", profilesErr.message);
        setPeople([]);
        return;
      }
      setPeople(
        (profiles ?? []).map((p) => ({
          id: p.id,
          displayName: p.display_name,
          email: p.email,
          avatarUrl: p.avatar_url,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [pipelineId]);

  const filtered = useMemo(() => {
    if (!people) return [];
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) => (p.displayName ?? "").toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
    );
  }, [people, query]);

  const assignedIds = new Set(currentAssignees.map((a) => a.id));

  const toggle = async (person: Person) => {
    const isAssigned = assignedIds.has(person.id);
    setPending((prev) => new Set(prev).add(person.id));

    if (isAssigned) {
      onChange(currentAssignees.filter((a) => a.id !== person.id));
      const { error } = await supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", taskId)
        .eq("user_id", person.id);
      if (error) console.error("[assignees] remove failed:", error.message);
    } else {
      onChange([...currentAssignees, { id: person.id, displayName: person.displayName, avatarUrl: person.avatarUrl }]);
      const { error } = await supabase.from("task_assignees").insert({ task_id: taskId, user_id: person.id });
      if (error) console.error("[assignees] add failed:", error.message);
    }
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(person.id);
      return next;
    });
  };

  if (!position || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Assign people"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fade-in"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 60,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_HEIGHT,
        display: "flex",
        flexDirection: "column",
        background: "#18181B",
        border: "1px solid #2D2E30",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        padding: 8,
      }}
    >
      <div
        className="flex items-center gap-2"
        style={{
          height: 32,
          padding: "0 10px",
          background: "#212124",
          border: "1px solid #2D2E30",
          borderRadius: 8,
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        <Search size={13} color="#71717A" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or enter email…"
          className="text-[12px] outline-none flex-1"
          style={{ background: "transparent", border: "none", color: "#E4E4E7" }}
        />
      </div>

      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        <div className="text-[11px] mb-1" style={{ color: "#71717A", padding: "2px 8px" }}>
          People
        </div>

        {people === null && (
          <div className="text-[12px]" style={{ color: "#52525B", padding: "8px" }}>
            Loading…
          </div>
        )}

        {people !== null && filtered.length === 0 && (
          <div className="text-[12px]" style={{ color: "#52525B", padding: "8px" }}>
            No matches.
          </div>
        )}

        {filtered.map((person) => {
          const isAssigned = assignedIds.has(person.id);
          const { text, bg } = getAvatarColorFromUserId(person.id);
          return (
            <button
              key={person.id}
              type="button"
              disabled={pending.has(person.id)}
              onClick={() => toggle(person)}
              className="flex items-center gap-2 w-full transition-colors"
              style={{
                background: "transparent",
                border: "none",
                borderRadius: 6,
                padding: "6px 8px",
                cursor: pending.has(person.id) ? "default" : "pointer",
                textAlign: "left",
                opacity: pending.has(person.id) ? 0.6 : 1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div
                className="flex items-center justify-center rounded-full text-[10px] font-medium"
                style={{ width: 22, height: 22, background: bg, color: text, flexShrink: 0 }}
              >
                {resolveInitial({ display_name: person.displayName })}
              </div>
              <span className="text-[13px] flex-1 truncate" style={{ color: "#E4E4E7" }}>
                {person.displayName ?? person.email}
              </span>
              {isAssigned && <Check size={14} color="#108CE9" />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
