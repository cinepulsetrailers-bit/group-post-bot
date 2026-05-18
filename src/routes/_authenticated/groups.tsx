import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listGroups, syncGroups, toggleGroupSelected, selectAllGroups,
  leaveGroups, listFailedGroupsFromLastPost,
} from "@/lib/automation.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { RefreshCw, Users, LogOut, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/groups")({ component: GroupsPage });

function GroupsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listGroups);
  const sync = useServerFn(syncGroups);
  const toggle = useServerFn(toggleGroupSelected);
  const all = useServerFn(selectAllGroups);
  const listFailed = useServerFn(listFailedGroupsFromLastPost);
  const leave = useServerFn(leaveGroups);
  const [q, setQ] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmIds, setConfirmIds] = useState<string[]>([]);
  const [confirmTitle, setConfirmTitle] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["groups"], queryFn: () => list() });
  const { data: failedGroups } = useQuery({
    queryKey: ["failedGroupsLastPost"],
    queryFn: () => listFailed(),
  });

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
  const mLeave = useMutation({
    mutationFn: (group_ids: string[]) => leave({ data: { group_ids } }),
    onSuccess: (r) => {
      if (r.failed > 0) {
        toast.warning(`Left ${r.left} groups, ${r.failed} failed`);
      } else {
        toast.success(`Left ${r.left} group${r.left === 1 ? "" : "s"} on Telegram`);
      }
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["failedGroupsLastPost"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const askLeave = (ids: string[], title: string) => {
    setConfirmIds(ids);
    setConfirmTitle(title);
    setConfirmOpen(true);
  };

  const groups = (data ?? []).filter((g) =>
    !q ? true : g.title.toLowerCase().includes(q.toLowerCase()),
  );
  const selectedCount = (data ?? []).filter((g) => g.is_selected).length;
  const failedCount = failedGroups?.length ?? 0;

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

      {failedCount > 0 && (
        <Card className="p-4 border-destructive/30 bg-destructive/5 flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium text-destructive">
              {failedCount} group{failedCount === 1 ? "" : "s"} rejected your last broadcast
            </div>
            <div className="text-muted-foreground text-xs">
              These have restrictions (admin-only, write forbidden, paid, etc.). Leave them so they don't waste future sends.
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => askLeave(
              (failedGroups ?? []).map((g) => g.id),
              `Leave ${failedCount} failed group${failedCount === 1 ? "" : "s"}`,
            )}
            disabled={mLeave.isPending}
          >
            <LogOut className="size-4 mr-1" />
            {mLeave.isPending ? "Leaving…" : "Leave all failed"}
          </Button>
        </Card>
      )}

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
          <div
            key={g.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50"
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
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => askLeave([g.id], `Leave "${g.title}"`)}
              disabled={mLeave.isPending}
              title="Leave this group on Telegram"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your Telegram account will leave {confirmIds.length === 1 ? "this group" : `these ${confirmIds.length} groups`} permanently.
              They will also be removed from your Groups list here. You can rejoin manually on Telegram later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                mLeave.mutate(confirmIds);
                setConfirmOpen(false);
              }}
            >
              Yes, leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
