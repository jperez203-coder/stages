"use client";

import type { ChatChannel } from "@/lib/chat-data";

/**
 * Left pane of the chat surface — "Chat" header + channel list.
 * Phase 4b slice 1.
 *
 * Slice-1 scope:
 *   * Renders the #general channel row, always.
 *   * Renders the client channel row ONLY when the parent passes
 *     `pipelineHasClient && clientChannel != null`. Sidebar gate per
 *     the locked decision — pipelines without an accepted client don't
 *     surface the client channel at all (pending invites stay on
 *     /clients, not here).
 *   * Active state highlights whichever channel is `activeChannelId`.
 *     In slice 1 that's always the #general channel; clicking the
 *     client channel row is inert (no-op handler) — channel switching
 *     ships in slice 4.
 *   * Channel rows show `#` prefix for internal channels, person icon
 *     for the client channel (matches the figma's two glyph treatments).
 *   * Deferred features that appear in the figma but are NOT in slice 1:
 *     "Unread" filter + badge, "Threads" nav, search input. Don't add
 *     placeholders for them.
 *
 * The label for the client channel renders `channels.name` verbatim —
 * which defaults to `"client"` until the rename-on-invite-accept
 * enhancement ships (currently deferred from the create RPC scope).
 */

const SIDEBAR_WIDTH = 260;

type Props = {
  /** All channels for the pipeline — both #general and the client channel
   *  if present. */
  channels: ChatChannel[];
  /** The #general channel, always present in slice-1 fetches. Null only
   *  if the pipeline schema is in some impossible state — render an
   *  empty list defensively. */
  generalChannel: ChatChannel | null;
  /** The client channel (`is_client=true`). Present in the DB whenever
   *  the pipeline was created via `create_pipeline_with_channels`; the
   *  sidebar GATE on whether to render it lives one level up
   *  (`pipelineHasClient`). */
  clientChannel: ChatChannel | null;
  /** Render the client channel row when true. False = pipeline has no
   *  accepted client yet → hide it entirely. */
  showClientChannel: boolean;
  /** Active channel id — drives the blue highlight. Slice 1 always
   *  passes the #general channel id. */
  activeChannelId: string | null;
  /** Slice 1: clicking the client row is a no-op (channel switching
   *  is slice 4). The handler still receives the call so slice 4 can
   *  wire it without restructuring this component. */
  onSelectChannel: (channelId: string) => void;
};

export function ChatSidebar({
  generalChannel,
  clientChannel,
  showClientChannel,
  activeChannelId,
  onSelectChannel,
}: Props) {
  return (
    <aside
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        // Slightly recessed vs the message thread (#212124) so the
        // sidebar reads as a panel. Polish round 2026-05-22.
        background: "#1A1A1C",
        borderRight: "1px solid #2A2A2D",
        display: "flex",
        flexDirection: "column",
        padding: "20px 16px",
        gap: 20,
        overflowY: "auto",
      }}
    >
      {/* "Chat" header. */}
      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "white",
          margin: 0,
          lineHeight: 1.2,
        }}
      >
        Chat
      </h2>

      {/* Channels group. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.45)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            padding: "0 8px",
            marginBottom: 4,
          }}
        >
          Channels
        </div>

        {generalChannel && (
          <ChannelRow
            label={generalChannel.name}
            glyph="hash"
            active={activeChannelId === generalChannel.id}
            onClick={() => onSelectChannel(generalChannel.id)}
          />
        )}

        {showClientChannel && clientChannel && (
          <ChannelRow
            label={clientChannel.name}
            glyph="person"
            active={activeChannelId === clientChannel.id}
            onClick={() => onSelectChannel(clientChannel.id)}
          />
        )}
      </div>
    </aside>
  );
}

// ─── Single channel row ─────────────────────────────────────────────────

type ChannelRowProps = {
  label: string;
  glyph: "hash" | "person";
  active: boolean;
  onClick: () => void;
};

function ChannelRow({ label, glyph, active, onClick }: ChannelRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        // Vertical padding trimmed 10 → 7 so the active blue bar
        // reads a touch skinnier. Polish 2026-05-22.
        padding: "7px 12px",
        background: active ? "#108CE9" : "transparent",
        border: "none",
        borderRadius: 8,
        color: active ? "white" : "rgba(255,255,255,0.75)",
        // Bumped from 13 → 15 for legibility. Polish 2026-05-22.
        fontSize: 15,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "background 120ms ease-out, color 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        e.currentTarget.style.color = "white";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(255,255,255,0.75)";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          // Wider + bigger glyph slot so it stays proportional to the
          // larger label text. Polish 2026-05-22.
          width: 22,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 17,
          opacity: active ? 1 : 0.7,
        }}
      >
        {glyph === "hash" ? "#" : <PersonGlyph size={17} />}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {label}
      </span>
    </button>
  );
}

// ─── Person glyph for the client channel row ───────────────────────────

/**
 * Single-person silhouette used in front of the client channel label —
 * matches the figma's "person icon then label" treatment which
 * differentiates the client channel from #-prefixed internal channels at
 * a glance. Lucide's `User` is the standard glyph but at this size
 * (14px) the inline path renders crisper than the imported component.
 */
function PersonGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
