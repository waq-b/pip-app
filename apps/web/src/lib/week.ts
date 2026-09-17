import type {
  NudgeResponse,
  NudgeResponseResult,
  WeekResponse,
  WeekView,
} from "@finance-app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "./api";

/** This week, today's daily notes and earlier weeks (`GET /week`). */
export function useWeek() {
  return useQuery({ queryKey: ["week"], queryFn: () => apiGet<WeekResponse>("/week") });
}

/** An earlier week, by its Monday. */
export function usePastWeek(weekOf: string | undefined) {
  return useQuery({
    queryKey: ["week", weekOf],
    queryFn: () => apiGet<WeekView>(`/week/${weekOf}`),
    enabled: weekOf !== undefined,
  });
}

/** Marks what you did about a note. Only ever your own; the API checks. */
export function useRespond() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, response }: { id: string; response: NudgeResponse }) =>
      apiPost<NudgeResponseResult>(`/nudges/${id}/response`, { response }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["week"] }),
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-09-14` → "14 Sep". Fixed names, since browsers disagree on "Sep" and "Sept". */
export function shortDay(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[(month ?? 1) - 1]}`;
}

export const RESPONSES: { id: NudgeResponse; label: string }[] = [
  { id: "nothing", label: "Nothing" },
  { id: "acted", label: "Acted" },
  { id: "dismissed", label: "Dismissed" },
];
