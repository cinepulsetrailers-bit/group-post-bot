import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSettings, saveSettings } from "@/lib/automation.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

function genSecret(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function SettingsPage() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getSettings);
  const save = useServerFn(saveSettings);
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const [form, setForm] = useState({ base_url: "", shared_secret: "", webhook_secret: "" });

  // Hydrate form when data arrives
  useState(() => {});
  if (data && !form.base_url && (data.base_url || data.shared_secret || data.webhook_secret)) {
    setForm({
      base_url: data.base_url ?? "",
      shared_secret: data.shared_secret ?? "",
      webhook_secret: data.webhook_secret ?? "",
    });
  }

  const m = useMutation({
    mutationFn: () => save({ data: form }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/public/telegram/inbound`
      : "/api/public/telegram/inbound";

  function copy(t: string) {
    navigator.clipboard.writeText(t);
    toast.success("Copied");
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connect your external GramJS bridge server.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bridge connection</CardTitle>
          <CardDescription>
            Your bridge server runs separately (Railway / Render / VPS) and logs into your personal
            Telegram account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Bridge base URL</Label>
            <Input
              placeholder="https://my-tg-bridge.up.railway.app"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Shared secret (Lovable ↔ bridge auth)</Label>
            <div className="flex gap-2">
              <Input
                value={form.shared_secret}
                onChange={(e) => setForm({ ...form, shared_secret: e.target.value })}
                placeholder="long random string"
              />
              <Button type="button" variant="outline" onClick={() => setForm({ ...form, shared_secret: genSecret() })}>
                Generate
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Webhook secret (bridge → Lovable HMAC)</Label>
            <div className="flex gap-2">
              <Input
                value={form.webhook_secret}
                onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })}
                placeholder="long random string"
              />
              <Button type="button" variant="outline" onClick={() => setForm({ ...form, webhook_secret: genSecret() })}>
                Generate
              </Button>
            </div>
          </div>
          <Button onClick={() => m.mutate()} disabled={m.isPending || isLoading}>
            {m.isPending ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inbound webhook URL</CardTitle>
          <CardDescription>Configure this URL in your bridge's env.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} />
            <Button variant="outline" onClick={() => copy(webhookUrl)}>
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Bridge must send <code>X-User-Id</code> header and{" "}
            <code>X-Signature</code> = HMAC-SHA256(body, webhook_secret) hex.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
