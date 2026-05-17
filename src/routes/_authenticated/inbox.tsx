import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMessages, replyToChat, markChatRead } from "@/lib/automation.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Send, Inbox as InboxIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inbox")({ component: InboxPage });

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

function InboxPage() {
  const qc = useQueryClient();
  const list = useServerFn(listMessages);
  const reply = useServerFn(replyToChat);
  const mark = useServerFn(markChatRead);

  const { data } = useQuery({ queryKey: ["messages"], queryFn: () => list() as Promise<Msg[]> });
  const messages = data ?? [];

  const [activeChat, setActiveChat] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyToId, setReplyToId] = useState<number | null>(null);

  // realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel("messages-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["messages"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const chats = useMemo(() => {
    const map = new Map<number, { chat_id: number; title: string; last: Msg; unread: number }>();
    for (const m of messages) {
      const existing = map.get(m.tg_chat_id);
      const title = m.chat_title || `Chat ${m.tg_chat_id}`;
      if (!existing) {
        map.set(m.tg_chat_id, {
          chat_id: m.tg_chat_id,
          title,
          last: m,
          unread: m.direction === "in" && !m.read_at ? 1 : 0,
        });
      } else {
        if (new Date(m.created_at) > new Date(existing.last.created_at)) existing.last = m;
        if (m.direction === "in" && !m.read_at) existing.unread += 1;
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime(),
    );
  }, [messages]);

  const thread = useMemo(
    () => messages.filter((m) => m.tg_chat_id === activeChat).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
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
      reply({
        data: {
          tg_chat_id: activeChat!,
          text: replyText,
          reply_to_tg_id: replyToId,
        },
      }),
    onSuccess: () => {
      setReplyText("");
      setReplyToId(null);
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-screen">
      <aside className="w-80 border-r bg-card overflow-y-auto">
        <div className="p-4 border-b">
          <h2 className="font-semibold flex items-center gap-2"><InboxIcon className="size-4" /> Inbox</h2>
        </div>
        {chats.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground text-center">
            No replies yet.
          </div>
        )}
        {chats.map((c) => (
          <button
            key={c.chat_id}
            onClick={() => setActiveChat(c.chat_id)}
            className={cn(
              "w-full text-left px-4 py-3 border-b hover:bg-accent/50",
              activeChat === c.chat_id && "bg-accent",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{c.title}</span>
              {c.unread > 0 && (
                <span className="text-xs bg-primary text-primary-foreground rounded-full px-2 py-0.5">
                  {c.unread}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {c.last.direction === "out" ? "You: " : c.last.from_name ? `${c.last.from_name}: ` : ""}
              {c.last.text ?? "📎 media"}
            </div>
          </button>
        ))}
      </aside>

      <section className="flex-1 flex flex-col">
        {activeChat == null ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b font-medium">
              {chats.find((c) => c.chat_id === activeChat)?.title}
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
                    onDoubleClick={() => m.direction === "in" && setReplyToId(m.tg_message_id)}
                    title="Double-click to reply to this message"
                  >
                    {m.direction === "in" && m.from_name && (
                      <div className="text-xs opacity-70 mb-0.5">{m.from_name}</div>
                    )}
                    <div className="whitespace-pre-wrap">{m.text ?? "📎 media"}</div>
                    <div className="text-[10px] opacity-60 mt-1">
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t p-3 space-y-2">
              {replyToId && (
                <div className="text-xs flex items-center gap-2 bg-muted px-2 py-1 rounded">
                  Replying to message #{replyToId}
                  <button className="ml-auto" onClick={() => setReplyToId(null)}>✕</button>
                </div>
              )}
              <div className="flex gap-2">
                <Textarea
                  rows={2}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type a reply…"
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
