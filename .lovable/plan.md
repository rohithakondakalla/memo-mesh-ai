# AI Memory OS — Build Plan

A private, per-user memory assistant. Users upload PDFs, images, and notes; content is understood by AI, indexed semantically, and later retrieved by asking natural-language questions in a chat that answers with source citations.

## Core Experience
1. **Sign in** (email/password + Google) — each user only sees their own memories.
2. **Upload / add memory** — drop a PDF, image, or type a note. Each item is processed: text extracted, images described by AI vision, then chunked and embedded.
3. **Chat** — ask a question; the app finds the most relevant chunks across all your memories and generates an answer that cites which documents it used.
4. **Library** — browse, search, and delete uploaded memories with processing status.

## Backend (Lovable Cloud)
Enable Lovable Cloud for auth, database, storage, and server AI calls.

**Auth**: Email/password + Google sign-in. Protected app routes under `_authenticated`; public `/auth` page.

**Storage**: Private `memories` bucket for original files (PDFs, images), scoped per user via RLS on `storage.objects`.

**Database** (with pgvector):
- `documents` — id, user_id, title, source_type (pdf/image/note), file_path, status (pending/processing/ready/failed), summary, created_at.
- `document_chunks` — id, document_id, user_id, content, embedding `vector(3072)`, chunk_index. HNSW index on the embedding.
- `match_chunks(query_embedding, match_user_id, match_count)` — security-definer SQL function returning top chunks for a user by cosine similarity.
- RLS on both tables scoped to `auth.uid()`; standard GRANTs.

## Processing Pipeline (server functions)
On upload/create, a server function:
- **PDF** → extract text server-side.
- **Image** → send to Lovable AI vision (`google/gemini-3-flash-preview`) to produce a rich description; store as the searchable text.
- **Note** → use text directly.
- Generate a short title/summary, chunk the text (~1000 chars w/ overlap), embed each chunk via `google/gemini-embedding-001`, insert chunks, mark document `ready`.

## Chat + Retrieval (RAG)
- Streaming chat server route (`/api/chat`) using the AI SDK.
- On each question: embed the query, call `match_chunks` for the current user, inject the top matches as context into the system prompt, and stream an answer instructing the model to cite sources.
- Response renders as markdown; a **Sources** section lists the documents used, linking back to the library item.

## Frontend
- **Design direction**: calm, focused "second brain" aesthetic — warm neutral surfaces, a single confident accent, generous spacing, a distinctive (non-Sparkles) memory/brain brand mark. Not generic AI-purple.
- **Routes**: `/auth`, `/` (chat home, single conversation), `/library` (memories + upload).
- Chat UI built with AI Elements (conversation, message, prompt-input, shimmer). Assistant messages on plain surface; user messages in a high-contrast bubble. Optimistic send + typing indicator.
- Upload UI with drag-and-drop, per-item processing status, and a search box over the library.
- Conversation is a single ongoing chat (no thread list) persisted per user in the database.

## Technical Notes
- All AI + embedding calls run server-side via Lovable AI Gateway (`LOVABLE_API_KEY`).
- Embeddings use `google/gemini-embedding-001` (3072-dim; halfvec cast for the HNSW index/search).
- Image understanding uses Lovable AI vision at ingest so images are searchable by content.
- Processing runs in a server function triggered right after upload; documents show `processing` until embeddings are stored.

## Build Order
1. Enable Cloud; auth (email + Google) + `/auth` + protected layout.
2. Schema: pgvector, tables, RLS, GRANTs, `match_chunks`, storage bucket + policies.
3. Upload UI + ingest/processing server function (PDF/image/note → chunks + embeddings).
4. Library page (list, status, search, delete).
5. RAG chat: retrieval server fn + streaming `/api/chat` + AI Elements chat UI with citations.
6. Visual polish, brand mark, empty states, error/rate-limit handling.
