"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { StagesLogo } from "@/components/icons/StagesLogo";
import { ChartIcon, ClientsIcon, ClockIcon } from "@/components/icons/StatIcons";
import { Stat } from "./Stat";
import { ClientCard } from "./ClientCard";
import { SortTab } from "./SortTab";
import { EmptyState } from "./EmptyState";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { ProfileMenu } from "./ProfileMenu";
import type { Client, Session, Workspace } from "@/types/stages";

type Props = {
  clients: Client[];
  allClients: Client[];
  totalClients: number;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  session: Session;
  onLogout: () => void;
  computeUnread: (c: Client | undefined) => { thread: number; members: number; activity: number };
  workspaces: Workspace[];
  activeWorkspace: Workspace | undefined;
  onSwitchWorkspace: (id: string) => void;
  onShowWorkspaceModal: () => void;
  onRenameWorkspace: (id: string, name: string) => void;
  onDeleteWorkspace: (id: string) => void;
};

export function ClientList({
  clients, allClients, totalClients, searchQuery, setSearchQuery,
  onOpen, onDelete, onNew, session, onLogout, computeUnread,
  workspaces, activeWorkspace, onSwitchWorkspace, onShowWorkspaceModal,
  onRenameWorkspace, onDeleteWorkspace,
}: Props) {
  const isOwner = session.role === "owner";
  const [searchFocused, setSearchFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [sortBy, setSortBy] = useState<"name" | "recents">("recents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const searchRef = useRef<HTMLDivElement | null>(null);

  const sortedClients = [...clients].sort((a, b) => {
    if (sortBy === "name") {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    }
    const cmp = (a.lastEdited || a.createdAt) - (b.lastEdited || b.createdAt);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const searchResults = searchQuery.trim()
    ? (allClients || [])
        .filter((c) => {
          const q = searchQuery.toLowerCase();
          return c.name.toLowerCase().includes(q) || (c.company || "").toLowerCase().includes(q);
        })
        .slice(0, 8)
    : [];
  const showDropdown = searchFocused && searchQuery.trim().length > 0;

  useEffect(() => {
    setHighlightIdx(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!searchFocused) return;
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchFocused(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [searchFocused]);

  const handleResultClick = (id: string) => {
    onOpen(id);
    setSearchQuery("");
    setSearchFocused(false);
  };

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = searchResults[highlightIdx];
      if (target) handleResultClick(target.id);
    } else if (e.key === "Escape") {
      setSearchFocused(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "#212124" }}>
      <header
        className="border-b border-zinc-800 flex items-center"
        style={{
          background: "#121212",
          paddingLeft: "16px",
          paddingRight: "16px",
          paddingTop: "12px",
          paddingBottom: "12px",
          gap: "12px",
          height: "64px",
        }}
      >
        <div className="flex-shrink-0 flex items-center">
          <StagesLogo size={28} />
        </div>

        {isOwner && activeWorkspace && (
          <div className="flex-shrink-0" style={{ marginLeft: "12px" }}>
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onSwitch={onSwitchWorkspace}
              onCreateNew={onShowWorkspaceModal}
              onRename={onRenameWorkspace}
              onDelete={onDeleteWorkspace}
            />
          </div>
        )}

        <div
          ref={searchRef}
          className="relative flex-1 min-w-0"
          style={{ marginLeft: "8px", marginRight: "8px" }}
        >
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={handleSearchKey}
            placeholder="Search by name or company..."
            className="w-full"
            style={{
              paddingLeft: "34px",
              paddingRight: searchQuery ? "32px" : "12px",
              height: "36px",
              fontSize: "13px",
              background: "#1A1A1A",
              border: "1px solid #36363A",
              borderRadius: "8px",
              color: "#E4E4E7",
              outline: "none",
              transition: "border-color 0.15s",
            }}
            onBlurCapture={(e) => (e.currentTarget.style.borderColor = "#36363A")}
            onFocusCapture={(e) => (e.currentTarget.style.borderColor = "#108CE9")}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <X size={14} />
            </button>
          )}
          {showDropdown && (
            <div
              className="absolute left-0 right-0 mt-2 panel-card overflow-hidden fade-in z-50"
              style={{ background: "#1A1A1A", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}
            >
              {searchResults.length === 0 ? (
                <div className="p-4 text-center text-[13px] text-zinc-500">
                  No clients match &quot;{searchQuery}&quot;
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 text-[12px] text-zinc-500 border-b border-zinc-800">
                    {searchResults.length} {searchResults.length === 1 ? "result" : "results"} · ↑↓
                    to navigate · ↵ to open
                  </div>
                  <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
                    {searchResults.map((c, idx) => {
                      const cs = c.stages.find((s) => s.id === c.currentStage);
                      const high = idx === highlightIdx;
                      return (
                        <button
                          key={c.id}
                          onClick={() => handleResultClick(c.id)}
                          onMouseEnter={() => setHighlightIdx(idx)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                          style={{ background: high ? "#212124" : "transparent" }}
                        >
                          <div
                            className="w-8 h-8 rounded-md flex items-center justify-center text-[16px] flex-shrink-0"
                            style={{ background: "#212124", border: "1px solid #36363A" }}
                          >
                            {c.emoji || "📋"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold truncate">{c.name}</div>
                            <div className="text-[12px] text-zinc-500 truncate">
                              {c.company ? `${c.company} · ` : ""}
                              {cs?.name}
                            </div>
                          </div>
                          <span className="text-[11px] text-zinc-500 flex-shrink-0">
                            {c.stages.filter((s) => s.completed).length}/{c.stages.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {isOwner && (
          <button
            onClick={onNew}
            className="flex items-center gap-2 font-medium transition-colors flex-shrink-0"
            style={{
              background: "#108CE9",
              color: "white",
              border: "1px solid #108CE9",
              borderRadius: "8px",
              padding: "0 14px",
              fontSize: "13px",
              height: "36px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#0E7DD1";
              e.currentTarget.style.borderColor = "#0E7DD1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#108CE9";
              e.currentTarget.style.borderColor = "#108CE9";
            }}
          >
            <Plus size={14} strokeWidth={2.5} /> <span className="hidden sm:inline">Pipeline</span>
          </button>
        )}

        <div className="flex-shrink-0">
          <ProfileMenu session={session} onLogout={onLogout} />
        </div>
      </header>

      <div className="px-4 sm:px-6 pt-6 pb-2 grid grid-cols-3 gap-4">
        <Stat
          icon={<ClientsIcon size={22} color="#108CE9" />}
          label="Total Pipelines"
          value={totalClients}
          accent="#108CE9"
        />
        <Stat
          icon={<ClockIcon size={22} color="#F59E0C" />}
          label="Pipelines in progress"
          value={
            clients.filter((c) => {
              const allDone = c.stages.length > 0 && c.stages.every((s) => s.completed);
              return !allDone;
            }).length
          }
          accent="#F59E0C"
        />
        <Stat
          icon={<ChartIcon size={22} color="#15B981" />}
          label="Pipelines completed (Week)"
          value={
            clients.filter((c) => {
              const lastStage = c.stages[c.stages.length - 1];
              if (!lastStage?.completed || !lastStage.completedAt) return false;
              const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
              return lastStage.completedAt >= weekAgo;
            }).length
          }
          accent="#15B981"
        />
      </div>

      <div className="p-4 sm:p-6">
        {clients.length === 0 && totalClients === 0 ? (
          <EmptyState onNew={onNew} isOwner={isOwner} />
        ) : clients.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">
            No clients match &quot;{searchQuery}&quot;
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 mb-4">
              <SortTab
                label="Name"
                active={sortBy === "name"}
                direction={sortDir}
                onClick={() => {
                  if (sortBy === "name") setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else {
                    setSortBy("name");
                    setSortDir("asc");
                  }
                }}
              />
              <SortTab
                label="Recents"
                active={sortBy === "recents"}
                direction={sortDir}
                onClick={() => {
                  if (sortBy === "recents") setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else {
                    setSortBy("recents");
                    setSortDir("desc");
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {sortedClients.map((c) => {
                const u = computeUnread(c);
                const totalUnread = u.thread + u.members + u.activity;
                return (
                  <ClientCard
                    key={c.id}
                    client={c}
                    unreadTotal={totalUnread}
                    onOpen={() => onOpen(c.id)}
                    onDelete={() => onDelete(c.id)}
                    canDelete={isOwner && c.ownerEmail === session.email}
                    currentUserEmail={session.email}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
