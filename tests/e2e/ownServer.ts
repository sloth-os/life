// A second copy of the browser-test server, for a test that changes the server's settings: its
// changes then can't reach tests running at the same time against the shared one.
import { spawn } from "node:child_process";

export async function startOwnServer(port: number, env: Record<string, string> = {}): Promise<() => void> {
  const child = spawn(process.execPath, ["tests/e2e/server.ts"], { env: { ...process.env, E2E_PORT: String(port), E2E_HOST: "127.0.0.1", ...env }, stdio: "ignore" });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return () => child.kill();
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`the test server on port ${port} didn't start`);
}
