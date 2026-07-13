import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listDocuments,
  addUpload,
  processUpload,
  addNote,
  deleteDocument,
} from "@/lib/memories.functions";
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [{ title: "Library · Memory OS" }],
  }),
  component: LibraryPage,
});

type Doc = {
  id: string;
  title: string;
  source_type: "pdf" | "image" | "note";
  status: "pending" | "processing" | "ready" | "failed";
  summary: string | null;
  error: string | null;
  created_at: string;
};

const typeMeta = {
  pdf: { icon: FileText, label: "PDF" },
  image: { icon: ImageIcon, label: "Image" },
  note: { icon: StickyNote, label: "Note" },
} as const;

function LibraryPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments() as Promise<Doc[]>,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["documents"] });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      toast.error("Your session expired. Please sign in again.");
      return;
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

      const uploadToast = toast.loading(`Uploading ${file.name}…`);
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
        toast.loading(`Understanding ${file.name}…`, { id: uploadToast });
        await processUpload({ data: { documentId: id } });
        await refresh();
        toast.success(`${file.name} added to your memory.`, { id: uploadToast });
      } catch (err) {
        toast.error(`Failed to process ${file.name}: ${(err as Error).message}`, {
          id: uploadToast,
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything you've saved. Uploads are read and understood
              automatically.
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
                  <Button onClick={saveNote} disabled={savingNote || !noteText.trim()}>
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

        {isLoading ? (
          <p className="mt-16 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : !docs || docs.length === 0 ? (
          <div className="mt-16 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <h3 className="mt-4 font-medium">Your library is empty</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Upload a PDF or image, or write a note. Then ask questions about it
              in chat.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((doc) => {
              const meta = typeMeta[doc.source_type];
              const Icon = meta.icon;
              return (
                <div
                  key={doc.id}
                  className="group relative flex flex-col rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <button
                      onClick={() => remove(doc.id)}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <h3 className="mt-3 line-clamp-2 font-medium leading-snug">
                    {doc.title}
                  </h3>
                  <p className="mt-1 line-clamp-3 flex-1 text-sm text-muted-foreground">
                    {doc.status === "failed"
                      ? doc.error ?? "Processing failed."
                      : doc.summary || "—"}
                  </p>
                  <div className="mt-3">
                    <StatusBadge status={doc.status} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Doc["status"] }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
        Ready
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
        <AlertCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground",
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      Processing
    </span>
  );
}
