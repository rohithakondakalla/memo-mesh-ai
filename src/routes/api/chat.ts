import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { embedText } from "@/lib/embeddings.server";
import { generateFollowUps } from "@/lib/ingest.server";

type ChatRequestBody = { messages?: unknown };

type Source = {
  documentId: string;
  title: string;
  sourceType: string;
};

type RelatedMemory = {
  documentId: string;
  title: string;
  sourceType: string;
  eventName: string | null;
};

type AssistantMetadata = {
  sources: Source[];
  related: RelatedMemory[];
  relevance: "high" | "medium" | "low" | "none";
  followUps: string[];
};

function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

function relevanceFromScore(top: number): AssistantMetadata["relevance"] {
  if (top >= 0.7) return "high";
  if (top >= 0.5) return "medium";
  if (top >= 0.3) return "low";
  return "none";
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!key || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Server not configured", { status: 500 });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace("Bearer ", "");
        if (!token || token.split(".").length !== 3) {
          return new Response("Unauthorized", { status: 401 });
        }

        const supabase = createClient<Database>(
          SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          },
        );

        const { data: claims, error: claimsError } =
          await supabase.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (claimsError || !userId) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { messages } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages) || messages.length === 0) {
          return new Response("Messages are required", { status: 400 });
        }

        const uiMessages = messages as UIMessage[];
        const lastUser = [...uiMessages].reverse().find((m) => m.role === "user");
        const question = lastUser ? messageText(lastUser) : "";

        // --- Retrieval ---
        let contextBlock = "";
        let sources: Source[] = [];
        let related: RelatedMemory[] = [];
        let relevance: AssistantMetadata["relevance"] = "none";
        let memorySummaries: string[] = [];

        if (question) {
          try {
            const queryEmbedding = await embedText(question);
            const { data: matches } = await supabase.rpc("match_chunks", {
              query_embedding: JSON.stringify(queryEmbedding) as unknown as string,
              match_user_id: userId,
              match_count: 6,
            });

            if (matches && matches.length > 0) {
              const topScore = matches[0]?.similarity ?? 0;
              relevance = relevanceFromScore(topScore);

              const seen = new Set<string>();
              for (const m of matches) {
                if (!seen.has(m.document_id)) {
                  seen.add(m.document_id);
                  sources.push({
                    documentId: m.document_id,
                    title: m.title,
                    sourceType: m.source_type,
                  });
                }
              }
              contextBlock = matches
                .map(
                  (m, i) =>
                    `[Source ${i + 1}: "${m.title}" (${m.source_type})]\n${m.content}`,
                )
                .join("\n\n---\n\n");
              memorySummaries = matches.map(
                (m) => `${m.title} — ${m.content.slice(0, 200)}`,
              );

              // --- Related memories from the connections + events graph ---
              const sourceIds = Array.from(seen);

              // 1) Docs connected via memory_connections
              const { data: conns } = await supabase
                .from("memory_connections")
                .select("doc_a, doc_b")
                .or(
                  sourceIds
                    .map((id) => `doc_a.eq.${id},doc_b.eq.${id}`)
                    .join(","),
                );

              const relatedIds = new Set<string>();
              for (const c of conns ?? []) {
                if (sourceIds.includes(c.doc_a) && !seen.has(c.doc_b))
                  relatedIds.add(c.doc_b);
                if (sourceIds.includes(c.doc_b) && !seen.has(c.doc_a))
                  relatedIds.add(c.doc_a);
              }

              // 2) Same-event docs
              const { data: sourceDocs } = await supabase
                .from("documents")
                .select("event_id")
                .in("id", sourceIds);
              const eventIds = Array.from(
                new Set(
                  (sourceDocs ?? [])
                    .map((d) => d.event_id)
                    .filter((v): v is string => !!v),
                ),
              );
              if (eventIds.length > 0) {
                const { data: siblings } = await supabase
                  .from("documents")
                  .select("id")
                  .in("event_id", eventIds);
                for (const s of siblings ?? []) {
                  if (!seen.has(s.id)) relatedIds.add(s.id);
                }
              }

              if (relatedIds.size > 0) {
                const { data: relDocs } = await supabase
                  .from("documents")
                  .select(
                    "id, title, source_type, memory_events(name)",
                  )
                  .in("id", Array.from(relatedIds))
                  .limit(8);
                related = (relDocs ?? []).map((d: any) => ({
                  documentId: d.id,
                  title: d.title,
                  sourceType: d.source_type,
                  eventName: d.memory_events?.name ?? null,
                }));
              }
            }
          } catch (e) {
            console.error("Retrieval failed:", e);
          }
        }

        const systemPrompt = `You are Memory OS — the user's personal memory assistant and second brain. You never call yourself a chatbot. You help the user remember, connect, and reason about their own saved memories (documents, images, notes).

Answer using ONLY the retrieved memories below. When you use one, mention its title inline in italics (e.g. "According to your *Passport*..."). If the retrieved memories don't contain the answer, say so plainly and suggest what they might upload to remember it next time.

Write in warm, direct, second-person prose. Use short paragraphs and markdown. Do NOT list "Sources", "Related Memories", or "Follow-up questions" in the text — the app renders those separately.

Retrieved memories:
${contextBlock || "(No relevant memories were found for this question.)"}`;

        // Persist the user's message before streaming.
        if (question) {
          await supabase
            .from("chat_messages")
            .insert({ user_id: userId, role: "user", content: question });
        }

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: systemPrompt,
          messages: await convertToModelMessages(uiMessages),
          onFinish: async ({ text }) => {
            let followUps: string[] = [];
            try {
              followUps = await generateFollowUps(
                question,
                text,
                memorySummaries,
              );
            } catch (e) {
              console.error("Follow-up generation failed:", e);
            }

            const meta: AssistantMetadata = {
              sources,
              related,
              relevance,
              followUps,
            };

            await supabase.from("chat_messages").insert({
              user_id: userId,
              role: "assistant",
              content: text,
              sources: meta as unknown as Database["public"]["Tables"]["chat_messages"]["Row"]["sources"],
            });
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: uiMessages,
          messageMetadata: () => ({
            sources,
            related,
            relevance,
            followUps: [] as string[],
          }),
        });

      },
    },
  },
});
