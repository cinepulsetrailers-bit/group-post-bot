import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMessages, replyToChat, markChatRead } from "@/lib/automation.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Send, MessageSquare, Search, Users, MailOpen } from "lucide-react";

export const Route = createFileRoute("/_authenticated/replies")({ component: RepliesPage });

type Msg = {
  id: string;
  tg_chat_id: number;
  tg_message_id: number;
  chat_title: string | null;
  from_name: string | null;
  text: string | null;
  media_url: string | null;
  direction: "in" | "out";
  reply_to_tg_id: number | null;
  read_at: string | null;
  created_at: string;
};

function RepliesPage() {
  const qc = useQueryClient();
  const list = useServerFn(listMessages);
  const reply = useServerFn(replyToChat);
  const mark = useServerFn(markChatRead);

  const { data } = useQuery({
    queryKey: ["messages"],
    queryFn: () => list() as Promise<Msg[]>,
    refetchInterval: 8000,
  });
  const messages = data ?? [];

  const [activeChat, setActiveChat] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "new" | "unread">("all");

  useEffect(() => {
    const ch = supabase
      .channel("replies-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["messages"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Only chats where someone replied (≥1 inbound message)
  const replyChats = useMemo(() => {
    const map = new Map<
      number,
      {
        chat_id: number;
        title: string;
        last: Msg;
        inboundCount: number;
        unread: number;
        people: Set<string>;
      }
    >();
    for (const m of messages) {
      const title = m.chat_title || `Chat ${m.tg_chat_id}`;
      let entry = map.get(m.tg_chat_id);
      if (!entry) {
        entry = {
          chat_id: m.tg_chat_id,
          title,
          last: m,
          inboundCount: 0,
          unread: 0,
          people: new Set<string>(),
        };
        map.set(m.tg_chat_id, entry);
      }
      if (new Date(m.created_at) > new Date(entry.last.created_at)) entry.last = m;
      if (m.direction === "in") {
        entry.inboundCount++;
        if (m.from_name) entry.people.add(m.from_name);
        if (!m.read_at) entry.unread++;
      }
    }
    return Array.from(map.values())
      .filter((c) => c.inboundCount > 0)
      .sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime());
  }, [messages]);

  const filteredChats = useMemo(() => {
    return replyChats.filter((c) => {
      if (filter === "unread" && c.unread === 0) return false;
      if (filter === "new" && c.last.direction !== "in") return false;
      if (search) {
        const q = search.toLowerCase();
        if (!c.title.toLowerCase().includes(q) &&
            !Array.from(c.people).join(" ").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [replyChats, filter, search]);

  const newCount = useMemo(
    () => replyChats.filter((c) => c.last.direction === "in").length,
    [replyChats],
  );

  // Summary stats
  const stats = useMemo(() => {
    let totalReplies = 0;
    let totalUnread = 0;
    const people = new Set<string>();
    for (const c of replyChats) {
      totalReplies += c.inboundCount;
      totalUnread += c.unread;
      c.people.forEach((p) => people.add(p));
    }
    return {
      chats: replyChats.length,
      replies: totalReplies,
      unread: totalUnread,
      people: people.size,
    };
  }, [replyChats]);

  const thread = useMemo(
    () => messages
      .filter((m) => m.tg_chat_id === activeChat)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [messages, activeChat],
  );

  useEffect(() => {
    if (activeChat != null) {
      mark({ data: { tg_chat_id: activeChat } }).then(() =>
        qc.invalidateQueries({ queryKey: ["messages"] }),
      );
    }
  }, [activeChat, mark, qc]);

  const send = useMutation({
    mutationFn: () =>
      reply({ data: { tg_chat_id: activeChat!, text: replyText, reply_to_tg_id: null } }),
    onSuccess: () => {
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["messages"] });
      toast.success("Reply sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-screen">
      {/* Left list */}
      <aside className="w-96 border-r bg-card flex flex-col">
        <div className="p-4 border-b space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <MessageSquare className="size-4" /> Replies
          </h2>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-2">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Users className="size-3" /> Groups replied
              </div>
              <div className="text-lg font-semibold">{stats.chats}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <MessageSquare className="size-3" /> Total replies
              </div>
              <div className="text-lg font-semibold">{stats.replies}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Users className="size-3" /> People
              </div>
              <div className="text-lg font-semibold">{stats.people}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <MailOpen className="size-3" /> Unread
              </div>
              <div className="text-lg font-semibold text-primary">{stats.unread}</div>
            </Card>
          </div>
          {/* Search + filter */}
          <div className="relative">
            <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search group or person…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8"
            />
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={filter === "all" ? "default" : "outline"}
              className="flex-1 h-7"
              onClick={() => setFilter("all")}
            >
              All ({stats.chats})
            </Button>
            <Button
              size="sm"
              variant={filter === "new" ? "default" : "outline"}
              className="flex-1 h-7"
              onClick={() => setFilter("new")}
            >
              New ({newCount})
            </Button>
            <Button
              size="sm"
              variant={filter === "unread" ? "default" : "outline"}
              className="flex-1 h-7"
              onClick={() => setFilter("unread")}
            >
              Unread ({stats.unread})
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredChats.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {replyChats.length === 0 ? "No replies yet 📭" : "No chats match this filter"}
            </div>
          )}
          {filteredChats.map((c) => (
            <button
              key={c.chat_id}
              onClick={() => setActiveChat(c.chat_id)}
              className={cn(
                "w-full text-left px-4 py-3 border-b hover:bg-accent/50 transition-colors",
                activeChat === c.chat_id && "bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{c.title}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="secondary" className="text-[10px]">
                    {c.inboundCount} {c.inboundCount === 1 ? "reply" : "replies"}
                  </Badge>
                  {c.unread > 0 && (
                    <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {c.last.direction === "out" ? "You: " : c.last.from_name ? `${c.last.from_name}: ` : ""}
                {c.last.text ?? "📎 media"}
              </div>
              {c.people.size > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  👥 {Array.from(c.people).slice(0, 3).join(", ")}
                  {c.people.size > 3 ? ` +${c.people.size - 3} more` : ""}
                </div>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Conversation */}
      <section className="flex-1 flex flex-col">
        {activeChat == null ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a conversation to reply
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b font-medium">
              {replyChats.find((c) => c.chat_id === activeChat)?.title}
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {thread.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-md px-3 py-2 rounded-lg text-sm",
                      m.direction === "out"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.direction === "in" && m.from_name && (
                      <div className="text-xs opacity-70 mb-0.5 font-medium">{m.from_name}</div>
                    )}
                    <div className="whitespace-pre-wrap">{m.text ?? "📎 media"}</div>
                    <div className="text-[10px] opacity-60 mt-1">
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t p-3">
              <div className="flex gap-2">
                <Textarea
                  rows={2}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type a message… (Ctrl/⌘+Enter to send)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (replyText.trim()) send.mutate();
                    }
                  }}
                />
                <Button
                  disabled={!replyText.trim() || send.isPending}
                  onClick={() => send.mutate()}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
