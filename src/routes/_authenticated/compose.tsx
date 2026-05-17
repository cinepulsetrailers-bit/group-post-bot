import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listGroups, createPost, processPostChunk, getPostProgress } from "@/lib/automation.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Send, Loader2, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/compose")({ component: ComposePage });

function ComposePage() {
  const qc = useQueryClient();
  const list = useServerFn(listGroups);
  const post = useServerFn(createPost);
  const { data: groups } = useQuery({ queryKey: ["groups"], queryFn: () => list() });

  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"all" | "selected" | "custom">("selected");
  const [custom, setCustom] = useState<string[]>([]);
  const [schedule, setSchedule] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadMedia(file: File) {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      const path = `${uid}/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const { error } = await supabase.storage.from("media").upload(path, file);
      if (error) throw error;
      setMediaUrl(path);
      setMediaType(file.type.startsWith("image/") ? "photo" : "document");
      toast.success("Uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const m = useMutation({
    mutationFn: () =>
      post({
        data: {
          body,
          media_url: mediaUrl,
          media_type: mediaType,
          target_mode: mode,
          custom_group_ids: mode === "custom" ? custom : undefined,
          scheduled_at: schedule ? new Date(schedule).toISOString() : null,
        },
      }),
    onSuccess: (r) => {
      if (r.scheduled) toast.success(`Scheduled for ${r.targets} group(s)`);
      else toast.success(`Sent: ${r.ok ?? 0} ok, ${r.fail ?? 0} failed`);
      setBody("");
      setMediaUrl(null);
      setMediaType(null);
      setSchedule("");
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedCount = (groups ?? []).filter((g) => g.is_selected).length;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Compose</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="What do you want to broadcast?"
            maxLength={4096}
          />

          {mediaUrl ? (
            <div className="flex items-center gap-2 text-sm border rounded-md p-2 bg-muted/30">
              <span className="flex-1 truncate">📎 {mediaUrl.split("/").pop()} ({mediaType})</span>
              <Button size="sm" variant="ghost" onClick={() => { setMediaUrl(null); setMediaType(null); }}>
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div>
              <Label className="text-sm">Attach image/file (optional)</Label>
              <Input
                type="file"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && uploadMedia(e.target.files[0])}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target groups</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="selected" id="r1" />
              <span>Selected groups ({selectedCount})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="all" id="r2" />
              <span>All groups ({groups?.length ?? 0})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem value="custom" id="r3" />
              <span>Pick specific…</span>
            </label>
          </RadioGroup>

          {mode === "custom" && (
            <div className="mt-3 max-h-60 overflow-auto border rounded-md divide-y">
              {(groups ?? []).map((g) => (
                <label key={g.id} className="flex items-center gap-2 p-2 cursor-pointer hover:bg-accent/50">
                  <Checkbox
                    checked={custom.includes(g.id)}
                    onCheckedChange={(v) =>
                      setCustom((c) => (v ? [...c, g.id] : c.filter((x) => x !== g.id)))
                    }
                  />
                  <span className="text-sm">{g.title}</span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedule (optional)</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            type="datetime-local"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Leave empty to send immediately.
          </p>
        </CardContent>
      </Card>

      <Button
        size="lg"
        className="w-full"
        disabled={m.isPending || !body.trim() || uploading}
        onClick={() => m.mutate()}
      >
        {m.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />}
        {schedule ? "Schedule post" : "Send now"}
      </Button>
    </div>
  );
}
