# AI Memory OS — Expansion Plan (revised)

The app already has working sign-in, uploads (PDF/image/note), an AI ingestion pipeline (text extraction, vision, chunking, embeddings, pgvector), and a RAG chat with source citations. This plan adds the "memory intelligence" layer: rich metadata, event-based Memory Connections, a Timeline, a Dashboard focused on Memory Insights, and a redesigned Memory Vault + smarter chat with related memories, plain-language relevance, and dynamic follow-ups.

Everywhere in the UI copy and empty states, the product is framed as a **personal memory assistant / second brain** — not a document chatbot. The AI proactively organizes, connects, and reminds; the user never has to sort things manually.

## 1. Data model (Lovable Cloud)

One migration, all with RLS scoped to `auth.uid()` and proper grants:

- **profiles** — display name, avatar url; auto-created on signup via trigger.
- **documents** — add AI metadata columns:
  - `doc_type`, `category` (text)
  - `people`, `organizations`, `locations`, `keywords`, `action_items` (text[])
  - `important_dates` (jsonb: `[{date, label}]`)
  - `event_id` (uuid, nullable, FK to memory_events)
- **memory_events** — AI-inferred real-world events: `user_id`, `name` (e.g. "Japan Trip", "Medical Treatment", "College Admission", "Home Purchase"), `description`, `event_type` (travel / medical / financial / education / personal / …), `start_date`, `end_date`.
- **memory_connections** — pairwise links between documents with `relation` label and `user_id`, used to render the Related Memories graph even when docs aren't in the same event.
- **document_chunks**, **chat_messages** — unchanged; `chat_messages.sources` jsonb will also carry related memories, relevance label, and follow-up questions.

## 2. Ingestion pipeline upgrade

Extend `ingest.server.ts` to extract, in one structured call: Title, Summary, Document Type, Category, People, Dates, Organizations, Locations, Keywords, Action Items. Save on the documents row during `processText`.

## 3. Memory Connections = real-world events (not similarity)

After a document finishes processing, run an **event-inference pass** server-side:

1. Fetch the user's existing events + recent documents (metadata only).
2. Ask the AI: given this new memory's metadata and these existing events/memories, does it belong to an existing real-world event, start a new one, or neither? Return a decision plus an AI-generated event name and type derived from context (e.g. "Japan Trip", "Medical Treatment", "College Admission", "Home Purchase") — never copied from a filename.
3. Attach the document to an existing `memory_events` row, create a new one, or leave it standalone. Also write pairwise `memory_connections` for the strongest inter-doc relationships within the event.

Server functions: `getEvents()`, `getEvent(id)`, `getConnections(documentId)`.

## 4. Timeline

`getTimeline()` returns memories ordered by most relevant extracted date (fallback: upload date), grouped by event when one exists. Route `/timeline` renders a vertical chronological timeline; events appear as expandable clusters ("Japan Trip · 5 memories").

## 5. Dashboard with Memory Insights (new `/` route)

Chat moves to `/ask`; `/` becomes the Dashboard. Widgets:

- Welcome + "Search your memory" prompt (submits into chat)
- **Memory Insights** panel (this is the section name in the UI) — proactive reminders derived server-side from stored metadata + events:
  - Upcoming document expirations (from `important_dates`, e.g. passport, license, warranty)
  - Important action items pulled from ingested docs
  - Pending follow-ups (e.g. medical follow-ups, unresolved items)
  - Recently connected memories (a new event was just detected)
  - Recently uploaded memories
- Memory Timeline preview → link to full timeline
- Quick Upload (PDF / image / note shortcuts)
- Storage Usage (count + summed file size)

## 6. Memory Vault (rename Library → `/vault`)

Redesigned cards: Title, Category badge, Summary, Upload date, Processing status, Related Memories count, Important Dates, Event badge (e.g. "Japan Trip"). Search box (semantic + text), detail dialog showing full metadata, event membership, related memories, and delete.

## 7. Chat upgrades — every AI response has four sections

Enhance `/api/chat` and chat UI so each assistant message renders in this order:

1. **AI Answer** — natural-language markdown answer grounded in retrieved memories.
2. **Source Documents** — the memories actually cited (chips linking into the Vault).
3. **Related Memories** — pulled from the Memory Connections graph and event membership of the cited docs, not just vector similarity.
4. **Suggested Follow-up Questions** — 3–5 contextual chips generated dynamically from the retrieved memories (e.g. "When does it expire?", "Show all related documents", "Summarize this document", "Are there any important dates?", "What action items are mentioned?"). Clicking a chip sends it.

A **relevance label** is shown alongside the answer using plain language — `High Match`, `Medium Match`, or `Low Match` — derived from top retrieval scores. No numeric percentages anywhere.

All four sections plus the relevance label persist in `chat_messages.sources` jsonb so history renders identically.

## 8. Navigation & design

`app-shell.tsx` nav: Dashboard · Ask · Memory Vault · Timeline. Keep the warm neutral editorial theme (amber/terracotta) already in `styles.css`. Refine cards, badges, and the memory-inspired logo. No purple AI theme, no robot icon. Copy across empty states, tooltips, and headings consistently frames the app as a second brain.

## 9. Second-brain UX + hackathon demo polish

- Empty states speak in memory language ("Nothing to remember yet — upload a passport, a bill, or a note.").
- Automatic categorization + event grouping happen silently.
- Dashboard leads with Memory Insights, not chat.

Demo flow the first-time experience showcases in order: upload docs → cards populate with extracted metadata → an event badge appears (e.g. "Japan Trip") → user asks a natural-language question → answer arrives with AI Answer + Source Documents + Related Memories + Suggested Follow-up Questions and a relevance label → Timeline shows the whole story chronologically.

## Technical notes

- All server logic stays in `createServerFn` / the existing `/api/chat` server route. Embeddings via `google/gemini-embedding-001`; chat, vision, metadata, event inference, and follow-up generation via `google/gemini-3-flash-preview` through the Lovable AI Gateway.
- Migration ships first (tables, columns, enums, RLS, grants, profile trigger) before any dependent code so generated types refresh.
- Event inference runs after ingestion so uploads stay responsive; it reuses stored embeddings + extracted entities to keep cost down.
- Every new public table gets `GRANT` + owner-scoped RLS in the same migration.

## Build order

1. Migration (profiles, documents metadata, memory_events, memory_connections, trigger, RLS, grants).
2. Ingestion metadata upgrade + event-inference pass (server).
3. Server functions: events, connections, timeline, insights, vault search.
4. Chat upgrades (four-section response with graph-driven Related Memories, plain-language relevance label, follow-up generation).
5. Frontend: Dashboard (Memory Insights), Memory Vault redesign, Timeline, chat UI updates, second-brain copy, nav.
6. Typecheck + end-to-end verification with Playwright.
