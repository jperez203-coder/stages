"use client";

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Checklist section of the portal task detail panel. Phase 4b-2-b.
 *
 * Self-contained: fetches its own data on mount (lazy — only fires
 * when a task panel opens, NOT eagerly for every visible task in the
 * canvas fetch). Renders nothing while loading and nothing when the
 * task has zero client-visible checklist items — matches the panel's
 * "hide empty sections" rule (no placeholder text).
 *
 * Server enforcement (confirmed in place, NOT rebuilt here):
 *   * checklist_items_select RLS (20260519120000) — chain-visibility:
 *     item.client_visible AND task.client_visible AND stage.client_visible.
 *     Clients see only items that pass the full chain.
 *   * checklist_items_update RLS — same chain gate for client UPDATE.
 *   * A trigger in the same migration restricts client column writes
 *     to `completed_at` only — title/position/client_visible attempts
 *     server-reject. The UI here only flips completed_at, so the trigger
 *     is the backstop, never the primary gate.
 *
 * Add / remove items NOT shown — those are agency-only operations.
 * Order: stable, by `position` ascending (server-side ordering).
 */

type ChecklistItem = {
  id: string;
  title: string;
  position: number;
  completed_at: string | null;
};

type Props = {
  taskId: string;
};

export function PortalChecklistSection({ taskId }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Lazy fetch on mount. Re-fires if taskId changes (i.e., user
  // navigates between panel-opens without unmounting the panel —
  // shouldn't happen in 4b-2-b's mount/unmount model but defensive).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("checklist_items")
        .select("id, title, position, completed_at")
        .eq("task_id", taskId)
        .eq("client_visible", true)
        .order("position", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("[portal panel] checklist fetch failed:", error);
        setItems([]);
        setLoaded(true);
        return;
      }

      setItems((data ?? []) as ChecklistItem[]);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Optimistic toggle. Client can only flip completed_at (true → ISO
  // timestamp, false → null). The trigger restricts non-completed_at
  // attempts server-side, so even a bug in this handler would server-
  // reject anything else.
  const onToggle = useCallback(
    async (itemId: string, nextCompleted: boolean) => {
      const snapshot = items;
      const nextValue = nextCompleted ? new Date().toISOString() : null;

      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId ? { ...it, completed_at: nextValue } : it,
        ),
      );

      const { error } = await supabase
        .from("checklist_items")
        .update({ completed_at: nextValue })
        .eq("id", itemId);

      if (error) {
        console.error("[portal panel] checklist toggle failed:", error);
        setItems(snapshot);
      }
    },
    [items],
  );

  // Hide the entire section when loading hasn't completed OR when
  // there are no items to show. Per the panel's "hide empty sections"
  // rule — no placeholder, no skeleton.
  if (!loaded || items.length === 0) {
    return null;
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "rgba(255,255,255,0.5)",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          margin: 0,
        }}
      >
        Checklist
      </h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {items.map((it) => (
          <ChecklistRow key={it.id} item={it} onToggle={onToggle} />
        ))}
      </ul>
    </section>
  );
}

// ─── Single checklist row ──────────────────────────────────────────────

function ChecklistRow({
  item,
  onToggle,
}: {
  item: ChecklistItem;
  onToggle: (itemId: string, nextCompleted: boolean) => void;
}) {
  const isDone = item.completed_at !== null;

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 8px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <button
        type="button"
        onClick={() => onToggle(item.id, !isDone)}
        aria-label={
          isDone ? `Uncheck "${item.title}"` : `Check off "${item.title}"`
        }
        aria-pressed={isDone}
        style={{
          flexShrink: 0,
          width: 16,
          height: 16,
          borderRadius: 4,
          background: isDone ? "#15B981" : "transparent",
          border: `1.5px solid ${isDone ? "#15B981" : "rgba(255,255,255,0.25)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          transition:
            "background 120ms ease-out, border-color 120ms ease-out",
        }}
      >
        {isDone && <Check size={11} color="white" strokeWidth={3} />}
      </button>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          color: isDone ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.88)",
          textDecoration: isDone ? "line-through" : "none",
          lineHeight: 1.4,
        }}
      >
        {item.title}
      </span>
    </li>
  );
}
