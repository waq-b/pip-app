import { BUCKET_META, displayNameFor, type NotificationItemView } from "@finance-app/shared";
import { Bell as BellIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Skeleton } from "../components/skeleton";
import { SwitchRow } from "../components/switch";
import { ago } from "../lib/connections";
import { grouped, useMarkRead, useNotifications, useSwitch } from "../lib/notifications";
import { DEVICE_WORDS, useNotificationSettings, useThisDevice } from "../lib/push";
import { ICON_STROKE } from "./nav";
import { PipMark } from "./pip-mark";
import { useBreakpoint } from "./use-breakpoint";

/**
 * The bell (DESIGN §10.3): on every signed-in screen, with an unread badge in
 * `solid` — red stays Side Bet's. It opens the last 30 days of what Pip told
 * you. On a phone or tablet that's a panel over a scrim; from 1120 up it's a
 * popover with no scrim, so the board stays visible. Same list, same
 * switches, same order everywhere.
 */
export function Bell() {
  const breakpoint = useBreakpoint();
  const desktop = breakpoint === "desktop";
  const [open, setOpen] = useState(false);
  const notifications = useNotifications();
  const unread = notifications.data?.unread ?? 0;
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    // The popover closes on a click anywhere else; the panel has its scrim.
    const onClick = (event: MouseEvent) => {
      if (desktop && !wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, desktop]);

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={`bg-card text-ink relative grid cursor-pointer place-items-center rounded-full border-0 ${
          desktop ? "ring-acc h-[38px] w-[38px] ring-2" : "h-10 w-10"
        }`}
      >
        <BellIcon size={desktop ? 19 : 20} strokeWidth={ICON_STROKE} aria-hidden />
        {unread > 0 ? (
          <span
            aria-hidden
            className="bg-solid text-solid-ink ring-card absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-extrabold ring-[2.5px] transition-opacity duration-150"
          >
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        desktop ? (
          <div className="bg-card absolute top-[52px] right-0 z-40 w-[382px] rounded-[24px] shadow-[0_0_0_1px_var(--pip-line),0_26px_60px_color-mix(in_srgb,var(--pip-ink)_26%,transparent)]">
            <Panel onClose={() => setOpen(false)} />
          </div>
        ) : (
          <div
            className="bg-ink/30 fixed inset-0 z-40"
            onClick={(event) => event.target === event.currentTarget && setOpen(false)}
          >
            <div className="bg-card absolute top-[92px] right-3.5 left-3.5 mx-auto max-h-[566px] max-w-[460px] overflow-y-auto rounded-[28px]">
              <Panel onClose={() => setOpen(false)} />
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const notifications = useNotifications();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const items = notifications.data?.items ?? [];
  const unread = items.filter((item) => !item.read);

  const openRow = (item: NotificationItemView) => {
    if (!item.read) markRead.mutate([item]);
    onClose();
    void navigate(item.url);
  };

  return (
    <section role="dialog" aria-label="Notifications" className="flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between px-1 pt-1">
        <h2 className="font-heading m-0 text-[21px] font-normal">Notifications</h2>
        {unread.length > 0 ? (
          <button
            type="button"
            onClick={() => markRead.mutate(unread)}
            className="text-solid cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-bold"
          >
            Mark all read
          </button>
        ) : null}
      </header>

      {notifications.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} width="100%" height={58} rounded="rounded-[20px]" />
          ))}
        </div>
      ) : notifications.isError ? (
        <p className="text-ink2 m-0 px-1 text-[13px] font-semibold">
          Couldn't load your notifications.{" "}
          <button
            type="button"
            onClick={() => void notifications.refetch()}
            className="text-solid cursor-pointer border-0 bg-transparent p-0 font-bold"
          >
            Try again
          </button>
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <PipMark size={30} outline className="opacity-50" />
          <p className="m-0 text-[14px] font-bold">Nothing in the last month</p>
          <p className="text-ink2 m-0 text-[12.5px] leading-normal font-medium">
            Which is the normal amount. Pip will be here when something actually happens.
          </p>
        </div>
      ) : (
        grouped(items).map((group) => (
          <div key={group.section} className="flex flex-col gap-1.5">
            <h3 className="text-ink3 m-0 px-1 text-[11px] font-bold tracking-[0.12em] uppercase">
              {group.section}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {group.items.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <Row item={item} onOpen={() => openRow(item)} />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <Foot />
    </section>
  );
}

/** Tokens only (DESIGN §10.1): Side Bet `acc` in its own scope, a quiet connection amber. */
function Row({ item, onOpen }: { item: NotificationItemView; onOpen: () => void }) {
  const sideBet = item.bucket === "Degen" || item.kind === "limit_alert";
  const gap = item.kind === "connection_gap";
  const scope = sideBet ? `pot-${BUCKET_META.Degen.scope} bg-tint` : "";
  const dot = gap
    ? "bg-amber-dot"
    : `bg-acc ${sideBet ? "" : `pot-${BUCKET_META[item.bucket ?? "Base"].scope}`}`;
  const where = item.bucket ? ` · ${displayNameFor(item.bucket)}` : "";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${scope} text-ink flex w-full cursor-pointer items-start gap-2.5 rounded-[20px] border-0 px-3 py-[13px] text-left ${sideBet ? "" : "bg-transparent"}`}
    >
      <span
        aria-label={item.read ? undefined : "Unread"}
        className={`mt-[5px] h-[9px] w-[9px] flex-none rounded-full ${item.read ? "bg-line opacity-0" : dot}`}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] leading-snug font-bold">{item.title}</span>
        {item.body ? (
          <span className="text-ink2 text-[12.5px] leading-snug font-medium">{item.body}</span>
        ) : null}
        <span className="text-ink3 text-[11px] font-semibold">
          {ago(item.at)}
          {where}
        </span>
      </span>
    </button>
  );
}

/** The two masters, mirrored in Setup. Turning push off never clears the list. */
function Foot() {
  const settings = useNotificationSettings();
  const device = useThisDevice();
  const flip = useSwitch();
  if (!settings.data) return null;
  const { push, email } = settings.data.settings;

  return (
    <footer className="border-line flex flex-col gap-2 border-t px-1 pt-3">
      <SwitchRow
        label="Push alerts"
        detail={push ? deviceLine(device.state) : "Off"}
        checked={push}
        onChange={(next) => flip.mutate({ push: next })}
      />
      <SwitchRow
        label="Weekly email"
        detail="Monday morning"
        checked={email}
        onChange={(next) => flip.mutate({ email: next })}
      />
      <p className="text-ink3 m-0 text-[11px] font-medium">
        Per-kind switches and this device are in Setup. Turning push off never clears this list.
      </p>
    </footer>
  );
}

function deviceLine(state: ReturnType<typeof useThisDevice>["state"]): string {
  if (state === "needs_install") return "Add Pip to your Home Screen first";
  return DEVICE_WORDS[state];
}
