/**
 * What a push carries, read defensively: the service worker shows whatever
 * arrives, so a malformed or hostile payload falls back to plain words and
 * the home screen. Kept apart from `sw.ts` so it can be tested.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** A screen in Pip: `/rules`, `/week`, `/setup`. */
  url: string;
}

/** Only ever a path inside Pip: a push can't send anyone somewhere else. */
export function safePath(url: unknown): string {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

export function parsePush(data: string | null): PushMessage {
  try {
    const message = JSON.parse(data ?? "") as Partial<PushMessage>;
    return {
      title: typeof message.title === "string" && message.title ? message.title : "Pip",
      body: typeof message.body === "string" ? message.body : "",
      url: safePath(message.url),
    };
  } catch {
    return { title: "Pip", body: "", url: "/" };
  }
}
