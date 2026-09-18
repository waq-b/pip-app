import { DEVICE_WORDS, useThisDevice } from "../lib/push";
import { InstallSteps } from "./notifications-ask";

/**
 * This device's push state (DESIGN §10.4, phase-6.md decision 5). A button
 * only where the browser can actually ask; on an iPhone or iPad in a Safari
 * tab, the Add to Home Screen sentence instead. A dropped subscription shows
 * "Notifications stopped on this device" with the button again — that's the
 * re-ask; the first-login sheet never comes back.
 */

export function ThisDeviceRow() {
  const { state, turnOn, turningOn } = useThisDevice();
  const canAsk = state === "off" || state === "stopped";

  return (
    <div aria-label="This device" role="group" className="flex flex-col gap-2 py-4">
      <div className="text-[14.5px] font-semibold">This device</div>
      <div className="text-ink2 text-xs leading-normal font-medium">
        {state === "needs_install" ? <InstallSteps /> : DEVICE_WORDS[state]}
      </div>
      {canAsk ? (
        <button
          type="button"
          onClick={turnOn}
          disabled={turningOn}
          className="bg-solid text-solid-ink cursor-pointer self-start rounded-full border-0 px-4 py-2.5 text-[13px] font-bold disabled:cursor-default disabled:opacity-45"
        >
          Turn on for this device
        </button>
      ) : null}
    </div>
  );
}
