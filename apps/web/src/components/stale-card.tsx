/**
 * The red rung of the staleness ladder (DESIGN.md §5): the feed is gone, not
 * late. Says so once, reassures that holdings haven't changed, and offers a
 * retry. It names the price feed's effect, never a broker — prices don't come
 * from trading APIs (DESIGN.md §6.1).
 */
export function StaleCard({
  heading,
  body,
  onRetry,
}: {
  heading: string;
  body: string;
  onRetry: () => void;
}) {
  return (
    <section
      role="alert"
      className="pot-bet bg-tint border-acc text-aink rounded-[22px] border-2 px-[18px] py-4"
    >
      <h2 className="font-heading m-0 text-[17px] leading-tight font-normal">{heading}</h2>
      <p className="m-0 mt-1.5 text-[12.5px] leading-normal font-medium">{body}</p>
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
