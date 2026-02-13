import { apiClient } from "./client";

function normalizeTodo(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = raw.id ?? raw._id ?? raw.todo_id ?? raw.uuid;
  const title = raw.title ?? raw.text ?? raw.name ?? "";
  const completed = Boolean(raw.completed ?? raw.done ?? raw.is_completed ?? raw.isDone);

  const createdAt = raw.created_at ?? raw.createdAt ?? null;
  const updatedAt = raw.updated_at ?? raw.updatedAt ?? null;

  return {
    id,
    title: String(title),
    completed,
    createdAt,
    updatedAt,
    raw,
  };
}

function normalizeTodoList(data) {
  if (Array.isArray(data)) return data.map(normalizeTodo).filter(Boolean);
  if (data && typeof data === "object") {
    const items = data.items ?? data.todos ?? data.data ?? data.results;
    if (Array.isArray(items)) return items.map(normalizeTodo).filter(Boolean);
  }
  return [];
}

async function safeUpdate(id, patch) {
  // Try PATCH first (common for partial), then fallback to PUT.
  try {
    return await apiClient.patchTodo(id, patch);
  } catch (e) {
    if (e && (e.status === 405 || e.status === 404)) {
      return await apiClient.updateTodo(id, patch);
    }
    throw e;
  }
}

// PUBLIC_INTERFACE
export async function fetchTodos() {
  /** Fetch todos and return normalized list. */
  const data = await apiClient.listTodos();
  return normalizeTodoList(data);
}

// PUBLIC_INTERFACE
export async function createTodo(title) {
  /** Create a todo with the given title. */
  const data = await apiClient.createTodo({ title });
  const todo = normalizeTodo(data) || normalizeTodo(data?.item) || normalizeTodo(data?.todo);
  return todo;
}

// PUBLIC_INTERFACE
export async function setTodoCompleted(id, completed) {
  /** Set completion state for a todo. */
  const data = await safeUpdate(id, { completed });
  return normalizeTodo(data) || normalizeTodo(data?.item) || normalizeTodo(data?.todo);
}

// PUBLIC_INTERFACE
export async function renameTodo(id, title) {
  /** Rename/update title for a todo. */
  const data = await safeUpdate(id, { title });
  return normalizeTodo(data) || normalizeTodo(data?.item) || normalizeTodo(data?.todo);
}

// PUBLIC_INTERFACE
export async function deleteTodo(id) {
  /** Delete a todo. Returns nothing on success. */
  await apiClient.deleteTodo(id);
}
