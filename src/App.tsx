import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { rankFor } from "../shared/rules.ts";
import type { AppConfig } from "../shared/schemas.ts";
import { Logo, Toasts } from "./components/ui.tsx";
import { MapContext, MapController, createWorldMap, useMap } from "./map/index.ts";
import type { WorldMap } from "./map/types.ts";
import { CompassScreen, SettingsScreen } from "./screens/Compass.tsx";
import { DebriefScreen } from "./screens/Debrief.tsx";
import { EncounterScreen } from "./screens/Encounter.tsx";
import { AccessGate, OnboardingScreen, TitleScreen } from "./screens/Intro.tsx";
import { JournalScreen } from "./screens/Journal.tsx";
import { ClassroomScreen } from "./screens/Classroom.tsx";
import { MediationScreen } from "./screens/Mediation.tsx";
import { ArrivingScreen, ExpeditionScreen, ScoutingOverlay, WorldScreen } from "./screens/World.tsx";
import { currentExpedition, go, loadConfig } from "./state/actions.ts";
import { useGame } from "./state/store.ts";
import type { Screen } from "./state/types.ts";
import { detectLang, rankName, setLang, t, type MessageKey } from "./i18n/index.ts";

export function useDark(theme: "system" | "light" | "dark"): boolean {
  const query = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const [systemDark, setSystemDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [query]);
  return theme === "dark" || (theme === "system" && systemDark);
}

/** The one long-lived map, kept mounted under the world and expedition screens. */
function MapStage({ config, visible, dark }: { config: AppConfig; visible: boolean; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const controller = useMap();
  const [error, setError] = useState<string | null>(null);
  const initialDark = useRef(dark);

  useEffect(() => {
    let disposed = false;
    let map: WorldMap | null = null;
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      // Stop driving a map Google has disabled; the side panel keeps working without it.
      controller.detach();
      setError(t("map.keyRejected"));
    };
    createWorldMap(ref.current!, config, initialDark.current)
      .then((created) => {
        if (disposed) return created.destroy();
        map = created;
        controller.attach(created);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t("map.failed")));
    return () => {
      disposed = true;
      controller.detach();
      map?.destroy();
    };
  }, [config, controller]);

  useEffect(() => controller.run((m) => m.setDark(dark)), [controller, dark]);

  // Keep the map aware of the side panel (left on desktop, bottom sheet on phones).
  // A layout effect runs before the screens' effects, so their first camera move already knows.
  useLayoutEffect(() => {
    if (!visible) return;
    const measure = () => {
      const panel = document.querySelector(".side-panel")?.getBoundingClientRect();
      const stage = ref.current?.getBoundingClientRect();
      if (!panel || !stage) return;
      const bottomSheet = panel.width > stage.width * 0.8;
      controller.run((m) => m.setInsets(bottomSheet ? { left: 0, bottom: Math.max(0, stage.bottom - panel.top) } : { left: Math.max(0, panel.right - stage.left), bottom: 0 }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [controller, visible]);

  return (
    <div className={`map-stage${visible ? "" : " is-hidden"}`} aria-hidden={!visible}>
      <div ref={ref} className="map-canvas" data-testid="map" />
      {error ? (
        <div className="map-error" role="alert">
          <strong>{t("map.unavailable")}</strong> {error}
        </div>
      ) : null}
    </div>
  );
}

const NAV: { screen: Screen; label: MessageKey; icon: string; classroom?: true }[] = [
  { screen: "world", label: "nav.world", icon: "🌍" },
  { screen: "journal", label: "nav.journal", icon: "📔" },
  { screen: "compass", label: "nav.compass", icon: "🧭" },
  { screen: "classroom", label: "nav.classroom", icon: "🎓", classroom: true },
  { screen: "settings", label: "nav.settings", icon: "⚙️" },
];

function TopBar() {
  const game = useGame();
  const rank = rankFor(game.progress.xp);
  const progress = rank.next ? (game.progress.xp - rank.floor) / (rank.next - rank.floor) : 1;
  const active = game.ui.screen === "expedition" || game.ui.screen === "encounter" || game.ui.screen === "mediation" || game.ui.screen === "debrief" ? "world" : game.ui.screen;
  const due = game.journal.insights.filter((j) => j.recall.dueAt <= Date.now()).length;
  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => go(currentExpedition(game) && game.ui.screen !== "expedition" ? "expedition" : "world")}>
        <Logo size={28} />
        <span>Common Ground</span>
      </button>
      <nav aria-label="Main">
        {NAV.filter((item) => !item.classroom || game.ui.config?.features.classroom).map((item) => (
          <button
            key={item.screen}
            type="button"
            className={`nav-btn${active === item.screen ? " is-active" : ""}`}
            aria-label={item.screen === "journal" && due > 0 ? t("nav.journalDue", { label: t(item.label), count: due }) : t(item.label)}
            aria-current={active === item.screen ? "page" : undefined}
            onClick={() => go(item.screen)}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span className="nav-btn__label">{t(item.label)}</span>
            {item.screen === "journal" && due > 0 ? (
              <span className="badge" aria-hidden="true">
                {due}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="rank" title={rank.next ? t("rank.toNext", { xp: game.progress.xp, left: rank.next - game.progress.xp }) : `${game.progress.xp} XP`}>
        <span className="rank__name">{rankName(rank.name)}</span>
        <span className="rank__bar" aria-hidden="true">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
        <span className="rank__xp">{game.progress.xp} XP</span>
      </div>
    </header>
  );
}

export function App() {
  const game = useGame();
  const controller = useMemo(() => new MapController(), []);
  const { config, configError, screen, needsAccessCode } = game.ui;
  const dark = useDark(game.settings.theme);
  // Before any child renders, so every t() call speaks the player's language.
  setLang(game.settings.language ?? detectLang());

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = game.settings.theme === "system" ? "" : game.settings.theme;
    root.style.setProperty("--text-scale", String(game.settings.textScale));
    root.classList.toggle("reduce-motion", game.settings.reducedMotion);
  }, [game.settings.theme, game.settings.textScale, game.settings.reducedMotion]);

  if (!config) {
    return (
      <div className="splash">
        <Logo size={56} />
        {configError ? (
          <>
            <p role="alert">{t("app.serverUnreachable", { error: configError })}</p>
            <button type="button" className="btn btn--primary" onClick={() => void loadConfig()}>
              {t("common.tryAgain")}
            </button>
          </>
        ) : (
          <p>{t("app.loading")}</p>
        )}
      </div>
    );
  }
  if (needsAccessCode) return <AccessGate />;

  const inGame = game.player && screen !== "title" && screen !== "onboarding";
  const mapVisible = screen === "world" || screen === "expedition";
  return (
    <MapContext.Provider value={controller}>
      <div className="app" data-screen={screen}>
        {inGame ? <TopBar /> : null}
        <main className="stage">
          {inGame ? <MapStage config={config} visible={mapVisible} dark={dark} /> : null}
          {screen === "onboarding" ? <OnboardingScreen /> : !inGame ? <TitleScreen /> : null}
          {inGame && screen === "world" ? <WorldScreen /> : null}
          {inGame && screen === "expedition" ? game.ui.busy?.briefing ? <ArrivingScreen /> : <ExpeditionScreen /> : null}
          {inGame && screen === "encounter" ? <EncounterScreen /> : null}
          {inGame && screen === "mediation" ? <MediationScreen /> : null}
          {inGame && screen === "debrief" ? <DebriefScreen /> : null}
          {inGame && screen === "journal" ? <JournalScreen /> : null}
          {inGame && screen === "compass" ? <CompassScreen /> : null}
          {inGame && screen === "classroom" ? <ClassroomScreen /> : null}
          {inGame && screen === "settings" ? <SettingsScreen /> : null}
        </main>
        {game.ui.busy ? <ScoutingOverlay /> : null}
        <Toasts toasts={game.ui.toasts} />
      </div>
    </MapContext.Provider>
  );
}
