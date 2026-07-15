import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  BookOpen,
  LogOut,
  LayoutDashboard,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import logo from "@/assets/memory-os-logo.png";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/ask", label: "Ask", icon: MessageSquare },
  { to: "/vault", label: "Memory Vault", icon: BookOpen },
  { to: "/timeline", label: "Timeline", icon: Clock },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 md:flex">
        <Link to="/" className="flex items-center gap-2.5 px-2">
          <img src={logo} alt="Memory Weaver" className="h-8 w-8 rounded-lg" />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold tracking-tight">
              Memory Weaver
            </span>
            <span className="text-[11px] text-muted-foreground">
              From memory to meaning.
            </span>
          </div>
        </Link>

        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Button
          variant="ghost"
          className="justify-start gap-3 text-muted-foreground hover:text-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Memory OS" className="h-7 w-7 rounded-md" />
            <span className="font-semibold tracking-tight">Memory OS</span>
          </Link>
          <div className="flex items-center gap-1">
            {nav.map((item) => {
              const active = pathname === item.to;
              return (
                <Link key={item.to} to={item.to}>
                  <Button
                    variant={active ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={item.label}
                  >
                    <item.icon className="h-4 w-4" />
                  </Button>
                </Link>
              );
            })}
            <Button variant="ghost" size="icon-sm" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
