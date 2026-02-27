# DataFlow — Large Dataset CSV Exporter

> A production-ready **Next.js 16** application that streams up to **100,000+ rows** from a SQLite database to a CSV file in the browser — with **cursor-based pagination**, **Server-Sent Events (SSE) streaming**, **resumable exports**, and a polished React UI.

**GitHub Repository:** [https://github.com/AbhishekSharma9161/CSV-Export-Demo](https://github.com/AbhishekSharma9161/CSV-Export-Demo)

---

## Table of Contents

1. [Quick Start (3 Steps)](#quick-start-3-steps)
2. [Tech Stack](#tech-stack)
3. [Concept & Architecture](#concept--architecture)
4. [Algorithm / Pseudo-code / Flowchart](#algorithm--pseudo-code--flowchart)
5. [Project Structure](#project-structure)
6. [API Reference](#api-reference)
7. [Key Design Decisions](#key-design-decisions)
8. [Error Handling & Resumability](#error-handling--resumability)
9. [Performance Considerations](#performance-considerations)

---

## Quick Start (3 Steps)

> **Prerequisites:** Node.js ≥ 18, npm ≥ 9

```bash
# Step 1 — Install dependencies
npm install

# Step 2 — Set up the database and seed 100,000 rows
npm run db:setup

# Step 3 — Run the development server
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

> **What `db:setup` does:** runs Prisma migrations → generates the Prisma client → seeds the database with 100,000 product rows in batches of 500.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.1.6 |
| Language | TypeScript | ^5 |
| ORM | Prisma | ^5.22.0 |
| Database | SQLite (via Prisma) | — |
| Styling | Tailwind CSS v4 | ^4 |
| Runtime | Node.js | ≥ 18 |
| Streaming | Web Streams API (ReadableStream) + SSE | native |

---

## Concept & Architecture

### The Problem

Exporting millions of rows to CSV is a classic heavy-database-operation problem. Naïve approaches fail because:

- **Memory overload:** fetching all rows at once into memory causes Node.js to OOM-crash.
- **DB saturation:** one enormous SQL query locks tables and starves concurrent users.
- **Network timeouts:** a single long HTTP response times out before the data arrives.
- **No recovery:** if the connection drops mid-download, the user must start from scratch.

### The Solution (this project)

This app implements a **three-phase, streaming, resumable export pipeline**:

```
Browser                    Next.js Server                      SQLite DB
  │                              │                                  │
  │── POST /api/export ─────────►│── INSERT ExportJob ─────────────►│
  │◄─ { jobId, totalRows } ──────│                                  │
  │                              │                                  │
  │── GET /api/export/:id/stream ►│                                 │
  │                              │──── SELECT * WHERE id > cursor ──►│
  │◄── SSE: data (CSV chunk) ────│◄─── 1,000 rows ─────────────────│
  │◄── SSE: progress event ──────│──── UPDATE lastCursor ───────────►│
  │      (repeats per chunk)     │──── SELECT * WHERE id > cursor ──►│
  │                              │       ... (loop) ...              │
  │◄── SSE: done event ──────────│──── UPDATE status = DONE ────────►│
  │  (browser assembles Blob     │                                  │
  │   and triggers download)     │                                  │
```

**Phase 1 — Job Creation** (`POST /api/export`)

The browser POSTs the active filters. The server counts matching rows, writes an `ExportJob` record to the DB (with `status=PENDING`, `lastCursor=0`), and returns the `jobId`. This is a fast, lightweight operation.

**Phase 2 — Streaming** (`GET /api/export/:jobId/stream`)

The server opens a `ReadableStream` and queries the DB in chunks of **1,000 rows** using cursor-based pagination (`WHERE id > lastCursor ORDER BY id ASC LIMIT 1000`). Each chunk is:
1. Converted to CSV lines in memory.
2. Sent to the browser as an SSE `data:` event.
3. Followed by a `progress` SSE event so the UI can update the progress bar.
4. After each chunk, `lastCursor` and `rowsExported` are persisted to the `ExportJob` row.
5. A 50 ms throttle delay is inserted between chunks to avoid hammering the DB.

**Phase 3 — Browser Assembly & Download**

The browser accumulates all incoming SSE chunks into a `string[]` array. When the `done` event fires, it assembles a `Blob`, creates an Object URL, and imperatively clicks an `<a download>` element — triggering the native file save dialog instantly.

### Why SSE instead of a plain HTTP response?

| Approach | Pros | Cons |
|---|---|---|
| Single HTTP response (chunked) | Simple | No progress events; proxy buffering breaks streaming |
| Polling | Works everywhere | High DB load, janky UX |
| WebSocket | Bi-directional | Overkill; complex server setup |
| **SSE (this app)** | Native browser support, multiplexed events, auto-reconnect in protocol | One-directional only (fine for export) |

SSE also sets `X-Accel-Buffering: no` and `Cache-Control: no-transform` to defeat nginx/CDN buffering.

---

## Algorithm / Pseudo-code / Flowchart

### High-level Flowchart

```
┌─────────────┐
│  User sets  │
│  filters &  │
│clicks Export│
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  POST /api/export                       │
│  ┌──────────────────────────────────┐   │
│  │ Build WHERE clause from filters  │   │
│  │ COUNT(*) matching rows           │   │
│  │ INSERT ExportJob {               │   │
│  │   status: PENDING,               │   │
│  │   lastCursor: 0,                 │   │
│  │   rowsExported: 0,               │   │
│  │   totalRows: count               │   │
│  │ }                                │   │
│  │ RETURN { jobId, totalRows }      │   │
│  └──────────────────────────────────┘   │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  GET /api/export/:jobId/stream          │
│  Open ReadableStream (SSE)              │
│                                         │
│  cursor = job.lastCursor                │
│  SEND csv_header as SSE data            │
│                                         │
│  ┌─── LOOP ────────────────────────┐    │
│  │                                 │    │
│  │  rows = SELECT *                │    │
│  │    WHERE id > cursor            │    │
│  │    ORDER BY id ASC LIMIT 1000   │    │
│  │                                 │    │
│  │  if rows.length == 0 → BREAK    │    │
│  │                                 │    │
│  │  csvChunk = rows.map(toCsvLine) │    │
│  │  SEND csvChunk as SSE data      │    │
│  │                                 │    │
│  │  cursor = rows[-1].id           │    │
│  │  rowsExported += rows.length    │    │
│  │                                 │    │
│  │  UPDATE ExportJob SET           │    │
│  │    lastCursor = cursor,         │    │
│  │    rowsExported = rowsExported  │    │
│  │                                 │    │
│  │  SEND progress SSE event        │    │
│  │  WAIT 50ms (throttle)           │    │
│  └─────────────────────────────────┘    │
│                                         │
│  UPDATE ExportJob SET status = DONE     │
│  SEND done SSE event                    │
│  CLOSE stream                           │
└─────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Browser (EventSource listener)         │
│                                         │
│  onmessage  → push chunk to csvParts[]  │
│  on progress → update state/UI          │
│  on done                                │
│    → Blob(csvParts, "text/csv")         │
│    → URL.createObjectURL(blob)          │
│    → <a download>.click()              │
│    → URL.revokeObjectURL(url)           │
│                                         │
│  onerror / on "error"                   │
│    → set state to FAILED                │
│    → show "Resume Export" button        │
└─────────────────────────────────────────┘
```

### Pseudo-code — Cursor-based Chunked Query

```
function exportStream(jobId):
    job = DB.ExportJob.findById(jobId)
    if not job: sendError("Job not found"); return

    DB.ExportJob.update(jobId, { status: "PROCESSING" })
    filters = JSON.parse(job.filters)
    WHERE = buildWhereClause(filters)

    cursor = job.lastCursor          // 0 on fresh start, N on resume
    rowsExported = job.rowsExported  // 0 on fresh start, N on resume

    sendSSE(CSV_HEADER)

    loop:
        rows = DB.Product.findMany({
            where: { ...WHERE, id: { gt: cursor } },
            orderBy: { id: ASC },
            take: CHUNK_SIZE (1000),
        })

        if rows is empty: break

        csvChunk = rows.map(row => formatCsvLine(row)).join("")
        sendSSE(csvChunk)

        cursor = rows.last.id
        rowsExported += rows.length

        DB.ExportJob.update(jobId, { lastCursor: cursor, rowsExported })
        sendSSEEvent("progress", { rowsExported, totalRows: job.totalRows })

        sleep(50ms)  // throttle

    DB.ExportJob.update(jobId, { status: "DONE" })
    sendSSEEvent("done", { rowsExported })
    closeStream()

    on error:
        DB.ExportJob.update(jobId, { status: "FAILED" })
        sendSSEEvent("error", { message: err.message })
        closeStream()
```

### Pseudo-code — Resume Flow

```
function resumeExport(jobId):
    status = GET /api/export/:jobId/status
    // Returns: { lastCursor, rowsExported, totalRows, status }

    // Server-side stream picks up WHERE id > lastCursor automatically
    // because it reads lastCursor from the DB ExportJob record
    openSSEStream(/api/export/:jobId/stream)
    // Stream continues from where it left off
```

### CSV Escaping

```
function escapeCsvField(value: string) -> string:
    if value contains ',' or '"' or newline:
        return '"' + value.replace('"', '""') + '"'  // RFC 4180
    return value
```

---

## Project Structure

```
csv-export-demo/
├── prisma/
│   ├── schema.prisma          # DB models: Product, ExportJob
│   ├── seed.ts                # Seeds 100,000 product rows
│   └── dev.db                 # SQLite database file (auto-generated)
│
├── lib/
│   ├── prisma.ts              # Prisma singleton (HMR-safe)
│   └── csvUtils.ts            # CSV header constant + row formatter
│
├── src/
│   ├── lib/
│   │   └── prisma.ts          # Re-export of lib/prisma.ts
│   └── app/
│       ├── layout.tsx         # Root layout
│       ├── page.tsx           # Main UI (React client component)
│       ├── globals.css        # Global styles
│       └── api/
│           ├── products/
│           │   └── route.ts   # GET /api/products  – paginated list
│           └── export/
│               ├── route.ts   # POST /api/export   – create export job
│               └── [jobId]/
│                   ├── status/
│                   │   └── route.ts  # GET /api/export/:id/status
│                   └── stream/
│                       └── route.ts  # GET /api/export/:id/stream (SSE)
│
├── .env                       # DATABASE_URL=file:./prisma/dev.db
├── next.config.ts
├── tsconfig.json
└── package.json
```

---

## API Reference

### `POST /api/export`

Creates a new export job.

**Request body:**
```json
{
  "category": "Electronics",   // optional filter
  "status": "active",          // optional filter
  "search": "Ultra"            // optional name search
}
```

**Response:**
```json
{
  "jobId": "cm7abc123xyz",
  "totalRows": 9876
}
```

---

### `GET /api/export/:jobId/stream`

Opens an SSE stream. The server queries the DB in chunks and emits events:

| Event type | Payload | Description |
|---|---|---|
| `message` (default) | `"id,name,...\n"` | A raw CSV text chunk (header or rows) |
| `progress` | `{ rowsExported, totalRows }` | After each chunk of 1,000 rows |
| `done` | `{ rowsExported }` | Export finished |
| `error` | `{ message }` | Export failed |

**Response Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

---

### `GET /api/export/:jobId/status`

Polls the current state of an export job (useful before resuming).

**Response:**
```json
{
  "jobId": "cm7abc123xyz",
  "status": "PROCESSING",
  "rowsExported": 45000,
  "totalRows": 100000,
  "lastCursor": 45000,
  "createdAt": "2026-02-27T02:00:00.000Z",
  "updatedAt": "2026-02-27T02:01:30.000Z"
}
```

---

### `GET /api/products`

Server-side paginated product listing for the UI table.

| Query param | Default | Description |
|---|---|---|
| `page` | 1 | Page number |
| `pageSize` | 50 | Rows per page (max 100) |
| `category` | — | Filter by category |
| `status` | — | Filter by status |
| `search` | — | Filter by name (contains) |

**Response:**
```json
{
  "products": [...],
  "total": 100000,
  "page": 1,
  "pageSize": 50,
  "totalPages": 2000
}
```

---

## Key Design Decisions

### 1. Cursor-based pagination vs. OFFSET

| | Cursor (`WHERE id > N`) | Offset (`SKIP N`) |
|---|---|---|
| Performance on large tables | **O(log N)** — uses B-tree index | **O(N)** — DB scans N rows before returning |
| Consistency | Stable even if rows are inserted mid-export | Can miss or duplicate rows on concurrent writes |
| Resumability | Natural — just store the last cursor | Fragile — offsets shift when rows change |

This app uses `WHERE id > lastCursor ORDER BY id ASC LIMIT 1000`, which is always fast regardless of how many rows have already been processed.

### 2. Prisma Singleton

```typescript
// lib/prisma.ts
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };
export const prisma = globalForPrisma.prisma ?? new PrismaClient(...);
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

Next.js HMR in development re-executes modules, which would otherwise create hundreds of DB connections. The singleton pattern stores the client on `globalThis` to reuse it across hot reloads.

### 3. 50 ms throttle between chunks

The `CHUNK_DELAY_MS = 50` pause between DB queries gives the database breathing room for concurrent read/write operations, preventing a single export from starving the connection pool. For production with many concurrent exports, this should be made configurable.

### 4. Browser-side Blob assembly

Rather than streaming raw bytes through a `<video>` or `fetch()` body stream (which has poor browser support for CSV download), this app:
1. Collects all SSE text chunks into `csvParts: string[]`.
2. On `done`, assembles them into a single `Blob`.
3. Uses `URL.createObjectURL` + `a.download` for a native save dialog.

This gives the user the fastest possible download start time (download begins after the last chunk arrives), with no server-side file storage needed.

---

## Error Handling & Resumability

### What happens on failure

If the SSE connection drops (network error, server crash, browser tab refresh mid-export):

1. The `onerror` handler on the `EventSource` fires.
2. The UI transitions to `state: "failed"` which shows the last known progress bar and a **"Resume Export"** button.
3. The `ExportJob` row in the DB retains `lastCursor` and `rowsExported` from the last successful chunk update.

### Resume flow

```
User clicks "Resume Export"
    ↓
GET /api/export/:jobId/status    // fetch lastCursor from DB
    ↓
GET /api/export/:jobId/stream    // server reads lastCursor from DB
                                  // begins WHERE id > lastCursor
                                  // browser re-collects new chunks
                                  // assembles final CSV from those chunks
```

> **Note:** On resume, the browser's `csvParts[]` is reset. The server re-streams from `lastCursor` forward. Therefore, the downloaded CSV on resume will only contain rows from the resumption point onward, not a full file. For a complete re-export from the beginning, the user should start a new export job. To get a merged file a production system would write chunks to server-side storage (e.g., S3) and merge on completion.

### ExportJob status machine

```
PENDING → PROCESSING → DONE
                     ↘ FAILED (resumable)
```

---

## Performance Considerations

| Concern | Solution |
|---|---|
| DB overwhelm | Chunk size of 1,000 rows + 50 ms inter-chunk delay |
| Memory usage | Cursor pagination; server never materialises all rows at once |
| Index efficiency | Uses primary key (`id`) as cursor; always uses B-tree index |
| HMR connection leak | Prisma singleton on `globalThis` |
| Proxy buffering | `X-Accel-Buffering: no` + `Cache-Control: no-transform` headers |
| Debounced search | 400 ms debounce on search input prevents unnecessary queries |
| Parallel count+list | Products list uses `Promise.all([findMany, count])` |

For a production system handling millions of rows, consider:
- **PostgreSQL** instead of SQLite (concurrent writes, better index statistics)
- **Background job queue** (BullMQ / pg-boss) instead of inline streaming
- **S3/GCS chunked upload** to build a resumable, server-stored file
- **Rate limiting** on the `/api/export` endpoint
