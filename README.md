# Common Ground

[![CI](https://github.com/sloth-os/life/actions/workflows/ci.yml/badge.svg)](https://github.com/sloth-os/life/actions/workflows/ci.yml)

> *Explore the real world. Meet its people. Find common ground.*

**Common Ground** is a web game built around AI. You travel anywhere on Earth through **Google Maps**, meet **AI locals grounded in real places**, and earn their trust with real social skills. Each conversation ends with a **mentor debrief** that quotes your own words: what worked, one thing to try, and a rewrite of a line you actually said. As locals come to trust you, they share **insights about the place's nature, culture, history, society and economy**, each linked to its source. Those insights become cards in your field journal, which you review with spaced repetition.

| World map | A conversation | Mentor debrief |
|---|---|---|
| ![World map](docs/images/world.jpg) | ![Encounter](docs/images/encounter.jpg) | ![Debrief](docs/images/debrief.jpg) |

*(Screenshots are from Demo AI + Open map mode. With API keys you get locals played by Claude or any OpenAI-compatible model, Google Maps and Street View.)*

## Why it works

The design is based on research about how people learn conversation skills. In brief (details and citations in [`docs/DESIGN.md`](docs/DESIGN.md)):

- **AI Partner + AI Mentor**: separate agents play the local and coach you (Yang et al., 2024).
- **Feedback is what builds skill.** In a randomized trial, practice alone mostly raised confidence; skill gains needed feedback (CARE, Louie et al., 2025). So every encounter ends in a debrief with **verbatim evidence**, which the server checks.
- **Realistic, principled partners.** Locals follow a written constitution (Roleplay-doh; Rehearsal): their rapport is earned, they disclose more only as trust grows, they have boundaries and their own agenda, and they don't flatter you (social sycophancy research).
- **People, not stereotypes.** Prompts follow a persona charter to counter the exoticizing patterns that LLM-written personas fall into (Marked Personas, ACL 2023).
- **Experiential learning loop.** You reflect first, then get feedback, then a concept card, then a **real-world field mission** (Kolb; deliberate practice). Insights become **spaced-recall** cards.

The **Skill Compass** tracks six skills: 🧭 Curiosity · 👂 Listening · 💛 Empathy · 🙏 Respect · 🔆 Clarity · 🤝 Common Ground.

## Quick start

Requires **Node.js 22.18+**; the server runs TypeScript natively.

```bash
npm install
npm run dev          # http://localhost:8787
```

It runs with **no keys at all**, in Demo AI + Open map mode: scripted locals built from real Wikipedia and Open-Meteo data, drawn on an OpenStreetMap-based map. Add keys to unlock the full experience:

```bash
cp .env.example .env   # then fill in what you have
```

| Variable | What it enables |
|---|---|
| `ANTHROPIC_API_KEY` | **Claude** plays the Game Master, the locals and the mentor (default model `claude-opus-5-5`; override with `CLAUDE_MODEL`) |
| `AI_PROVIDER=openai`, `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY` | Any **OpenAI-compatible** model instead, through the OpenAI SDK: OpenAI, a gateway, vLLM, Ollama… (`OPENAI_API_KEY`, `OPENAI_BASE_URL` and `OPENAI_MODEL` work too). The `AI_*` variables also configure Claude with `AI_PROVIDER=anthropic`. |
| `GOOGLE_MAPS_API_KEY` | **Google Maps** in the browser: the interactive map, Advanced Markers and **Street View** at each local's spot. Enable the *Maps JavaScript API* and restrict the key by HTTP referrer. |
| `GOOGLE_MAPS_MAP_ID` | Your Map ID (defaults to `DEMO_MAP_ID` for testing) |
| `GOOGLE_MAPS_SERVER_KEY` | **Maps Experience agent tools** (MCP, `mapstools.googleapis.com`): grounds the AI in real Google Maps places and live weather, and powers "Go anywhere" search. Enable that API and restrict the key by API, not referrer. |
| `ACCESS_CODE` | Optional passcode for classroom or public deployments |
| `RATE_LIMIT_PER_10MIN`, `TRUST_PROXY` | AI requests per player per 10 minutes (default 120; a shared classroom IP gets 10×). Set `TRUST_PROXY=true` behind a proxy. |
| `APP_USER_AGENT` | Contact string sent to Wikipedia, Nominatim and Open-Meteo, as their usage policies ask. Please set it. |
| `EFFORT_TURN`, `EFFORT_DEBRIEF`, … | Claude effort per task (defaults: `low` for turns and hints, `medium` for the rest) |
| `OPENAI_JSON_MODE` | Structured output to try first with OpenAI-compatible servers: `json_schema` (default), `json_object` or `text`. The game steps down automatically when a server rejects one. |

Production: `npm run build && npm start`.

### Docker

Every push to `main` publishes a multi-arch image (`linux/amd64`, `linux/arm64`) to the GitHub Container Registry:

```bash
docker run -p 8787:8787 \
  -e ANTHROPIC_API_KEY=... -e GOOGLE_MAPS_API_KEY=... -e GOOGLE_MAPS_SERVER_KEY=... \
  ghcr.io/sloth-os/life:latest
```

It takes the same environment variables as above (or `--env-file .env`). For an OpenAI-compatible model, pass `AI_PROVIDER=openai`, `AI_MODEL`, `AI_BASE_URL` and `AI_API_KEY` instead of `ANTHROPIC_API_KEY`. Tags are `latest` and the commit SHA. To build it yourself: `docker build -t common-ground .`

### Modes

| | **Demo AI** (no key) | **Claude** or **OpenAI-compatible** |
|---|---|---|
| **Open map** (no Google key) | Scripted locals; MapLibre + OpenFreeMap; Wikipedia photos of places | AI locals on the open map |
| **Google Maps** | Scripted locals on Google Maps + Street View | The full experience |

Google content and the open map are **never mixed on one screen** (Google Maps Platform terms §3.2.3(e)).

## How it works

```
Browser (React + Maps JS)                Server (Node + Express)                    Services
─────────────────────────                ───────────────────────                    ────────
World map ──► POST /api/expedition ──►   Grounding: Maps agent tools (MCP)  ───►   Google Maps Platform
                                                    Wikipedia, weather        ───►   Wikipedia / Open-Meteo
                                         Game Master (AI) → expedition
Expedition ─► POST /api/npc/persona ─►   Game Master → persona + insights
Encounter ──► POST /api/npc/turn ────►   Partner (AI, streamed over SSE)
              (server-sent events)       Engine: clamp rapport, gate insights,
                                                 enforce turn budget
Debrief ────► POST /api/coach/debrief ►  Mentor (AI) → rubric scores;
                                         engine keeps only verbatim quotes
```

- **The model proposes; the engine decides.** Every AI output goes through structured outputs (JSON schema) and Zod validation. Rapport changes are clamped, insights unlock only above their threshold (one per turn), and the mentor's quotes are checked against the transcript.
- **Streaming**: the NPC's `reply` field is pulled out of the partial JSON stream and sent to the browser as it is written.
- **Prompt caching** (Claude): constitution, then persona, then an append-only transcript, with per-turn state kept in the newest message. Unit tests check that the cached prefix stays stable.
- **Refusal handling** (Claude): `fallbacks: "default"` (server-side fallback beta), and `stop_reason: "refusal"` is handled explicitly.
- **OpenAI-compatible models**: the same prompts over Chat Completions, with every call streamed. Structured output steps down from JSON schema to JSON mode to plain text when a server rejects a mode, and replies are fitted to the schema before validation ([`docs/DESIGN.md`](docs/DESIGN.md) §7.3).
- **Stateless server**: the browser holds the save (`localStorage`), and each request carries what it needs.

Prompts live in [`server/ai/prompts.ts`](server/ai/prompts.ts). The game rules are in [`shared/rules.ts`](shared/rules.ts) and [`server/game/engine.ts`](server/game/engine.ts).

### Google Maps Platform terms

LLM output may draw on Google Maps data only through **Maps Experience agent tools**, and must show the Google Maps source links (Service Specific Terms §10.2.1). The rest of the design follows from that:

- Grounded places and summaries come only from the agent tools and always appear with their Google Maps links.
- Raw tool results stay in server memory for the session (≤ 2 h). Coordinates of Google places in saved games are dropped after 30 days.
- Coordinates from a Google search result are never sent to third parties; Wikipedia is queried with the player's own words instead.
- Voice output keeps the full transcript on screen and shows a notice.

This is engineering diligence, not legal advice. Review the terms for your own deployment.

**Usage per expedition** (approximate): 1 expedition call + 3 persona calls (prefetched) + one call per player message + optional hints + 1 debrief ≈ 15–20 model calls. Google side: 5 `search_places` + 1 `lookup_weather` per expedition, 1 map load per session, and 1 Street View load per encounter.

## Development

```bash
npm run typecheck    # TypeScript (server + client + tests)
npm test             # unit + integration (Vitest)
npm run test:e2e     # browser tests on desktop Chromium (Playwright)

./scripts/start-redroid.sh   # a real Android device: redroid (Android 12 in Docker) + Chromium
npm run test:e2e:mobile      # the same journey on that device, at phone and tablet sizes

npm run test:e2e:real        # real services: Google Maps, live grounding and a real model (costs money)
```

The real suite runs the production build against whatever the environment configures (`AI_*` or `ANTHROPIC_API_KEY`, plus `GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_MAP_ID`). It serves on `http://localhost:8791`, which a referrer-restricted browser Maps key must allow. To check an OpenAI-compatible model before a whole run, `node scripts/probe-ai.ts` asks it for a tiny JSON reply in each structured-output mode and reports what its server accepts.

The mobile tests drive Chromium on a real Android system rather than desktop emulation, so touch, viewport and layout behave as on a phone. They need Docker and the `binder_linux` kernel module; the script installs the module if it's missing and reuses a running device.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the build and typecheck, unit and integration tests, and the browser tests in two jobs: desktop Chromium, and a real Android device (redroid) at phone and tablet sizes. When they all pass, it builds the multi-arch Docker image; it publishes the image only for pushes to `main`. On pushes to `main` and manual runs (never pull requests), it also runs the **real-services suite** with the organization's `GOOGLE_MAPS_API_KEY` and `VISION_MODEL_*` settings mapped onto `AI_*`. It records no traces, because they would capture the browser Maps key.

The tests run without network or keys:
- **Claude**: the real Anthropic SDK with a fake `fetch` serving streamed responses. Checks the request shape (model, effort, structured output schema, caching, fallback beta) and the handling of refusals, truncation, schema violations and rate limits.
- **OpenAI-compatible**: the real OpenAI SDK with a fake `fetch`. Covers strict JSON-schema requests, streaming, stepping down to JSON mode when a server rejects schemas, `<think>` blocks and code fences, coercing loose enum values, a repair round for non-JSON replies, and error mapping.
- **Maps agent tools**: our MCP client against a local MCP server with the same tool names and argument shapes.
- **API**: the full HTTP flow through the real engine with Demo AI, including SSE streaming, access codes and rate limiting.
- **E2E**: onboarding → travel → conversation (including a stereotyping line flagged as `⚠ assumption`) → coach → reflection → debrief → journal review. Runs on desktop Chromium, and on Chromium on a real Android device at phone (390×844) and tablet (768×1024) sizes, with layout checks for each.

```
shared/        game vocabulary + rules + API schemas (used by both sides)
server/
  ai/          Claude and OpenAI-compatible engines, Demo engine, prompts, output schemas, streaming JSON
  game/        engine: orchestration + authoritative rules
  grounding/   Maps agent tools (MCP), Wikipedia, Open-Meteo, Nominatim
src/           React client: screens, map adapters (Google / MapLibre), state
tests/         unit + integration (Vitest), e2e (Playwright)
docs/          DESIGN.md: research, learning design, AI design, compliance
```

## Status and known limits

- **Verified live**: the real-services suite plays full expeditions with Google Maps, Street View, Wikipedia grounding and an OpenAI-compatible thinking model (`qwen3.8-max`).
- **Claude is not yet verified live.** It is tested against the SDK's request and streaming contract with simulated responses. Prompt quality still needs a **live evaluation pass** with a real key (plan in `docs/DESIGN.md` §7.5).
- **Thinking models make arrival slow.** With `qwen3.8-max`:
  - an expedition took 3.9–4.3 minutes
  - each local's persona took 2.3–4.6 minutes
  - the debrief took 1.3–2.2 minutes
  - chat replies took 7–20 s

  Prefer a fast or non-thinking model for now. The measurements and the improvement plan are in `docs/DESIGN.md` §7.4.
- **Proxies must allow long responses.** `/api/expedition`, `/api/npc/persona` and `/api/coach/debrief` answer only when the model finishes, so a reverse proxy in front of the server must allow responses of several minutes. nginx's default `proxy_read_timeout` is 60 s.
- **Macron letters render wrongly.** The display font (Fraunces, from Google Fonts) draws ā ē ī ō ū with the macron shifted right, so "Māori" can read as "Maōri" in titles and scene text. Other accents and Vietnamese marks render correctly. This isn't fixed yet.
- **Maps agent tools have no live run yet.** Google documents their inputs but not all output fields. The parser accepts several shapes and logs the result keys on first use; check the logs once with your key.
- Demo AI is deliberately simple and labelled as such. It's for trying the game, for classrooms without API budgets, and for tests.

## Safety and privacy

Locals are fictional and played by AI, with content suitable for ages 13 and up. Disrespect has realistic consequences: the local walks away, and the mentor addresses it without shaming. Progress stays in the browser and the server keeps no player data. The game is framed as rehearsal for real conversations, and field missions push practice into the real world.
