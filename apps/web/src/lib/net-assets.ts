import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, apiPost, apiPut } from "./api";

/**
 * The one figure Pip has no other way of knowing, and the most sensitive thing
 * it holds (DESIGN §11). It sets Side Bet's limit and nothing else.
 *
 * The ordinary read says only whether it's set and when it was last reviewed:
 * the figure — and the limit, which gives it away ten times over — come back
 * only when the eye is tapped, from a route of their own.
 */

export interface NetAssetsStatus {
  set: boolean;
  starterLimit: boolean;
  reviewedAt?: string;
  /** A year has passed since it was last reviewed. */
  dueReview: boolean;
}

export interface NetAssetsRevealed extends NetAssetsStatus {
  /** Absent when nothing has been set. */
  pounds?: number;
  /** The FCA's 10% guide, or the starter limit. Pence. */
  limit: number;
}

export function useNetAssets(enabled = true) {
  return useQuery({
    queryKey: ["net-assets"],
    queryFn: () => apiGet<NetAssetsStatus>("/net-assets"),
    enabled,
  });
}

/** The eye: asked for outright, never cached, so it can't leak into a screen later. */
export function useRevealNetAssets() {
  return useMutation({
    mutationFn: () => apiPost<NetAssetsRevealed>("/net-assets/reveal", {}),
  });
}

/**
 * Saving changes Side Bet's limit, so every screen is refetched. The API
 * checks the figure; the screen only stops the obvious.
 */
export function useSaveNetAssets() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pounds: number) => apiPut<NetAssetsRevealed>("/net-assets", { pounds }),
    onSuccess: () => client.invalidateQueries(),
  });
}

/** Remembered per device, like the other conveniences: storage can throw. */
const ASKED_KEY = "pip.net-assets.asked";

function alreadyAsked(): boolean {
  try {
    return window.localStorage.getItem(ASKED_KEY) === "yes";
  } catch {
    return false;
  }
}

/**
 * Whether to put the net-assets question in front of someone (DESIGN §11.2):
 * once, at the end of their first look at Pip, and never again on this device.
 * Setup's row is the permanent place, so "I'd rather not say" costs nothing.
 */
export function useAskNetAssets(readyToAsk: boolean) {
  const { data } = useNetAssets(readyToAsk);
  const [dismissed, setDismissed] = useState(alreadyAsked);

  return {
    show: readyToAsk && !dismissed && data?.set === false,
    dismiss: () => {
      try {
        window.localStorage.setItem(ASKED_KEY, "yes");
      } catch {
        // A device that can't remember will ask again; the row on Setup is the real place.
      }
      setDismissed(true);
    },
  };
}
