import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBridgeStatus } from "@/lib/bridge.functions";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function BridgeStatusIndicator() {
  const fetchStatus = useServerFn(getBridgeStatus);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["bridge-status"],
    queryFn: () => fetchStatus({}),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    retry: 1,
    staleTime: 0,
  });

  let color = "bg-muted-foreground";
  let label = "Checking…";
  let detail = "Contacting bridge…";

  if (isError) {
    color = "bg-destructive";
    label = "Bridge error";
    detail = "Failed to reach bridge status endpoint.";
  } else if (!isLoading && data) {
    if (!data.reachable) {
      color = "bg-destructive";
      label = "Bridge offline";
      detail = data.error ?? "Bridge URL unreachable.";
    } else if (data.telegramReady && data.telegramConnected) {
      color = "bg-emerald-500";
      label = "Connected";
      detail = "Telegram bridge is online and ready.";
    } else if (data.telegramConnected || data.reachable) {
      color = "bg-amber-500";
      label = "Connecting…";
      detail = "Bridge is up, Telegram session still warming up.";
    } else {
      color = "bg-destructive";
      label = "Telegram down";
      detail = data.error ?? "Bridge reachable but Telegram not connected.";
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 rounded-md border bg-card/50 px-2 py-1.5 text-xs cursor-default">
            <span className="relative flex size-2.5">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-60",
                  color,
                  (label === "Connected" || label === "Connecting…") && "animate-ping",
                )}
              />
              <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
            </span>
            <span className="font-medium truncate">{label}</span>
            {data?.queueSize ? (
              <span className="ml-auto text-muted-foreground">
                {data.queueSize} queued
              </span>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <div className="font-semibold">{label}</div>
            <div className="text-muted-foreground">{detail}</div>
            {data?.reachable && (
              <div className="grid grid-cols-2 gap-x-3 pt-1">
                <span>Telegram ready</span>
                <span>{data.telegramReady ? "yes" : "no"}</span>
                <span>Socket connected</span>
                <span>{data.telegramConnected ? "yes" : "no"}</span>
                {typeof data.queueSize === "number" && (
                  <>
                    <span>Queued msgs</span>
                    <span>{data.queueSize}</span>
                  </>
                )}
                {typeof data.cachedDialogs === "number" && (
                  <>
                    <span>Cached dialogs</span>
                    <span>{data.cachedDialogs}</span>
                  </>
                )}
                {typeof data.uptimeSeconds === "number" && (
                  <>
                    <span>Bridge uptime</span>
                    <span>{formatUptime(data.uptimeSeconds)}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function formatUptime(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}
