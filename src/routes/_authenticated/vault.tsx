import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  listDocuments,
  addUpload,
  processUpload,
  addNote,
  deleteDocument,
  getDocument,
} from "@/lib/memories.functions";
import { getFileUrl, listEvents } from "@/lib/insights.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  FileText,
  Image as ImageIcon,
  StickyNote,
  Upload,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Search,
  CalendarClock,
  CheckSquare,
  Sparkles,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/vault")({
  head: () => ({
    meta: [{ title: "Memory Vault · Memory Weaver" }],
  }),
  validateSearch: z.object({
    upload: z.string().optional(),
    note: z.string().optional(),
  }),
  component: VaultPage,
});

type Doc = {
  id: string;
  title: string;
  source_type: "pdf" | "image" | "note";
  status: "pending" | "processing" | "ready" | "failed";
  summary: string | null;
  error: string | null;
  created_at: string;
  doc_type: string | null;
  category: string | null;
  keywords: string[] | null;
  important_dates: Array<{ date: string; label: string }> | null;
  action_items: string[] | null;
  event_id: string | null;
  memory_events: { id: string; name: string; event_type: string | null } | null;
};

const typeMeta = {
  pdf: { icon: FileText, label: "PDF" },
  image: { icon: ImageIcon, label: "Image" },
  note: { icon: StickyNote, label: "Note" },
} as const;

function VaultPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [query, setQuery] = useState("");
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments() as Promise<Doc[]>,
  });

  // consume ?upload / ?note deep links from the dashboard once
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current) return;
    if (search.upload) {
      consumed.current = true;
      fileInputRef.current?.click();
    } else if (search.note) {
      consumed.current = true;
      setNoteOpen(true);
    }
  }, [search.upload, search.note]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const filtered = useMemo(() => {
    if (!docs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => {
      const hay = [
        d.title,
        d.summary,
        d.category,
        d.doc_type,
        d.memory_events?.name,
        ...(d.keywords ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [docs, query]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      toast.error("Your session expired. Please sign in again.");
      return;
    }

    // Snapshot event names before processing, to detect newly-created events.
    let eventsBefore = new Set<string>();
    try {
      const before = await listEvents();
      eventsBefore = new Set((before ?? []).map((e: any) => e.id));
    } catch {
      /* non-fatal */
    }

    for (const file of Array.from(files)) {
      const isPdf = file.type === "application/pdf";
      const isImage = file.type.startsWith("image/");
      if (!isPdf && !isImage) {
        toast.error(`${file.name}: only PDFs and images are supported.`);
        continue;
      }
      const sourceType = isPdf ? "pdf" : "image";
      const path = `${userId}/${crypto.randomUUID()}-${file.name}`;

      const steps = [
        "Reading document…",
        "Extracting text…",
        "Understanding content…",
        "Identifying people, places and dates…",
        "Creating memory connections…",
        "Building your second brain…",
      ];
      const toastId = toast.loading(`${file.name} · ${steps[0]}`);
      let step = 0;
      const stepper = setInterval(() => {
        step = Math.min(step + 1, steps.length - 1);
        toast.loading(`${file.name} · ${steps[step]}`, { id: toastId });
      }, 1600);

      try {
        const { error: upErr } = await supabase.storage
          .from("memories")
          .upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;

        const { id } = await addUpload({
          data: {
            filePath: path,
            mime: file.type,
            sourceType,
            fileName: file.name,
          },
        });
        await refresh();
        await processUpload({ data: { documentId: id } });
        clearInterval(stepper);
        toast.success(`${file.name} · Done. Woven into your memory.`, {
          id: toastId,
        });
        await refresh();

        // Detect any newly-created Memory Event and celebrate it.
        try {
          const after = await listEvents();
          const newEvents = (after ?? []).filter(
            (e: any) => !eventsBefore.has(e.id),
          );
          eventsBefore = new Set((after ?? []).map((e: any) => e.id));
          for (const ev of newEvents) {
            const count = (ev as any).documents?.length ?? 0;
            if (count < 1) continue;
            toast.success(
              `🧠 New Memory Event Created\n${ev.name}\n${count} ${count === 1 ? "memory" : "memories"} connected.`,
              {
                duration: 6000,
                action: {
                  label: "View Event",
                  onClick: () => {
                    window.location.href = "/timeline";
                  },
                },
              },
            );
          }
        } catch {
          /* non-fatal */
        }
      } catch (err) {
        clearInterval(stepper);
        toast.error(`Failed to process ${file.name}: ${(err as Error).message}`, {
          id: toastId,
        });
        await refresh();
      }
    }
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await addNote({ data: { content: noteText.trim() } });
      setNoteText("");
      setNoteOpen(false);
      await refresh();
      toast.success("Note saved to your memory.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingNote(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteDocument({ data: { id } });
      await refresh();
      toast.success("Memory deleted.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 pb-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
                Your second brain
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">
                Memory Vault
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Every document, image and note Memory Weaver has quietly
                understood on your behalf.
              </p>
            </div>
            <div className="flex gap-2">
              <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    New note
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New note</DialogTitle>
                    <DialogDescription>
                      Anything you write here becomes searchable memory.
                    </DialogDescription>
                  </DialogHeader>
                  <Textarea
                    autoFocus
                    rows={8}
                    placeholder="Write anything you want to remember…"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onClick={() => setNoteOpen(false)}
                      disabled={savingNote}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={saveNote}
                      disabled={savingNote || !noteText.trim()}
                    >
                      {savingNote ? "Saving…" : "Save note"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </Button>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary/40">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your memories by title, keyword, or event…"
              className="flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {isLoading ? (
            <p className="mt-16 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : !filtered || filtered.length === 0 ? (
            <div className="mt-16 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Upload className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight">
                {docs && docs.length > 0
                  ? "No memories match that search."
                  : "Your vault is quiet — for now."}
              </h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {docs && docs.length > 0
                  ? "Try a different keyword or event name."
                  : "Upload a passport, a receipt or a photo. Memory Weaver will read it, understand it, and connect it to the rest of your life."}
              </p>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((doc) => {
                const meta = typeMeta[doc.source_type];
                const Icon = meta.icon;
                const nextDate = (doc.important_dates ?? [])[0];
                return (
                  <button
                    key={doc.id}
                    onClick={() =>
                      doc.status === "ready" && setOpenDocId(doc.id)
                    }
                    className="group relative flex flex-col rounded-xl border border-border bg-card p-4 text-left transition-shadow hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                          <Icon className="h-4 w-4" />
                        </div>
                        {doc.category && (
                          <span className="rounded-md bg-accent/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-foreground">
                            {doc.category}
                          </span>
                        )}
                      </div>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(doc.id);
                        }}
                        role="button"
                        tabIndex={-1}
                        className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </div>
                    </div>

                    <h3 className="mt-3 line-clamp-2 font-medium leading-snug">
                      {doc.title}
                    </h3>
                    <p className="mt-1 line-clamp-3 flex-1 text-sm text-muted-foreground">
                      {doc.status === "failed"
                        ? doc.error ?? "Processing failed."
                        : doc.summary || "—"}
                    </p>

                    {doc.memory_events?.name && (
                      <div className="mt-3 inline-flex w-fit items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
                        <Link2 className="h-3 w-3" />
                        {doc.memory_events.name}
                      </div>
                    )}

                    {nextDate && (
                      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CalendarClock className="h-3 w-3" />
                        {nextDate.label}: {nextDate.date}
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between">
                      <StatusBadge status={doc.status} />
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {openDocId && (
          <DocumentDialog
            documentId={openDocId}
            onClose={() => setOpenDocId(null)}
          />
        )}
      </div>
    </AppShell>
  );
}

function DocumentDialog({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument({ data: { id: documentId } }),
  });

  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (data?.doc?.file_path) {
        try {
          const { url } = await getFileUrl({
            data: { path: data.doc.file_path },
          });
          setFileUrl(url);
        } catch {
          setFileUrl(null);
        }
      }
    })();
  }, [data?.doc?.file_path]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {isLoading || !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{data.doc.title}</DialogTitle>
              <DialogDescription>
                {data.doc.category ? `${data.doc.category} · ` : ""}
                {new Date(data.doc.created_at).toLocaleDateString()}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[65vh] space-y-4 overflow-y-auto">
              {data.doc.memory_events?.name && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                    <Link2 className="h-4 w-4" />
                    Part of "{data.doc.memory_events.name}"
                  </div>
                  {data.doc.memory_events.description && (
                    <p className="mt-1 text-xs text-primary/80">
                      {data.doc.memory_events.description}
                    </p>
                  )}
                </div>
              )}

              {data.doc.summary && (
                <p className="text-sm text-foreground">{data.doc.summary}</p>
              )}

              <MetaGrid doc={data.doc} />

              {(() => {
                const dates = (data.doc.important_dates ??
                  []) as Array<{ date: string; label: string }>;
                return dates.length > 0 ? (
                  <MetaBlock icon={CalendarClock} title="Important dates">
                    <ul className="space-y-1 text-sm">
                      {dates.map((d, i) => (
                        <li key={i} className="flex justify-between">
                          <span>{d.label}</span>
                          <span className="text-muted-foreground">{d.date}</span>
                        </li>
                      ))}
                    </ul>
                  </MetaBlock>
                ) : null;
              })()}

              {data.doc.action_items?.length > 0 && (
                <MetaBlock icon={CheckSquare} title="Action items">
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {data.doc.action_items.map((a: string, i: number) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </MetaBlock>
              )}

              {data.related.length > 0 && (
                <MetaBlock icon={Link2} title="Related memories">
                  <div className="flex flex-wrap gap-1.5">
                    {data.related.map((r) => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
                      >
                        {r.title}
                      </span>
                    ))}
                  </div>
                </MetaBlock>
              )}

              {fileUrl && data.doc.file_mime?.startsWith("image/") && (
                <img
                  src={fileUrl}
                  alt={data.doc.title}
                  className="max-h-64 rounded-lg border border-border object-contain"
                />
              )}
              {fileUrl && data.doc.source_type === "pdf" && (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  Open original PDF
                </a>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaGrid({ doc }: { doc: any }) {
  const items: Array<{ label: string; values: string[] }> = [
    { label: "People", values: doc.people ?? [] },
    { label: "Organizations", values: doc.organizations ?? [] },
    { label: "Locations", values: doc.locations ?? [] },
    { label: "Keywords", values: doc.keywords ?? [] },
  ].filter((i) => i.values.length > 0);
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {item.label}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.values.map((v) => (
              <span
                key={v}
                className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetaBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: Doc["status"] }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
        <Sparkles className="h-3 w-3" />
        Remembered
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
        <AlertCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground",
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      Understanding
    </span>
  );
}
