import { createFileRoute, Outlet, redirect, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Inbox, Send, Users, Calendar, Settings as SettingsIcon, LogOut, BarChart3, MessageSquare, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { BridgeStatusIndicator } from "@/components/BridgeStatusIndicator";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AuthLayout,
});

const NAV = [
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/replies", label: "Replies", icon: MessageSquare },
  { to: "/activity", label: "Group Activity", icon: Activity },
  { to: "/compose", label: "Compose", icon: Send },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/scheduled", label: "Scheduled", icon: Calendar },
  { to: "/reports", label: "Delivery Report", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

function AuthLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [user, loading, nav]);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-60 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <Send className="size-4" />
            </div>
            <div className="font-semibold">TG Broadcast</div>
          </div>
        </div>
        <nav className="p-2 space-y-1 flex-1">
          {NAV.map((n) => {
            const active = loc.pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t text-xs text-muted-foreground space-y-2">
          <div className="truncate">{user?.email}</div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={async () => {
              await supabase.auth.signOut();
              nav({ to: "/login" });
            }}
          >
            <LogOut className="size-3.5 mr-1" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
