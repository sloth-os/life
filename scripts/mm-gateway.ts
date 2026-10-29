// Start or stop mm-gateway (github.com/sloth-os/mm-gateway) for postcard images, configured from
// IMAGE_MODEL_TYPE / IMAGE_MODEL_BASE_URL / IMAGE_MODEL / IMAGE_MODEL_API_KEY, the way the
// sibling project rideo runs it for its real-model suite.
//   node scripts/mm-gateway.ts start   # prints MM_GATEWAY_URL and MM_GATEWAY_API_KEY (appends them to $GITHUB_ENV in CI)
//   node scripts/mm-gateway.ts stop    # saves its log without keys, removes the container
// The provider key reaches the container as an environment variable, never on a command line or in a file.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const IMAGE = process.env.MM_GATEWAY_IMAGE?.trim() || "ghcr.io/sloth-os/mm-gateway:sha-98b05a9";
const NAME = "life-mm-gateway";
const PORT = Number(process.env.MM_GATEWAY_PORT ?? 8792);
const KEY_ENV = "LIFE_GATEWAY_KEY";
const TAG = "life";
const DIR = join(process.env.RUNNER_TEMP ?? tmpdir(), "life-mm-gateway");
const LOG = process.env.MM_GATEWAY_LOG ?? "test-results/real/mm-gateway.log";

const docker = async (args: string[], env: NodeJS.ProcessEnv = process.env) => (await run("docker", args, { env, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The log without the keys (the gateway may print a credential's first and last four characters). */
export function redact(text: string, keys: (string | undefined)[]): string {
  let out = text;
  for (const key of keys) {
    if (!key || key.length < 8) continue;
    out = out.split(key).join("***").split(`${key.slice(0, 4)}...${key.slice(-4)}`).join("***");
  }
  return out;
}

async function start(): Promise<void> {
  const type = required("IMAGE_MODEL_TYPE");
  const baseUrl = required("IMAGE_MODEL_BASE_URL").replace(/\/+$/, "");
  const model = required("IMAGE_MODEL");
  const providerKey = required("IMAGE_MODEL_API_KEY");
  const gatewayKey = `life-${randomBytes(18).toString("hex")}`;
  const ref = (name: string) => `\${${name}}`;
  const config = {
    server: { host: "0.0.0.0", port: 8000, log_level: "INFO", log_format: "json" },
    backends: [{ name: "life-image", type, base_url: baseUrl, api_key: ref("IMAGE_MODEL_API_KEY"), tags: [TAG], extra: { image_model: model } }],
    keys: [{ id: "life", key: ref(KEY_ENV), allow_tags: [TAG] }],
  };
  await mkdir(DIR, { recursive: true });
  const file = join(DIR, "config.yaml");
  // JSON is YAML. The container's user reads it, so it is world-readable; it holds no key.
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
  console.log(`pulling ${IMAGE}`);
  await docker(["pull", "--quiet", IMAGE]);
  await docker(["rm", "--force", NAME]).catch(() => "");
  await docker(
    ["run", "--detach", "--name", NAME, "--publish", `127.0.0.1:${PORT}:8000`, "--volume", `${file}:/etc/mm-gateway/config.yaml:ro`, "--env", "MM_GATEWAY_CONFIG=/etc/mm-gateway/config.yaml", "--env", "IMAGE_MODEL_API_KEY", "--env", KEY_ENV, IMAGE],
    { ...process.env, IMAGE_MODEL_API_KEY: providerKey, [KEY_ENV]: gatewayKey },
  );
  const url = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    const health = await fetch(`${url}/health`).catch(() => null);
    if (health?.ok) break;
    const running = await docker(["inspect", "--format", "{{.State.Running}}", NAME]).catch(() => "false");
    if (running !== "true" || Date.now() > deadline) {
      await stop();
      throw new Error(`mm-gateway did not start (its log: ${LOG})`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`mm-gateway ${IMAGE} on ${url}, image model ${model}`);
  if (process.env.GITHUB_ENV) {
    console.log(`::add-mask::${gatewayKey}`);
    await appendFile(process.env.GITHUB_ENV, `MM_GATEWAY_URL=${url}\nMM_GATEWAY_API_KEY=${gatewayKey}\n`);
  } else {
    console.log(`MM_GATEWAY_URL=${url}\nMM_GATEWAY_API_KEY=${gatewayKey}`);
  }
}

async function stop(): Promise<void> {
  const logs = await run("docker", ["logs", NAME], { maxBuffer: 64 * 1024 * 1024 }).catch((error: { stdout?: string; stderr?: string }) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
  const text = redact(`${logs.stdout}${logs.stderr}`, [process.env.IMAGE_MODEL_API_KEY, process.env.MM_GATEWAY_API_KEY]);
  await mkdir(join(LOG, ".."), { recursive: true }).catch(() => undefined);
  await writeFile(LOG, text).catch(() => undefined);
  await docker(["rm", "--force", NAME]).catch(() => "");
  console.log(`mm-gateway stopped; log in ${LOG}`);
}

const command = process.argv[2];
if (command === "start") await start();
else if (command === "stop") await stop();
else {
  console.error("usage: node scripts/mm-gateway.ts start|stop");
  process.exit(2);
}
