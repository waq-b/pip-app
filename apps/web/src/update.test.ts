import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Options = {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (url: string, registration: unknown) => void;
  onRegisterError?: (error: unknown) => void;
};
const registerSW = vi.fn();
vi.mock("virtual:pwa-register", () => ({ registerSW: (o: Options) => registerSW(o) }));
const { CHECK_MS, INSTALLING_MAX_MS, SPLASH_MIN_MS, checkForUpdate, launch } =
  await import("./update");

let options: Options;
const updateSW = vi.fn(async () => undefined);
const registration = (
  overrides: Partial<{
    active: object | null;
    waiting: object | null;
    installing: object | null;
    update: () => Promise<void>;
  }> = {},
) => ({ active: {}, waiting: null, installing: null, update: async () => undefined, ...overrides });
const settled = (promise: Promise<void>) => {
  let done = false;
  void promise.then(() => (done = true));
  return () => done;
};

beforeEach(() => {
  vi.useFakeTimers();
  registerSW.mockReset().mockImplementation((o: Options) => {
    options = o;
    return updateSW;
  });
  updateSW.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  document.getElementById("splash")?.remove();
});

describe("checking for an update on launch", () => {
  it("shows the app once the check finds nothing new", async () => {
    const promise = checkForUpdate(true);
    options.onRegisteredSW!("/sw.js", registration());
    await expect(promise).resolves.toBeUndefined();
    expect(updateSW).not.toHaveBeenCalled();
  });

  it("applies a waiting update while the splash is up, and keeps the splash until the reload", async () => {
    const done = settled(checkForUpdate(true));
    options.onRegisteredSW!("/sw.js", registration({ waiting: {} }));
    options.onNeedRefresh!();
    await vi.advanceTimersByTimeAsync(CHECK_MS + 100);
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(done()).toBe(false);
  });

  it("waits for an update that's still installing, then applies it", async () => {
    const done = settled(checkForUpdate(true));
    options.onRegisteredSW!("/sw.js", registration({ installing: {} }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(done()).toBe(false);
    options.onNeedRefresh!();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it("keeps waiting past CHECK_MS while a new version is still downloading", async () => {
    const reg = registration({ update: () => new Promise(() => undefined) });
    const done = settled(checkForUpdate(true));
    options.onRegisteredSW!("/sw.js", reg);
    // The phone found the new build and is still fetching it when CHECK_MS passes.
    reg.installing = {};
    await vi.advanceTimersByTimeAsync(CHECK_MS + 5000);
    expect(done()).toBe(false);

    options.onNeedRefresh!();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it("gives up on a download that never finishes, at INSTALLING_MAX_MS", async () => {
    const reg = registration({ update: () => new Promise(() => undefined) });
    const done = settled(checkForUpdate(true));
    options.onRegisteredSW!("/sw.js", reg);
    reg.installing = {};
    await vi.advanceTimersByTimeAsync(INSTALLING_MAX_MS - 1);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done()).toBe(true);
  });

  it("gives up after CHECK_MS, and an update found later waits for the next launch", async () => {
    const promise = checkForUpdate(true);
    options.onRegisteredSW!("/sw.js", registration({ update: () => new Promise(() => undefined) }));
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await expect(promise).resolves.toBeUndefined();
    options.onNeedRefresh!();
    expect(updateSW).not.toHaveBeenCalled();
  });

  it("doesn't hold the first visit, when there's nothing to update from", async () => {
    const promise = checkForUpdate(true);
    options.onRegisteredSW!("/sw.js", registration({ active: null }));
    await expect(promise).resolves.toBeUndefined();
  });

  it("shows the app if registration fails", async () => {
    const promise = checkForUpdate(true);
    options.onRegisterError!(new Error("blocked"));
    await expect(promise).resolves.toBeUndefined();
  });

  it("does nothing when disabled (dev, no service worker, offline)", async () => {
    await expect(checkForUpdate(false)).resolves.toBeUndefined();
    expect(registerSW).not.toHaveBeenCalled();
  });
});

describe("the launch splash", () => {
  it("stays up for at least SPLASH_MIN_MS, then fades and is removed", async () => {
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.append(splash);

    const done = settled(launch(async () => undefined));
    await vi.advanceTimersByTimeAsync(SPLASH_MIN_MS - 1);
    expect(done()).toBe(false);
    expect(splash).not.toHaveClass("is-leaving");

    await vi.advanceTimersByTimeAsync(1);
    expect(splash).toHaveClass("is-leaving");
    await vi.advanceTimersByTimeAsync(400);
    expect(document.getElementById("splash")).toBeNull();
  });
});
