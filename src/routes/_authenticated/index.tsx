import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "@/lib/insights.functions";
import { listDocuments } from "@/lib/memories.functions";
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
  Layers,
  CalendarRange,
  Tag,
  BookOpen,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [{ title: "Dashboard · Memory Weaver" }],
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

const PLACEHOLDERS = [
  "What was the warranty my brother sent?",
  "Which report mentioned Vitamin D deficiency?",
  "Show everything related to my Japan trip.",
  "Where is the passport I renewed last year?",
];

function DashboardPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
  });
  const { data: allDocs } = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments(),
  });

  useEffect(() => {
    const t = setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length),
      3500,
    );
    return () => clearInterval(t);
  }, []);

  const categoryCount = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDocs ?? []) {
      if ((d as any).category) set.add((d as any).category);
    }
    return set.size;
  }, [allDocs]);

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    navigate({ to: "/ask", search: { q: trimmed } });
  };

  const empty =
    !isLoading && data && data.totals.memories === 0;

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-10 pb-20">
          {/* Hero */}
          <header className="mb-10">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary/80">
              From memory to meaning.
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
              Welcome back <span className="inline-block">👋</span>
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Memory Weaver quietly organizes your documents into meaningful
              memories, so you can ask naturally instead of searching through
              folders.
            </p>
          </header>

          {/* Primary search */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
            className="mb-10 flex items-center gap-2 rounded-2xl border border-border bg-card p-2.5 shadow-sm transition-all focus-within:border-primary/50 focus-within:shadow-md"
          >
            <Sparkles className="ml-2 h-5 w-5 text-primary" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={PLACEHOLDERS[placeholderIdx]}
              className="flex-1 bg-transparent px-1 py-2 text-base outline-none placeholder:text-muted-foreground/80"
            />
            <Button type="submit" disabled={!q.trim()} size="lg">
              Ask
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </form>

          {isLoading || !data ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Shimmer>Weaving your memories together…</Shimmer>
            </div>
          ) : empty ? (
            <EmptyDashboard />
          ) : (
            <>
              {/* Stats */}
              <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  icon={BookOpen}
                  value={data.totals.memories}
                  label="Memories"
                  tint="text-primary bg-primary/10"
                />
                <StatCard
                  icon={CalendarRange}
                  value={data.totals.events}
                  label="Memory Events"
                  tint="text-chart-3 bg-chart-3/10"
                />
                <StatCard
                  icon={Tag}
                  value={categoryCount}
                  label="Categories"
                  tint="text-chart-4 bg-chart-4/10"
                />
                <StatCard
                  icon={Database}
                  value={formatBytes(data.totals.storageBytes)}
                  label="Storage Used"
                  tint="text-muted-foreground bg-muted"
                />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Memory Insights */}
                <section className="lg:col-span-2">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold tracking-tight">
                        Memory Insights
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Things worth remembering, surfaced automatically.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InsightGroup
                      icon={CalendarClock}
                      accent="text-emerald-600 bg-emerald-500/10"
                      title="Upcoming"
                      description="Expirations and dates on the horizon."
                      emptyEmoji="🟢"
                      emptyText="No upcoming expirations."
                    >
                      {data.upcomingDates.map((d) => (
                        <InsightRow
                          key={`${d.documentId}-${d.date}-${d.label}`}
                          onClick={() =>
                            ask(
                              `Tell me about ${d.label.toLowerCase()} of my ${d.title}`,
                            )
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
                      accent="text-orange-600 bg-orange-500/10"
                      title="Action Items"
                      description="Follow-ups pulled from your memories."
                      emptyEmoji="🟠"
                      emptyText="No pending action items."
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
                      accent="text-sky-600 bg-sky-500/10"
                      title="Connected Memories"
                      description="Documents Memory Weaver linked into events."
                      emptyEmoji="🔵"
                      emptyText="No connected memories yet."
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
                      accent="text-violet-600 bg-violet-500/10"
                      title="Recently Added"
                      description="Fresh memories, just woven in."
                      emptyEmoji="🟣"
                      emptyText="No recently added memories."
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
                          Nothing yet — your timeline will bloom as you add
                          memories.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function EmptyDashboard() {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card/40 p-10 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Layers className="h-7 w-7" />
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">
        Your memories are waiting to be woven together.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm font-medium text-foreground">
        Start building your second brain.
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Upload anything you want to remember (PDF, DOCX, XLSX, PPTX, TXT,
        Images, and more). Memory Weaver understands the context,
        intelligently connects related information, and helps you retrieve
        it naturally whenever you need it.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link to="/vault" search={{ upload: "1" } as any}>
          <Button>
            <Upload className="mr-2 h-4 w-4" />
            Upload your first document
          </Button>
        </Link>
        <Link to="/vault" search={{ note: "1" } as any}>
          <Button variant="outline">
            <StickyNote className="mr-2 h-4 w-4" />
            Or jot a quick note
          </Button>
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  tint,
}: {
  icon: typeof BookOpen;
  value: number | string;
  label: string;
  tint: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm">
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          tint,
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function InsightGroup({
  icon: Icon,
  accent,
  title,
  description,
  emptyEmoji,
  emptyText,
  children,
}: {
  icon: typeof CalendarClock;
  accent: string;
  title: string;
  description: string;
  emptyEmoji: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const arr = Array.isArray(children) ? children : [children];
  const hasChildren = arr.filter(Boolean).length > 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg",
            accent,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        {hasChildren ? (
          children
        ) : (
          <p className="text-xs text-muted-foreground">
            <span className="mr-1">{emptyEmoji}</span>
            {emptyText}
          </p>
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
      className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
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
