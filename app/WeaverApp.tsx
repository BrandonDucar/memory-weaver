"use client";

import {
  AlertTriangle,
  BookOpenCheck,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  CloudCog,
  Code2,
  Copy,
  Database,
  Download,
  FileJson,
  FileText,
  FolderGit2,
  GitBranch,
  Globe2,
  HardDrive,
  KeyRound,
  Link2,
  Menu,
  MessageSquareText,
  Network,
  PanelLeftClose,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent } from "react";
import {
  createDemoWorkspace,
  createEmptyWorkspace,
  downloadJson,
  downloadText,
  makeId,
  redactSecrets,
  toCapsuleMarkdown,
  weaveSources,
  type SourceKind,
  type WeaveIssue,
  type WeaveSource,
  type WeaverWorkspace,
} from "./lib/weaver";

type View = "weave" | "sources" | "threads" | "friction" | "exports" | "connections";
type Dialog = "source" | "github" | null;

const STORAGE_KEY = "dreamnet.memory-weaver.workspace.v1";
const CONNECTION_KEY = "dreamnet.memory-weaver.connections.v1";

const viewItems: Array<{ id: View; label: string; icon: typeof Network }> = [
  { id: "weave", label: "Weave", icon: Network },
  { id: "sources", label: "Sources", icon: FileText },
  { id: "threads", label: "Threads", icon: Link2 },
  { id: "friction", label: "Friction", icon: AlertTriangle },
  { id: "exports", label: "Capsules", icon: Boxes },
  { id: "connections", label: "Connections", icon: CloudCog },
];

const kindIcons: Record<SourceKind, typeof FileText> = {
  document: FileText,
  github: GitBranch,
  conversation: MessageSquareText,
  web: Globe2,
  database: Database,
};

const issueLabels: Record<WeaveIssue["type"], string> = {
  conflict: "Conflict",
  duplicate: "Duplicate",
  orphan: "Orphan",
  stale: "Stale",
};

const safeFileName = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "memory-weave";

const formatDate = (value: string): string => new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
}).format(new Date(value));

const parseRepo = (value: string): { owner: string; repo: string } | null => {
  const trimmed = value.trim().replace(/\.git$/, "");
  const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  return shortMatch ? { owner: shortMatch[1], repo: shortMatch[2] } : null;
};

const sourceFromFile = async (file: File): Promise<WeaveSource> => ({
  id: makeId("source"),
  title: file.name,
  kind: file.name.endsWith(".json") ? "database" : "document",
  content: redactSecrets(await file.text()),
  origin: `Local file · ${file.name}`,
  addedAt: new Date().toISOString(),
  updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
  tags: file.name.split(/[._-]/).filter((part) => part.length > 3).slice(0, 5),
});

export function WeaverApp() {
  const [workspace, setWorkspace] = useState<WeaverWorkspace>(() => createDemoWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("weave");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [guideOpen, setGuideOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [weaving, setWeaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubStatus, setGithubStatus] = useState("");
  const [sourceDraft, setSourceDraft] = useState({ title: "", content: "", tags: "" });
  const [llmConfig, setLlmConfig] = useState({ endpoint: "", model: "" });
  const [llmKey, setLlmKey] = useState("");
  const [llmStatus, setLlmStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const savedConnections = localStorage.getItem(CONNECTION_KEY);
        if (saved) setWorkspace(JSON.parse(saved) as WeaverWorkspace);
        if (savedConnections) setLlmConfig(JSON.parse(savedConnections));
      } catch {
        setToast("The saved local vault could not be read. The demo was restored.");
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [hydrated, workspace]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(llmConfig));
  }, [hydrated, llmConfig]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    void navigator.serviceWorker.register("/sw.js");
  }, []);

  const result = workspace.result;
  const selectedSource = workspace.sources.find((source) => source.id === selectedSourceId) ?? null;
  const selectedTopic = result?.topics.find((topic) => topic.id === selectedTopicId) ?? result?.topics[0] ?? null;

  const filteredSources = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspace.sources;
    return workspace.sources.filter((source) => [source.title, source.origin, source.content, ...source.tags]
      .join(" ")
      .toLowerCase()
      .includes(needle));
  }, [query, workspace.sources]);

  const relatedEdges = result?.edges.filter((edge) => edge.kind === "related") ?? [];
  const connectedSourceIds = new Set(relatedEdges.flatMap((edge) => [edge.from, edge.to]));
  const guideSteps = [
    { label: "Add a real source", done: workspace.sources.some((source) => !source.mock) },
    { label: "Run a fresh weave", done: Boolean(result && result.receipt.generatedAt !== "2026-07-18T20:00:00.000Z") },
    { label: "Review friction", done: view === "friction" },
    { label: "Export a Capsule", done: workspace.receipts.length > 1 },
  ];
  const guideProgress = guideSteps.filter((step) => step.done).length;

  const updateWorkspace = (updater: (current: WeaverWorkspace) => WeaverWorkspace) => {
    setWorkspace((current) => ({ ...updater(current), updatedAt: new Date().toISOString() }));
  };

  const runWeave = () => {
    if (!workspace.sources.length) {
      setToast("Add at least one source before weaving.");
      setView("sources");
      return;
    }
    setWeaving(true);
    window.setTimeout(() => {
      updateWorkspace((current) => {
        const nextResult = weaveSources(current.sources);
        return {
          ...current,
          isDemo: current.sources.every((source) => source.mock),
          result: nextResult,
          receipts: [nextResult.receipt, ...current.receipts].slice(0, 25),
        };
      });
      setWeaving(false);
      setToast("Weave complete. A local receipt was added.");
    }, 420);
  };

  const addSources = (sources: WeaveSource[]) => {
    updateWorkspace((current) => ({
      ...current,
      isDemo: false,
      result: null,
      sources: [...sources, ...current.sources],
    }));
    setToast(`${sources.length} source${sources.length === 1 ? "" : "s"} added to the local vault.`);
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const sources = await Promise.all(files.map(sourceFromFile));
    addSources(sources);
    event.target.value = "";
  };

  const addPastedSource = (event: FormEvent) => {
    event.preventDefault();
    if (!sourceDraft.title.trim() || !sourceDraft.content.trim()) return;
    const now = new Date().toISOString();
    addSources([{
      id: makeId("source"),
      title: sourceDraft.title.trim(),
      kind: "document",
      content: redactSecrets(sourceDraft.content.trim()),
      origin: "Pasted note",
      addedAt: now,
      updatedAt: now,
      tags: sourceDraft.tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 10),
    }]);
    setSourceDraft({ title: "", content: "", tags: "" });
    setDialog(null);
  };

  const importGithub = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseRepo(repoInput);
    if (!parsed) {
      setGithubStatus("Enter owner/repository or a GitHub repository URL.");
      return;
    }
    setGithubStatus("Reading repository manifest…");
    try {
      const headers: HeadersInit = {
        Accept: "application/vnd.github+json",
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      };
      const repoResponse = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers });
      if (!repoResponse.ok) throw new Error(`Repository request failed (${repoResponse.status})`);
      const repo = await repoResponse.json() as { default_branch: string; html_url: string; pushed_at: string };
      const treeResponse = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
        { headers },
      );
      if (!treeResponse.ok) throw new Error(`File index request failed (${treeResponse.status})`);
      const tree = await treeResponse.json() as { tree: Array<{ path: string; type: string; size?: number }> };
      const candidates = tree.tree
        .filter((entry) => entry.type === "blob" && /\.(md|mdx|txt|json)$/i.test(entry.path) && (entry.size ?? 0) < 220_000)
        .sort((left, right) => {
          const rank = (path: string) => /(^|\/)readme\.md$/i.test(path) ? 0 : /(^|\/)docs?\//i.test(path) ? 1 : 2;
          return rank(left.path) - rank(right.path) || left.path.localeCompare(right.path);
        })
        .slice(0, 18);
      if (!candidates.length) throw new Error("No Markdown, text, or JSON sources were found.");
      setGithubStatus(`Importing ${candidates.length} source files…`);
      const imported = await Promise.all(candidates.map(async (entry) => {
        const contentResponse = await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${entry.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repo.default_branch)}`,
          { headers: { ...headers, Accept: "application/vnd.github.raw+json" } },
        );
        if (!contentResponse.ok) throw new Error(`Could not read ${entry.path}`);
        return {
          id: makeId("source"),
          title: entry.path.split("/").at(-1) ?? entry.path,
          kind: "github" as const,
          content: redactSecrets(await contentResponse.text()),
          origin: `${parsed.owner}/${parsed.repo} · ${entry.path}`,
          addedAt: new Date().toISOString(),
          updatedAt: repo.pushed_at || new Date().toISOString(),
          tags: [parsed.repo, ...entry.path.split("/").slice(0, -1)].filter(Boolean).slice(0, 6),
        };
      }));
      addSources(imported);
      setRepoInput("");
      setGithubToken("");
      setGithubStatus("");
      setDialog(null);
      setView("sources");
    } catch (error) {
      setGithubStatus(error instanceof Error ? error.message : "GitHub import failed.");
    }
  };

  const importWorkspace = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as WeaverWorkspace | { workspace: WeaverWorkspace };
      const imported = "workspace" in parsed ? parsed.workspace : parsed;
      if (!imported.id || !Array.isArray(imported.sources)) throw new Error("Invalid weave archive");
      setWorkspace({ ...imported, isDemo: false, updatedAt: new Date().toISOString() });
      setToast("Local weave archive restored.");
      setDialog(null);
    } catch {
      setToast("That file is not a valid Memory Weaver archive.");
    }
    event.target.value = "";
  };

  const deleteSource = (sourceId: string) => {
    updateWorkspace((current) => ({
      ...current,
      result: null,
      sources: current.sources.filter((source) => source.id !== sourceId),
    }));
    setSelectedSourceId(null);
    setToast("Source removed from this device.");
  };

  const exportArchive = () => {
    downloadJson(`${safeFileName(workspace.name)}.weave.json`, {
      format: "memory-weaver-archive",
      version: "1.0",
      exportedAt: new Date().toISOString(),
      workspace,
    });
    setToast("Portable weave archive downloaded.");
  };

  const exportCapsule = () => {
    downloadText(`${safeFileName(workspace.name)}-capsule.md`, toCapsuleMarkdown(workspace));
    setToast("Knowledge Capsule downloaded.");
  };

  const testLlm = async () => {
    if (!llmConfig.endpoint.trim()) {
      setLlmStatus("Add an OpenAI-compatible base URL first.");
      return;
    }
    setLlmStatus("Testing…");
    try {
      const endpoint = llmConfig.endpoint.replace(/\/$/, "");
      const response = await fetch(`${endpoint}/models`, {
        headers: llmKey ? { Authorization: `Bearer ${llmKey}` } : {},
      });
      if (!response.ok) throw new Error(`Endpoint returned ${response.status}`);
      setLlmStatus("Connected. The key remains in this tab only.");
    } catch (error) {
      setLlmStatus(error instanceof Error ? error.message : "Connection failed.");
    }
  };

  const issueCount = result?.issues.length ?? 0;
  const relationCount = relatedEdges.length;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          {sidebarOpen && <div><strong>Memory Weaver</strong><small>by DreamNet</small></div>}
          <button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} title="Toggle navigation">
            {sidebarOpen ? <PanelLeftClose size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <nav className="main-nav" aria-label="Workspace views">
          {viewItems.map((item) => {
            const Icon = item.icon;
            const count = item.id === "sources" ? workspace.sources.length : item.id === "friction" ? issueCount : undefined;
            return (
              <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} title={item.label}>
                <Icon size={18} />
                {sidebarOpen && <><span>{item.label}</span>{count !== undefined && <b>{count}</b>}</>}
              </button>
            );
          })}
        </nav>

        {sidebarOpen && (
          <div className="vault-panel">
            <div className="vault-status"><HardDrive size={16} /><span>Local browser vault</span><Check size={15} /></div>
            <p>{workspace.sources.length} sources · {Math.round(JSON.stringify(workspace).length / 1024)} KB</p>
          </div>
        )}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="workspace-title">
            <span className="status-dot" />
            <input
              aria-label="Workspace name"
              value={workspace.name}
              onChange={(event) => updateWorkspace((current) => ({ ...current, name: event.target.value }))}
            />
            {workspace.isDemo && <span className="demo-badge">Populated demo</span>}
          </div>
          <div className="top-actions">
            <button className="quiet-button" onClick={() => { setWorkspace(createEmptyWorkspace("My first weave")); setView("sources"); setToast("Fresh local workspace created."); }}><Plus size={16} /> New</button>
            <button className="quiet-button" onClick={() => workspaceInputRef.current?.click()}><Upload size={16} /> Open</button>
            <button className="quiet-button" onClick={exportArchive}><Download size={16} /> Export</button>
            <button className="primary-button" onClick={runWeave} disabled={weaving}>
              <RefreshCw size={16} className={weaving ? "spin" : ""} /> {weaving ? "Weaving" : "Weave now"}
            </button>
            <input ref={workspaceInputRef} type="file" accept=".json,.weave.json" hidden onChange={importWorkspace} />
          </div>
        </header>

        {guideOpen && (
          <section className="guide-strip" aria-label="First weave checklist">
            <div className="guide-heading">
              <BookOpenCheck size={18} />
              <strong>First weave</strong>
              <span>{guideProgress}/4</span>
            </div>
            <div className="guide-steps">
              {guideSteps.map((step, index) => (
                <button
                  key={step.label}
                  className={step.done ? "done" : ""}
                  onClick={() => {
                    if (index === 0) setView("sources");
                    if (index === 1) runWeave();
                    if (index === 2) setView("friction");
                    if (index === 3) setView("exports");
                  }}
                >
                  {step.done ? <CheckCircle2 size={16} /> : <CircleDot size={16} />}{step.label}
                </button>
              ))}
            </div>
            <button className="icon-button" onClick={() => setGuideOpen(false)} title="Dismiss checklist"><X size={17} /></button>
          </section>
        )}

        <div className="content-frame">
          {view === "weave" && (
            <section className="view-section weave-view">
              <div className="section-header">
                <div><span className="eyebrow">Current weave</span><h1>{result ? "Your context has structure" : "Sources are ready to weave"}</h1></div>
                <div className="privacy-stamp"><ShieldCheck size={18} /><span><strong>Device local</strong><small>No source upload</small></span></div>
              </div>

              <div className="metric-band">
                <button onClick={() => setView("sources")}><span>Sources</span><strong>{workspace.sources.length}</strong><small>{connectedSourceIds.size} connected</small></button>
                <button onClick={() => setView("threads")}><span>Topics</span><strong>{result?.topics.length ?? 0}</strong><small>{relationCount} source threads</small></button>
                <button onClick={() => setView("friction")}><span>Friction</span><strong>{issueCount}</strong><small>{result?.issues.filter((issue) => issue.severity === "attention").length ?? 0} needs attention</small></button>
                <button onClick={() => setView("exports")}><span>Receipts</span><strong>{workspace.receipts.length}</strong><small>{result ? result.receipt.outputHash : "Not woven"}</small></button>
              </div>

              {result ? (
                <div className="weave-board">
                  <div className="topic-rail">
                    <div className="subsection-title"><Network size={17} /><strong>Signal clusters</strong><span>{result.topics.length}</span></div>
                    <div className="topic-list">
                      {result.topics.slice(0, 12).map((topic) => (
                        <button key={topic.id} className={selectedTopic?.id === topic.id ? "selected" : ""} onClick={() => setSelectedTopicId(topic.id)}>
                          <span className="topic-pulse" style={{ "--pulse": Math.min(100, 30 + topic.score * 18) } as CSSProperties} />
                          <span>{topic.label}</span><b>{topic.sourceIds.length}</b>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="thread-canvas">
                    <div className="thread-focus">
                      <span className="eyebrow">Selected thread</span>
                      <h2>{selectedTopic?.label ?? "No topic selected"}</h2>
                      <p>{selectedTopic ? `${selectedTopic.sourceIds.length} sources carry this signal.` : "Add sources and run the weave."}</p>
                    </div>
                    <div className="thread-stack">
                      {selectedTopic?.sourceIds.map((sourceId, index) => {
                        const source = workspace.sources.find((candidate) => candidate.id === sourceId);
                        if (!source) return null;
                        const Icon = kindIcons[source.kind];
                        return (
                          <button key={source.id} onClick={() => { setSelectedSourceId(source.id); setView("sources"); }}>
                            <span className="thread-index">{String(index + 1).padStart(2, "0")}</span>
                            <span className="source-icon"><Icon size={17} /></span>
                            <span><strong>{source.title}</strong><small>{source.origin}</small></span>
                            <ChevronRight size={17} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <aside className="weave-notes">
                    <div className="subsection-title"><Sparkles size={17} /><strong>Weaver notes</strong></div>
                    <div className="note-block good"><CheckCircle2 size={17} /><span><strong>{relationCount} relationships found</strong><small>Shared meaning across sources</small></span></div>
                    <div className="note-block warn"><AlertTriangle size={17} /><span><strong>{issueCount} items to review</strong><small>Conflicts, stale claims, and gaps</small></span></div>
                    <div className="receipt-mini">
                      <span>Latest receipt</span>
                      <code>{result.receipt.id.slice(0, 22)}</code>
                      <button onClick={() => navigator.clipboard.writeText(result.receipt.id)} title="Copy receipt ID"><Copy size={15} /></button>
                    </div>
                  </aside>
                </div>
              ) : (
                <div className="empty-weave">
                  <div className="empty-mark"><span /><span /><span /></div>
                  <h2>Run the deterministic weave</h2>
                  <p>{workspace.sources.length} sources are waiting in the local vault.</p>
                  <button className="primary-button" onClick={runWeave}><RefreshCw size={16} /> Weave now</button>
                </div>
              )}
            </section>
          )}

          {view === "sources" && (
            <section className="view-section sources-view">
              <div className="section-header compact">
                <div><span className="eyebrow">Local vault</span><h1>Sources</h1></div>
                <div className="section-actions">
                  <div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sources" /></div>
                  <button className="quiet-button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Files</button>
                  <button className="quiet-button" onClick={() => setDialog("github")}><GitBranch size={16} /> Repository</button>
                  <button className="primary-button" onClick={() => setDialog("source")}><Plus size={16} /> Note</button>
                  <input ref={fileInputRef} type="file" multiple accept=".md,.mdx,.txt,.json,.csv" hidden onChange={handleFiles} />
                </div>
              </div>
              <div className={`source-layout ${selectedSource ? "with-inspector" : ""}`}>
                <div className="source-table">
                  <div className="source-row source-head"><span>Source</span><span>Type</span><span>Updated</span><span>Threads</span><span /></div>
                  {filteredSources.map((source) => {
                    const Icon = kindIcons[source.kind];
                    const threads = result?.topics.filter((topic) => topic.sourceIds.includes(source.id)).length ?? 0;
                    return (
                      <button className={`source-row ${selectedSourceId === source.id ? "selected" : ""}`} key={source.id} onClick={() => setSelectedSourceId(source.id)}>
                        <span className="source-name"><span className="source-icon"><Icon size={17} /></span><span><strong>{source.title}</strong><small>{source.origin}</small></span>{source.mock && <em>mock</em>}</span>
                        <span className="kind-label">{source.kind}</span>
                        <span>{formatDate(source.updatedAt)}</span>
                        <span>{threads}</span>
                        <ChevronRight size={16} />
                      </button>
                    );
                  })}
                  {!filteredSources.length && <div className="empty-row">No matching sources.</div>}
                </div>
                {selectedSource && (
                  <aside className="source-inspector">
                    <button className="icon-button inspector-close" onClick={() => setSelectedSourceId(null)} title="Close source"><X size={17} /></button>
                    <span className="eyebrow">Source detail</span>
                    <h2>{selectedSource.title}</h2>
                    <p className="origin-line">{selectedSource.origin}</p>
                    <div className="tag-row">{selectedSource.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                    <div className="source-copy">{selectedSource.content}</div>
                    <div className="inspector-actions">
                      <button className="danger-button" onClick={() => deleteSource(selectedSource.id)}><Trash2 size={16} /> Remove</button>
                    </div>
                  </aside>
                )}
              </div>
            </section>
          )}

          {view === "threads" && (
            <section className="view-section">
              <div className="section-header compact"><div><span className="eyebrow">Relationship map</span><h1>Threads</h1></div></div>
              <div className="thread-table">
                <div className="thread-row thread-head"><span>Source</span><span>Shared signal</span><span>Source</span><span>Weight</span></div>
                {relatedEdges.map((edge) => {
                  const from = workspace.sources.find((source) => source.id === edge.from);
                  const to = workspace.sources.find((source) => source.id === edge.to);
                  if (!from || !to) return null;
                  return <button className="thread-row" key={edge.id} onClick={() => { setSelectedSourceId(from.id); setView("sources"); }}><strong>{from.title}</strong><span><i /><em>{edge.label}</em><i /></span><strong>{to.title}</strong><b>{edge.weight}</b></button>;
                })}
                {!relatedEdges.length && <div className="empty-row">Run a weave to create source threads.</div>}
              </div>
            </section>
          )}

          {view === "friction" && (
            <section className="view-section">
              <div className="section-header compact"><div><span className="eyebrow">Knowledge maintenance</span><h1>Friction</h1></div><button className="quiet-button" onClick={runWeave}><RefreshCw size={16} /> Recheck</button></div>
              <div className="issue-summary">
                {(["conflict", "stale", "duplicate", "orphan"] as const).map((type) => <div key={type}><span>{issueLabels[type]}</span><strong>{result?.issues.filter((issue) => issue.type === type).length ?? 0}</strong></div>)}
              </div>
              <div className="issue-list">
                {result?.issues.map((issue) => (
                  <article className={`issue-item ${issue.severity}`} key={issue.id}>
                    <div className="issue-icon">{issue.type === "stale" ? <Clock3 size={18} /> : issue.type === "duplicate" ? <Copy size={18} /> : issue.type === "orphan" ? <Link2 size={18} /> : <AlertTriangle size={18} />}</div>
                    <div><span className="issue-type">{issueLabels[issue.type]}</span><h2>{issue.title}</h2><p>{issue.detail}</p><small>{issue.suggestion}</small></div>
                    <button className="quiet-button" onClick={() => { setSelectedSourceId(issue.sourceIds[0]); setView("sources"); }}>Inspect <ChevronRight size={15} /></button>
                  </article>
                )) ?? <div className="empty-row">Run a weave to inspect friction.</div>}
              </div>
            </section>
          )}

          {view === "exports" && (
            <section className="view-section">
              <div className="section-header compact"><div><span className="eyebrow">Portable context</span><h1>Capsules & receipts</h1></div></div>
              <div className="export-grid">
                <button onClick={exportArchive}><span className="export-icon blue"><FileJson size={25} /></span><span><strong>Weave archive</strong><small>Complete local backup with sources, threads, friction, and receipts.</small><code>.weave.json</code></span><Download size={18} /></button>
                <button onClick={exportCapsule}><span className="export-icon red"><Boxes size={25} /></span><span><strong>Knowledge Capsule</strong><small>Portable Markdown manifest for people and agents.</small><code>capsule.md</code></span><Download size={18} /></button>
                <button onClick={() => downloadJson(`${safeFileName(workspace.name)}-trapper.json`, { type: "Trapper", version: "1.0", workspaceId: workspace.id, title: workspace.name, sources: workspace.sources, weave: result })}><span className="export-icon yellow"><FolderGit2 size={25} /></span><span><strong>Trapper package</strong><small>Warper Keeper-ready context object with source provenance.</small><code>trapper.json</code></span><Download size={18} /></button>
              </div>
              <div className="receipt-ledger">
                <div className="subsection-title"><ReceiptText size={17} /><strong>Local receipt ledger</strong><span>{workspace.receipts.length}</span></div>
                {workspace.receipts.map((receipt) => (
                  <div className="receipt-row" key={receipt.id}>
                    <CheckCircle2 size={17} />
                    <span><strong>{receipt.id}</strong><small>{formatDate(receipt.generatedAt)} · {receipt.sourceCount} sources · {receipt.relationshipCount} relationships</small></span>
                    <code>{receipt.outputHash}</code>
                    <button className="icon-button" onClick={() => navigator.clipboard.writeText(JSON.stringify(receipt, null, 2))} title="Copy receipt"><Copy size={15} /></button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {view === "connections" && (
            <section className="view-section">
              <div className="section-header compact"><div><span className="eyebrow">Bring your own stack</span><h1>Connections</h1></div></div>
              <div className="mesh-runtime-banner">
                <div className="mesh-organ"><span>K</span><div><strong>KoiDream</strong><small>Versions, provenance, encryption, receipts</small></div></div>
                <ChevronRight size={18} />
                <div className="mesh-organ"><span>G</span><div><strong>Gourami</strong><small>Topics, relationships, routing, shared context</small></div></div>
                <ChevronRight size={18} />
                <div className="mesh-organ result"><Network size={18} /><div><strong>Local memory mesh</strong><small>User-owned and permissioned</small></div></div>
              </div>
              <div className="connection-list">
                <article>
                  <span className="connection-icon"><Network size={22} /></span>
                  <div><h2>Memory Weaver local companion</h2><p>Encrypted PGLite vault, approved folder watching, KoiDream lineage, Gourami topology, and a read-only local MCP gateway.</p></div>
                  <a className="primary-button" href="https://github.com/BrandonDucar/memory-weaver/releases/latest" target="_blank" rel="noreferrer">Download alpha</a>
                </article>
                <article>
                  <span className="connection-icon"><GitBranch size={22} /></span>
                  <div><h2>GitHub</h2><p>Import selected text files from a public or private repository.</p></div>
                  <button className="primary-button" onClick={() => setDialog("github")}>Import repository</button>
                </article>
                <article>
                  <span className="connection-icon"><HardDrive size={22} /></span>
                  <div><h2>Files & local databases</h2><p>Open Markdown, text, CSV, JSON, or a complete weave archive from this device.</p></div>
                  <button className="quiet-button" onClick={() => fileInputRef.current?.click()}>Choose files</button>
                </article>
                <article className="llm-connection">
                  <span className="connection-icon"><Code2 size={22} /></span>
                  <div><h2>OpenAI-compatible model</h2><p>Optional enrichment lane. The key is held in memory for this tab and sent only to the endpoint you enter.</p></div>
                  <div className="connection-form">
                    <input placeholder="https://your-endpoint.example/v1" value={llmConfig.endpoint} onChange={(event) => setLlmConfig((current) => ({ ...current, endpoint: event.target.value }))} />
                    <input placeholder="Model ID" value={llmConfig.model} onChange={(event) => setLlmConfig((current) => ({ ...current, model: event.target.value }))} />
                    <div className="key-field"><KeyRound size={15} /><input type="password" placeholder="API key (not saved)" value={llmKey} onChange={(event) => setLlmKey(event.target.value)} /></div>
                    <button className="quiet-button" onClick={testLlm}>Test</button>
                    {llmStatus && <small>{llmStatus}</small>}
                  </div>
                </article>
                <article className="planned-connection">
                  <span className="connection-icon"><Settings2 size={22} /></span>
                  <div><h2>Native data mesh adapters</h2><p>Pieces, BrainSync, Obsidian, exact HTTP endpoints, Redis, NATS, Kafka, Neon, Graphiti, and agent clients all use one default-deny permission manifest.</p></div>
                  <span className="status-label">Companion rollout</span>
                </article>
              </div>
              <div className="privacy-boundary">
                <ShieldCheck size={22} /><div><strong>Two explicit privacy boundaries</strong><p>The web workspace stays in browser storage. No DreamNet backend receives imported source content. The companion starts with zero connectors, encrypts approved source bodies locally, preserves untrusted-content labels, and gives MCP clients read access only when a connector grants it. External writeback is disabled.</p></div>
              </div>
            </section>
          )}
        </div>
      </main>

      {dialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label={dialog === "github" ? "Import GitHub repository" : "Add source"}>
            <button className="icon-button dialog-close" onClick={() => setDialog(null)} title="Close"><X size={18} /></button>
            {dialog === "source" && (
              <form onSubmit={addPastedSource}>
                <span className="eyebrow">New local source</span><h2>Add a note</h2>
                <label>Title<input required value={sourceDraft.title} onChange={(event) => setSourceDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                <label>Content<textarea required rows={10} value={sourceDraft.content} onChange={(event) => setSourceDraft((current) => ({ ...current, content: event.target.value }))} /></label>
                <label>Tags <small>comma separated</small><input value={sourceDraft.tags} onChange={(event) => setSourceDraft((current) => ({ ...current, tags: event.target.value }))} /></label>
                <div className="dialog-actions"><button type="button" className="quiet-button" onClick={() => setDialog(null)}>Cancel</button><button className="primary-button" type="submit"><Plus size={16} /> Add source</button></div>
              </form>
            )}
            {dialog === "github" && (
              <form onSubmit={importGithub}>
                <span className="eyebrow">Direct browser import</span><h2>Connect a repository</h2>
                <label>Repository<input required placeholder="owner/repository or GitHub URL" value={repoInput} onChange={(event) => setRepoInput(event.target.value)} /></label>
                <label>Fine-grained token <small>private repositories only</small><div className="key-field"><KeyRound size={15} /><input type="password" placeholder="Held in this tab only" value={githubToken} onChange={(event) => setGithubToken(event.target.value)} /></div></label>
                <div className="dialog-note"><ShieldCheck size={17} /><p>The browser calls GitHub directly. Memory Weaver does not receive or store the token.</p></div>
                {githubStatus && <div className="form-status">{githubStatus}</div>}
                <div className="dialog-actions"><button type="button" className="quiet-button" onClick={() => setDialog(null)}>Cancel</button><button className="primary-button" type="submit"><GitBranch size={16} /> Import</button></div>
              </form>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  );
}
