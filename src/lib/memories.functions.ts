import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "memories";

type SupabaseCtxClient = Parameters<
  Parameters<typeof requireSupabaseAuth.server>[0]
>[0]["context"]["supabase"] extends never
  ? never
  : never;

// --- Internal: run the embedding pipeline for a document's text ---
async function processText(
  supabase: any,
  documentId: string,
  userId: string,
  text: string,
): Promise<void> {
  const { chunkText, summarizeAndTitle } = await import("./ingest.server");
  const { embedTexts } = await import("./embeddings.server");

  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    await supabase
      .from("documents")
      .update({ status: "failed", error: "No readable content found." })
      .eq("id", documentId);
    return;
  }

  const [{ title, summary }, chunks] = await Promise.all([
    summarizeAndTitle(trimmed),
    Promise.resolve(chunkText(trimmed)),
  ]);

  const embeddings = await embedTexts(chunks);

  const rows = chunks.map((content, index) => ({
    document_id: documentId,
    user_id: userId,
    content,
    chunk_index: index,
    embedding: JSON.stringify(embeddings[index]),
  }));

  // Replace any existing chunks (in case of re-processing).
  await supabase.from("document_chunks").delete().eq("document_id", documentId);
  const { error: chunkError } = await supabase.from("document_chunks").insert(rows);
  if (chunkError) throw chunkError;

  await supabase
    .from("documents")
    .update({ title, summary, status: "ready", error: null })
    .eq("id", documentId);
}

// --- Add a note (inserts + processes inline) ---
export const addNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ content: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc, error } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        source_type: "note",
        title: "New note",
        status: "processing",
      })
      .select()
      .single();
    if (error) throw error;

    try {
      await processText(supabase, doc.id, userId, data.content);
    } catch (e) {
      await supabase
        .from("documents")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", doc.id);
      throw e;
    }
    return { id: doc.id };
  });

// --- Register an uploaded file (fast insert, returns processing row) ---
export const addUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        filePath: z.string().min(1),
        mime: z.string().min(1),
        sourceType: z.enum(["pdf", "image"]),
        fileName: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc, error } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        source_type: data.sourceType,
        file_path: data.filePath,
        file_mime: data.mime,
        title: data.fileName?.slice(0, 120) || "Processing…",
        status: "processing",
      })
      .select()
      .single();
    if (error) throw error;
    return { id: doc.id };
  });

// --- Process an uploaded file (download + extract/vision + embed) ---
export const processUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ documentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc, error } = await supabase
      .from("documents")
      .select("*")
      .eq("id", data.documentId)
      .single();
    if (error) throw error;
    if (!doc.file_path) throw new Error("Document has no file.");

    try {
      const { data: file, error: dlError } = await supabase.storage
        .from(BUCKET)
        .download(doc.file_path);
      if (dlError) throw dlError;

      const bytes = await file.arrayBuffer();
      const { extractPdfText, describeImage } = await import("./ingest.server");

      let text = "";
      if (doc.source_type === "pdf") {
        text = await extractPdfText(bytes);
      } else if (doc.source_type === "image") {
        const base64 = Buffer.from(bytes).toString("base64");
        text = await describeImage(base64, doc.file_mime || "image/png");
      }

      await processText(supabase, doc.id, userId, text);
    } catch (e) {
      await supabase
        .from("documents")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", doc.id);
      throw e;
    }
    return { ok: true };
  });

// --- List all documents for the current user ---
export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("documents")
      .select("id, title, source_type, status, summary, error, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });

// --- Delete a document and its file ---
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc } = await supabase
      .from("documents")
      .select("file_path")
      .eq("id", data.id)
      .single();

    if (doc?.file_path) {
      await supabase.storage.from(BUCKET).remove([doc.file_path]);
    }
    const { error } = await supabase.from("documents").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
