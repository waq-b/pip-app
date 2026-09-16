/**
 * Google's "G".
 *
 * The one deliberate exception to the no-hex-in-components rule (DESIGN.md §3):
 * these are Google's brand colours, and their sign-in branding guidelines
 * require the mark to appear in them unaltered. It lives in its own file so the
 * exception is visible and contained.
 */
export function GoogleMark({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="flex-none">
      <path
        fill="#4285F4"
        d="M45 24c0-1.6-.1-2.7-.4-4H24v8h12c-.2 2-1.5 5-4.7 7l6.4 5C41.4 36.2 45 30.8 45 24z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.4-5c-1.9 1.3-4.5 2.2-8.1 2.2-6.1 0-11.2-4-13-9.5l-6.7 5.2C8 41 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .8-4.4l-6.7-5.2C2.8 17.3 2 20.5 2 24s.8 6.7 2.3 9.6l6.7-5.2z"
      />
      <path
        fill="#EA4335"
        d="M24 10.2c3.3 0 6.3 1.2 8.6 3.4l5.7-5.7C34.9 4.6 29.9 2 24 2 15.4 2 8 7 4.3 14.4l6.7 5.2c1.8-5.5 6.9-9.4 13-9.4z"
      />
    </svg>
  );
}
