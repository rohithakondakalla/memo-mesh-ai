import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getTimeline } from "@/lib/insights.functions";
import { AppShell } from "@/components/app-shell";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  FileText,
  Image as ImageIcon,
  StickyNote,
  Link2,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/timeline")({
  head: () => ({
    meta: [{ title: "Timeline · Memory Weaver" }],
  }),
  component: TimelinePage,
});

const sourceIcon: Record<string, typeof FileText> = {
  pdf: FileText,
  image: ImageIcon,
  note: StickyNote,
};

function TimelinePage() {
  const { data: items, isLoading } = useQuery({
    queryKey: ["timeline"],
    queryFn: () => getTimeline(),
  });

  const grouped = useMemo(() => {
    if (!items) return [] as Array<{ label: string; items: any[] }>;
    const map = new Map<string, any[]>();
    for (const item of items) {
      const d = new Date(item.when);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });
      const arr = map.get(key) ?? [];
      arr.push({ ...item, _label: label });
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([, arr]) => ({ label: arr[0]._label, items: arr }));
  }, [items]);

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8 pb-16">
          <header className="mb-8">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
              Your story, woven
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Memory Timeline
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your life's timeline, in the order it actually happened.
            </p>
          </header>

          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Shimmer>Weaving your timeline…</Shimmer>
            </div>
          ) : grouped.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/40 py-20 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center">
                <svg
                  viewBox="0 0 64 64"
                  className="h-16 w-16 text-primary/60"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <circle cx="14" cy="14" r="4" />
                  <circle cx="50" cy="20" r="4" />
                  <circle cx="20" cy="42" r="4" />
                  <circle cx="46" cy="50" r="4" />
                  <path d="M18 14 L46 20 M16 18 L20 38 M24 42 L46 48 M50 24 L46 46" strokeDasharray="2 3" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium">Your story begins here.</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Upload your first passport, receipt, bill, medical report or
                note — Memory Weaver will automatically connect the dots into
                a timeline you can navigate.
              </p>
              <Link
                to="/vault"
                className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Add your first memory
              </Link>
            </div>
          ) : (
            <div className="space-y-10">
              {grouped.map((group) => (
                <section key={group.label}>
                  <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </h2>
                  <div className="relative space-y-4 border-l-2 border-border pl-6">
                    {group.items.map((item: any) => {
                      const Icon = sourceIcon[item.source_type] ?? FileText;
                      const when = new Date(item.when);
                      return (
                        <div key={item.id} className="relative">
                          <div className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                            <Icon className="h-3 w-3" />
                          </div>
                          <Link
                            to="/vault"
                            className="block rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">
                                  {when.toLocaleDateString(undefined, {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })}{" "}
                                  · {item.whenLabel}
                                </p>
                                <h3 className="mt-0.5 truncate font-medium">
                                  {item.title}
                                </h3>
                                {item.summary && (
                                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                    {item.summary}
                                  </p>
                                )}
                              </div>
                              {item.memory_events?.name && (
                                <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
                                  <Link2 className="h-3 w-3" />
                                  {item.memory_events.name}
                                </span>
                              )}
                            </div>
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
