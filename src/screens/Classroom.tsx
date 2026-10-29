// Classroom mode: students join with a class code and see their assignments; teachers create a
// class, assign expeditions with a focus skill, and read the class debrief view. Only summaries are
// shared (scores, the mentor's headline): conversations stay in each student's browser.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AssignmentSummary, ClassDashboard, StudentClassView } from "../../shared/classroom.ts";
import { POSTCARDS } from "../../shared/destinations.ts";
import { SKILL_IDS, SKILLS, type SkillId } from "../../shared/skills.ts";
import { Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { createClass, joinClass, leaveClass, message, startAssignment, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { placeName, postcardText, skillName, t } from "../i18n/index.ts";

function JoinClass() {
  const game = useGame();
  const [code, setCode] = useState("");
  const [name, setName] = useState(game.player?.name ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await joinClass(code, name.trim());
    setBusy(false);
  };
  return (
    <form className="card class-form" onSubmit={(e) => void submit(e)} aria-labelledby="join-title">
      <h2 id="join-title">{t("class.joinTitle")}</h2>
      <p className="muted small">{t("class.joinText")}</p>
      <label className="field">
        <span>{t("class.code")}</span>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoCapitalize="characters" autoComplete="off" required data-testid="class-code-input" />
      </label>
      <label className="field">
        <span>{t("class.studentName")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required data-testid="student-name-input" />
      </label>
      <button type="submit" className="btn btn--primary" disabled={busy || code.trim().length !== 6 || !name.trim()} data-testid="join-class">
        {busy ? <Spinner label={t("class.joining")} /> : t("class.join")}
      </button>
    </form>
  );
}

function StudentClass({ code, className }: { code: string; className: string }) {
  const [view, setView] = useState<StudentClassView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(useGame().ui.busy);
  useEffect(() => {
    api.classes.view(code).then(setView, (e: unknown) => setError(message(e)));
  }, [code]);
  return (
    <section className="card" aria-labelledby="student-class-title" data-testid="student-class">
      <p className="eyebrow">{t("class.yourClass")}</p>
      <h2 id="student-class-title">{className}</h2>
      {view ? <p className="muted small">{t("class.teacher", { name: view.teacherName })}</p> : null}
      {error ? <p className="notice">{error}</p> : null}
      {!view && !error ? <Spinner label={t("class.loadingAssignments")} /> : null}
      {view && view.assignments.length === 0 ? <p className="muted">{t("class.noAssignmentsStudent")}</p> : null}
      <ul className="assignments">
        {view?.assignments.map((a) => (
          <li key={a.id} className="assignment">
            <div>
              <h3>{a.title}</h3>
              <p className="muted small">
                {placeName(a.destination)} · {t("class.focus", { icon: SKILLS[a.focusSkill].icon, skill: skillName(a.focusSkill) })}
              </p>
              {a.note ? <p className="small">{a.note}</p> : null}
            </div>
            <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => void startAssignment(a, code)} data-testid="start-assignment">
              {t("class.start")}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="link-btn small" onClick={() => leaveClass("student")}>
        {t("class.leave")}
      </button>
    </section>
  );
}

function CreateClass() {
  const game = useGame();
  const [name, setName] = useState("");
  const [teacherName, setTeacherName] = useState(game.player?.name ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await createClass(name.trim(), teacherName.trim());
    setBusy(false);
  };
  return (
    <form className="card class-form" onSubmit={(e) => void submit(e)} aria-labelledby="create-title">
      <h2 id="create-title">{t("class.teachTitle")}</h2>
      <p className="muted small">{t("class.teachText")}</p>
      <label className="field">
        <span>{t("class.name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder={t("class.namePlaceholder")} data-testid="class-name-input" />
      </label>
      <label className="field">
        <span>{t("class.teacherName")}</span>
        <input value={teacherName} onChange={(e) => setTeacherName(e.target.value)} maxLength={60} required data-testid="teacher-name-input" />
      </label>
      <button type="submit" className="btn btn--primary" disabled={busy || !name.trim() || !teacherName.trim()} data-testid="create-class">
        {busy ? <Spinner label={t("class.creating")} /> : t("class.create")}
      </button>
    </form>
  );
}

function AssignForm({ code, teacherKey, onAdded }: { code: string; teacherKey: string; onAdded: () => void }) {
  const [postcardId, setPostcardId] = useState(POSTCARDS[0]!.id);
  const [focus, setFocus] = useState<SkillId>("listening");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = POSTCARDS.find((x) => x.id === postcardId)!;
    setBusy(true);
    try {
      await api.classes.assign(code, teacherKey, {
        title: `${postcardText(p).name}: ${skillName(focus)}`,
        destination: { lat: p.lat, lng: p.lng, label: p.name, country: p.country, postcardId: p.id, source: "postcard" },
        focusSkill: focus,
        note: note.trim() || undefined,
      });
      setNote("");
      onAdded();
    } catch (error) {
      toast("error", t("class.addFailed"), message(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="assign-form" onSubmit={(e) => void submit(e)} aria-label={t("class.newAssignment")}>
      <label className="field">
        <span>{t("class.where")}</span>
        <select value={postcardId} onChange={(e) => setPostcardId(e.target.value)} data-testid="assign-place">
          {POSTCARDS.map((p) => (
            <option key={p.id} value={p.id}>
              {postcardText(p).name}, {postcardText(p).country} — {postcardText(p).theme}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("onboarding.focusSkill")}</span>
        <select value={focus} onChange={(e) => setFocus(e.target.value as SkillId)} data-testid="assign-skill">
          {SKILL_IDS.map((id) => (
            <option key={id} value={id}>
              {SKILLS[id].icon} {skillName(id)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("class.note")}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder={t("class.notePlaceholder")} />
      </label>
      <button type="submit" className="btn btn--primary" disabled={busy} data-testid="add-assignment">
        {busy ? <Spinner label={t("class.adding")} /> : t("class.assign")}
      </button>
    </form>
  );
}

/** The class debrief view for one assignment. */
function AssignmentReport({ summary, students, onRemove }: { summary: AssignmentSummary; students: number; onRemove: () => void }) {
  const { assignment, completed } = summary;
  const scored = SKILL_IDS.filter((id) => summary.averageScores[id] !== null);
  const calibration = summary.averageCalibration;
  return (
    <li className="card report" data-testid="assignment-report">
      <header className="report__head">
        <div>
          <h3>{assignment.title}</h3>
          <p className="muted small">
            {t("class.focus", { icon: SKILLS[assignment.focusSkill].icon, skill: skillName(assignment.focusSkill) })}
            {assignment.note ? ` · ${assignment.note}` : ""}
          </p>
        </div>
        <button type="button" className="link-btn small" onClick={onRemove}>
          {t("class.remove")}
        </button>
      </header>
      <p className="report__stats">
        <strong data-testid="completed">
          {t("class.completedOf", { done: completed, total: students })}
        </strong>{" "}
        {t("class.finished")}
        {summary.goalRate !== null ? ` · ${t("class.goalRate", { rate: summary.goalRate })}` : ""}
      </p>
      {completed > 0 ? (
        <>
          <dl className="report__skills">
            {scored.map((id) => (
              <div key={id}>
                <dt>
                  {SKILLS[id].icon} {skillName(id)}
                </dt>
                <dd>
                  <span className="report__bar" style={{ width: `${(summary.averageScores[id]! / 4) * 100}%` }} />
                  <span className="small">{summary.averageScores[id]} / 4</span>
                </dd>
              </div>
            ))}
          </dl>
          {summary.commonGrowth.length ? (
            <p className="small">
              <strong>{t("class.growthAreas")}</strong> {summary.commonGrowth.map((g) => `${skillName(g.skill)} (${g.count})`).join(", ")}
            </p>
          ) : null}
          {calibration !== null ? (
            <p className="small">
              <strong>{t("class.selfAssessment")}</strong>{" "}
              {Math.abs(calibration) < 0.5 ? t("class.calibrated") : calibration > 0 ? t("class.overrate") : t("class.underrate")}
            </p>
          ) : null}
          <table className="report__table">
            <thead>
              <tr>
                <th scope="col">{t("class.student")}</th>
                <th scope="col">{t("class.talkedWith")}</th>
                <th scope="col">{t("class.headline")}</th>
                <th scope="col">{t("class.goal")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.results.map((r) => (
                <tr key={`${r.studentName}-${r.at}`}>
                  <td>{r.studentName}</td>
                  <td>
                    {r.kind === "mediation" ? "⚖️ " : ""}
                    {r.with}
                  </td>
                  <td>{r.headline}</td>
                  <td>{r.goalAchieved ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted small">{t("class.noResults")}</p>
      )}
    </li>
  );
}

function TeacherClass({ code, teacherKey, className }: { code: string; teacherKey: string; className: string }) {
  const [dashboard, setDashboard] = useState<ClassDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(() => {
    setLoading(true);
    api.classes
      .dashboard(code, teacherKey)
      .then(setDashboard, (e: unknown) => toast("error", t("class.loadFailed"), message(e)))
      .finally(() => setLoading(false));
  }, [code, teacherKey]);
  useEffect(refresh, [refresh]);
  const remove = async (id: string) => {
    if (!window.confirm(t("class.removeConfirm"))) return;
    await api.classes.unassign(code, teacherKey, id).catch((e: unknown) => toast("error", t("class.removeFailed"), message(e)));
    refresh();
  };
  return (
    <section className="card" aria-labelledby="teacher-class-title" data-testid="teacher-class">
      <p className="eyebrow">{t("class.teaching")}</p>
      <h2 id="teacher-class-title">{className}</h2>
      <p className="class-code">
        {t("class.code")} <strong data-testid="class-code">{code}</strong>
      </p>
      <p className="muted small">{t("class.codeHelp")}</p>
      <h3>{t("class.newAssignment")}</h3>
      <AssignForm code={code} teacherKey={teacherKey} onAdded={refresh} />
      <div className="row report-head">
        <h3>{t("class.debrief")}</h3>
        <span className="muted small">{dashboard ? t("class.students", { count: dashboard.students.length }) : ""}</span>
        <button type="button" className="btn btn--small" onClick={refresh} disabled={loading} data-testid="refresh-dashboard">
          {loading ? <Spinner /> : t("class.refresh")}
        </button>
      </div>
      {dashboard && dashboard.assignments.length === 0 ? <p className="muted">{t("class.noAssignments")}</p> : null}
      <ul className="reports">
        {dashboard?.assignments.map((summary) => (
          <AssignmentReport key={summary.assignment.id} summary={summary} students={dashboard.students.length} onRemove={() => void remove(summary.assignment.id)} />
        ))}
      </ul>
      <button type="button" className="link-btn small" onClick={() => window.confirm(t("class.forgetConfirm")) && leaveClass("teacher")}>
        {t("class.forget")}
      </button>
    </section>
  );
}

export function ClassroomScreen() {
  const game = useGame();
  const classroom = game.classroom ?? {};
  return (
    <div className="page classroom">
      <header className="page-head">
        <h1>{t("nav.classroom")}</h1>
        <p className="muted">{t("class.intro")}</p>
      </header>
      <div className="classroom__grid">
        {classroom.student ? <StudentClass code={classroom.student.code} className={classroom.student.className} /> : <JoinClass />}
        {classroom.teacher ? <TeacherClass code={classroom.teacher.code} teacherKey={classroom.teacher.teacherKey} className={classroom.teacher.className} /> : <CreateClass />}
      </div>
    </div>
  );
}
