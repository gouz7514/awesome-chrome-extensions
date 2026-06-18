# CLAUDE.md

## Browser Memory

Browser Memory is a local-first Chrome extension that helps users re-find previously viewed web pages using vague memory and natural-language-like queries.

The core idea is:

> Bookmarks save URLs.  
> Browser Memory saves things you vaguely remember.

Examples:

- "that Next.js logger article"
- "the Reddit thread complaining about Supabase auth"
- "the Italy honeymoon weather article I saw last week"

The product is intentionally designed around:

- low friction
- local-first storage
- privacy
- research workflows
- lightweight retrieval

---

# Product Philosophy

Most people do not remember:

- URLs
- exact page titles
- domains

People remember:

- context
- topics
- rough meaning
- fragments of ideas

Browser Memory aims to bridge that gap.

This is NOT:

- a bookmark manager
- a note-taking app
- a knowledge base
- a productivity dashboard

This IS:

- a lightweight browser memory layer
- a personal research recall tool
- a vague-memory retrieval system

---

# Current MVP Scope (v0)

Current implementation is intentionally minimal.

Features:

- Save current page manually
- Extract visible page text
- Store locally in IndexedDB
- Search saved pages by keyword/substring
- No backend
- No account
- No cloud sync

Current architecture:

```text
Chrome Extension
├── popup UI
├── content script
├── background service worker
└── IndexedDB local storage
```

---

# Current File Structure

```text
browser-memory-v0/
├── manifest.json
├── background.js
├── content.js
├── popup.html
└── popup.js
```

---

# Current Storage Model

IndexedDB database:

```text
browserMemoryDB
└── documents
```

Document shape:

```ts
type SavedDocument = {
  id?: number;
  title: string;
  url: string;
  text: string;
  createdAt: number;
};
```

---

# Current Search Strategy

The current MVP uses:

- substring matching
- lowercase normalization

This is NOT semantic search.

Examples that currently work:

- "nextjs logger"
- "italy honeymoon"
- "supabase"

Examples that currently DO NOT work well:

- "article about request context"
- "that post comparing pino and datadog"
- synonym-based retrieval

Future semantic retrieval will require:

- embeddings
- vector search
- retrieval ranking

---

# Why Local-First?

Privacy is a core product value.

Users are highly sensitive about browser history access.

Current MVP guarantees:

- data stays on device
- no remote sync
- no analytics
- no hidden collection

This constraint is intentional.

---

# Product Direction

The product should evolve gradually.

## v0

Manual save + keyword retrieval

## v1

Temporary memory layer

Automatically store lightweight metadata:

- title
- url
- visitedAt
- domain
- short preview

Without saving full page text.

## v2

Saved memory layer

Explicitly saved pages include:

- full text
- summary
- tags
- project assignment

## v3

Semantic retrieval

Introduce:

- embeddings
- vector search
- natural language retrieval

Potential stack:

- transformers.js
- local embedding generation
- pgvector
- Supabase
- Qdrant

## v4

Ask My Research

Users can query their saved pages:

Examples:

- "What did I save about Next.js logging?"
- "What were the common complaints about Supabase auth?"
- "Summarize my research on Chrome extensions."

This becomes a personal research assistant.

---

# Important Constraints

Do NOT turn this into:

- Notion clone
- productivity tracker
- CRM
- social product
- generic AI chatbot

The key value is:

- lightweight recall
- low friction
- memory augmentation

---

# UX Principles

The UX should feel:

- instant
- lightweight
- invisible
- personal

Avoid:

- dashboards
- heavy setup
- onboarding friction
- mandatory tagging

Good UX examples:

- "I vaguely remember seeing this"
- "Show me things related to X"
- "What was that article again?"

---

# Future Technical Considerations

Potential future architecture:

```text
Chrome Extension
├── local IndexedDB
├── local embeddings
├── semantic search
└── optional cloud sync

Backend (optional)
├── Supabase
├── pgvector
├── RAG pipeline
└── user sync
```

Potential future tools:

- Dexie.js
- MiniSearch
- FlexSearch
- transformers.js
- readability.js
- Supabase
- pgvector

---

# Non-Goals

Non-goals for the foreseeable future:

- enterprise collaboration
- team workspace
- social feeds
- automatic browsing surveillance
- invasive tracking
- full-device activity logging

---

# Core Insight

People do not want to manage knowledge.

People want to:

- find things again
- reduce repeated searching
- recover vague memories
- continue interrupted research

Browser Memory should optimize for:

- retrieval
- continuity
- contextual recall

not information management.
