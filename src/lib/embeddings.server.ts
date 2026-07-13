// Server-only embedding helper using the Lovable AI Gateway (OpenAI-compatible).
const EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
const EMBEDDING_MODEL = "google/gemini-embedding-001";
const MAX_BATCH = 100;

function requireKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return key;
}

async function embedBatch(inputs: string[], key: string): Promise<number[][]> {
  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding request failed [${res.status}]: ${body}`);
  }

  const json = (await res.json()) as {
    data: { index: number; embedding: number[] }[];
  };
  // Reassemble in original order.
  const ordered: number[][] = new Array(inputs.length);
  for (const item of json.data) {
    ordered[item.index] = item.embedding;
  }
  return ordered;
}

/** Embed many texts, batching to respect the per-request item cap. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = requireKey();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const vectors = await embedBatch(batch, key);
    out.push(...vectors);
  }
  return out;
}

/** Embed a single text (e.g. a search query). */
export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
