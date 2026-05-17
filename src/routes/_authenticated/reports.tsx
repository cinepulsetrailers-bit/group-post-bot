import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listPosts, getPostReport } from "@/lib/automation.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, Clock, RefreshCw, Search, Download } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

type StatusFilter = "all" | "sent" | "failed" | "pending";

type ErrorCategory =
  | "timeout"
  | "flood"
  | "blocked"
  | "invalid_chat"
  | "permission"
  | "bridge_down"
  | "auth"
  | "other";

const CATEGORY_META: Record<ErrorCategory, { label: string; emoji: string; hint: string }> = {
  timeout: { label: "Timeout", emoji: "⏱️", hint: "Bridge took too long to respond" },
  flood: { label: "Flood / Rate limit", emoji: "🌊", hint: "Telegram throttled — slow down or wait" },
  blocked: { label: "Peer blocked / Kicked", emoji: "🚫", hint: "Bot was removed or blocked in this group" },
  invalid_chat: { label: "Invalid chat", emoji: "❓", hint: "Group not found, deleted, or wrong ID" },
  permission: { label: "Permission denied", emoji: "🔒", hint: "Not allowed to post (admin-only, restricted)" },
  bridge_down: { label: "Bridge down (502)", emoji: "💥", hint: "Railway bridge crashed or sleeping" },
  auth: { label: "Auth / Session", emoji: "🔑", hint: "Telegram session expired — re-login bridge" },
  other: { label: "Other", emoji: "❔", hint: "Uncategorized error" },
};

function categorizeError(err: string | null | undefined): ErrorCategory {
  if (!err) return "other";
  const e = err.toLowerCase();
  if (/\b50(2|3|4)\b|failed to respond|bad gateway|service unavailable/.test(e)) return "bridge_down";
  if (/timeout|timed out|etimedout/.test(e)) return "timeout";
  if (/flood|too many requests|slowmode|slow_mode|429/.test(e)) return "flood";
  if (/blocked|kicked|user_banned|banned_in_channel|left the chat|chat_write_forbidden|forbidden/.test(e))
    return "blocked";
  if (/peer_id_invalid|chat not found|chat_id_invalid|invalid chat|peer not found|channel_invalid/.test(e))
    return "invalid_chat";
  if (/permission|not_allowed|admin_required|need administrator|rights/.test(e)) return "permission";
  if (/unauthorized|auth_key|session|401|sign in/.test(e)) return "auth";
  return "other";
}

function ReportsPage() {
  const listPostsFn = useServerFn(listPosts);
  const getReportFn = useServerFn(getPostReport);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const postsQ = useQuery({
    queryKey: ["posts-report-list"],
    queryFn: () => listPostsFn(),
    refetchInterval: 5000,
  });

  const reportQ = useQuery({
    queryKey: ["post-report", selectedPostId],
    queryFn: () => getReportFn({ data: { post_id: selectedPostId! } }),
    enabled: !!selectedPostId,
    refetchInterval: 4000,
  });

  const rows = reportQ.data?.rows ?? [];
  const counts = useMemo(() => {
    const c = { sent: 0, failed: 0, pending: 0, total: rows.length };
    for (const r of rows) {
      if (r.status === "sent") c.sent++;
      else if (r.status === "failed") c.failed++;
      else c.pending++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.group_title} ${r.group_username ?? ""} ${r.tg_chat_id} ${r.error ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, search]);

  const exportCsv = () => {
    if (!filtered.length) return;
    const header = ["status", "group_title", "group_username", "tg_chat_id", "sent_at", "error"];
    const lines = [
      header.join(","),
      ...filtered.map((r) =>
        [
          r.status,
          JSON.stringify(r.group_title ?? ""),
          r.group_username ?? "",
          r.tg_chat_id,
          r.sent_at ?? "",
          JSON.stringify(r.error ?? ""),
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery-report-${selectedPostId?.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full">
      {/* Posts list */}
      <div className="w-80 border-r overflow-auto">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Posts</h2>
          <p className="text-xs text-muted-foreground">Select a post to see delivery</p>
        </div>
        <div className="divide-y">
          {postsQ.data?.map((p: any) => {
            const active = selectedPostId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedPostId(p.id)}
                className={cn(
                  "w-full text-left p-3 hover:bg-accent/50 transition-colors",
                  active && "bg-accent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString()}
                  </span>
                  <StatusPill status={p.status} />
                </div>
                <p className="text-sm mt-1 line-clamp-2">{p.body || "(media only)"}</p>
              </button>
            );
          })}
          {postsQ.data?.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">No posts yet</div>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-auto">
        {!selectedPostId ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Select a post on the left to view delivery report
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {/* Stat cards */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Total" value={counts.total} icon={<RefreshCw className="size-4" />} />
              <StatCard
                label="Sent"
                value={counts.sent}
                icon={<CheckCircle2 className="size-4 text-green-600" />}
                onClick={() => setStatusFilter("sent")}
              />
              <StatCard
                label="Failed"
                value={counts.failed}
                icon={<XCircle className="size-4 text-red-600" />}
                onClick={() => setStatusFilter("failed")}
              />
              <StatCard
                label="Pending"
                value={counts.pending}
                icon={<Clock className="size-4 text-amber-600" />}
                onClick={() => setStatusFilter("pending")}
              />
            </div>

            {/* Filter bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search group name, username, or error..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({counts.total})</SelectItem>
                  <SelectItem value="sent">Sent ({counts.sent})</SelectItem>
                  <SelectItem value="failed">Failed ({counts.failed})</SelectItem>
                  <SelectItem value="pending">Pending ({counts.pending})</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
                <Download className="size-4 mr-1" /> CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => reportQ.refetch()}
              >
                <RefreshCw className={cn("size-4", reportQ.isFetching && "animate-spin")} />
              </Button>
            </div>

            {/* Targets list */}
            <Card className="divide-y">
              {filtered.map((r) => (
                <div key={r.id} className="p-3 flex items-start gap-3">
                  <div className="mt-0.5">
                    {r.status === "sent" && <CheckCircle2 className="size-5 text-green-600" />}
                    {r.status === "failed" && <XCircle className="size-5 text-red-600" />}
                    {r.status === "pending" && <Clock className="size-5 text-amber-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{r.group_title}</span>
                      {r.group_username && (
                        <span className="text-xs text-muted-foreground">@{r.group_username}</span>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {r.tg_chat_id}
                      </Badge>
                    </div>
                    {r.sent_at && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Sent: {new Date(r.sent_at).toLocaleString()}
                      </p>
                    )}
                    {r.error && (
                      <p className="text-xs text-red-600 mt-1 break-all font-mono bg-red-50 dark:bg-red-950/30 p-2 rounded">
                        {r.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No targets match this filter
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn("p-4", onClick && "cursor-pointer hover:bg-accent/50")}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    sending: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    queued: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    draft: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full uppercase font-medium", map[status] ?? map.draft)}>
      {status}
    </span>
  );
}
