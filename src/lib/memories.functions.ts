import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "memories";

// --- Internal: run the embedding + metadata + event-inference pipeline ---

async function processText(
  supabase: any,
  documentId: string,
  userId: string,
  text: string,
): Promise<void> {
  const { chunkText, extractMetadata, inferEventForDocument } = await import(
    "./ingest.server"
  );
  const { embedTexts } = await import("./embeddings.server");

  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    await supabase
      .from("documents")
      .update({ status: "failed", error: "No readable content found." })
      .eq("id", documentId);
    return;
  }

  const [meta, chunks] = await Promise.all([
    extractMetadata(trimmed),
    Promise.resolve(chunkText(trimmed)),
  ]);

  const embeddings = await embedTexts(chunks);

  const rows = chunks.map((content: string, index: number) => ({
    document_id: documentId,
    user_id: userId,
    content,
    chunk_index: index,
    embedding: JSON.stringify(embeddings[index]),
  }));

  await supabase.from("document_chunks").delete().eq("document_id", documentId);
  const { error: chunkError } = await supabase.from("document_chunks").insert(rows);
  if (chunkError) throw chunkError;

  await supabase
    .from("documents")
    .update({
      title: meta.title,
      summary: meta.summary,
      doc_type: meta.docType,
      category: meta.category,
      people: meta.people,
      organizations: meta.organizations,
      locations: meta.locations,
      keywords: meta.keywords,
      action_items: meta.actionItems,
      important_dates: meta.importantDates as unknown as object,
      status: "ready",
      error: null,
    })
    .eq("id", documentId);

  // --- Event inference: try to attach this memory to a real-world event ---
  try {
    const { data: events } = await supabase
      .from("memory_events")
      .select("id, name, event_type, description")
      .order("created_at", { ascending: false })
      .limit(30);

    const { data: recent } = await supabase
      .from("documents")
      .select("id, title, doc_type, category, event_id")
      .eq("status", "ready")
      .neq("id", documentId)
      .order("created_at", { ascending: false })
      .limit(30);

    const result = await inferEventForDocument({
      newDoc: {
        title: meta.title,
        summary: meta.summary,
        doc_type: meta.docType,
        category: meta.category,
        people: meta.people,
        organizations: meta.organizations,
        locations: meta.locations,
        keywords: meta.keywords,
        important_dates: meta.importantDates,
      },
      existingEvents: (events ?? []) as any[],
      recentDocs: (recent ?? []) as any[],
    });

    let eventId: string | null = null;
    let related: string[] = [];

    if (result.decision === "attach") {
      eventId = result.eventId;
      related = result.relatedDocIds;
    } else if (result.decision === "create") {
      const { data: newEvent, error: evErr } = await supabase
        .from("memory_events")
        .insert({
          user_id: userId,
          name: result.name,
          event_type: result.event_type,
          description: result.description,
        })
        .select()
        .single();
      if (!evErr && newEvent) {
        eventId = newEvent.id;
        related = result.relatedDocIds;
        // attach the related recent docs to the new event too
        if (related.length > 0) {
          await supabase
            .from("documents")
            .update({ event_id: eventId })
            .in("id", related);
        }
      }
    }

    if (eventId) {
      await supabase
        .from("documents")
        .update({ event_id: eventId })
        .eq("id", documentId);
    }

    // Always record pairwise connections to related docs the AI identified
    if (related.length > 0) {
      const connectionRows = related.map((otherId) => {
        // canonical ordering to satisfy the unique pair constraint
        const [a, b] =
          documentId < otherId
            ? [documentId, otherId]
            : [otherId, documentId];
        return {
          user_id: userId,
          doc_a: a,
          doc_b: b,
          relation: eventId ? "same_event" : "related",
        };
      });
      await supabase
        .from("memory_connections")
        .upsert(connectionRows, { onConflict: "doc_a,doc_b", ignoreDuplicates: true });
    }
  } catch (e) {
    // Never fail the whole ingestion just because inference failed.
    console.error("Event inference failed:", e);
  }
}

// --- Add a note (inserts + processes inline) ---
export const addNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        content: z.string().min(1),
        title: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const initialTitle = data.title?.trim() || "New note";
    const { data: doc, error } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        source_type: "note",
        title: initialTitle,
        status: "processing",
      })
      .select()
      .single();
    if (error) throw error;

    try {
      await processText(supabase, doc.id, userId, data.content);
      if (data.title && data.title.trim()) {
        await supabase
          .from("documents")
          .update({ title: data.title.trim().slice(0, 200) })
          .eq("id", doc.id);
      }
    } catch (e) {
      await supabase
        .from("documents")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", doc.id);
      throw e;
    }
    return { id: doc.id };
  });

// --- Update an existing note (title/body) and re-run ingestion ---
export const updateNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        content: z.string().min(1),
        title: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: fetchErr } = await supabase
      .from("documents")
      .select("id, source_type")
      .eq("id", data.id)
      .single();
    if (fetchErr) throw fetchErr;
    if (existing.source_type !== "note") {
      throw new Error("Only notes can be edited.");
    }

    await supabase
      .from("documents")
      .update({ status: "processing", error: null })
      .eq("id", data.id);

    try {
      await processText(supabase, data.id, userId, data.content);
      if (data.title && data.title.trim()) {
        await supabase
          .from("documents")
          .update({ title: data.title.trim().slice(0, 200) })
          .eq("id", data.id);
      }
    } catch (e) {
      await supabase
        .from("documents")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", data.id);
      throw e;
    }
    return { ok: true };
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

// --- List all documents for the current user (with event info) ---
export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("documents")
      .select(
        "id, title, source_type, status, summary, error, created_at, doc_type, category, keywords, important_dates, action_items, event_id, memory_events(id, name, event_type)",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });

// --- Get a single document with its connections ---
export const getDocument = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc, error } = await supabase
      .from("documents")
      .select(
        "id, title, source_type, status, summary, error, created_at, doc_type, category, people, organizations, locations, keywords, important_dates, action_items, event_id, file_path, file_mime, memory_events(id, name, event_type, description)",
      )
      .eq("id", data.id)
      .single();
    if (error) throw error;

    // Related memories via connections graph
    const { data: connections } = await supabase
      .from("memory_connections")
      .select("doc_a, doc_b, relation")
      .or(`doc_a.eq.${data.id},doc_b.eq.${data.id}`);

    const relatedIds = (connections ?? [])
      .map((c) => (c.doc_a === data.id ? c.doc_b : c.doc_a))
      .filter((v, i, a) => a.indexOf(v) === i);

    let related: Array<{
      id: string;
      title: string;
      source_type: string;
      category: string | null;
    }> = [];
    if (relatedIds.length > 0) {
      const { data: relDocs } = await supabase
        .from("documents")
        .select("id, title, source_type, category")
        .in("id", relatedIds);
      related = (relDocs ?? []) as any;
    }

    return { doc, related };
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
