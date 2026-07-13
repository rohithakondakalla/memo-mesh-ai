import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import { getChatHistory } from "@/lib/chat.functions";
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
import { FileText, Image as ImageIcon, StickyNote, Brain } from "lucide-react";
import logo from "@/assets/memory-os-logo.png";

export const Route = createFileRoute("/_authenticated/")({
  component: ChatPage,
});

type Source = { documentId: string; title: string; sourceType: string };

const sourceIcon: Record<string, typeof FileText> = {
  pdf: FileText,
  image: ImageIcon,
  note: StickyNote,
};

function getText(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

function ChatPage() {
  const { data: history, isLoading } = useQuery({
    queryKey: ["chat-history"],
    queryFn: () => getChatHistory(),
  });

  const initialMessages = useMemo<UIMessage[]>(() => {
    if (!history) return [];
    return history.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      parts: [{ type: "text", text: m.content }],
      metadata: { sources: (m.sources ?? []) as Source[] },
    }));
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
      <ChatInner key={initialMessages.length} initialMessages={initialMessages} />
    </AppShell>
  );
}

function ChatInner({ initialMessages }: { initialMessages: UIMessage[] }) {
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

  return (
    <div className="flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <ConversationEmptyState
              className="h-full"
              icon={<img src={logo} alt="" className="h-14 w-14 rounded-2xl" />}
              title="Ask your memory anything"
              description="I'll search across your uploaded PDFs, images, and notes and answer with sources."
            >
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[
                  "What did I save about my trip plans?",
                  "Summarize my latest document",
                  "Find the invoice amount",
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
              const sources =
                (message.metadata as { sources?: Source[] } | undefined)
                  ?.sources ?? [];
              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    <MessageResponse>{getText(message)}</MessageResponse>
                    {message.role === "assistant" && sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
                        {sources.map((src) => {
                          const Icon = sourceIcon[src.sourceType] ?? Brain;
                          return (
                            <span
                              key={src.documentId}
                              className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
                            >
                              <Icon className="h-3 w-3" />
                              {src.title}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </MessageContent>
                </Message>
              );
            })
          )}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Searching your memories…</Shimmer>
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
