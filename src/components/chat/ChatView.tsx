"use client";

import { useEffect, useState } from "react";
import { Hash, MessageCircle, Plus } from "lucide-react";
import { SidebarTabBtn } from "./SidebarTabBtn";
import { ChannelRow } from "./ChannelRow";
import { ChannelChat } from "./ChannelChat";
import { UnreadView } from "./UnreadView";
import { ThreadsView } from "./ThreadsView";
import { CreateChannelModal } from "./CreateChannelModal";
import { ChannelMembersModal } from "./ChannelMembersModal";
import type { Client, Session } from "@/types/stages";

type Props = {
  client: Client;
  session: Session;
  clientPortalEmail: string | null;
  onCreateChannel: (name: string, members: string[], isClient: boolean) => string | null;
  onAddChannelMember: (channelId: string, email: string) => void;
  onRemoveChannelMember: (channelId: string, email: string) => void;
  onSendChannelMessage: (
    channelId: string,
    text: string,
    mentions: string[],
    internal: boolean,
  ) => void;
};

type SidebarTab = "channels" | "unread" | "threads";

export function ChatView({
  client, session, clientPortalEmail,
  onCreateChannel, onAddChannelMember, onRemoveChannelMember, onSendChannelMessage,
}: Props) {
  const channels = client.channels || [];
  const isOwner = client.ownerEmail === session.email;
  const visibleChannels = isOwner
    ? channels
    : channels.filter((ch) => (ch.memberEmails || []).includes(session.email));

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("channels");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    visibleChannels[0]?.id || null,
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showChannelMembersModal, setShowChannelMembersModal] = useState(false);

  useEffect(() => {
    if (!visibleChannels.find((ch) => ch.id === activeChannelId)) {
      setActiveChannelId(visibleChannels[0]?.id || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.channels?.length]);

  const activeChannel = visibleChannels.find((ch) => ch.id === activeChannelId);

  // Per-channel unread + mention counts (MVP: treat all messages from others
  // as unread; full read-tracking comes in Phase 4 with persistent state).
  const channelMeta = visibleChannels.map((ch) => {
    const msgs = ch.messages || [];
    const unread = msgs.filter((m) => m.author !== session.email).length;
    const mentions = msgs.filter((m) => (m.mentions || []).includes(session.email)).length;
    return { id: ch.id, unread, mentions };
  });
  const totalUnread = channelMeta.reduce((a, c) => a + c.unread, 0);

  const mentionItems = visibleChannels
    .flatMap((ch) =>
      (ch.messages || [])
        .filter((m) => (m.mentions || []).includes(session.email))
        .map((m) => ({
          ...m,
          channelId: ch.id,
          channelName: ch.name,
          isClient: ch.isClient,
        })),
    )
    .sort((a, b) => b.ts - a.ts);

  const unreadByChannel = visibleChannels
    .map((ch) => ({
      channel: ch,
      messages: (ch.messages || []).filter((m) => m.author !== session.email).slice(-3),
    }))
    .filter((x) => x.messages.length > 0);

  const chatSession = { email: session.email, role: session.role };

  return (
    <div className="flex" style={{ height: "calc(100vh - 64px)", background: "#212124" }}>
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{
          width: "220px",
          background: "#1A1A1C",
          borderRight: "1px solid #36363A",
        }}
      >
        <div className="px-4 pt-5 pb-3">
          <div className="text-[20px] font-bold" style={{ color: "#FFFFFF" }}>Chat</div>
        </div>

        <div className="px-2 space-y-0.5 mb-3">
          <SidebarTabBtn
            icon={<Hash size={15} strokeWidth={2.5} />}
            label="Unread"
            active={sidebarTab === "unread"}
            onClick={() => setSidebarTab("unread")}
            badge={totalUnread > 0 ? totalUnread : null}
            badgeColor="#CE6A6C"
          />
          <SidebarTabBtn
            icon={<MessageCircle size={15} strokeWidth={2.5} />}
            label="Threads"
            active={sidebarTab === "threads"}
            onClick={() => setSidebarTab("threads")}
            badge={mentionItems.length > 0 ? mentionItems.length : null}
            badgeColor="#CE6A6C"
          />
        </div>

        <div className="px-2 flex items-center justify-between mb-1">
          <div
            className="text-[12px] font-semibold uppercase tracking-wider px-2"
            style={{ color: "#979393" }}
          >
            Channels
          </div>
          {isOwner && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1 rounded transition-colors"
              style={{
                background: "transparent",
                color: "#979393",
                border: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#2C2C2F";
                e.currentTarget.style.color = "#E4E4E7";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#979393";
              }}
              title="Create channel"
            >
              <Plus size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-3">
          {visibleChannels.length === 0 ? (
            <div className="text-[12px] text-center py-6" style={{ color: "#979393" }}>
              No channels yet
            </div>
          ) : (
            <div className="space-y-0.5">
              {visibleChannels.map((ch) => {
                const meta = channelMeta.find((m) => m.id === ch.id) || { unread: 0, mentions: 0 };
                const isActive = activeChannelId === ch.id && sidebarTab === "channels";
                return (
                  <ChannelRow
                    key={ch.id}
                    channel={ch}
                    isActive={isActive}
                    unread={meta.unread}
                    mentions={meta.mentions}
                    onClick={() => {
                      setActiveChannelId(ch.id);
                      setSidebarTab("channels");
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0" style={{ background: "#212124" }}>
        {sidebarTab === "unread" ? (
          <UnreadView
            items={unreadByChannel}
            onOpenChannel={(id) => {
              setActiveChannelId(id);
              setSidebarTab("channels");
            }}
          />
        ) : sidebarTab === "threads" ? (
          <ThreadsView
            items={mentionItems}
            onOpenChannel={(id) => {
              setActiveChannelId(id);
              setSidebarTab("channels");
            }}
          />
        ) : activeChannel ? (
          <ChannelChat
            channel={activeChannel}
            client={client}
            session={chatSession}
            onSend={(text, mentions, internal) =>
              onSendChannelMessage(activeChannel.id, text, mentions, internal)
            }
            onShowMembers={() => setShowChannelMembersModal(true)}
            onShowCreateChannel={isOwner ? () => setShowCreateModal(true) : undefined}
          />
        ) : (
          <div
            className="flex-1 flex items-center justify-center text-[13px]"
            style={{ color: "#979393" }}
          >
            Select or create a channel to start chatting.
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateChannelModal
          client={client}
          session={session}
          clientPortalEmail={clientPortalEmail}
          onCreate={(name, members, isClient) => {
            const newId = onCreateChannel(name, members, isClient);
            if (newId) setActiveChannelId(newId);
            setShowCreateModal(false);
          }}
          onClose={() => setShowCreateModal(false)}
        />
      )}
      {showChannelMembersModal && activeChannel && (
        <ChannelMembersModal
          channel={activeChannel}
          client={client}
          session={session}
          isOwner={isOwner}
          clientPortalEmail={clientPortalEmail}
          onAdd={(email) => onAddChannelMember(activeChannel.id, email)}
          onRemove={(email) => onRemoveChannelMember(activeChannel.id, email)}
          onClose={() => setShowChannelMembersModal(false)}
        />
      )}
    </div>
  );
}
