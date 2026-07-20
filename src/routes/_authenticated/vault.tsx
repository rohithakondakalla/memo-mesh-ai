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
  updateNote,
  deleteDocument,
  getDocument,
} from "@/lib/memories.functions";
import { getFileUrl, listEvents } from "@/lib/insights.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
  Pencil,
  X,
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

const ACCEPTED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const ACCEPTED_LABEL = "PDF, PNG, JPG/JPEG";
const MAX_BYTES = 20 * 1024 * 1024; // 20MB

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function VaultPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments() as Promise<Doc[]>,
  });

  // Deep-link from dashboard: open the correct modal
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current) return;
    if (search.upload) {
      consumed.current = true;
      setUploadOpen(true);
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

  const processFile = async (file: File, userId: string, eventsBefore: Set<string>) => {
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/") && ACCEPTED_MIME.includes(file.type);
    if (!isPdf && !isImage) {
      toast.error(`${file.name}: unsupported type. Please upload ${ACCEPTED_LABEL}.`);
      return eventsBefore;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name}: file exceeds 20MB limit.`);
      return eventsBefore;
    }
    const sourceType = isPdf ? "pdf" : "image";
    const path = `${userId}/${crypto.randomUUID()}-${file.name}`;

    const steps = [
      "Uploading file…",
      "Extracting text…",
      "Understanding document…",
      "Identifying people, places, dates and keywords…",
      "Finding related memories…",
      "Weaving into your second brain…",
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
      if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

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
      toast.success(`${file.name} · Ready. Woven into your memory.`, {
        id: toastId,
      });
      await refresh();

      // New Memory Event detection
      try {
        const after = await listEvents();
        const newEvents = (after ?? []).filter(
          (e: any) => !eventsBefore.has(e.id),
        );
        const nextSet = new Set((after ?? []).map((e: any) => e.id));
        for (const ev of newEvents) {
          const count = (ev as any).documents?.length ?? 0;
          if (count < 1) continue;
          toast.success(
            `🧠 New Memory Event Created — ${ev.name} (${count} ${count === 1 ? "memory" : "memories"})`,
            {
              duration: 6000,
              action: {
                label: "View",
                onClick: () => {
                  window.location.href = "/timeline";
                },
              },
            },
          );
        }
        return nextSet;
      } catch {
        return eventsBefore;
      }
    } catch (err) {
      clearInterval(stepper);
      const message = (err as Error).message || "Unknown error";
      console.error("[Upload]", file.name, err);
      toast.error(`${file.name} failed: ${message}`, { id: toastId });
      await refresh();
      return eventsBefore;
    }
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      toast.error("Your session expired. Please sign in again.");
      return;
    }
    let eventsBefore = new Set<string>();
    try {
      const before = await listEvents();
      eventsBefore = new Set((before ?? []).map((e: any) => e.id));
    } catch {
      /* non-fatal */
    }
    for (const file of files) {
      eventsBefore = await processFile(file, userId, eventsBefore);
    }
  };

  const saveNote = async () => {
    if (!noteText.trim()) {
      toast.error("Please write something in the note body before saving.");
      return;
    }
    setSavingNote(true);
    const toastId = toast.loading("Saving note…");
    try {
      toast.loading("Understanding note…", { id: toastId });
      await addNote({
        data: {
          content: noteText.trim(),
          title: noteTitle.trim() || undefined,
        },
      });
      toast.success("Note saved to your memory.", { id: toastId });
      setNoteText("");
      setNoteTitle("");
      setNoteOpen(false);
      await refresh();
    } catch (err) {
      console.error("[Note save]", err);
      toast.error(`Save failed: ${(err as Error).message}`, { id: toastId });
    } finally {
      setSavingNote(false);
    }
  };

  const cancelNote = () => {
    if ((noteText.trim() || noteTitle.trim()) && !savingNote) {
      if (!confirm("Discard this note? Your changes will be lost.")) return;
    }
    setNoteText("");
    setNoteTitle("");
    setNoteOpen(false);
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
              <Button variant="outline" onClick={() => setNoteOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New note
              </Button>
              <Button onClick={() => setUploadOpen(true)}>
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
                  : `Upload a ${ACCEPTED_LABEL} file or jot a note. Memory Weaver will read it, understand it, and connect it to the rest of your life.`}
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
                    onClick={() => setOpenDocId(doc.id)}
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

        {/* Note editor */}
        <Dialog
          open={noteOpen}
          onOpenChange={(o) => {
            if (!o) cancelNote();
            else setNoteOpen(true);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New note</DialogTitle>
              <DialogDescription>
                Anything you write here becomes searchable memory.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Title (optional)
                </label>
                <Input
                  autoFocus
                  placeholder="Give this note a title…"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Note content
                </label>
                <Textarea
                  rows={10}
                  placeholder="Write anything you want to remember. Paragraphs, bullet points, quotes — all searchable later."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={cancelNote} disabled={savingNote}>
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

        {/* Upload flow */}
        <UploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onSubmit={async (files) => {
            setUploadOpen(false);
            await handleFiles(files);
          }}
        />

        {openDocId && (
          <DocumentDialog
            documentId={openDocId}
            onClose={() => setOpenDocId(null)}
            onChanged={refresh}
          />
        )}
      </div>
    </AppShell>
  );
}

// ---------- Upload modal ----------

function UploadDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (files: File[]) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open) setFiles([]);
  }, [open]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: File[] = [];
    for (const f of Array.from(list)) {
      if (!ACCEPTED_MIME.includes(f.type)) {
        toast.error(`${f.name}: unsupported. Please pick ${ACCEPTED_LABEL}.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name}: exceeds 20MB.`);
        continue;
      }
      next.push(f);
    }
    setFiles((prev) => [...prev, ...next]);
  };

  const removeAt = (i: number) =>
    setFiles((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload to your vault</DialogTitle>
          <DialogDescription>
            Supported: {ACCEPTED_LABEL}. Max 20MB per file.
          </DialogDescription>
        </DialogHeader>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-card/40 hover:border-primary/40",
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Upload className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium">
            Drag & drop, or click to select files
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ACCEPTED_LABEL}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_MIME.join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="max-h-52 space-y-2 overflow-y-auto">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {f.type || "unknown"} · {formatBytes(f.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(files)}
            disabled={files.length === 0}
          >
            Upload {files.length > 0 ? `(${files.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Document detail ----------

export function DocumentDialog({
  documentId,
  onClose,
  onChanged,
}: {
  documentId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument({ data: { id: documentId } }),
  });

  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);

  // Preview signed URL for inline image rendering only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (data?.doc?.file_path && data.doc.file_mime?.startsWith("image/")) {
        try {
          const { url } = await getFileUrl({
            data: { path: data.doc.file_path },
          });
          if (!cancelled) setFileUrl(url);
        } catch {
          if (!cancelled) setFileUrl(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.doc?.file_path, data?.doc?.file_mime]);

  const openOriginal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!data?.doc?.file_path) {
      toast.error("Original file is unavailable.");
      return;
    }
    // Open a blank tab synchronously so popup blockers don't swallow it.
    const newTab = window.open("", "_blank", "noopener,noreferrer");
    setOpening(true);
    (async () => {
      try {
        const { url } = await getFileUrl({
          data: { path: data.doc.file_path },
        });
        if (!url) throw new Error("No signed URL returned.");
        if (newTab) {
          newTab.opener = null;
          newTab.location.href = url;
        } else {
          const a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } catch (err) {
        if (newTab) newTab.close();
        console.error("[Open original]", err);
        toast.error(
          `Unable to open the original file. ${(err as Error).message || "Please try again."}`,
        );
      } finally {
        setOpening(false);
      }
    })();
  };

  const startEdit = () => {
    if (!data) return;
    setEditTitle(data.doc.title || "");
    setEditBody(data.originalContent || "");
    setEditing(true);
  };

  const cancelEdit = () => {
    if (data && (editTitle !== (data.doc.title || "") ||
      editBody !== (data.originalContent || ""))) {
      if (!confirm("Discard your changes?")) return;
    }
    setEditing(false);
  };

  const handleClose = () => {
    if (editing && data && (editTitle !== (data.doc.title || "") ||
      editBody !== (data.originalContent || ""))) {
      if (!confirm("You have unsaved changes. Close anyway?")) return;
    }
    onClose();
  };

  const saveEdit = async () => {
    if (!editBody.trim()) {
      toast.error("Note body cannot be empty.");
      return;
    }
    setSaving(true);
    const toastId = toast.loading("Saving changes…");
    try {
      toast.loading("Re-understanding your note…", { id: toastId });
      await updateNote({
        data: {
          id: documentId,
          content: editBody.trim(),
          title: editTitle.trim() || undefined,
        },
      });
      toast.success("Note updated.", { id: toastId });
      setEditing(false);
      await refetch();
      onChanged();
    } catch (err) {
      console.error("[Note update]", err);
      toast.error(`Update failed: ${(err as Error).message}`, { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl">
        {isLoading || !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-3">
                <span className="truncate">{data.doc.title}</span>
                {data.doc.source_type === "note" && !editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={startEdit}
                    className="shrink-0"
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
              </DialogTitle>
              <DialogDescription>
                {data.doc.category ? `${data.doc.category} · ` : ""}
                {new Date(data.doc.created_at).toLocaleDateString()}
              </DialogDescription>
            </DialogHeader>

            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Title
                  </label>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Note content
                  </label>
                  <Textarea
                    rows={12}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={saveEdit} disabled={saving || !editBody.trim()}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
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

                {data.doc.source_type === "note" && data.originalContent && (
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Your note
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {data.originalContent}
                    </p>
                  </div>
                )}

                {data.doc.summary && (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      AI summary
                    </p>
                    <p className="text-sm text-foreground">{data.doc.summary}</p>
                  </div>
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
                {data.doc.source_type !== "note" && data.doc.file_path && (
                  <button
                    type="button"
                    onClick={openOriginal}
                    disabled={opening}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline disabled:opacity-60"
                  >
                    <FileText className="h-4 w-4" />
                    {opening
                      ? "Opening…"
                      : data.doc.source_type === "pdf"
                      ? "Open original PDF"
                      : data.doc.file_mime?.startsWith("image/")
                      ? "Open original image"
                      : "Open original file"}
                  </button>
                )}
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
            )}
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
