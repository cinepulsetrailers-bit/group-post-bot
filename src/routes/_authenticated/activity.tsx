import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMessages, listReactions } from "@/lib/automation.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search, MessageSquare, Smile, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/activity")({ component: ActivityPage });

type Msg = {
  id: string;
  tg_chat_id: number;
  tg_message_id: number;
  chat_title: string | null;
  from_name: string | null;
  from_id: number | null;
  text: string | null;
  direction: "in" | "out";
  created_at: string;
};

type Reaction = {
  id: string;
  tg_chat_id: number;
  tg_message_id: number;
  chat_title: string | null;
  from_id: number | null;
  from_name: string | null;
  emoji: string;
  action: string;
  created_at: string;
};

type Item =
  | { kind: "msg"; at: string; chat_id: number; chat_title: string | null; from: string; text: string }
  | { kind: "rxn"; at: string; chat_id: number; chat_title: string | null; from: string; emoji: string; action: string };

function ActivityPage() {
  const qc = useQueryClient();
  const lm = useServerFn(listMessages);
  const lr = useServerFn(listReactions);

  const { data: msgs } = useQuery({
    queryKey: ["messages"],
    queryFn: () => lm() as Promise<Msg[]>,
    refetchInterval: 8000,
  });
  const { data: rxns } = useQuery({
    queryKey: ["reactions"],
    queryFn: () => lr() as Promise<Reaction[]>,
    refetchInterval: 8000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("activity-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () =>
        qc.invalidateQueries({ queryKey: ["messages"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, () =>
        qc.invalidateQueries({ queryKey: ["reactions"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const [activeChat, setActiveChat] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "messages" | "reactions">("all");

  // Aggregate per group
  const groups = useMemo(() => {
    const map = new Map<number, { chat_id: number; title: string; msgCount: number; rxnCount: number; people: Set<string>; lastAt: string }>();
    for (const m of msgs ?? []) {
      if (m.direction !== "in") continue;
      const g = map.get(m.tg_chat_id) ?? { chat_id: m.tg_chat_id, title: m.chat_title ?? String(m.tg_chat_id), msgCount: 0, rxnCount: 0, people: new Set<string>(), lastAt: m.created_at };
      g.msgCount++;
      if (m.from_name) g.people.add(m.from_name);
      if (m.created_at > g.lastAt) g.lastAt = m.created_at;
      g.title = m.chat_title ?? g.title;
      map.set(m.tg_chat_id, g);
    }
    for (const r of rxns ?? []) {
      const g = map.get(r.tg_chat_id) ?? { chat_id: r.tg_chat_id, title: r.chat_title ?? String(r.tg_chat_id), msgCount: 0, rxnCount: 0, people: new Set<string>(), lastAt: r.created_at };
      g.rxnCount++;
      if (r.from_name) g.people.add(r.from_name);
      if (r.created_at > g.lastAt) g.lastAt = r.created_at;
      g.title = r.chat_title ?? g.title;
      map.set(r.tg_chat_id, g);
    }
    const arr = Array.from(map.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    const q = search.trim().toLowerCase();
    return q ? arr.filter((g) => g.title.toLowerCase().includes(q)) : arr;
  }, [msgs, rxns, search]);

  const totalPeople = useMemo(() => {
    const s = new Set<string>();
    (msgs ?? []).forEach((m) => m.direction === "in" && m.from_name && s.add(`${m.tg_chat_id}:${m.from_name}`));
    (rxns ?? []).forEach((r) => r.from_name && s.add(`${r.tg_chat_id}:${r.from_name}`));
    return s.size;
  }, [msgs, rxns]);

  const totalMsgs = (msgs ?? []).filter((m) => m.direction === "in").length;
  const totalRxns = (rxns ?? []).length;

  const items: Item[] = useMemo(() => {
    if (activeChat == null) return [];
    const out: Item[] = [];
    (msgs ?? []).forEach((m) => {
      if (m.tg_chat_id !== activeChat || m.direction !== "in") return;
      out.push({ kind: "msg", at: m.created_at, chat_id: m.tg_chat_id, chat_title: m.chat_title, from: m.from_name ?? "Unknown", text: m.text ?? "" });
    });
    (rxns ?? []).forEach((r) => {
      if (r.tg_chat_id !== activeChat) return;
      out.push({ kind: "rxn", at: r.created_at, chat_id: r.tg_chat_id, chat_title: r.chat_title, from: r.from_name ?? "Unknown", emoji: r.emoji, action: r.action });
    });
    const filtered = out.filter((i) => (tab === "messages" ? i.kind === "msg" : tab === "reactions" ? i.kind === "rxn" : true));
    return filtered.sort((a, b) => b.at.localeCompare(a.at));
  }, [activeChat, msgs, rxns, tab]);

  const activeTitle = groups.find((g) => g.chat_id === activeChat)?.title ?? "";

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Group Activity</h1>
        <p className="text-sm text-muted-foreground">Dekho kis group me kisne message kiya ya react kiya.</p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat icon={<Users className="size-4" />} label="Active groups" value={groups.length} />
        <Stat icon={<MessageSquare className="size-4" />} label="Inbound messages" value={totalMsgs} />
        <Stat icon={<Smile className="size-4" />} label="Reactions" value={totalRxns} />
        <Stat icon={<Users className="size-4" />} label="People (per group)" value={totalPeople} />
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-4">
        <Card className="p-3 space-y-2 h-[70vh] flex flex-col">
          <div className="relative">
            <Search className="size-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input placeholder="Search group" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <div className="overflow-auto flex-1 space-y-1">
            {groups.length === 0 && (
              <div className="text-sm text-muted-foreground p-4 text-center">No group activity yet.</div>
            )}
            {groups.map((g) => (
              <button
                key={g.chat_id}
                onClick={() => setActiveChat(g.chat_id)}
                className={cn(
                  "w-full text-left p-2 rounded-md hover:bg-accent/60 transition-colors",
                  activeChat === g.chat_id && "bg-accent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-medium text-sm">{g.title}</div>
                  <div className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(g.lastAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-1.5 mt-1">
                  <Badge variant="secondary" className="text-[10px]">
                    <MessageSquare className="size-3 mr-1" />{g.msgCount}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    <Smile className="size-3 mr-1" />{g.rxnCount}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {g.people.size} ppl
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4 h-[70vh] flex flex-col">
          {activeChat == null ? (
            <div className="m-auto text-sm text-muted-foreground">Select a group to see activity</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="font-medium truncate">{activeTitle}</div>
                <div className="flex gap-1">
                  {(["all", "messages", "reactions"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-md border",
                        tab === t ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-auto flex-1 space-y-2">
                {items.length === 0 && (
                  <div className="text-sm text-muted-foreground p-4 text-center">Nothing to show.</div>
                )}
                {items.map((it, i) => (
                  <div key={i} className="p-2.5 rounded-md border bg-card/50">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{it.from}</span>
                        {it.kind === "rxn" ? (
                          <Badge variant="outline" className="text-[10px]">
                            <Smile className="size-3 mr-1" />reaction
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            <MessageSquare className="size-3 mr-1" />message
                          </Badge>
                        )}
                      </div>
                      <span>{new Date(it.at).toLocaleString()}</span>
                    </div>
                    {it.kind === "msg" ? (
                      <div className="text-sm whitespace-pre-wrap">{it.text || <span className="text-muted-foreground italic">(no text)</span>}</div>
                    ) : (
                      <div className="text-sm">
                        <span className="text-2xl mr-2">{it.emoji}</span>
                        {it.action === "remove" && <span className="text-xs text-muted-foreground">(removed)</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Card>
  );
}
