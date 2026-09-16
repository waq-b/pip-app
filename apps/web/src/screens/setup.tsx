import { displayNameFor, type Connection, type ProviderId } from "@finance-app/shared";
import { Plus, ShieldCheck } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Skeleton } from "../components/skeleton";
import {
  PROVIDERS,
  ago,
  maskKey,
  providerInfo,
  splitMessage,
  useConnect,
  useConnections,
  useDisconnect,
} from "../lib/connections";
import { setHideNumbers, useHideNumbers } from "../lib/hide-numbers";
import { useAppearance } from "../lib/use-appearance";
import { ICON_STROKE } from "../shell/nav";
import { pointerWords } from "../shell/pointer-words";
import { useBreakpoint } from "../shell/use-breakpoint";

/**
 * Where Pip reads your numbers from, and how this device shows them
 * (DESIGN.md §7–8). Connecting only ever accepts a key that can look: the API
 * refuses anything that can trade or withdraw, and this screen explains why
 * rather than offering a way round it (CLAUDE.md s13). "Nudge me" is left out
 * until notifications exist (Phase 7); currency is fixed to pounds.
 */
export function SetupScreen() {
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === "desktop";
  const words = pointerWords(breakpoint);

  return (
    <div className={isDesktop ? "max-w-[700px]" : "px-5 pt-1 pb-6"}>
      <header className="pt-1 pb-4">
        <h1
          className={`font-heading m-0 font-normal tracking-[-0.02em] ${isDesktop ? "text-[32px]" : "text-[29px]"}`}
        >
          Setup
        </h1>
        <p className="text-ink2 m-0 mt-1.5 text-[13.5px] leading-normal">
          Where Pip reads your numbers from.
        </p>
      </header>

      <div
        className={isDesktop ? "grid grid-cols-2 items-start gap-3.5" : "flex flex-col gap-[11px]"}
      >
        <Connections />
        <Preferences device={words.device} verb={words.verb} />
      </div>

      <p
        className={`text-ink3 leading-normal font-medium ${isDesktop ? "mt-4 text-xs" : "mx-2 mt-[18px] text-center text-[11.5px]"}`}
      >
        Pip uses read-only keys. Even if someone took {words.carried}, they couldn't trade.
      </p>
    </div>
  );
}

function Connections() {
  const connections = useConnections();
  const [open, setOpen] = useState<ProviderId | null>(null);
  const [choosing, setChoosing] = useState(false);

  if (connections.isPending) return <ConnectionsLoading />;
  if (connections.isError) return <ConnectionsError onRetry={() => void connections.refetch()} />;

  const list = connections.data;
  const byProvider = (id: ProviderId) => list.find((connection) => connection.provider === id);
  const unconnected = PROVIDERS.filter((provider) => byProvider(provider.id)?.status !== "live");
  const known = list.filter(isKnown);
  const nothingConnected = known.length === 0;

  const pick = (id: ProviderId) => {
    setOpen(id);
    setChoosing(false);
  };

  return (
    <section aria-label="Connections" className="flex flex-col gap-[11px]">
      {nothingConnected && !open ? (
        <NothingPluggedIn onPick={pick} />
      ) : (
        <>
          {known.length > 0 ? (
            <ul className="bg-card m-0 list-none rounded-[26px] px-[18px] py-1">
              {known.map((connection) => (
                <li key={connection.provider} className="border-line border-b last:border-b-0">
                  <ConnectionRow
                    connection={connection}
                    expanded={open === connection.provider}
                    onToggle={() =>
                      setOpen((current) =>
                        current === connection.provider ? null : connection.provider,
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          ) : null}

          {unconnected.length > 0 ? (
            choosing ? (
              <ProviderChooser
                providers={unconnected.map((provider) => provider.id)}
                onPick={pick}
              />
            ) : (
              <button
                type="button"
                onClick={() =>
                  unconnected.length === 1 ? pick(unconnected[0]!.id) : setChoosing(true)
                }
                className="border-line text-ink flex cursor-pointer items-center gap-2 rounded-full border-[1.5px] bg-transparent px-[18px] py-3 text-sm font-bold"
              >
                <Plus size={18} strokeWidth={ICON_STROKE} aria-hidden />
                Connect another account
              </button>
            )
          ) : null}
        </>
      )}

      {open ? (
        byProvider(open)?.status === "live" ? (
          <ConnectedCard connection={byProvider(open)!} />
        ) : (
          <ConnectCard key={open} provider={open} status={byProvider(open)?.status} />
        )
      ) : null}
    </section>
  );
}

/** A provider row only exists once someone has connected it at some point. */
function isKnown(connection: Connection): boolean {
  return connection.status !== "not_connected";
}

function ConnectionRow({
  connection,
  expanded,
  onToggle,
}: {
  connection: Connection;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { name, initial } = providerInfo(connection.provider);

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="text-ink flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent py-[15px] text-left"
    >
      <Swatch provider={connection.provider} initial={initial} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-semibold">{name}</span>
        <span className="text-ink2 block text-xs font-medium">{rowLine(connection)}</span>
      </span>
      <StatusBadge status={connection.status} />
    </button>
  );
}

function rowLine(connection: Connection): string {
  const feeds = connection.feeds.map(displayNameFor).join(" + ");
  switch (connection.status) {
    case "live":
      return connection.lastReadAt ? `${feeds} · synced ${ago(connection.lastReadAt)}` : feeds;
    case "expired":
      return "Nothing here — its key expired";
    case "error":
      return "Couldn't read it last time";
    default:
      return "Not connected";
  }
}

function StatusBadge({ status }: { status: Connection["status"] }) {
  if (status === "live") return <Badge scope="pot-fnd">Live</Badge>;
  if (status === "expired") return <Badge scope="pot-bet">Expired</Badge>;
  if (status === "error") return <Badge scope="pot-bet">Error</Badge>;
  return null;
}

function Badge({ scope, children }: { scope: string; children: string }) {
  return (
    <span className={`${scope} bg-tint text-aink rounded-full px-2.5 py-1 text-[11px] font-bold`}>
      {children}
    </span>
  );
}

const SWATCH: Record<ProviderId, string> = {
  trading212: "bg-swatch-trading212",
  kraken: "bg-swatch-kraken",
};

function Swatch({ provider, initial }: { provider: ProviderId; initial: string }) {
  return (
    <span
      aria-hidden
      className={`${SWATCH[provider]} font-heading grid h-[38px] w-[38px] flex-none place-items-center rounded-[13px] text-base text-white`}
    >
      {initial}
    </span>
  );
}

function CardHeader({
  provider,
  line,
  badge,
}: {
  provider: ProviderId;
  line: string;
  badge?: string;
}) {
  const { name, initial } = providerInfo(provider);
  return (
    <div className="mb-3.5 flex items-center gap-[11px]">
      <Swatch provider={provider} initial={initial} />
      <div className="flex-1">
        <h2 className="m-0 text-[15px] font-bold">{name}</h2>
        <div className="text-ink2 text-[11.5px] font-semibold">{line}</div>
      </div>
      {badge ? <Badge scope="pot-fnd">{badge}</Badge> : null}
    </div>
  );
}

function NothingPluggedIn({ onPick }: { onPick: (id: ProviderId) => void }) {
  return (
    <section className="bg-card rounded-[24px] px-5 py-[22px]">
      <h2 className="font-heading m-0 text-[21px] font-normal">Nothing plugged in yet</h2>
      <p className="text-ink2 m-0 mt-1.5 mb-3.5 text-[13px] leading-normal font-medium">
        Pip needs read-only access to see your numbers. Pick whichever you already use — you can add
        the others whenever.
      </p>
      <ProviderButtons providers={PROVIDERS.map((provider) => provider.id)} onPick={onPick} />
    </section>
  );
}

function ProviderChooser({
  providers,
  onPick,
}: {
  providers: ProviderId[];
  onPick: (id: ProviderId) => void;
}) {
  return (
    <section aria-label="Choose an account" className="bg-card rounded-[24px] px-[18px] py-4">
      <ProviderButtons providers={providers} onPick={onPick} />
    </section>
  );
}

function ProviderButtons({
  providers,
  onPick,
}: {
  providers: ProviderId[];
  onPick: (id: ProviderId) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {providers.map((id) => {
        const { name, initial } = providerInfo(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className="bg-sunk text-ink flex cursor-pointer items-center gap-2.5 rounded-full border-0 px-3 py-2 text-left text-sm font-bold"
          >
            <span
              aria-hidden
              className={`${SWATCH[id]} grid h-[26px] w-[26px] place-items-center rounded-[9px] text-xs text-white`}
            >
              {initial}
            </span>
            {name}
          </button>
        );
      })}
    </div>
  );
}

function ConnectedCard({ connection }: { connection: Connection }) {
  const disconnect = useDisconnect(connection.provider);
  const rows: [string, string][] = [["Feeding", connection.feeds.map(displayNameFor).join(" · ")]];
  if (connection.holdingsSeen !== undefined)
    rows.push(["Holdings seen", String(connection.holdingsSeen)]);
  if (connection.lastReadAt) rows.push(["Last read", ago(connection.lastReadAt)]);

  return (
    <section className="bg-card rounded-[24px] px-[18px] py-5">
      <CardHeader provider={connection.provider} line="Read-only" badge="Live" />
      <dl className="m-0 flex flex-col gap-2 text-[13px]">
        {rows.map(([term, value]) => (
          <div key={term} className="flex justify-between gap-3">
            <dt className="text-ink2 font-medium">{term}</dt>
            <dd className="m-0 text-right font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="bg-sunk text-ink2 mt-4 flex items-center gap-[7px] rounded-2xl px-[13px] py-[11px] text-[11.5px] leading-snug font-semibold">
        <ShieldCheck size={15} strokeWidth={ICON_STROKE} className="flex-none" aria-hidden />
        This key cannot place orders. Pip checked.
      </div>
      {disconnect.isError ? (
        <p role="alert" className="text-ink2 m-0 mt-3 text-[12.5px] font-medium">
          Couldn't disconnect just now. Nothing was changed.
        </p>
      ) : null}
      <button
        type="button"
        disabled={disconnect.isPending}
        onClick={() => disconnect.mutate()}
        className="text-solid cursor-pointer border-0 bg-transparent px-0 pt-[13px] text-left text-[13.5px] font-bold disabled:opacity-60"
      >
        {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
      </button>
    </section>
  );
}

/**
 * The connect flow. The pasted key lives in this component only until it's
 * sent; afterwards only a masked copy is kept for showing back. Every refusal
 * says nothing was connected or stored.
 */
function ConnectCard({
  provider,
  status,
}: {
  provider: ProviderId;
  status?: Connection["status"];
}) {
  const { name, steps } = providerInfo(provider);
  const inputId = useId();
  const connect = useConnect(provider);
  const [key, setKey] = useState("");
  const [masked, setMasked] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setMasked(maskKey(key));
    connect.mutate(key);
    setKey("");
  };

  const startOver = () => {
    connect.reset();
    setMasked("");
  };

  const result = connect.data;

  if (connect.isError) {
    return (
      <section className="bg-card rounded-[24px] px-[18px] py-5">
        <CardHeader provider={provider} line="Couldn't connect" />
        <Refusal
          heading="Couldn't reach Pip just now"
          body="Nothing is connected, and nothing was changed."
        />
        <PrimaryButton onClick={startOver}>Try that again</PrimaryButton>
      </section>
    );
  }

  if (result?.outcome === "invalid_key") {
    const { heading, body } = splitMessage(result.message);
    return (
      <section className="bg-card rounded-[24px] px-[18px] py-5">
        <CardHeader provider={provider} line="Couldn't connect" />
        <KeyLabel />
        <div className="pot-bet bg-sunk border-acc text-ink rounded-2xl border-2 px-3.5 py-3 font-mono text-[13px] break-all">
          {masked}
        </div>
        <div className="mt-[11px]">
          <Refusal heading={heading} body={body} />
        </div>
        <PrimaryButton onClick={startOver}>Try that again</PrimaryButton>
      </section>
    );
  }

  if (result?.outcome === "too_much_access") {
    const { heading, body } = splitMessage(result.message);
    return (
      <section className="bg-card rounded-[24px] px-[18px] py-5">
        <CardHeader provider={provider} line="Refused on purpose" />
        <Refusal heading={heading} body={body} bordered />
        <ul className="m-0 mt-3.5 flex list-none flex-col gap-[9px] p-0 text-[12.5px] font-semibold">
          {(result.permissions ?? []).map((permission) => (
            <li
              key={permission.name}
              className={`flex items-center gap-[9px] ${permission.required ? "pot-fnd" : "pot-bet"}`}
            >
              <span
                aria-hidden
                className={`grid h-[17px] w-[17px] flex-none place-items-center rounded-full text-[11px] font-extrabold ${
                  permission.required ? "bg-tint text-aink" : "bg-solid text-solid-ink"
                }`}
              >
                {permission.required ? "✓" : "✕"}
              </span>
              <span>
                {permission.name} —{" "}
                <span className="text-ink2 font-medium">
                  {permission.required ? "needed" : "must be off"}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <PrimaryButton onClick={startOver}>Make a read-only key</PrimaryButton>
      </section>
    );
  }

  return (
    <section className="bg-card rounded-[24px] px-[18px] py-5">
      <CardHeader
        provider={provider}
        line={
          connect.isPending
            ? "Checking your keys…"
            : status === "expired"
              ? "Its key expired"
              : "Not connected"
        }
      />
      <ol className="text-ink2 m-0 mb-3.5 flex list-none flex-col gap-1.5 p-0 text-[12.5px] leading-snug font-medium">
        <Step n={1}>{steps}</Step>
        <Step n={2}>
          Generate a key with <strong className="text-ink">read-only</strong> ticked, nothing else
        </Step>
        <Step n={3}>Paste it below</Step>
      </ol>
      <form onSubmit={submit}>
        <KeyLabel htmlFor={inputId} />
        <input
          id={inputId}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="Paste your key here"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={connect.isPending}
          className="bg-sunk border-line text-ink placeholder:text-ink3 w-full rounded-2xl border-[1.5px] px-3.5 py-3 font-mono text-[13px]"
        />
        <button
          type="submit"
          disabled={connect.isPending || !key.trim()}
          className="bg-solid text-solid-ink mt-3 w-full cursor-pointer rounded-full border-0 px-[18px] py-[13px] text-left text-sm font-bold disabled:cursor-default disabled:opacity-60"
        >
          {connect.isPending ? "Checking your keys…" : `Connect ${name}`}
        </button>
      </form>
      <p className="text-ink3 m-0 mt-[11px] text-[11.5px] leading-normal font-medium">
        Your key is stored encrypted and only ever used to read balances.
      </p>
    </section>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-2">
      <strong className="text-ink">{n}</strong>
      <span>{children}</span>
    </li>
  );
}

function KeyLabel({ htmlFor }: { htmlFor?: string }) {
  const className = "text-ink2 mb-1.5 block text-[11px] font-bold tracking-[0.06em] uppercase";
  return htmlFor ? (
    <label htmlFor={htmlFor} className={className}>
      API key
    </label>
  ) : (
    <div className={className}>API key</div>
  );
}

function Refusal({
  heading,
  body,
  bordered = false,
}: {
  heading: string;
  body: string;
  bordered?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`pot-bet bg-tint text-aink rounded-[18px] p-3.5 ${bordered ? "border-acc border-2" : ""}`}
    >
      <h3 className="font-heading m-0 text-[17px] leading-tight font-normal">{heading}</h3>
      {body ? <p className="m-0 mt-1.5 text-[12.5px] leading-normal font-medium">{body}</p> : null}
    </div>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-solid text-solid-ink mt-3 w-full cursor-pointer rounded-full border-0 px-[18px] py-[13px] text-left text-sm font-bold"
    >
      {children}
    </button>
  );
}

function Preferences({ device, verb }: { device: string; verb: string }) {
  const [appearance, setAppearance] = useAppearance();
  const hidden = useHideNumbers();

  return (
    <section aria-label="Preferences" className="bg-card rounded-[26px] px-[18px] py-1">
      <Row
        title="Appearance"
        detail={
          appearance === "system" ? (
            `Follows ${device}`
          ) : (
            <button
              type="button"
              onClick={() => setAppearance("system")}
              className="text-solid cursor-pointer border-0 bg-transparent p-0 text-left font-bold"
            >
              Follow {device} instead
            </button>
          )
        }
      >
        <div
          role="group"
          aria-label="Appearance"
          className="bg-sunk flex gap-1 rounded-full p-[3px]"
        >
          {(["light", "dark"] as const).map((choice) => {
            const on = appearance === choice;
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={on}
                onClick={() => setAppearance(choice)}
                className={`cursor-pointer rounded-full border-0 px-[13px] py-[7px] text-xs font-bold ${
                  on ? "bg-solid text-solid-ink" : "text-ink2 bg-transparent"
                }`}
              >
                {choice === "light" ? "Light" : "Dark"}
              </button>
            );
          })}
        </div>
      </Row>

      <Row title="Hide the numbers" detail={`Blur totals until you ${verb}`}>
        <button
          type="button"
          role="switch"
          aria-checked={hidden}
          aria-label="Hide the numbers"
          onClick={() => setHideNumbers(!hidden)}
          className={`relative h-[27px] w-[46px] flex-none cursor-pointer rounded-full border-0 ${hidden ? "pot-fnd bg-acc" : "bg-sunk"}`}
        >
          <span
            aria-hidden
            className={`absolute top-[3px] h-[21px] w-[21px] rounded-full ${hidden ? "bg-card right-[3px]" : "bg-ink3 left-[3px]"}`}
          />
        </button>
      </Row>

      <Row title="Currency" detail="Pounds sterling" last>
        <span className="text-ink2 text-sm font-bold">£ GBP</span>
      </Row>
    </section>
  );
}

function Row({
  title,
  detail,
  last = false,
  children,
}: {
  title: string;
  detail: ReactNode;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex items-center gap-[13px] py-4 ${last ? "" : "border-line border-b"}`}>
      <div className="flex-1">
        <div className="text-[14.5px] font-semibold">{title}</div>
        <div className="text-ink2 mt-0.5 text-xs font-medium">{detail}</div>
      </div>
      {children}
    </div>
  );
}

function ConnectionsLoading() {
  return (
    <div aria-busy="true" className="bg-card flex flex-col gap-4 rounded-[26px] px-[18px] py-4">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton width={38} height={38} rounded="rounded-[13px]" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton width="45%" height={12} />
            <Skeleton width="70%" height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConnectionsError({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="pot-bet bg-tint border-acc text-aink rounded-[22px] border-2 px-[18px] py-4"
    >
      <h2 className="font-heading m-0 text-[17px] leading-tight font-normal">
        Can't load your connections right now
      </h2>
      <p className="m-0 mt-1.5 text-[12.5px] leading-normal font-medium">
        Your accounts are as you left them — this is only the view of them.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="border-aink text-aink mt-3 cursor-pointer rounded-full border-[1.5px] bg-transparent px-3.5 py-2 text-[12.5px] font-bold"
      >
        Try again
      </button>
    </section>
  );
}
