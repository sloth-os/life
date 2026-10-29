import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { INSIGHT_THRESHOLDS, rapportTier } from "../../shared/rules.ts";
import type { Source } from "../../shared/schemas.ts";
import { SKILL_IDS, SKILLS, type SkillId } from "../../shared/skills.ts";
import { EMOTIONS, LENSES, MOVES, type EmotionId, type LensId, type MoveId } from "../../shared/world.ts";
import { dismissToast } from "../state/actions.ts";
import type { Toast } from "../state/types.ts";
import { emotionLabel, lensName, moveText, skillName, t, tierName } from "../i18n/index.ts";

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="logo">
      <path d="M24 4C13 4 4 12 4 22c0 5.6 2.8 10.6 7.3 13.9L9.5 44l9-4.6c1.8.4 3.6.6 5.5.6 11 0 20-8 20-18S35 4 24 4z" fill="var(--accent)" />
      <circle cx="24" cy="22" r="11" fill="var(--paper)" />
      <path d="M24 13.5l3 8.5-3 8.5-3-8.5z" fill="var(--ink)" />
      <path d="M15.5 22l8.5-3 8.5 3-8.5 3z" fill="var(--accent-2)" />
      <circle cx="24" cy="22" r="1.6" fill="var(--paper)" />
    </svg>
  );
}

export function Avatar({ name, hue, size = 44 }: { name: string; hue: number; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="avatar" style={{ "--hue": hue, width: size, height: size, fontSize: size * 0.38 } as CSSProperties} aria-hidden="true">
      {initials}
    </span>
  );
}

export function LensTag({ lens }: { lens: LensId }) {
  const info = LENSES[lens];
  return (
    <span className="tag" style={{ "--tag-color": info.color } as CSSProperties}>
      <span aria-hidden="true">{info.icon}</span> {lensName(lens)}
    </span>
  );
}

export function EmotionChip({ emotion }: { emotion: EmotionId }) {
  const info = EMOTIONS[emotion];
  return (
    <span className="emotion" aria-label={t("ui.mood", { mood: emotionLabel(emotion) })}>
      <span aria-hidden="true">{info.emoji}</span> {emotionLabel(emotion)}
    </span>
  );
}

export function Difficulty({ level }: { level: 1 | 2 | 3 }) {
  const label = level === 1 ? t("ui.difficultyOpen") : level === 2 ? t("ui.difficultyReserved") : t("ui.difficultyGuarded");
  return (
    <span className="difficulty" aria-label={t("ui.difficulty", { level, label })}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= level ? "on" : ""} aria-hidden="true" />
      ))}
      {label}
    </span>
  );
}

export function RapportMeter({ value, delta, thresholds = [...INSIGHT_THRESHOLDS] }: { value: number; delta?: number; thresholds?: number[] }) {
  const v = Math.round(value);
  return (
    <div className="rapport" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={t("ui.rapportAria", { value: v, tier: tierName(rapportTier(v)) })}>
      <div className="rapport__head">
        <span className="rapport__label">{t("ui.rapport")}</span>
        <strong>{tierName(rapportTier(v))}</strong>
        {delta ? (
          <span key={`${v}-${delta}`} className={`rapport__delta ${delta > 0 ? "up" : "down"}`}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        ) : null}
      </div>
      <div className="rapport__track">
        <div className="rapport__fill" style={{ width: `${v}%` }} />
        {thresholds.map((mark) => (
          <span key={mark} className={`rapport__mark${v >= mark ? " is-reached" : ""}`} style={{ left: `${mark}%` }} title={t("ui.insightAt", { value: mark })}>
            {v >= mark ? "★" : "·"}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MoveChips({ moves }: { moves: MoveId[] }) {
  if (!moves.length) return null;
  return (
    <ul className="moves" aria-label={t("ui.noticed")}>
      {moves.map((m) => {
        const info = MOVES[m];
        const kind = info.valence > 0 ? "good" : info.valence < 0 ? "watch" : "neutral";
        return (
          <li key={m} className={`move move--${kind}`} title={moveText(m).description}>
            {info.valence > 0 ? "+ " : info.valence < 0 ? "⚠ " : ""}
            {moveText(m).label}
            {info.skill && info.valence !== 0 ? <span className="move__skill"> · {skillName(info.skill)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function SkillRadar({ values, size = 320, label = t("compass.title") }: { values: Record<SkillId, number>; size?: number; label?: string }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 64;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / SKILL_IDS.length;
  const at = (i: number, v: number) => [cx + ((r * v) / 100) * Math.cos(angle(i)), cy + ((r * v) / 100) * Math.sin(angle(i))] as const;
  const polygon = SKILL_IDS.map((id, i) => at(i, Math.max(4, values[id])).join(",")).join(" ");
  return (
    <svg className="radar" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${SKILL_IDS.map((id) => `${skillName(id)} ${Math.round(values[id])}`).join(", ")}`}>
      {[20, 40, 60, 80, 100].map((ring) => (
        <polygon key={ring} className="radar__ring" points={SKILL_IDS.map((_, i) => at(i, ring).join(",")).join(" ")} />
      ))}
      {SKILL_IDS.map((id, i) => {
        const [x, y] = at(i, 100);
        return <line key={id} className="radar__axis" x1={cx} y1={cy} x2={x} y2={y} />;
      })}
      <polygon className="radar__value" points={polygon} />
      {SKILL_IDS.map((id, i) => {
        const [x, y] = at(i, Math.max(4, values[id]));
        return <circle key={id} className="radar__dot" cx={x} cy={y} r={3.5} />;
      })}
      {SKILL_IDS.map((id, i) => {
        const [x, y] = at(i, 132);
        return (
          <text key={id} className="radar__label" x={x} y={y} textAnchor="middle" dominantBaseline="middle">
            <tspan x={x} dy="-0.4em">
              {SKILLS[id].icon}
            </tspan>
            <tspan x={x} dy="1.25em">
              {skillName(id)}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}

export function SourceList({ sources, title = t("ui.sources") }: { sources: Source[]; title?: string }) {
  if (!sources.length) return null;
  const google = sources.filter((s) => s.kind === "google_place");
  return (
    <details className="sources">
      <summary>
        {title} <span className="muted">({sources.length})</span>
      </summary>
      <ul>
        {sources.map((s) => (
          <li key={s.id}>
            <span className="sources__id">{s.id}</span>{" "}
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            ) : (
              s.title
            )}{" "}
            <span className="muted">· {s.attribution}</span>
          </li>
        ))}
      </ul>
      {google.length ? <p className="sources__note">{t("ui.googleNote")}</p> : null}
    </details>
  );
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <div>
            <strong>{toast.kind === "insight" ? "📗 " : toast.kind === "error" ? "⚠️ " : toast.kind === "success" ? "✨ " : ""}{toast.title}</strong>
            {toast.body ? <p>{toast.body}</p> : null}
          </div>
          <button type="button" className="icon-btn" aria-label={t("ui.dismiss")} onClick={() => dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

/** Seconds since `startedAt`, ticking once a second (0 while `startedAt` is null). */
export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
}

/** 75 → "1:15". */
export const formatElapsed = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** 12400 → "12k". */
export const formatCount = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner__dot" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">{t("ui.loading")}</span>}
    </span>
  );
}
