import { useEffect, useState } from "react";
import type { LensId } from "../../shared/world.ts";
import { api } from "../lib/api.ts";
import { loadPostcard, savePostcard } from "../lib/postcards.ts";
import { message, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { Spinner, formatElapsed, useElapsed } from "./ui.tsx";
import { t } from "../i18n/index.ts";

export interface PostcardProps {
  expeditionId: string;
  /** The place as the player chose it, and its country. */
  label: string;
  country?: string;
  lenses: LensId[];
  /** A small version for the atlas list. */
  compact?: boolean;
}

/**
 * A souvenir postcard of a place, painted on request by the image model and kept in this
 * browser. It shows only places and themes the player explored.
 */
export function Postcard({ expeditionId, label, country, lenses, compact }: PostcardProps) {
  const enabled = Boolean(useGame().ui.config?.features.postcards);
  const [url, setUrl] = useState<string | null>(null);
  const [paintingSince, setPaintingSince] = useState<number | null>(null);
  const elapsed = useElapsed(paintingSince);

  useEffect(() => {
    let objectUrl: string | null = null;
    let live = true;
    void loadPostcard(expeditionId).then((stored) => {
      if (!live || !stored) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setUrl(objectUrl);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [expeditionId]);

  const paint = async () => {
    setPaintingSince(Date.now());
    try {
      const blob = await api.postcard({ expeditionId, label, country, lenses });
      await savePostcard(expeditionId, blob);
      setUrl(URL.createObjectURL(blob));
    } catch (error) {
      toast("error", t("postcard.failed"), message(error));
    } finally {
      setPaintingSince(null);
    }
  };

  if (url) {
    return (
      <figure className={`postcard${compact ? " postcard--compact" : ""}`}>
        <img src={url} alt={t("postcard.alt", { place: label })} data-testid="postcard-img" />
        {compact ? null : <figcaption className="muted small">{t("postcard.caption", { place: [label, country].filter(Boolean).join(", ") })}</figcaption>}
      </figure>
    );
  }
  if (!enabled) return null;
  if (paintingSince !== null) {
    return (
      <p className="postcard-status" role="status">
        <Spinner label={t("postcard.painting", { time: formatElapsed(elapsed) })} />
      </p>
    );
  }
  return (
    <button type="button" className={`btn${compact ? " btn--small" : ""}`} onClick={() => void paint()} data-testid="paint-postcard">
      🖼 {compact ? t("postcard.paintShort") : t("postcard.paint", { place: label })}
    </button>
  );
}
