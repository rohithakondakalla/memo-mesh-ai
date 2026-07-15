import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "@/lib/insights.functions";
import { AppShell } from "@/components/app-shell";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import {
  CalendarClock,
  CheckSquare,
  Link2,
  Sparkles,
  Upload,
  StickyNote,
  FileText,
  Image as ImageIcon,
  Database,
  ArrowRight,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [{ title: "Dashboard · Memory OS" }],
  }),
  component: DashboardPage,
});

const sourceIcon: Record<string, typeof FileText> = {
  pdf: FileText,
  image: ImageIcon,
  note: StickyNote,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function DashboardPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
  });

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    navigate({ to: "/ask", search: { q: trimmed } });
  };

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 pb-16">
          <header className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your second brain has been quietly organizing your memories.
              Ask it anything.
            </p>
          </header>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
            className="mb-8 flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-primary/40"
          >
            <Sparkles className="ml-2 h-5 w-5 text-primary" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your memory — “when does my passport expire?”"
              className="flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button type="submit" disabled={!q.trim()}>
              Ask
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </form>

          {isLoading || !data ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Shimmer>Loading your memory…</Shimmer>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Memory Insights — spans two cols on large */}
              <section className="lg:col-span-2 rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">
                      Memory Insights
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Things worth remembering, surfaced automatically.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <InsightGroup
                    icon={CalendarClock}
                    title="Upcoming"
                    empty="No expirations coming up."
                  >
                    {data.upcomingDates.map((d) => (
                      <InsightRow
                        key={`${d.documentId}-${d.date}-${d.label}`}
                        onClick={() =>
                          ask(`Tell me about ${d.label.toLowerCase()} of my ${d.title}`)
                        }
                        primary={`${d.label} · ${d.title}`}
                        secondary={
                          d.daysAway === 0
                            ? "today"
                            : d.daysAway === 1
                              ? "tomorrow"
                              : `in ${d.daysAway} days · ${d.date}`
                        }
                      />
                    ))}
                  </InsightGroup>

                  <InsightGroup
                    icon={CheckSquare}
                    title="Pending action items"
                    empty="Nothing on your plate right now."
                  >
                    {data.pendingActions.map((a, i) => (
                      <InsightRow
                        key={`${a.documentId}-${i}`}
                        onClick={() =>
                          ask(`What action items are in my ${a.title}?`)
                        }
                        primary={a.action}
                        secondary={`from ${a.title}`}
                      />
                    ))}
                  </InsightGroup>

                  <InsightGroup
                    icon={Link2}
                    title="Recently connected"
                    empty="No memory events detected yet."
                  >
                    {data.recentEvents.map((e: any) => (
                      <InsightRow
                        key={e.id}
                        onClick={() =>
                          ask(`Show everything about my ${e.name}`)
                        }
                        primary={e.name}
                        secondary={`${e.docCount} memories · ${e.event_type ?? "personal"}`}
                        badge
                      />
                    ))}
                  </InsightGroup>

                  <InsightGroup
                    icon={Sparkles}
                    title="Recently added"
                    empty="Upload something to get started."
                  >
                    {data.recentDocs.map((d: any) => {
                      const Icon = sourceIcon[d.source_type] ?? FileText;
                      return (
                        <InsightRow
                          key={d.id}
                          icon={Icon}
                          onClick={() => ask(`Summarize my ${d.title}`)}
                          primary={d.title}
                          secondary={d.summary ?? d.category ?? ""}
                        />
                      );
                    })}
                  </InsightGroup>
                </div>
              </section>

              {/* Right column */}
              <div className="flex flex-col gap-6">
                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Your memory
                  </h2>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <Stat
                      label="Memories"
                      value={data.totals.memories.toString()}
                    />
                    <Stat
                      label="Events"
                      value={data.totals.events.toString()}
                    />
                  </div>
                  <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                    <Database className="h-4 w-4" />
                    {formatBytes(data.totals.storageBytes)} stored
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick add
                  </h2>
                  <div className="mt-4 flex flex-col gap-2">
                    <Link to="/vault" search={{ upload: "1" } as any}>
                      <Button variant="outline" className="w-full justify-start">
                        <Upload className="mr-2 h-4 w-4" />
                        Upload PDF or image
                      </Button>
                    </Link>
                    <Link to="/vault" search={{ note: "1" } as any}>
                      <Button variant="outline" className="w-full justify-start">
                        <StickyNote className="mr-2 h-4 w-4" />
                        New note
                      </Button>
                    </Link>
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      Timeline
                    </h2>
                    <Link
                      to="/timeline"
                      className="text-xs text-primary hover:underline"
                    >
                      View all
                    </Link>
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    {data.recentDocs.slice(0, 4).map((d: any) => {
                      const Icon = sourceIcon[d.source_type] ?? FileText;
                      return (
                        <div key={d.id} className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-secondary">
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {d.title}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {new Date(d.created_at).toLocaleDateString()}
                              {d.memory_events?.name
                                ? ` · ${d.memory_events.name}`
                                : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {data.recentDocs.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Nothing yet — upload a passport, a bill, or write a
                        note.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function InsightGroup({
  icon: Icon,
  title,
  empty,
  children,
}: {
  icon: typeof CalendarClock;
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const arr = Array.isArray(children) ? children : [children];
  const hasChildren = arr.filter(Boolean).length > 0;
  return (
    <div className="rounded-xl border border-border/60 bg-background p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {hasChildren ? (
          children
        ) : (
          <p className="text-xs text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  );
}

function InsightRow({
  primary,
  secondary,
  onClick,
  icon: Icon,
  badge,
}: {
  primary: string;
  secondary?: string;
  onClick?: () => void;
  icon?: typeof FileText;
  badge?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      {Icon ? (
        <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      ) : null}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "line-clamp-2 text-sm leading-snug",
            badge ? "font-medium" : "",
          )}
        >
          {primary}
        </p>
        {secondary && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {secondary}
          </p>
        )}
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
