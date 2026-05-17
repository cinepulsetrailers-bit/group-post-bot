import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listGroups, syncGroups, toggleGroupSelected, selectAllGroups } from "@/lib/automation.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { RefreshCw, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/groups")({ component: GroupsPage });

function GroupsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listGroups);
  const sync = useServerFn(syncGroups);
  const toggle = useServerFn(toggleGroupSelected);
  const all = useServerFn(selectAllGroups);
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["groups"], queryFn: () => list() });

  const mSync = useMutation({
    mutationFn: () => sync(),
    onSuccess: (r) => {
      toast.success(`Synced ${r.synced} groups`);
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mToggle = useMutation({
    mutationFn: (v: { id: string; is_selected: boolean }) => toggle({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });
  const mAll = useMutation({
    mutationFn: (value: boolean) => all({ data: { value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });

  const groups = (data ?? []).filter((g) =>
    !q ? true : g.title.toLowerCase().includes(q.toLowerCase()),
  );
  const selectedCount = (data ?? []).filter((g) => g.is_selected).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Groups</h1>
          <p className="text-sm text-muted-foreground">
            {data?.length ?? 0} total · {selectedCount} selected
          </p>
        </div>
        <Button onClick={() => mSync.mutate()} disabled={mSync.isPending}>
          <RefreshCw className={`size-4 mr-1 ${mSync.isPending ? "animate-spin" : ""}`} />
          Sync from Telegram
        </Button>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Search groups…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="outline" onClick={() => mAll.mutate(true)}>Select all</Button>
        <Button variant="outline" onClick={() => mAll.mutate(false)}>Clear</Button>
      </div>

      <Card className="divide-y">
        {isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && groups.length === 0 && (
          <div className="p-10 text-center text-muted-foreground text-sm">
            <Users className="size-8 mx-auto mb-2 opacity-50" />
            No groups yet. Click "Sync from Telegram" after saving your bridge in Settings.
          </div>
        )}
        {groups.map((g) => (
          <label
            key={g.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer"
          >
            <Checkbox
              checked={g.is_selected}
              onCheckedChange={(v) => mToggle.mutate({ id: g.id, is_selected: !!v })}
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{g.title}</div>
              <div className="text-xs text-muted-foreground">
                {g.username ? `@${g.username} · ` : ""}id: {g.tg_chat_id}
              </div>
            </div>
          </label>
        ))}
      </Card>
    </div>
  );
}
