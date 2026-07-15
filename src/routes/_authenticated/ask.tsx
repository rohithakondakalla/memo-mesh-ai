import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { getChatHistory, clearChat } from "@/lib/chat.functions";
import { AppShell } from "@/components/app-shell";
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
              const meta =
                (message.metadata as AssistantMetadata | undefined) ??
                undefined;
              const isAssistant = message.role === "assistant";
              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    <MessageResponse>{getText(message)}</MessageResponse>

                    {isAssistant && meta && meta.relevance !== "none" && (
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

                    {isAssistant && meta && meta.sources.length > 0 && (
                      <Section
                        icon={FileText}
                        title="Source Documents"
                      >
                        {meta.sources.map((src) => {
                          const Icon = sourceIcon[src.sourceType] ?? FileText;
                          return (
                            <Chip key={src.documentId}>
                              <Icon className="h-3 w-3" />
                              {src.title}
                            </Chip>
                          );
                        })}
                      </Section>
                    )}

                    {isAssistant && meta && meta.related.length > 0 && (
                      <Section icon={Link2} title="Related Memories">
                        {meta.related.map((r) => {
                          const Icon = sourceIcon[r.sourceType] ?? FileText;
                          return (
                            <Chip key={r.documentId} muted>
                              <Icon className="h-3 w-3" />
                              {r.title}
                              {r.eventName && (
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  · {r.eventName}
                                </span>
                              )}
                            </Chip>
                          );
                        })}
                      </Section>
                    )}

                    {isAssistant && meta && meta.followUps.length > 0 && (
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
              placeholder="Ask your memories…"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={busy} />
            </PromptInputFooter>
          </PromptInput>
        </div>
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
