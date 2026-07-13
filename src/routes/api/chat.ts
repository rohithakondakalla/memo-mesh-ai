import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { embedText } from "@/lib/embeddings.server";

type ChatRequestBody = { messages?: unknown };

type Source = {
  documentId: string;
  title: string;
  sourceType: string;
};

function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
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

        // Authenticate via bearer token attached by the client transport.
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
        const lastUser = [...uiMessages]
          .reverse()
          .find((m) => m.role === "user");
        const question = lastUser ? messageText(lastUser) : "";

        // --- Retrieval (RAG) ---
        let contextBlock = "";
        let sources: Source[] = [];
        if (question) {
          try {
            const queryEmbedding = await embedText(question);
            const { data: matches } = await supabase.rpc("match_chunks", {
              query_embedding: JSON.stringify(queryEmbedding) as unknown as string,
              match_user_id: userId,
              match_count: 6,
            });

            if (matches && matches.length > 0) {
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
            }
          } catch (e) {
            console.error("Retrieval failed:", e);
          }
        }

        const systemPrompt = `You are Memory OS, a personal memory assistant. You answer the user's questions using ONLY the retrieved memories provided below, which come from the user's own uploaded documents, images, and notes.

Guidelines:
- Answer naturally and conversationally in markdown.
- Base your answer strictly on the retrieved memories. If they do not contain the answer, say you couldn't find it in their memories and suggest what they might upload.
- When you use information from a memory, mention its title inline (e.g. "According to your note *Trip Plan*...").
- Never invent facts that are not in the memories.

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
          messages: convertToModelMessages(uiMessages),
          onFinish: async ({ text }) => {
            await supabase.from("chat_messages").insert({
              user_id: userId,
              role: "assistant",
              content: text,
              sources: sources as unknown as Database["public"]["Tables"]["chat_messages"]["Row"]["sources"],
            });
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: uiMessages,
          messageMetadata: () => ({ sources }),
        });
      },
    },
  },
});
