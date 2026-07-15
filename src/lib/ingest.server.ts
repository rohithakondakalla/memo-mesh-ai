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

export type ImportantDate = { date: string; label: string };

export type MemoryMetadata = {
  title: string;
  summary: string;
  docType: string;
  category: string;
  people: string[];
  organizations: string[];
  locations: string[];
  keywords: string[];
  actionItems: string[];
  importantDates: ImportantDate[];
};

function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract the first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function asStringArray(v: unknown, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

function asDateArray(v: unknown, max = 8): ImportantDate[] {
  if (!Array.isArray(v)) return [];
  const out: ImportantDate[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const d = (item as { date?: unknown }).date;
    const l = (item as { label?: unknown }).label;
    if (typeof d === "string" && typeof l === "string" && d.trim() && l.trim()) {
      out.push({ date: d.trim(), label: l.trim() });
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Extract full memory metadata in one AI call. */
export async function extractMetadata(text: string): Promise<MemoryMetadata> {
  const snippet = text.slice(0, 12000);
  const raw = await callChat([
    {
      role: "system",
      content: `You are the "librarian" of a personal memory assistant. Given a piece of content the user saved (document text, image description, or a note), extract structured metadata that makes it findable and connectable to other memories.

Respond ONLY with a compact JSON object of this exact shape:
{
  "title": "short human title, at most 8 words",
  "summary": "one clear sentence describing what this memory contains",
  "doc_type": "single lowercase noun such as passport, invoice, prescription, itinerary, receipt, id_card, contract, boarding_pass, blood_test, letter, note, screenshot, etc.",
  "category": "single broad life area such as travel, medical, finance, education, home, work, personal, legal, or family",
  "people": ["names of people mentioned"],
  "organizations": ["companies, institutions, government bodies"],
  "locations": ["cities, countries, addresses, venues"],
  "keywords": ["6-10 salient nouns that describe the memory"],
  "action_items": ["clear tasks the user should do, phrased as imperative sentences; empty if none"],
  "important_dates": [{"date": "YYYY-MM-DD", "label": "what this date represents (e.g. Expiry, Appointment, Flight, Due date)"}]
}

Rules:
- Only include facts explicitly present or clearly implied.
- Use ISO YYYY-MM-DD for dates; if only month/year is known, use the first of the month.
- Keep arrays short (at most 12 items, dates at most 8).
- If a field is not applicable, use an empty array or empty string.`,
    },
    { role: "user", content: snippet },
  ]);

  const parsed = parseJsonLoose<Record<string, unknown>>(raw);
  const fallbackTitle =
    text.slice(0, 60).replace(/\s+/g, " ").trim() || "Untitled memory";
  const fallbackSummary = text.slice(0, 200).replace(/\s+/g, " ").trim();

  if (!parsed) {
    return {
      title: fallbackTitle,
      summary: fallbackSummary,
      docType: "",
      category: "",
      people: [],
      organizations: [],
      locations: [],
      keywords: [],
      actionItems: [],
      importantDates: [],
    };
  }

  return {
    title: (typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : fallbackTitle
    ).slice(0, 120),
    summary: (typeof parsed.summary === "string" ? parsed.summary.trim() : fallbackSummary).slice(0, 400),
    docType: typeof parsed.doc_type === "string" ? parsed.doc_type.trim().slice(0, 60) : "",
    category: typeof parsed.category === "string" ? parsed.category.trim().slice(0, 40) : "",
    people: asStringArray(parsed.people),
    organizations: asStringArray(parsed.organizations),
    locations: asStringArray(parsed.locations),
    keywords: asStringArray(parsed.keywords),
    actionItems: asStringArray(parsed.action_items),
    importantDates: asDateArray(parsed.important_dates),
  };
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

// --- Event inference ---

export type EventInferenceInput = {
  newDoc: {
    title: string;
    summary: string;
    doc_type: string;
    category: string;
    people: string[];
    organizations: string[];
    locations: string[];
    keywords: string[];
    important_dates: ImportantDate[];
  };
  existingEvents: Array<{
    id: string;
    name: string;
    event_type: string | null;
    description: string | null;
  }>;
  recentDocs: Array<{
    id: string;
    title: string;
    doc_type: string | null;
    category: string | null;
    event_id: string | null;
  }>;
};

export type EventInferenceResult =
  | { decision: "attach"; eventId: string; relatedDocIds: string[] }
  | {
      decision: "create";
      name: string;
      event_type: string;
      description: string;
      relatedDocIds: string[];
    }
  | { decision: "standalone" };

/**
 * Ask the AI whether this new memory belongs to an existing real-world event,
 * starts a new one, or stands alone. Returns a decision plus which recent docs
 * are most related (used to build Memory Connections edges).
 */
export async function inferEventForDocument(
  input: EventInferenceInput,
): Promise<EventInferenceResult> {
  const raw = await callChat([
    {
      role: "system",
      content: `You are the "connections" mind of a personal memory assistant. Your job is to figure out whether a newly saved memory belongs to a real-world EVENT in the user's life (like "Japan Trip", "Medical Treatment", "College Admission", "Home Purchase", "Wedding Planning", "Car Purchase"), together with other memories they've already saved.

You are not clustering by keyword similarity — you are identifying real-life events. An event groups documents that were produced by, or belong to, the same actual thing that happened or is happening. A single passport by itself is NOT an event. A passport + visa + flight + hotel booking IS a "Japan Trip".

Respond ONLY with compact JSON. Choose exactly one of these shapes:

1) Attach to an existing event:
{"decision":"attach","event_id":"<id from existing_events>","related_doc_ids":["<ids from recent_docs that clearly belong to the same event>"]}

2) Create a new event (only if 2+ related recent docs together clearly form a real event):
{"decision":"create","name":"Short human name like 'Japan Trip' or 'Medical Treatment'","event_type":"travel|medical|finance|education|home|work|legal|family|personal","description":"one sentence","related_doc_ids":["<ids from recent_docs that are part of this event>"]}

3) Not part of any event yet:
{"decision":"standalone"}

Rules:
- Event names must be inferred from context, never copied from a document title/filename.
- Prefer "attach" over "create" when a suitable event already exists.
- Only "create" when there is clear real-world evidence (multiple docs, matching dates/places/people) — a lone memory should be "standalone".
- Return no prose, only JSON.`,
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          new_memory: input.newDoc,
          existing_events: input.existingEvents,
          recent_docs: input.recentDocs,
        },
        null,
        2,
      ),
    },
  ]);

  const parsed = parseJsonLoose<Record<string, unknown>>(raw);
  if (!parsed) return { decision: "standalone" };

  const decision = parsed.decision;
  const related = asStringArray(parsed.related_doc_ids, 20);

  if (decision === "attach" && typeof parsed.event_id === "string") {
    // ensure the event id actually exists among the ones we sent
    const known = input.existingEvents.find((e) => e.id === parsed.event_id);
    if (known) {
      return {
        decision: "attach",
        eventId: known.id,
        relatedDocIds: related.filter((id) =>
          input.recentDocs.some((d) => d.id === id),
        ),
      };
    }
  }
  if (decision === "create") {
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (name && related.length >= 1) {
      return {
        decision: "create",
        name: name.slice(0, 80),
        event_type:
          typeof parsed.event_type === "string"
            ? parsed.event_type.trim().slice(0, 40)
            : "personal",
        description:
          typeof parsed.description === "string"
            ? parsed.description.trim().slice(0, 300)
            : "",
        relatedDocIds: related.filter((id) =>
          input.recentDocs.some((d) => d.id === id),
        ),
      };
    }
  }
  return { decision: "standalone" };
}

// --- Follow-up question generation ---

export async function generateFollowUps(
  question: string,
  answer: string,
  memorySummaries: string[],
): Promise<string[]> {
  if (!answer.trim()) return [];
  const raw = await callChat([
    {
      role: "system",
      content: `You suggest short follow-up questions the user might naturally ask next about their own memories. Respond ONLY with a JSON array of 3-5 short question strings (each under 60 chars). Base them on the retrieved memories provided — reference expirations, dates, related documents, action items, or summaries when relevant. No prose, just JSON like ["When does it expire?","Show all related documents"].`,
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          user_question: question,
          assistant_answer: answer,
          retrieved_memories: memorySummaries.slice(0, 6),
        },
        null,
        2,
      ),
    },
  ]);
  const parsed = parseJsonLoose<unknown>(raw);
  const arr = Array.isArray(parsed) ? parsed : [];
  return arr
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}
