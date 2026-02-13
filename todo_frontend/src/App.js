import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { createTodo, deleteTodo, fetchTodos, renameTodo, setTodoCompleted } from "./api/todos";

function uid() {
  return Math.random().toString(16).slice(2);
}

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

// PUBLIC_INTERFACE
function App() {
  /**
   * Single-page Todo app UI.
   * Integrates with backend REST API (base URL from REACT_APP_API_BASE / REACT_APP_BACKEND_URL).
   */
  const [theme, setTheme] = useState("light");

  const [todos, setTodos] = useState([]);
  const [newTitle, setNewTitle] = useState("");

  const [filter, setFilter] = useState("all"); // all | active | done
  const [isLoading, setIsLoading] = useState(false);

  const [error, setError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Track optimistic operations (to show subtle "syncing" state per item).
  const [pendingIds, setPendingIds] = useState(() => new Set());

  const newInputRef = useRef(null);

  // Apply theme to document element
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const counts = useMemo(() => {
    const total = todos.length;
    const done = todos.filter((t) => t.completed).length;
    const active = total - done;
    return { total, done, active };
  }, [todos]);

  const visibleTodos = useMemo(() => {
    if (filter === "active") return todos.filter((t) => !t.completed);
    if (filter === "done") return todos.filter((t) => t.completed);
    return todos;
  }, [todos, filter]);

  const setPending = (id, isPending) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (isPending) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await fetchTodos();
      // Sort newest-first if createdAt exists, else keep order.
      setTodos(list);
    } catch (e) {
      setError(e?.message || "Failed to load todos. Check backend URL and CORS.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // PUBLIC_INTERFACE
  const toggleTheme = () => {
    /** Toggle between light and dark theme for the UI. */
    setTheme((prevTheme) => (prevTheme === "light" ? "dark" : "light"));
  };

  const onAdd = async (e) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    setError(null);
    setNewTitle("");

    // Optimistic add (temporary id)
    const tempId = `temp_${uid()}`;
    const optimistic = { id: tempId, title, completed: false, raw: { optimistic: true } };
    setTodos((prev) => [optimistic, ...prev]);
    setPending(tempId, true);

    try {
      const created = await createTodo(title);

      if (!created || created.id === undefined || created.id === null) {
        // If backend didn't return an item, reload.
        await load();
        return;
      }

      setTodos((prev) => prev.map((t) => (t.id === tempId ? created : t)));
    } catch (e2) {
      // Rollback optimistic item
      setTodos((prev) => prev.filter((t) => t.id !== tempId));
      setError(e2?.message || "Failed to create todo.");
    } finally {
      setPending(tempId, false);
      newInputRef.current?.focus();
    }
  };

  const onToggleCompleted = async (todo) => {
    if (!todo?.id) return;
    setError(null);

    // Optimistic
    const nextCompleted = !todo.completed;
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, completed: nextCompleted } : t)));
    setPending(todo.id, true);

    try {
      const updated = await setTodoCompleted(todo.id, nextCompleted);
      if (updated?.id != null) {
        setTodos((prev) => prev.map((t) => (t.id === todo.id ? updated : t)));
      }
    } catch (e) {
      // Rollback
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, completed: !nextCompleted } : t)));
      setError(e?.message || "Failed to update todo.");
    } finally {
      setPending(todo.id, false);
    }
  };

  const beginEdit = (todo) => {
    if (!todo?.id) return;
    setEditingId(todo.id);
    setEditingTitle(todo.title);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const commitEdit = async (todo) => {
    if (!todo?.id) return;
    const title = editingTitle.trim();
    if (!title) return;

    setError(null);
    setPending(todo.id, true);

    // Optimistic
    const before = todo.title;
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, title } : t)));
    setEditingId(null);
    setEditingTitle("");

    try {
      const updated = await renameTodo(todo.id, title);
      if (updated?.id != null) {
        setTodos((prev) => prev.map((t) => (t.id === todo.id ? updated : t)));
      }
    } catch (e) {
      // Rollback
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, title: before } : t)));
      setError(e?.message || "Failed to rename todo.");
    } finally {
      setPending(todo.id, false);
    }
  };

  const onDelete = async (todo) => {
    if (!todo?.id) return;
    setError(null);

    // Optimistic remove
    const snapshot = todos;
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
    setPending(todo.id, true);

    try {
      await deleteTodo(todo.id);
    } catch (e) {
      setTodos(snapshot);
      setError(e?.message || "Failed to delete todo.");
    } finally {
      setPending(todo.id, false);
    }
  };

  const clearCompleted = async () => {
    const completed = todos.filter((t) => t.completed && t.id != null);
    if (completed.length === 0) return;

    setError(null);

    // Optimistic: remove all completed
    const snapshot = todos;
    const ids = completed.map((t) => t.id);
    setTodos((prev) => prev.filter((t) => !t.completed));

    try {
      // Best effort: delete sequentially (keeps backend load low)
      // If any fails, we fall back to reload to reconcile.
      // eslint-disable-next-line no-restricted-syntax
      for (const id of ids) {
        setPending(id, true);
        // eslint-disable-next-line no-await-in-loop
        await deleteTodo(id);
        setPending(id, false);
      }
    } catch (e) {
      setError(e?.message || "Failed to clear completed. Reloading…");
      await load();
    } finally {
      ids.forEach((id) => setPending(id, false));
    }
  };

  return (
    <div className="App">
      <div className="page">
        <header className="topbar">
          <div className="brand">
            <div className="brandMark" aria-hidden="true" />
            <div>
              <div className="brandTitle">Todos</div>
              <div className="brandSub">Monochrome minimalist</div>
            </div>
          </div>

          <div className="topbarActions">
            <button
              className="iconBtn"
              type="button"
              onClick={load}
              aria-label="Refresh todos"
              title="Refresh"
              disabled={isLoading}
            >
              Refresh
            </button>
            <button
              className="iconBtn"
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              title="Toggle theme"
            >
              {theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <main className="card" role="main">
          <div className="cardHeader">
            <div className="cardTitleRow">
              <h1 className="cardTitle">Your tasks</h1>
              <div className="pillRow" aria-label="Todo counters">
                <span className="pill">{counts.active} active</span>
                <span className="pill">{counts.done} done</span>
              </div>
            </div>

            <form className="addRow" onSubmit={onAdd}>
              <label className="srOnly" htmlFor="newTodo">
                Add a task
              </label>
              <input
                id="newTodo"
                ref={newInputRef}
                className="input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add a task…"
                autoComplete="off"
              />
              <button className="btnPrimary" type="submit" disabled={!newTitle.trim()}>
                Add
              </button>
            </form>

            <div className="filterRow" role="tablist" aria-label="Todo filters">
              <button
                type="button"
                className={cx("segBtn", filter === "all" && "segBtnActive")}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={cx("segBtn", filter === "active" && "segBtnActive")}
                onClick={() => setFilter("active")}
              >
                Active
              </button>
              <button
                type="button"
                className={cx("segBtn", filter === "done" && "segBtnActive")}
                onClick={() => setFilter("done")}
              >
                Done
              </button>

              <div className="spacer" />

              <button
                type="button"
                className="btnGhost"
                onClick={clearCompleted}
                disabled={counts.done === 0}
                title="Delete all completed tasks"
              >
                Clear done
              </button>
            </div>

            {error ? (
              <div className="alert" role="alert">
                <div className="alertTitle">Couldn’t sync with the server</div>
                <div className="alertBody">{error}</div>
              </div>
            ) : null}
          </div>

          <section className="listSection" aria-label="Todo list">
            {isLoading && todos.length === 0 ? (
              <div className="emptyState">Loading…</div>
            ) : null}

            {!isLoading && visibleTodos.length === 0 ? (
              <div className="emptyState">
                <div className="emptyTitle">No tasks here</div>
                <div className="emptyBody">
                  {filter === "all"
                    ? "Add your first task above."
                    : "Try a different filter."}
                </div>
              </div>
            ) : null}

            <ul className="todoList">
              {visibleTodos.map((t) => {
                const isPending = pendingIds.has(t.id);
                const isEditing = editingId === t.id;

                return (
                  <li key={String(t.id)} className={cx("todoItem", isPending && "todoPending")}>
                    <label className="checkWrap">
                      <input
                        type="checkbox"
                        checked={Boolean(t.completed)}
                        onChange={() => onToggleCompleted(t)}
                        aria-label={`Mark "${t.title}" as ${t.completed ? "not completed" : "completed"}`}
                        disabled={isPending}
                      />
                      <span className="checkUi" aria-hidden="true" />
                    </label>

                    <div className="todoMain">
                      {isEditing ? (
                        <div className="editRow">
                          <label className="srOnly" htmlFor={`edit_${t.id}`}>
                            Edit todo
                          </label>
                          <input
                            id={`edit_${t.id}`}
                            className="input"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(t);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="btnPrimary"
                            onClick={() => commitEdit(t)}
                            disabled={!editingTitle.trim() || isPending}
                          >
                            Save
                          </button>
                          <button type="button" className="btnGhost" onClick={cancelEdit} disabled={isPending}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className={cx("todoTitle", t.completed && "todoTitleDone")}>
                            {t.title}
                          </div>
                          <div className="todoMeta">
                            {isPending ? <span className="syncTag">Syncing…</span> : <span className="syncTag syncOk">Synced</span>}
                          </div>
                        </>
                      )}
                    </div>

                    {!isEditing ? (
                      <div className="todoActions">
                        <button
                          type="button"
                          className="iconBtn"
                          onClick={() => beginEdit(t)}
                          disabled={isPending}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="iconBtn danger"
                          onClick={() => onDelete(t)}
                          disabled={isPending}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <footer className="cardFooter">
            <div className="footNote">
              Backend: <code className="inlineCode">{process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || "(same origin)"}</code>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
