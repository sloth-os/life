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
      <h2 id="join-title">Join a class</h2>
      <p className="muted small">Your teacher gives you a six-letter code. They'll see your name and how your assignments went — never your conversations.</p>
      <label className="field">
        <span>Class code</span>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoCapitalize="characters" autoComplete="off" required data-testid="class-code-input" />
      </label>
      <label className="field">
        <span>Your name, as your teacher knows you</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required data-testid="student-name-input" />
      </label>
      <button type="submit" className="btn btn--primary" disabled={busy || code.trim().length !== 6 || !name.trim()} data-testid="join-class">
        {busy ? <Spinner label="Joining…" /> : "Join"}
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
      <p className="eyebrow">Your class</p>
      <h2 id="student-class-title">{className}</h2>
      {view ? <p className="muted small">Teacher: {view.teacherName}</p> : null}
      {error ? <p className="notice">{error}</p> : null}
      {!view && !error ? <Spinner label="Loading assignments…" /> : null}
      {view && view.assignments.length === 0 ? <p className="muted">No assignments yet. Explore freely in the meantime!</p> : null}
      <ul className="assignments">
        {view?.assignments.map((a) => (
          <li key={a.id} className="assignment">
            <div>
              <h3>{a.title}</h3>
              <p className="muted small">
                {a.destination.label}
                {a.destination.country ? `, ${a.destination.country}` : ""} · focus: {SKILLS[a.focusSkill].icon} {SKILLS[a.focusSkill].name}
              </p>
              {a.note ? <p className="small">{a.note}</p> : null}
            </div>
            <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => void startAssignment(a, code)} data-testid="start-assignment">
              Start
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="link-btn small" onClick={() => leaveClass("student")}>
        Leave this class
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
      <h2 id="create-title">Teach a class</h2>
      <p className="muted small">Assign expeditions with a focus skill, and see how your class is doing: completion, skills, common growth areas and how well students judge themselves.</p>
      <label className="field">
        <span>Class name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="e.g. 9B Global Citizenship" data-testid="class-name-input" />
      </label>
      <label className="field">
        <span>Your name, as students know you</span>
        <input value={teacherName} onChange={(e) => setTeacherName(e.target.value)} maxLength={60} required data-testid="teacher-name-input" />
      </label>
      <button type="submit" className="btn btn--primary" disabled={busy || !name.trim() || !teacherName.trim()} data-testid="create-class">
        {busy ? <Spinner label="Creating…" /> : "Create class"}
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
        title: `${p.name}: ${SKILLS[focus].name}`,
        destination: { lat: p.lat, lng: p.lng, label: p.name, country: p.country, postcardId: p.id, source: "postcard" },
        focusSkill: focus,
        note: note.trim() || undefined,
      });
      setNote("");
      onAdded();
    } catch (error) {
      toast("error", "Couldn't add the assignment", message(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="assign-form" onSubmit={(e) => void submit(e)} aria-label="New assignment">
      <label className="field">
        <span>Where</span>
        <select value={postcardId} onChange={(e) => setPostcardId(e.target.value)} data-testid="assign-place">
          {POSTCARDS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {p.country} — {p.theme}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Focus skill</span>
        <select value={focus} onChange={(e) => setFocus(e.target.value as SkillId)} data-testid="assign-skill">
          {SKILL_IDS.map((id) => (
            <option key={id} value={id}>
              {SKILLS[id].icon} {SKILLS[id].name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Note for students (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="e.g. Ask at least two open questions before Friday." />
      </label>
      <button type="submit" className="btn btn--primary" disabled={busy} data-testid="add-assignment">
        {busy ? <Spinner label="Adding…" /> : "Assign"}
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
            {SKILLS[assignment.focusSkill].icon} focus: {SKILLS[assignment.focusSkill].name}
            {assignment.note ? ` · ${assignment.note}` : ""}
          </p>
        </div>
        <button type="button" className="link-btn small" onClick={onRemove}>
          Remove
        </button>
      </header>
      <p className="report__stats">
        <strong data-testid="completed">
          {completed} of {students}
        </strong>{" "}
        finished{summary.goalRate !== null ? ` · ${summary.goalRate}% reached their goal` : ""}
      </p>
      {completed > 0 ? (
        <>
          <dl className="report__skills">
            {scored.map((id) => (
              <div key={id}>
                <dt>
                  {SKILLS[id].icon} {SKILLS[id].name}
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
              <strong>Growth areas the mentor named:</strong> {summary.commonGrowth.map((g) => `${SKILLS[g.skill].name} (${g.count})`).join(", ")}
            </p>
          ) : null}
          {calibration !== null ? (
            <p className="small">
              <strong>Self-assessment:</strong>{" "}
              {Math.abs(calibration) < 0.5 ? "the class judges itself about right." : calibration > 0 ? "the class tends to rate itself higher than the mentor does." : "the class tends to be harder on itself than the mentor is."}
            </p>
          ) : null}
          <table className="report__table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Talked with</th>
                <th scope="col">Mentor's headline</th>
                <th scope="col">Goal</th>
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
        <p className="muted small">No results yet.</p>
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
      .then(setDashboard, (e: unknown) => toast("error", "Couldn't load the class", message(e)))
      .finally(() => setLoading(false));
  }, [code, teacherKey]);
  useEffect(refresh, [refresh]);
  const remove = async (id: string) => {
    if (!window.confirm("Remove this assignment and its results?")) return;
    await api.classes.unassign(code, teacherKey, id).catch((e: unknown) => toast("error", "Couldn't remove it", message(e)));
    refresh();
  };
  return (
    <section className="card" aria-labelledby="teacher-class-title" data-testid="teacher-class">
      <p className="eyebrow">Teaching</p>
      <h2 id="teacher-class-title">{className}</h2>
      <p className="class-code">
        Class code <strong data-testid="class-code">{code}</strong>
      </p>
      <p className="muted small">Students open Class → Join a class and type this code. Keep this browser: it holds your teacher key.</p>
      <h3>New assignment</h3>
      <AssignForm code={code} teacherKey={teacherKey} onAdded={refresh} />
      <div className="row report-head">
        <h3>Class debrief</h3>
        <span className="muted small">{dashboard ? `${dashboard.students.length} students` : ""}</span>
        <button type="button" className="btn btn--small" onClick={refresh} disabled={loading} data-testid="refresh-dashboard">
          {loading ? <Spinner /> : "Refresh"}
        </button>
      </div>
      {dashboard && dashboard.assignments.length === 0 ? <p className="muted">No assignments yet.</p> : null}
      <ul className="reports">
        {dashboard?.assignments.map((summary) => (
          <AssignmentReport key={summary.assignment.id} summary={summary} students={dashboard.students.length} onRemove={() => void remove(summary.assignment.id)} />
        ))}
      </ul>
      <button type="button" className="link-btn small" onClick={() => window.confirm("Forget this class on this browser? You'll lose the teacher key.") && leaveClass("teacher")}>
        Forget this class
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
        <h1>Class</h1>
        <p className="muted">Practise together: teachers assign expeditions, students share how they went. Conversations always stay private.</p>
      </header>
      <div className="classroom__grid">
        {classroom.student ? <StudentClass code={classroom.student.code} className={classroom.student.className} /> : <JoinClass />}
        {classroom.teacher ? <TeacherClass code={classroom.teacher.code} teacherKey={classroom.teacher.teacherKey} className={classroom.teacher.className} /> : <CreateClass />}
      </div>
    </div>
  );
}
