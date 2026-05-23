"use client";

import { ChatBody } from "@/app/w/(canvas)/[slug]/p/[pipeline-id]/chat/ChatBody";
import type {
  ChatMessageAuthor,
  PipelineChatData,
} from "@/lib/chat-data";
import type { ChromeMember } from "@/lib/canvas-chrome-data";

/**
 * Portal-side wrapper around ChatBody. Phase 4b-1.
 *
 * ─── LOCKED BEHAVIOR — DO NOT CHANGE WITHOUT EXPLICIT REVIEW ────────
 *
 * viewerIsAgencySide={false} is HARDCODED below. The portal route is
 * ALWAYS client-mode regardless of viewer identity:
 *
 *   * For a pure client (Casey): false is correct — they ARE the
 *     client; Layer 3 internal-message filter activates.
 *   * For an agency member previewing the portal: false is ALSO
 *     correct — the whole point of "view as client" is seeing what
 *     the client sees. Computing this from membership data would
 *     defeat the entire purpose of the preview.
 *
 * If a future feature ever needs "agency view inside portal," that's
 * a deliberate code change to this literal — NOT a runtime computation
 * that could go wrong. The shell's "Viewing as client" banner (driven
 * by viewerIsActuallyAgencySide in PortalShell) is a SEPARATE concept;
 * the two booleans never cross paths.
 *
 * ─── OTHER PORTAL-SPECIFIC FLAGS ────────────────────────────────────
 *
 * renderSidebar={false} — clients have a single channel; the sidebar
 *   would be a one-row pane with no purpose. The chat thread fills
 *   the available width instead.
 *
 * channelHeaderLabel={agencyName} — replaces the default "# client"
 *   treatment with the agency's workspace name. From the client's
 *   perspective they're chatting with "ACME Agency," not the abstract
 *   channel #client. Falls back to default rendering when agencyName
 *   is null (pre-migration state where workspaces_select doesn't
 *   expose the workspace name to clients).
 */

type Props = {
  data: PipelineChatData;
  viewer: ChatMessageAuthor;
  members: ChromeMember[];
  /** Agency workspace name. Used as the channel header label. May be
   *  null if the workspaces_select RLS didn't grant access (e.g.,
   *  pre-migration); in that case ChatBody falls back to the default
   *  "# <channel.name>" rendering via the null pass-through. */
  agencyName: string | null;
};

export function PortalChatBody({
  data,
  viewer,
  members,
  agencyName,
}: Props) {
  return (
    <ChatBody
      data={data}
      viewer={viewer}
      members={members}
      // SEE FILE HEADER — this literal is the canonical "portal is
      // always client-mode" decision. Do not derive from membership.
      viewerIsAgencySide={false}
      // Single-channel client view; no sidebar.
      renderSidebar={false}
      // "ACME Agency" instead of "# client" as the thread's channel
      // header — or null to fall back to default rendering.
      channelHeaderLabel={agencyName}
    />
  );
}
