// Server settings: everything the server is configured with, changed in the browser and applied
// without a restart. Behind the settings key. Secrets are write-only here: the server sends back
// only their last characters.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AI_TASKS,
  SETTINGS,
  SETTING_GROUPS,
  invalidSetting,
  type ProbeResult,
  type ProbeTarget,
  type ServiceName,
  type SettingDef,
  type SettingGroup,
  type SettingProblem,
  type SettingState,
  type SettingsView,
} from "../../shared/settings.ts";
import { Logo, Spinner } from "../components/ui.tsx";
import { admin, rememberKey, savedKey } from "../lib/admin.ts";
import { ApiError } from "../lib/api.ts";
import { go, loadConfig, message, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { plural, t, type MessageKey } from "../i18n/index.ts";

/** Unsaved changes: a value to set here, or null to stop setting it here. */
type Draft = Record<string, string | null>;

const PROBES: Partial<Record<SettingGroup, ProbeTarget>> = { ai: "ai", voice: "voice", postcards: "images", maps: "maps" };

const label = (key: string) => t(`setting.${key}` as MessageKey);
const help = (key: string) => t(`setting.${key}.help` as MessageKey);

function problemText(problem: SettingProblem): string {
  switch (problem.code) {
    case "min":
    case "max":
      return t(`server.problem.${problem.code}`, { limit: problem.limit });
    case "option":
      return t("server.problem.option", { options: problem.options.join(", ") });
    default:
      return t(`server.problem.${problem.code}` as MessageKey);
  }
}

/** The value a field shows: the unsaved one, else what the server uses. */
function shownValue(def: SettingDef, state: SettingState, draft: Draft): string {
  if (def.key in draft) {
    const value = draft[def.key];
    return value ?? state.envValue ?? def.fallback ?? "";
  }
  return state.value ?? "";
}

function SourceBadge({ def, state, draft }: { def: SettingDef; state: SettingState; draft: Draft }) {
  const pending = def.key in draft;
  const source = pending ? (draft[def.key] === null ? (state.envKey ? "env" : "default") : "page") : state.source;
  const text = source === "env" ? t("server.source.env", { key: state.envKey ?? def.key }) : t(`server.source.${source}`);
  return (
    <span className={`source source--${source}${pending ? " is-pending" : ""}`} data-testid={`source-${def.key}`}>
      {text}
      {pending ? ` · ${t("server.unsaved")}` : ""}
    </span>
  );
}

interface FieldProps {
  def: SettingDef;
  state: SettingState;
  draft: Draft;
  onChange: (key: string, value: string | null | undefined) => void;
  /** In the per-task table: no label or help (the table has them). */
  compact?: boolean;
}

function FieldActions({ def, state, draft, onChange }: FieldProps) {
  const pending = def.key in draft;
  const secret = def.kind === "secret";
  return (
    <span className="setting__actions">
      {pending ? (
        <button type="button" className="link-btn small" onClick={() => onChange(def.key, undefined)}>
          {t("server.undo")}
        </button>
      ) : null}
      {!pending && state.source === "page" ? (
        <button type="button" className="link-btn small" title={t("server.resetTitle")} onClick={() => onChange(def.key, null)} data-testid={`reset-${def.key}`}>
          {t("server.reset")}
        </button>
      ) : null}
      {secret && !pending && state.hint ? (
        <button type="button" className="link-btn small" title={t("server.clearTitle")} onClick={() => onChange(def.key, "")}>
          {t("server.clear")}
        </button>
      ) : null}
    </span>
  );
}

function Control({ def, state, draft, onChange, compact }: FieldProps) {
  const value = shownValue(def, state, draft);
  const id = `setting-${def.key}`;
  // Back to what the server already uses: no change after all.
  const set = (next: string) => onChange(def.key, next === (state.value ?? "") && draft[def.key] !== null ? undefined : next);
  const common = { id, "data-testid": id, "aria-label": compact ? `${label(def.key)}` : undefined };

  if (def.bootstrap) {
    return (
      <span className="setting__readonly" {...common}>
        {def.kind === "secret" ? state.hint || t("server.secretUnset") : state.value || "—"}
      </span>
    );
  }
  switch (def.kind) {
    case "toggle":
      return (
        <label className="toggle setting__toggle">
          <input type="checkbox" {...common} checked={value === def.on} onChange={(e) => set(e.target.checked ? def.on! : def.off!)} />
          <span>{value === def.on ? t("server.on") : t("server.off.short")}</span>
        </label>
      );
    case "select": {
      const options = [...(def.options ?? [])];
      // A value from the environment the list doesn't know (an alias, say) still shows as it is.
      if (value && !options.includes(value)) options.unshift(value);
      return (
        <select {...common} value={value} onChange={(e) => set(e.target.value)}>
          {def.fallback === undefined ? <option value="">{t("server.automatic")}</option> : null}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    case "secret": {
      const pending = def.key in draft;
      const placeholder = pending && draft[def.key] === "" ? t("server.secretCleared") : state.hint ? t("server.secretSet", { hint: state.hint }) : state.source === "page" ? t("server.secretCleared") : t("server.secretUnset");
      return (
        <input
          {...common}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={pending ? (draft[def.key] ?? "") : ""}
          placeholder={placeholder}
          onChange={(e) => onChange(def.key, e.target.value === "" ? undefined : e.target.value)}
        />
      );
    }
    default: {
      const placeholder = def.fallback ? t("server.default", { value: def.fallback }) : def.example ? t("server.example", { value: def.example }) : "";
      return (
        <input
          {...common}
          type={def.kind === "number" ? "number" : def.kind === "url" ? "url" : "text"}
          inputMode={def.kind === "number" ? "numeric" : undefined}
          min={def.min}
          max={def.max}
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => set(e.target.value)}
        />
      );
    }
  }
}

function Field(props: FieldProps) {
  const { def, state, draft } = props;
  const pending = draft[def.key];
  const problem = typeof pending === "string" ? invalidSetting(def, pending.trim()) : null;
  const envNote = state.source === "page" && (state.envValue || state.envHint) ? t("server.envHas", { value: state.envValue ?? state.envHint ?? "" }) : null;
  return (
    <div className={`setting${problem ? " has-problem" : ""}`} data-key={def.key}>
      <div className="setting__head">
        <label htmlFor={`setting-${def.key}`} className="setting__label">
          {label(def.key)} <code>{def.key}</code>
        </label>
        <SourceBadge {...props} />
      </div>
      <div className="setting__control">
        <Control {...props} />
        {def.bootstrap ? null : <FieldActions {...props} />}
      </div>
      {problem ? (
        <p className="setting__problem" role="alert">
          {problemText(problem)}
        </p>
      ) : null}
      <p className="setting__help muted small">
        {def.bootstrap ? `${help(def.key)} ${t("server.bootstrap")}` : help(def.key)}
        {envNote ? ` ${envNote}.` : ""}
      </p>
    </div>
  );
}

function TaskTable({ view, draft, onChange }: { view: SettingsView; draft: Draft; onChange: FieldProps["onChange"] }) {
  const cell = (key: string) => {
    const def = SETTINGS.find((s) => s.key === key)!;
    const state = view.settings[key]!;
    const pending = draft[key];
    const problem = typeof pending === "string" ? invalidSetting(def, pending.trim()) : null;
    return (
      <td className={problem ? "has-problem" : undefined}>
        <div className="setting__control">
          <Control def={def} state={state} draft={draft} onChange={onChange} compact />
          <FieldActions def={def} state={state} draft={draft} onChange={onChange} />
        </div>
        {problem ? <p className="setting__problem">{problemText(problem)}</p> : null}
        {key in draft || state.source !== "default" ? <SourceBadge def={def} state={state} draft={draft} /> : null}
      </td>
    );
  };
  return (
    <div className="task-table__wrap">
      <table className="task-table">
        <thead>
          <tr>
            <th scope="col">{t("server.taskColumn")}</th>
            <th scope="col">{t("server.modelColumn")}</th>
            <th scope="col">{t("server.effortColumn")}</th>
            <th scope="col">{t("server.capColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {AI_TASKS.map((task) => {
            const upper = task.toUpperCase();
            return (
              <tr key={task}>
                <th scope="row">{t(`server.task.${task}`)}</th>
                {cell(`AI_MODEL_${upper}`)}
                {cell(`EFFORT_${upper}`)}
                {cell(`AI_MAX_TOKENS_${upper}`)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusCard({ view }: { view: SettingsView }) {
  const { status } = view;
  const ai = status.ai.mode === "demo" ? t("server.aiDemo") : `${status.ai.mode === "claude" ? "Claude" : "OpenAI-compatible"} · ${status.ai.model ?? ""}${status.ai.endpoint ? ` · ${status.ai.endpoint}` : ""}`;
  const voice = [
    status.voice.listen ? t("server.voiceListens", { model: status.voice.listen }) : null,
    status.voice.speak === "tts" ? t("server.voiceSpeaksTts", { model: status.voice.tts ?? "" }) : status.voice.speak === "model" ? t("server.voiceSpeaksModel") : t("server.voiceBrowser"),
  ]
    .filter(Boolean)
    .join(" · ");
  const maps = [status.maps.mode === "google" ? t("server.mapsGoogle") : t("server.mapsOpen"), status.maps.grounding === "google" ? t("server.groundingGoogle") : t("server.groundingWiki"), status.maps.walkingRoutes ? t("server.walking") : null].filter(Boolean).join(" · ");
  const rows: [string, string][] = [
    [t("server.statusAi"), ai],
    [t("server.statusVoice"), status.voice.listen || status.voice.speak !== "browser" ? voice : t("server.voiceOff")],
    [t("server.statusPostcards"), status.postcards.on ? `${t("server.on")}${status.postcards.model ? ` · ${status.postcards.model}` : ""}` : t("server.off.short")],
    [t("server.statusMaps"), maps],
    [t("server.statusClassroom"), status.classroom.on ? `${t("server.on")} · ${status.classroom.store === "postgres" ? t("server.storePostgres") : t("server.storeFile")}` : t("server.off.short")],
    [t("server.statusAccess"), status.accessCode ? t("server.required") : t("server.none")],
  ];
  return (
    <section className="card" aria-labelledby="server-status" data-testid="server-status">
      <h2 id="server-status">{t("server.status")}</h2>
      <dl className="facts">
        {rows.map(([name, value]) => (
          <div key={name} className="facts__row">
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">
        {view.storage === "postgres" ? t("server.storagePostgres") : t("server.storageFile")} {view.watchesDotEnv ? t("server.dotEnv") : ""}
      </p>
    </section>
  );
}

function ProbeLine({ result }: { result: ProbeResult | "running" | undefined }) {
  if (!result) return null;
  if (result === "running") return <Spinner label={t("server.testing")} />;
  return (
    <p className={`probe ${result.ok ? "probe--ok" : "probe--failed"}`} role="status" data-testid="probe-result">
      <strong>{result.ok ? `✓ ${t("server.testOk", { ms: result.ms })}` : `✗ ${t("server.testFailed")}`}</strong> {result.message}
    </p>
  );
}

function Unlock({ keySource, onUnlocked }: { keySource: "env" | "generated" | null; onUnlocked: (key: string, view: SettingsView) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const view = await admin.load(key.trim());
      rememberKey(key.trim());
      onUnlocked(key.trim(), view);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card unlock" onSubmit={(e) => void submit(e)}>
      <h2>{t("server.unlockTitle")}</h2>
      <p className="small">{keySource === "env" ? t("server.unlockEnv") : t("server.unlockText")}</p>
      <label className="field">
        <span>{t("server.key")}</span>
        <input type="password" autoComplete="current-password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} data-testid="settings-key" />
      </label>
      {error ? (
        <p className="setting__problem" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn--primary" disabled={!key.trim() || busy} data-testid="unlock-settings">
        {busy ? <Spinner /> : t("server.unlock")}
      </button>
    </form>
  );
}

export function ServerSettingsScreen() {
  const game = useGame();
  const [phase, setPhase] = useState<"checking" | "off" | "locked" | "open">("checking");
  const [keySource, setKeySource] = useState<"env" | "generated" | null>(null);
  const [key, setKey] = useState("");
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [probes, setProbes] = useState<Partial<Record<ProbeTarget, ProbeResult | "running">>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await admin.status();
        if (cancelled) return;
        setKeySource(status.keySource);
        if (!status.enabled) return setPhase("off");
        const remembered = savedKey();
        if (remembered) {
          try {
            const loaded = await admin.load(remembered);
            if (cancelled) return;
            setKey(remembered);
            setView(loaded);
            return setPhase("open");
          } catch {
            rememberKey(null);
          }
        }
        setPhase("locked");
      } catch (error) {
        if (cancelled) return;
        toast("error", t("server.title"), message(error));
        setPhase("locked");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const change = (settingKey: string, value: string | null | undefined) => {
    setDraft((d) => {
      const next = { ...d };
      if (value === undefined) delete next[settingKey];
      else next[settingKey] = value;
      return next;
    });
  };

  const problems = useMemo(
    () =>
      Object.entries(draft).filter(([settingKey, value]) => {
        const def = SETTINGS.find((s) => s.key === settingKey);
        return def && typeof value === "string" && invalidSetting(def, value.trim()) !== null;
      }).length,
    [draft],
  );
  const pending = Object.keys(draft).length;

  const back = () => {
    if (window.location.hash === "#settings") history.replaceState(null, "", window.location.pathname + window.location.search);
    go(game.player ? "settings" : "title");
  };

  const save = async () => {
    if (!view) return;
    setSaving(true);
    try {
      const saved = await admin.save(key, { values: draft, revision: view.revision });
      setView(saved);
      setDraft({});
      const services = saved.applied.map((s: ServiceName) => t(`server.service.${s}`)).join(", ");
      toast("success", t("server.applied"), services ? t("server.appliedText", { services }) : t("server.nothingApplied"));
      // This browser picks up the new configuration now; others do on their next check.
      void loadConfig();
    } catch (error) {
      if (error instanceof ApiError && error.code === "settings_conflict") setView(await admin.load(key));
      if (error instanceof ApiError && error.code === "admin_key") {
        rememberKey(null);
        setPhase("locked");
      }
      toast("error", t("server.title"), message(error));
    } finally {
      setSaving(false);
    }
  };

  const probe = async (target: ProbeTarget) => {
    setProbes((p) => ({ ...p, [target]: "running" }));
    try {
      const result = await admin.test(key, target, draft);
      setProbes((p) => ({ ...p, [target]: result }));
    } catch (error) {
      setProbes((p) => ({ ...p, [target]: { ok: false, ms: 0, message: message(error) } }));
    }
  };

  const newKey = async () => {
    if (!window.confirm(t("server.newKeyConfirm"))) return;
    try {
      const { key: fresh } = await admin.newKey(key);
      setKey(fresh);
      rememberKey(fresh);
      window.alert(t("server.newKeyShown", { key: fresh }));
    } catch (error) {
      toast("error", t("server.title"), message(error));
    }
  };

  const lock = () => {
    rememberKey(null);
    setKey("");
    setView(null);
    setDraft({});
    setPhase("locked");
  };

  let body: ReactNode;
  if (phase === "checking") body = <Spinner label={t("server.checking")} />;
  else if (phase === "off") body = <p className="notice">{t("server.off")}</p>;
  else if (phase === "locked" || !view)
    body = (
      <Unlock
        keySource={keySource}
        onUnlocked={(unlockedKey, loaded) => {
          setKey(unlockedKey);
          setView(loaded);
          setPhase("open");
        }}
      />
    );
  else
    body = (
      <>
        <StatusCard view={view} />
        {view.warnings.length ? (
          <section className="card card--warning" aria-labelledby="server-warnings" data-testid="server-warnings">
            <h2 id="server-warnings">{t("server.warnings")}</h2>
            <ul>
              {view.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {SETTING_GROUPS.map((group) => {
          const target = PROBES[group];
          return (
            <section key={group} className="card setting-group" aria-labelledby={`group-${group}`} data-testid={`group-${group}`}>
              <div className="setting-group__head">
                <h2 id={`group-${group}`}>{t(`server.group.${group}`)}</h2>
                {target ? (
                  <button type="button" className="btn btn--small" onClick={() => void probe(target)} disabled={probes[target] === "running"} title={t("server.testUnsaved")} data-testid={`test-${target}`}>
                    {t("server.test")}
                  </button>
                ) : null}
              </div>
              <p className="muted small">{t(`server.groupHelp.${group}`)}</p>
              {target ? <ProbeLine result={probes[target]} /> : null}
              {group === "tasks" ? (
                <TaskTable view={view} draft={draft} onChange={change} />
              ) : (
                SETTINGS.filter((def) => def.group === group).map((def) => <Field key={def.key} def={def} state={view.settings[def.key]!} draft={draft} onChange={change} />)
              )}
            </section>
          );
        })}
        <div className="save-bar" role="region" aria-label={t("server.save")}>
          <span className="save-bar__status" role="status">
            {problems ? t("server.fixProblems") : pending ? plural(pending, "server.unsavedOne", "server.unsavedOther") : t("server.allSaved")}
          </span>
          <button type="button" className="btn btn--ghost" onClick={() => setDraft({})} disabled={!pending || saving}>
            {t("server.discard")}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!pending || problems > 0 || saving} data-testid="save-settings">
            {saving ? <Spinner label={t("server.saving")} /> : t("server.save")}
          </button>
        </div>
      </>
    );

  return (
    <div className="page settings server-settings" data-testid="server-settings">
      <header className="page-head server-settings__head">
        <button type="button" className="link-btn back" onClick={back}>
          ← {t("server.back")}
        </button>
        <div className="row">
          {game.player ? null : <Logo size={32} />}
          <h1>{t("server.title")}</h1>
        </div>
        <p className="muted">{t("server.intro")}</p>
        {phase === "open" ? (
          <div className="row">
            {keySource === "generated" ? (
              <button type="button" className="btn btn--small" onClick={() => void newKey()}>
                {t("server.newKey")}
              </button>
            ) : null}
            <button type="button" className="btn btn--small" onClick={lock} data-testid="lock-settings">
              {t("server.lock")}
            </button>
          </div>
        ) : null}
      </header>
      {body}
    </div>
  );
}
