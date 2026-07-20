import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { getChatHistory, clearChat } from "@/lib/chat.functions";
import { listDocuments } from "@/lib/memories.functions";
import { AppShell } from "@/components/app-shell";
import { DocumentDialog } from "@/routes/_authenticated/vault";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Image as ImageIcon,
  StickyNote,
  Sparkles,
  Link2,
  MessageCircleQuestion,
  Eraser,
  CalendarClock,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import logo from "@/assets/memory-os-logo.png";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ask")({
  head: () => ({
    meta: [{ title: "Ask · Memory Weaver" }],
  }),
  validateSearch: z.object({
    q: z.string().optional(),
  }),
  errorComponent: ({ error, reset }) => (
    <AppShell>
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Something went wrong loading Ask.
        </p>
        <p className="max-w-md text-xs text-muted-foreground/80">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
        <Button size="sm" onClick={() => reset()}>Try again</Button>
      </div>
    </AppShell>
  ),
  component: AskPage,
});


type Source = { documentId: string; title: string; sourceType: string };
type RelatedMemory = {
  documentId: string;
  title: string;
  sourceType: string;
  eventName: string | null;
};
type Relevance = "high" | "medium" | "low" | "none";
type AssistantMetadata = {
  sources: Source[];
  related: RelatedMemory[];
  relevance: Relevance;
  followUps: string[];
};

const sourceIcon: Record<string, typeof FileText> = {
  pdf: FileText,
  image: ImageIcon,
  note: StickyNote,
};

const relevanceLabel: Record<Relevance, string> = {
  high: "High Match",
  medium: "Medium Match",
  low: "Low Match",
  none: "",
};

const relevanceStyle: Record<Relevance, string> = {
  high: "bg-primary/10 text-primary border-primary/20",
  medium: "bg-accent text-accent-foreground border-accent",
  low: "bg-muted text-muted-foreground border-border",
  none: "",
};

function getText(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

function AskPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data: history, isLoading } = useQuery({
    queryKey: ["chat-history"],
    queryFn: () => getChatHistory(),
  });

  const initialMessages = useMemo<UIMessage[]>(() => {
    if (!history) return [];
    return history.map((m) => {
      const meta = (m.sources ?? {}) as Partial<AssistantMetadata> | Source[];
      // Legacy rows stored sources as an array.
      const normalized: AssistantMetadata = Array.isArray(meta)
        ? { sources: meta, related: [], relevance: "none", followUps: [] }
        : {
            sources: meta.sources ?? [],
            related: meta.related ?? [],
            relevance: (meta.relevance ?? "none") as Relevance,
            followUps: meta.followUps ?? [],
          };
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        parts: [{ type: "text", text: m.content }],
        metadata: normalized,
      };
    });
  }, [history]);

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Shimmer>Loading your conversation…</Shimmer>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ChatInner
        key={initialMessages.length}
        initialMessages={initialMessages}
        prefilled={search.q}
        onConsumePrefill={() => navigate({ to: "/ask", search: {}, replace: true })}
      />
    </AppShell>
  );
}

function ChatInner({
  initialMessages,
  prefilled,
  onConsumePrefill,
}: {
  initialMessages: UIMessage[];
  prefilled?: string;
  onConsumePrefill: () => void;
}) {
  const queryClient = useQueryClient();
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const { data: allDocs } = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments() as Promise<any[]>,
  });
  const docsById = useMemo(() => {
    const m = new Map<string, any>();
    for (const d of allDocs ?? []) m.set(d.id, d);
    return m;
  }, [allDocs]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (url, options) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers = new Headers(options?.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          return fetch(url, { ...options, headers });
        },
      }),
    [],
  );

  const { messages, sendMessage, status } = useChat({
    messages: initialMessages,
    transport,
    onError: (err) => {
      console.error("Ask chat error:", err);
      toast.error(err?.message || "The assistant hit an error. Please try again.");
    },
  });


  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (status === "ready") inputRef.current?.focus();
  }, [status]);

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
  };

  // Consume the ?q= prefill exactly once
  const prefillConsumed = useRef(false);
  useEffect(() => {
    if (prefilled && !prefillConsumed.current) {
      prefillConsumed.current = true;
      send(prefilled);
      onConsumePrefill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilled]);

  // When streaming finishes, refetch history to pick up followUps + persisted metadata
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) wasBusy.current = true;
    if (!busy && wasBusy.current) {
      wasBusy.current = false;
      // small delay to allow server onFinish to persist
      const t = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["chat-history"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }, 400);
      return () => clearTimeout(t);
    }
  }, [busy, queryClient]);

  const startFresh = async () => {
    try {
      await clearChat();
      await queryClient.invalidateQueries({ queryKey: ["chat-history"] });
      toast.success("Conversation cleared.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {messages.length > 0 && (
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Weaving through your memories
            </p>
            <Button variant="ghost" size="sm" onClick={startFresh} disabled={busy}>
              <Eraser className="mr-1.5 h-3.5 w-3.5" />
              Start fresh
            </Button>
          </div>
        </div>
      )}

      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <ConversationEmptyState
              className="h-full"
              icon={<img src={logo} alt="" className="h-14 w-14 rounded-2xl" />}
              title="Ask anything about your memories."
              description="I'll weave together your PDFs, images, and notes — and answer with sources, related memories, and follow-up questions."
            >
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[
                  "What was the warranty my brother sent?",
                  "Which report mentioned Vitamin D deficiency?",
                  "Show everything related to my Japan trip.",
                  "Where is the passport I renewed last year?",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((message) => {
              const raw = message.metadata as Partial<AssistantMetadata> | undefined;
              const meta: AssistantMetadata = {
                sources: Array.isArray(raw?.sources) ? raw!.sources! : [],
                related: Array.isArray(raw?.related) ? raw!.related! : [],
                relevance: (raw?.relevance ?? "none") as Relevance,
                followUps: Array.isArray(raw?.followUps) ? raw!.followUps! : [],
              };
              const isAssistant = message.role === "assistant";
              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    <MessageResponse>{getText(message)}</MessageResponse>

                    {isAssistant && meta.relevance !== "none" && (
                      <div className="mt-3 flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            relevanceStyle[meta.relevance],
                          )}
                        >
                          <Sparkles className="mr-1 h-3 w-3" />
                          {relevanceLabel[meta.relevance]}
                        </span>
                      </div>
                    )}

                    {isAssistant && meta.sources.length > 0 && (
                      <DocSection
                        icon={FileText}
                        title="Source Documents"
                        items={meta.sources.map((s) => ({
                          documentId: s.documentId,
                          fallbackTitle: s.title,
                          fallbackType: s.sourceType,
                        }))}
                        docsById={docsById}
                        onOpen={setOpenDocId}
                      />
                    )}

                    {isAssistant && meta.related.length > 0 && (
                      <DocSection
                        icon={Link2}
                        title="Related Memories"
                        muted
                        items={meta.related.map((r) => ({
                          documentId: r.documentId,
                          fallbackTitle: r.title,
                          fallbackType: r.sourceType,
                          fallbackEvent: r.eventName ?? undefined,
                        }))}
                        docsById={docsById}
                        onOpen={setOpenDocId}
                      />
                    )}

                    {isAssistant && meta.followUps.length > 0 && (
                      <Section
                        icon={MessageCircleQuestion}
                        title="Suggested Follow-up Questions"
                      >
                        {meta.followUps.map((q) => (
                          <button
                            key={q}
                            onClick={() => send(q)}
                            disabled={busy}
                            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-50"
                          >
                            {q}
                          </button>
                        ))}
                      </Section>
                    )}
                  </MessageContent>
                </Message>
              );
            })

          )}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Weaving through your memories…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border bg-background px-4 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <PromptInput
            onSubmit={(msg) => {
              send(msg.text ?? "");
            }}
          >
            <PromptInputTextarea
              ref={inputRef}
              placeholder="Ask anything about your memories…"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={busy} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

      {openDocId && (
        <DocumentDialog
          documentId={openDocId}
          onClose={() => setOpenDocId(null)}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ["documents"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          }}
        />
      )}
    </div>
  );
}

type DocItem = {
  documentId: string;
  fallbackTitle: string;
  fallbackType: string;
  fallbackEvent?: string;
};

function DocSection({
  icon: Icon,
  title,
  items,
  docsById,
  onOpen,
  muted,
}: {
  icon: typeof FileText;
  title: string;
  items: DocItem[];
  docsById: Map<string, any>;
  onOpen: (id: string) => void;
  muted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const INITIAL = 3;
  const visible = expanded ? items : items.slice(0, INITIAL);
  const hidden = items.length - visible.length;
  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3 w-3" />
          {title}
          <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
            {items.length}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((it) => (
          <DocCard
            key={it.documentId}
            item={it}
            doc={docsById.get(it.documentId)}
            onOpen={onOpen}
            muted={muted}
          />
        ))}
      </div>
      {items.length > INITIAL && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] font-medium text-primary hover:underline"
        >
          {expanded
            ? "Show less"
            : `View all ${items.length} ${title.toLowerCase()}`}
          {!expanded && hidden > 0 ? ` (+${hidden})` : ""}
        </button>
      )}
    </div>
  );
}

function DocCard({
  item,
  doc,
  onOpen,
  muted,
}: {
  item: DocItem;
  doc: any | undefined;
  onOpen: (id: string) => void;
  muted?: boolean;
}) {
  const title = doc?.title ?? item.fallbackTitle;
  const sourceType = (doc?.source_type ?? item.fallbackType) as string;
  const Icon = sourceIcon[sourceType] ?? FileText;
  const category = doc?.category as string | null | undefined;
  const summary = doc?.summary as string | null | undefined;
  const status = doc?.status as string | undefined;
  const eventName =
    doc?.memory_events?.name ?? item.fallbackEvent ?? null;
  const nextDate = (doc?.important_dates ?? [])[0] as
    | { date: string; label: string }
    | undefined;
  const missing = doc && doc.status === undefined ? false : !doc;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 text-left transition-shadow hover:shadow-sm",
        muted
          ? "border-border bg-background"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight">
              {title}
            </p>
            {category && (
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {category}
              </p>
            )}
          </div>
        </div>
        {status === "processing" && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        {status === "failed" && (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        )}
      </div>

      {summary && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{summary}</p>
      )}

      {(eventName || nextDate) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {eventName && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              <Link2 className="h-2.5 w-2.5" />
              {eventName}
            </span>
          )}
          {nextDate && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <CalendarClock className="h-2.5 w-2.5" />
              {nextDate.label}: {nextDate.date}
            </span>
          )}
        </div>
      )}

      <div className="mt-1 flex items-center justify-between">
        {missing ? (
          <span className="text-[10px] text-muted-foreground">
            Preview unavailable in this session.
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {status === "ready"
              ? "Remembered"
              : status === "processing"
              ? "Understanding…"
              : status === "failed"
              ? "Processing failed"
              : ""}
          </span>
        )}
        <button
          onClick={() => onOpen(item.documentId)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </button>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
        muted
          ? "bg-background border border-border text-foreground"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      {children}
    </span>
  );
}
