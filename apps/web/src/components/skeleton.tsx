/**
 * Loading never shows a spinner where a number will be — it shows the number's
 * shape (DESIGN.md §7). A 1.5s pulse, per the design's motion rules.
 */
export function Skeleton({
  width,
  height,
  rounded = "rounded-[10px]",
}: {
  width?: number | string;
  height: number | string;
  rounded?: string;
}) {
  return (
    <div
      aria-hidden
      data-skeleton
      className={`bg-skel animate-pulse [animation-duration:1.5s] ${rounded}`}
      style={{ width: width ?? "100%", height }}
    />
  );
}
