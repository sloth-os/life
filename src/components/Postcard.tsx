import { useEffect, useState } from "react";
import type { LensId } from "../../shared/world.ts";
import { api } from "../lib/api.ts";
import { loadPostcard, savePostcard } from "../lib/postcards.ts";
import { message, toast } from "../state/actions.ts";
import { useGame } from "../state/store.ts";
import { Spinner, formatElapsed, useElapsed } from "./ui.tsx";

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
      toast("error", "The postcard couldn't be painted", message(error));
    } finally {
      setPaintingSince(null);
    }
  };

  if (url) {
    return (
      <figure className={`postcard${compact ? " postcard--compact" : ""}`}>
        <img src={url} alt={`A painted postcard of ${label}`} data-testid="postcard-img" />
        {compact ? null : <figcaption className="muted small">AI illustration of {[label, country].filter(Boolean).join(", ")} · kept in this browser</figcaption>}
      </figure>
    );
  }
  if (!enabled) return null;
  if (paintingSince !== null) {
    return (
      <p className="postcard-status" role="status">
        <Spinner label={`Painting your postcard… ${formatElapsed(elapsed)}`} />
      </p>
    );
  }
  return (
    <button type="button" className={`btn${compact ? " btn--small" : ""}`} onClick={() => void paint()} data-testid="paint-postcard">
      🖼 {compact ? "Paint postcard" : `Paint a postcard of ${label}`}
    </button>
  );
}
