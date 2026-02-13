/**
 * Small fetch wrapper with JSON parsing and helpful errors.
 */

const DEFAULT_TIMEOUT_MS = 15000;

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);

  const onAbort = () => controller.abort(signal?.reason || new Error("Aborted"));
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

// PUBLIC_INTERFACE
export function getApiBaseUrl() {
  /**
   * Resolve the backend base URL.
   * Prefers REACT_APP_API_BASE, then REACT_APP_BACKEND_URL.
   * Falls back to same-origin.
   */
  const raw =
    (process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || "").trim();

  if (!raw) return window.location.origin;

  // Allow passing just host:port
  if (!/^https?:\/\//i.test(raw)) return `http://${raw}`;

  return raw.replace(/\/+$/, "");
}

async function parseJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(path, { method = "GET", body, headers, signal, timeoutMs } = {}) {
  const base = getApiBaseUrl();
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  const timeout = withTimeout(signal, timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(headers || {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: timeout.signal,
    });

    const data = await parseJsonSafely(res);

    if (!res.ok) {
      const message =
        (data && typeof data === "object" && (data.detail || data.message)) ||
        (typeof data === "string" ? data : null) ||
        `Request failed (${res.status})`;

      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  } finally {
    timeout.cleanup();
  }
}

// PUBLIC_INTERFACE
export const apiClient = {
  /** Fetch all todos. */
  listTodos: () => request("/todos", { method: "GET" }),

  /** Create a todo. Accepts { title } or { text } depending on backend; we use title. */
  createTodo: (payload) => request("/todos", { method: "POST", body: payload }),

  /** Update a todo by id (partial). */
  updateTodo: (id, patch) => request(`/todos/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),

  /** Patch a todo by id (partial). */
  patchTodo: (id, patch) => request(`/todos/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),

  /** Delete a todo by id. */
  deleteTodo: (id) => request(`/todos/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
