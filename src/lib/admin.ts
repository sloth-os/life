// The settings page's API. The settings key lives in this tab's session storage only: it is gone
// when the tab closes, and never part of the save file.
import type { ProbeResult, ProbeTarget, SettingsSaved, SettingsUpdate, SettingsView } from "../../shared/settings.ts";
import { send } from "./api.ts";

const KEY_STORAGE = "common-ground:settings-key";

export function savedKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function rememberKey(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Private mode: the key lasts as long as the page.
  }
}

const withKey = (key: string) => ({ "X-Admin-Key": key });

export const admin = {
  status: () => send<{ enabled: boolean; keySource: "env" | "generated" | null }>("GET", "/api/admin/status"),
  /** Resolves if the key is right; throws (401, admin_key) if not. */
  check: (key: string) => send<void>("POST", "/api/admin/session", {}, withKey(key)),
  load: (key: string) => send<SettingsView>("GET", "/api/admin/settings", undefined, withKey(key)),
  save: (key: string, update: SettingsUpdate) => send<SettingsSaved>("PUT", "/api/admin/settings", update, withKey(key)),
  test: (key: string, target: ProbeTarget, values: SettingsUpdate["values"]) => send<ProbeResult>("POST", "/api/admin/test", { target, values }, withKey(key)),
  newKey: (key: string) => send<{ key: string }>("POST", "/api/admin/key", {}, withKey(key)),
};
