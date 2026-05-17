import { createFileRoute } from "@tanstack/react-router";
import { runDuePostsInternal } from "@/lib/automation.functions";

export const Route = createFileRoute("/api/public/hooks/run-scheduled")({
  server: {
    handlers: {
      POST: async () => {
        const sent = await runDuePostsInternal();
        return Response.json({ ok: true, sent });
      },
      GET: async () => {
        const sent = await runDuePostsInternal();
        return Response.json({ ok: true, sent });
      },
    },
  },
});
