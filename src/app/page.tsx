"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  quantity: number;
  status: string;
  createdAt: string;
};

type ExportState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "streaming"; jobId: string; rowsExported: number; totalRows: number; csvParts: string[] }
  | { kind: "done"; rowsExported: number }
  | { kind: "failed"; jobId: string; rowsExported: number; totalRows: number }
  | { kind: "resuming" };

const CATEGORIES = ["", "Electronics", "Clothing", "Food", "Books", "Toys", "Sports", "Home", "Garden", "Automotive", "Health"];
const STATUSES = ["", "active", "inactive", "discontinued"];

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const eventSourceRef = useRef<EventSource | null>(null);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      setProducts(data.products ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, category, status, search]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Debounced search
  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 400);
  };

  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  const startExport = async (resumeJobId?: string) => {
    if (resumeJobId) {
      setExportState({ kind: "resuming" });
    } else {
      setExportState({ kind: "creating" });
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, status, search }),
      });
      const data = await res.json();
      resumeJobId = data.jobId;
      setExportState({
        kind: "streaming",
        jobId: data.jobId,
        rowsExported: 0,
        totalRows: data.totalRows,
        csvParts: [],
      });
    }

    const jobId = resumeJobId!;

    // Get job status first (for resume)
    if (exportState.kind === "resuming") {
      const statusRes = await fetch(`/api/export/${jobId}/status`);
      const statusData = await statusRes.json();
      setExportState({
        kind: "streaming",
        jobId,
        rowsExported: statusData.rowsExported,
        totalRows: statusData.totalRows,
        csvParts: [],
      });
    }

    // Close existing stream
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const csvParts: string[] = [];
    const es = new EventSource(`/api/export/${jobId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const chunk = JSON.parse(e.data) as string;
      csvParts.push(chunk);
    };

    es.addEventListener("progress", (e) => {
      const { rowsExported, totalRows } = JSON.parse(e.data);
      setExportState((prev) =>
        prev.kind === "streaming"
          ? { ...prev, rowsExported, totalRows, csvParts }
          : prev
      );
    });

    es.addEventListener("done", (e) => {
      const { rowsExported } = JSON.parse(e.data);
      es.close();
      // Trigger download
      const blob = new Blob(csvParts, { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${jobId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportState({ kind: "done", rowsExported });
    });

    es.addEventListener("error", (e) => {
      es.close();
      setExportState((prev) => {
        if (prev.kind === "streaming") {
          return { kind: "failed", jobId: prev.jobId, rowsExported: prev.rowsExported, totalRows: prev.totalRows };
        }
        return { kind: "idle" };
      });
    });

    es.onerror = () => {
      es.close();
      setExportState((prev) => {
        if (prev.kind === "streaming") {
          return { kind: "failed", jobId: prev.jobId, rowsExported: prev.rowsExported, totalRows: prev.totalRows };
        }
        return { kind: "idle" };
      });
    };
  };

  const cancelExport = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setExportState({ kind: "idle" });
  };

  const exportProgress =
    exportState.kind === "streaming" && exportState.totalRows > 0
      ? (exportState.rowsExported / exportState.totalRows) * 100
      : 0;

  const showModal =
    exportState.kind !== "idle" && exportState.kind !== "creating";

  return (
    <div className="app-root">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="brand-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10,9 9,9 8,9" />
              </svg>
            </div>
            <div>
              <h1 className="brand-title">DataFlow</h1>
              <p className="brand-subtitle">Large Dataset Export</p>
            </div>
          </div>
          <div className="header-stats">
            <div className="stat-chip">
              <span className="stat-dot" />
              <span>{total.toLocaleString()} records</span>
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Filter Bar */}
        <div className="filter-bar">
          <div className="search-wrap">
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              className="search-input"
              placeholder="Search products..."
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <select className="filter-select" value={category} onChange={handleFilterChange(setCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c || "All Categories"}</option>
            ))}
          </select>
          <select className="filter-select" value={status} onChange={handleFilterChange(setStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s || "All Statuses"}</option>
            ))}
          </select>
          <button
            className="export-btn"
            onClick={() => startExport()}
            disabled={exportState.kind === "creating" || exportState.kind === "streaming" || exportState.kind === "resuming"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7,10 12,15 17,10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        </div>

        {/* Table */}
        <div className="table-wrap">
          {loading ? (
            <div className="loading-overlay">
              <div className="spinner" />
              <span>Loading data...</span>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Quantity</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={p.id} style={{ animationDelay: `${i * 12}ms` }} className="table-row">
                    <td className="cell-id">#{p.id}</td>
                    <td className="cell-name">{p.name}</td>
                    <td>
                      <span className="category-badge">{p.category}</span>
                    </td>
                    <td className="cell-price">${p.price.toFixed(2)}</td>
                    <td className="cell-qty">{p.quantity.toLocaleString()}</td>
                    <td>
                      <span className={`status-badge status-${p.status}`}>{p.status}</span>
                    </td>
                    <td className="cell-date">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="pagination">
          <span className="pagination-info">
            Page {page} of {totalPages} · {total.toLocaleString()} rows
          </span>
          <div className="pagination-controls">
            <button className="page-btn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
            <button className="page-btn" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>‹</button>
            <span className="page-current">{page}</span>
            <button className="page-btn" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>›</button>
            <button className="page-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button>
          </div>
        </div>
      </main>

      {/* Export Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              {exportState.kind === "done" ? (
                <div className="modal-icon modal-icon-done">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20,6 9,17 4,12" />
                  </svg>
                </div>
              ) : exportState.kind === "failed" ? (
                <div className="modal-icon modal-icon-fail">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
              ) : (
                <div className="modal-icon modal-icon-loading">
                  <div className="spinner-ring" />
                </div>
              )}
              <div>
                <h2 className="modal-title">
                  {exportState.kind === "done" && "Export Complete!"}
                  {exportState.kind === "failed" && "Export Failed"}
                  {exportState.kind === "streaming" && "Exporting CSV…"}
                  {exportState.kind === "resuming" && "Resuming Export…"}
                </h2>
                <p className="modal-subtitle">
                  {exportState.kind === "streaming" && `${exportState.rowsExported.toLocaleString()} / ${exportState.totalRows.toLocaleString()} rows streamed`}
                  {exportState.kind === "done" && `${(exportState as { rowsExported: number }).rowsExported.toLocaleString()} rows exported successfully`}
                  {exportState.kind === "failed" && "Connection lost. Your progress is saved."}
                  {exportState.kind === "resuming" && "Connecting to stream…"}
                </p>
              </div>
            </div>

            {(exportState.kind === "streaming" || exportState.kind === "failed") && (
              <div className="progress-section">
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${exportState.kind === "streaming" ? exportProgress : (exportState.rowsExported / exportState.totalRows) * 100}%` }}
                  />
                </div>
                <div className="progress-labels">
                  <span>{exportState.kind === "streaming" ? exportProgress.toFixed(1) : ((exportState.rowsExported / exportState.totalRows) * 100).toFixed(1)}%</span>
                  <span>{exportState.kind === "streaming" ? exportState.rowsExported.toLocaleString() : exportState.rowsExported.toLocaleString()} rows</span>
                </div>
              </div>
            )}

            <div className="modal-actions">
              {exportState.kind === "streaming" && (
                <button className="btn-secondary" onClick={cancelExport}>Cancel</button>
              )}
              {exportState.kind === "failed" && (
                <>
                  <button className="btn-secondary" onClick={() => setExportState({ kind: "idle" })}>Close</button>
                  <button className="btn-primary" onClick={() => startExport((exportState as { jobId: string }).jobId)}>
                    ↺ Resume Export
                  </button>
                </>
              )}
              {exportState.kind === "done" && (
                <button className="btn-primary" onClick={() => setExportState({ kind: "idle" })}>Done</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
