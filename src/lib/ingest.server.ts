// Server-only document processing helpers.
import { extractText, getDocumentProxy } from "unpdf";

const CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const CHAT_MODEL = "google/gemini-3-flash-preview";

function requireKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return key;
}

type ChatMessage = {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

async function callChat(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: CHAT_MODEL, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat request failed [${res.status}]: ${body}`);
  }
  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Extract plain text from a PDF file's bytes. */
export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).trim();
}

/** Use AI vision to produce a rich, searchable description of an image. */
export async function describeImage(
  base64: string,
  mime: string,
): Promise<string> {
  return callChat([
    {
      role: "system",
      content:
        "You are a meticulous visual analyst helping build a searchable personal memory. Describe the image in rich detail so it can later be found by natural-language questions. Transcribe ALL visible text verbatim. Note people, objects, scenes, charts, diagrams, handwriting, colors, and any context clues. Be thorough and factual.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this image in detail and transcribe any text it contains." },
        { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
      ],
    },
  ]);
}

/** Generate a concise title and one-sentence summary for a piece of content. */
export async function summarizeAndTitle(
  text: string,
): Promise<{ title: string; summary: string }> {
  const snippet = text.slice(0, 6000);
  const raw = await callChat([
    {
      role: "system",
      content:
        'You create concise metadata for saved memories. Respond ONLY with a compact JSON object of the form {"title": "...", "summary": "..."}. The title is at most 8 words. The summary is one clear sentence describing what this memory contains.',
    },
    { role: "user", content: snippet },
  ]);

  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { title?: string; summary?: string };
    return {
      title: (parsed.title || "Untitled memory").slice(0, 120),
      summary: (parsed.summary || "").slice(0, 400),
    };
  } catch {
    return {
      title: text.slice(0, 60).replace(/\s+/g, " ").trim() || "Untitled memory",
      summary: text.slice(0, 200).replace(/\s+/g, " ").trim(),
    };
  }
}

/** Split text into overlapping chunks suitable for embedding. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    // Prefer to break on a paragraph or sentence boundary near the end.
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const lastBreak = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
      );
      if (lastBreak > size * 0.5) {
        end = start + lastBreak + 1;
      }
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks.filter((c) => c.length > 0);
}
