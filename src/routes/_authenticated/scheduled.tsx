import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPosts, cancelScheduled } from "@/lib/automation.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/scheduled")({ component: ScheduledPage });

function ScheduledPage() {
  const qc = useQueryClient();
  const list = useServerFn(listPosts);
  const cancel = useServerFn(cancelScheduled);
  const { data, isLoading } = useQuery({ queryKey: ["posts"], queryFn: () => list() });

  const m = useMutation({
    mutationFn: (id: string) => cancel({ data: { id } }),
    onSuccess: () => {
      toast.success("Cancelled");
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const posts = data ?? [];

  function statusBadge(s: string) {
    const map: Record<string, string> = {
      sent: "bg-green-500/10 text-green-600 dark:text-green-400",
      failed: "bg-red-500/10 text-red-600 dark:text-red-400",
      queued: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      sending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      draft: "bg-muted text-muted-foreground",
    };
    return <Badge variant="outline" className={map[s] ?? ""}>{s}</Badge>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Posts</h1>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && posts.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground text-sm">
          No posts yet.
        </Card>
      )}
      <div className="space-y-2">
        {posts.map((p) => (
          <Card key={p.id} className="p-4 flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {statusBadge(p.status)}
                {p.scheduled_at && (
                  <span className="text-xs text-muted-foreground">
                    {p.status === "queued" ? "for " : ""}
                    {new Date(p.scheduled_at).toLocaleString()}
                  </span>
                )}
                {p.sent_at && p.status === "sent" && (
                  <span className="text-xs text-muted-foreground">
                    sent {new Date(p.sent_at).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="text-sm whitespace-pre-wrap line-clamp-3">{p.body || <em className="text-muted-foreground">(media only)</em>}</div>
              {p.media_url && <div className="text-xs text-muted-foreground mt-1">📎 attachment</div>}
            </div>
            {p.status === "queued" && (
              <Button size="sm" variant="ghost" onClick={() => m.mutate(p.id)}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
