import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ListChecks,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  Moon,
  Sun,
  Trash2
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ChecklistItem, ItemStatus, Ledger } from "../shared/types";
import { ChecklistApi, clearStoredToken, loadStoredToken, saveStoredToken } from "./api";

type ViewMode = ItemStatus;
type ThemeMode = "light" | "dark";
const LEDGER_KEY = "checklist-ledger-active-ledger-id";
const THEME_KEY = "checklist-ledger-theme";

/**
 * Root checklist experience.
 *
 * The app is deliberately not a project dashboard in v1. It opens directly to
 * the active checklist, with Finished available as a repository of completed
 * work. All persistence goes through the same authenticated API that Codex will
 * use from the CLI.
 */
export function App() {
  const [token, setToken] = useState(loadStoredToken);
  const [tokenDraft, setTokenDraft] = useState("");
  const api = useMemo(() => (token ? new ChecklistApi(token) : null), [token]);

  if (!token || !api) {
    return (
      <main className="auth-screen">
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="brand-mark">
            <ListChecks size={24} aria-hidden="true" />
          </div>
          <h1 id="auth-title">Checklist Ledger</h1>
          <p>Enter your private admin token to open the hosted checklist.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = tokenDraft.trim();
              if (next) {
                saveStoredToken(next);
                setToken(next);
              }
            }}
          >
            <input
              aria-label="Admin token"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              placeholder="Admin token"
              type="password"
            />
            <button type="submit">
              <Save size={18} aria-hidden="true" />
              Save token
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <ChecklistShell
      api={api}
      onLogout={() => {
        clearStoredToken();
        setToken("");
      }}
    />
  );
}

interface ChecklistShellProps {
  api: ChecklistApi;
  onLogout: () => void;
}

function ChecklistShell({ api, onLogout }: ChecklistShellProps) {
  const [view, setView] = useState<ViewMode>("active");
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [activeLedgerId, setActiveLedgerId] = useState<number>(() => loadStoredLedgerId());
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [finished, setFinished] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const ledgerList = await api.ledgers();
      const selectedLedger = chooseLedger(ledgerList, activeLedgerId);
      if (selectedLedger.id !== activeLedgerId) {
        saveStoredLedgerId(selectedLedger.id);
        setActiveLedgerId(selectedLedger.id);
      }
      const [activeItems, finishedItems] = await Promise.all([
        api.list(selectedLedger.id, "active"),
        api.list(selectedLedger.id, "finished")
      ]);
      setLedgers(ledgerList);
      setItems(activeItems);
      setFinished(finishedItems);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to load checklist.");
    } finally {
      setLoading(false);
    }
  }, [activeLedgerId, api]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleItems = view === "active" ? items : finished;
  const activeLedger = chooseLedger(ledgers, activeLedgerId);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Personal checklist</p>
          <h1>{activeLedger.name}</h1>
        </div>
        <div className="topbar-actions">
          <LedgerPicker
            ledgers={ledgers}
            activeLedgerId={activeLedger.id}
            onChange={(ledgerId) => {
              saveStoredLedgerId(ledgerId);
              setActiveLedgerId(ledgerId);
              setView("active");
            }}
            onCreate={async (name) => {
              const ledger = await api.createLedger({ name });
              saveStoredLedgerId(ledger.id);
              setActiveLedgerId(ledger.id);
              setLedgers((current) => [...current, ledger]);
              setView("active");
            }}
            onArchive={async () => {
              if (!window.confirm(`Archive "${activeLedger.name}"? Its items will be hidden until the ledger is restored from the CLI.`)) {
                return;
              }
              await api.archiveLedger(activeLedger.id);
              setView("active");
              await refresh();
            }}
            onDelete={async () => {
              if (!window.confirm(`Delete "${activeLedger.name}" and every item in it? This cannot be undone.`)) {
                return;
              }
              await api.deleteLedger(activeLedger.id);
              setView("active");
              await refresh();
            }}
          />
          <SegmentedView value={view} onChange={setView} finishedCount={finished.length} />
          <button
            className="icon-button"
            type="button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
          <button className="icon-button" type="button" onClick={onLogout} title="Clear saved token">
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace" aria-label={view === "active" ? "Active checklist" : "Finished items"}>
        <div className="workspace-header">
          <div>
            <h2>{view === "active" ? "Active" : "Finished"}</h2>
            <p>
              {view === "active"
                ? "Add, reorder, expand, and finish checklist items."
                : "Completed items stay here until you reopen them."}
            </p>
          </div>
          <span className="count-pill">{visibleItems.length}</span>
        </div>

        {view === "active" ? (
          <AddItemForm
            onAdd={async (title, details) => {
              await api.create({ ledgerId: activeLedger.id, title, details });
              await refresh();
            }}
          />
        ) : null}

        {loading ? (
          <div className="empty-state">Loading checklist...</div>
        ) : visibleItems.length === 0 ? (
          <div className="empty-state">
            {view === "active" ? "No active items yet." : "No finished items yet."}
          </div>
        ) : (
          <ChecklistList
            api={api}
            items={visibleItems}
            ledgerId={activeLedger.id}
            mode={view}
            onItemsChange={view === "active" ? setItems : setFinished}
            onRefresh={refresh}
          />
        )}
      </section>
    </main>
  );
}

interface LedgerPickerProps {
  ledgers: Ledger[];
  activeLedgerId: number;
  onChange: (ledgerId: number) => void;
  onCreate: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}

function LedgerPicker({ ledgers, activeLedgerId, onChange, onCreate, onArchive, onDelete }: LedgerPickerProps) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [mutating, setMutating] = useState(false);
  const canRemoveLedger = ledgers.length > 1;

  return (
    <div className="ledger-controls">
      <form
        className="ledger-picker"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim()) {
            return;
          }
          setCreating(true);
          try {
            await onCreate(name);
            setName("");
          } finally {
            setCreating(false);
          }
        }}
      >
        <select
          aria-label="Active ledger"
          value={activeLedgerId}
          onChange={(event) => onChange(Number(event.target.value))}
          disabled={mutating}
        >
          {ledgers.map((ledger) => (
            <option key={ledger.id} value={ledger.id}>
              {ledger.name}
            </option>
          ))}
        </select>
        <input
          aria-label="New ledger name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New ledger"
        />
        <button type="submit" disabled={creating || !name.trim()} title="Create ledger">
          <Plus size={16} aria-hidden="true" />
        </button>
      </form>
      <div className="ledger-actions" aria-label="Ledger actions">
        <button
          type="button"
          disabled={!canRemoveLedger || mutating}
          title={canRemoveLedger ? "Archive selected ledger" : "Create another ledger before archiving this one"}
          onClick={async () => {
            setMutating(true);
            try {
              await onArchive();
            } finally {
              setMutating(false);
            }
          }}
        >
          <Archive size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="danger"
          disabled={!canRemoveLedger || mutating}
          title={canRemoveLedger ? "Delete selected ledger" : "Create another ledger before deleting this one"}
          onClick={async () => {
            setMutating(true);
            try {
              await onDelete();
            } finally {
              setMutating(false);
            }
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface SegmentedViewProps {
  value: ViewMode;
  finishedCount: number;
  onChange: (value: ViewMode) => void;
}

function SegmentedView({ value, finishedCount, onChange }: SegmentedViewProps) {
  return (
    <div className="segmented" aria-label="Checklist view">
      <button type="button" className={value === "active" ? "selected" : ""} onClick={() => onChange("active")}>
        <ListChecks size={16} aria-hidden="true" />
        Active
      </button>
      <button
        type="button"
        className={value === "finished" ? "selected" : ""}
        onClick={() => onChange("finished")}
      >
        <Archive size={16} aria-hidden="true" />
        Finished {finishedCount > 0 ? finishedCount : ""}
      </button>
    </div>
  );
}

interface AddItemFormProps {
  onAdd: (title: string, details: string) => Promise<void>;
}

function AddItemForm({ onAdd }: AddItemFormProps) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    setSubmitting(true);
    await onAdd(title, details);
    setTitle("");
    setDetails("");
    setSubmitting(false);
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a checklist item"
        aria-label="New item title"
      />
      <textarea
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        placeholder="Optional details"
        aria-label="New item details"
        rows={2}
      />
      <button type="submit" disabled={submitting || !title.trim()}>
        <Plus size={18} aria-hidden="true" />
        Add
      </button>
    </form>
  );
}

interface ChecklistListProps {
  api: ChecklistApi;
  items: ChecklistItem[];
  ledgerId: number;
  mode: ViewMode;
  onItemsChange: (items: ChecklistItem[]) => void;
  onRefresh: () => Promise<void>;
}

function ChecklistList({ api, items, ledgerId, mode, onItemsChange, onRefresh }: ChecklistListProps) {
  const [draggedId, setDraggedId] = useState<number | null>(null);

  async function reorder(targetId: number) {
    if (draggedId === null || draggedId === targetId) {
      return;
    }

    const next = moveItem(items, draggedId, targetId);
    onItemsChange(next);
    await api.reorder({ ledgerId, parentId: null, orderedIds: next.map((item) => item.id) });
    await onRefresh();
  }

  return (
    <div className="item-list">
      {items.map((item) => (
        <ChecklistRow
          api={api}
          key={item.id}
          item={item}
          ledgerId={ledgerId}
          mode={mode}
          onRefresh={onRefresh}
          draggable={mode === "active"}
          onDragStart={() => setDraggedId(item.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => reorder(item.id)}
          onDragEnd={() => setDraggedId(null)}
        />
      ))}
    </div>
  );
}

interface ChecklistRowProps {
  api: ChecklistApi;
  item: ChecklistItem;
  ledgerId: number;
  mode: ViewMode;
  draggable: boolean;
  onRefresh: () => Promise<void>;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function ChecklistRow({
  api,
  item,
  ledgerId,
  mode,
  draggable,
  onRefresh,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: ChecklistRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [editingDetails, setEditingDetails] = useState(item.details);

  return (
    <article
      className={`item-row ${mode === "finished" ? "finished" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="item-main">
        <button className="drag-handle" type="button" title="Drag to reorder" disabled={!draggable}>
          <GripVertical size={18} aria-hidden="true" />
        </button>
        <button
          className="check-button"
          type="button"
          title={mode === "active" ? "Finish item" : "Reopen item"}
          onClick={async () => {
            if (mode === "active") {
              await api.finish(item.id);
            } else {
              await api.reopen(item.id);
            }
            await onRefresh();
          }}
        >
          {mode === "active" ? <Check size={18} aria-hidden="true" /> : <RotateCcw size={18} aria-hidden="true" />}
        </button>
        <button className="expand-button" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
        </button>
        <div className="item-title-block">
          <h3>{item.title}</h3>
          {item.details ? <p>{item.details}</p> : null}
        </div>
      </div>

      {expanded ? (
        <div className="item-details">
          <label>
            Details
            <textarea
              value={editingDetails}
              onChange={(event) => setEditingDetails(event.target.value)}
              rows={4}
              disabled={mode === "finished"}
            />
          </label>
          {mode === "active" ? (
            <button
              type="button"
              className="secondary-action"
              onClick={async () => {
                await api.update(item.id, { details: editingDetails });
                await onRefresh();
              }}
            >
              <Save size={16} aria-hidden="true" />
              Save details
            </button>
          ) : null}

          {item.children.length > 0 ? (
            <div className="child-list">
              {item.children.map((child) => (
                <div className="child-item" key={child.id}>
                  <span>{child.title}</span>
                  {mode === "active" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.finish(child.id);
                        await onRefresh();
                      }}
                    >
                      <Check size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {mode === "active" ? (
            <form
              className="child-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!childTitle.trim()) {
                  return;
                }
                await api.create({ ledgerId, title: childTitle, parentId: item.id });
                setChildTitle("");
                await onRefresh();
              }}
            >
              <input
                value={childTitle}
                onChange={(event) => setChildTitle(event.target.value)}
                placeholder="Add child item"
                aria-label={`Add child item under ${item.title}`}
              />
              <button type="submit">
                <Plus size={16} aria-hidden="true" />
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function chooseLedger(ledgers: Ledger[], requestedId: number): Ledger {
  return ledgers.find((ledger) => ledger.id === requestedId) ?? ledgers[0] ?? {
    id: 1,
    name: "Today",
    createdAt: "",
    updatedAt: "",
    archivedAt: null
  };
}

function loadStoredLedgerId(): number {
  const parsed = Number(localStorage.getItem(LEDGER_KEY) ?? "1");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function saveStoredLedgerId(ledgerId: number): void {
  localStorage.setItem(LEDGER_KEY, String(ledgerId));
}

function loadTheme(): ThemeMode {
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

function moveItem(items: ChecklistItem[], movedId: number, targetId: number): ChecklistItem[] {
  const current = items.findIndex((item) => item.id === movedId);
  const target = items.findIndex((item) => item.id === targetId);
  if (current === -1 || target === -1) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(current, 1);
  next.splice(target, 0, moved);
  return next;
}
