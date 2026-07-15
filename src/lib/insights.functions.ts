import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// --- Events ---

export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: events, error } = await supabase
      .from("memory_events")
      .select("id, name, event_type, description, start_date, end_date, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const ids = (events ?? []).map((e) => e.id);
    if (ids.length === 0) return [];

    const { data: docs } = await supabase
      .from("documents")
      .select("id, title, source_type, event_id, created_at")
      .in("event_id", ids);

    const grouped = new Map<string, any[]>();
    for (const d of docs ?? []) {
      if (!d.event_id) continue;
      const arr = grouped.get(d.event_id) ?? [];
      arr.push(d);
      grouped.set(d.event_id, arr);
    }

    return (events ?? []).map((e) => ({
      ...e,
      documents: grouped.get(e.id) ?? [],
    }));
  });

// --- Dashboard / Memory Insights ---

type ImportantDate = { date: string; label: string };

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [docsRes, eventsRes] = await Promise.all([
      supabase
        .from("documents")
        .select(
          "id, title, source_type, status, summary, category, important_dates, action_items, event_id, created_at, memory_events(id, name, event_type)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("memory_events")
        .select("id, name, event_type, description, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (docsRes.error) throw docsRes.error;
    const docs = (docsRes.data ?? []) as any[];
    const events = (eventsRes.data ?? []) as any[];

    // Storage usage
    const { data: files } = await supabase.storage
      .from("memories")
      .list(userId, { limit: 1000 });
    const bytes = (files ?? []).reduce(
      (sum, f) => sum + (f.metadata?.size ?? 0),
      0,
    );

    const now = new Date();
    const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Upcoming expirations / important dates
    const upcomingDates: Array<{
      documentId: string;
      title: string;
      date: string;
      label: string;
      daysAway: number;
    }> = [];
    for (const d of docs) {
      const dates = (d.important_dates ?? []) as ImportantDate[];
      for (const dt of dates) {
        const when = new Date(dt.date);
        if (isNaN(when.getTime())) continue;
        if (when >= now && when <= in90) {
          upcomingDates.push({
            documentId: d.id,
            title: d.title,
            date: dt.date,
            label: dt.label,
            daysAway: Math.round(
              (when.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
            ),
          });
        }
      }
    }
    upcomingDates.sort((a, b) => a.daysAway - b.daysAway);

    // Pending action items
    const pendingActions: Array<{
      documentId: string;
      title: string;
      action: string;
    }> = [];
    for (const d of docs) {
      for (const a of (d.action_items ?? []) as string[]) {
        pendingActions.push({ documentId: d.id, title: d.title, action: a });
      }
    }

    // Recently connected memories: events with >= 2 docs, most recent
    const recentEvents = events
      .map((e) => ({
        ...e,
        docCount: docs.filter((d) => d.event_id === e.id).length,
      }))
      .filter((e) => e.docCount >= 2)
      .slice(0, 5);

    // Recent memories
    const recentDocs = docs.slice(0, 6);

    return {
      totals: {
        memories: docs.length,
        events: events.length,
        storageBytes: bytes,
      },
      upcomingDates: upcomingDates.slice(0, 6),
      pendingActions: pendingActions.slice(0, 6),
      recentEvents,
      recentDocs,
    };
  });

// --- Timeline ---

export const getTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: docs, error } = await supabase
      .from("documents")
      .select(
        "id, title, source_type, summary, category, important_dates, created_at, event_id, memory_events(id, name, event_type)",
      );
    if (error) throw error;

    const items = (docs ?? []).map((d: any) => {
      const dates = (d.important_dates ?? []) as ImportantDate[];
      // pick the earliest important date if present, else created_at
      let when = new Date(d.created_at);
      let label = "Added";
      if (dates.length > 0) {
        const parsed = dates
          .map((x) => ({ ...x, t: new Date(x.date).getTime() }))
          .filter((x) => !isNaN(x.t))
          .sort((a, b) => a.t - b.t);
        if (parsed.length > 0) {
          when = new Date(parsed[0].t);
          label = parsed[0].label;
        }
      }
      return { ...d, when: when.toISOString(), whenLabel: label };
    });

    items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    return items;
  });

// --- Signed URL for viewing a stored file ---

export const getFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ path: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: signed, error } = await supabase.storage
      .from("memories")
      .createSignedUrl(data.path, 300);
    if (error) throw error;
    return { url: signed.signedUrl };
  });
