export type { Email } from "./text.js";
export { signInCodeEmail, type SignInCodeInput } from "./templates/sign-in-code.js";
export {
  weekDigestEmail,
  MAX_NUDGES,
  type WeekDigestInput,
  type DigestNudge,
  type DigestPot,
} from "./templates/week-digest.js";
export {
  recommendationEmail,
  type Recommendation,
  type RecommendationEmailInput,
} from "./templates/recommendation.js";
export { alertEmail, type AlertInput } from "./templates/alert.js";
export {
  waitlistEmail,
  youreInEmail,
  type WaitlistInput,
  type YoureInInput,
} from "./templates/account.js";
export { supabaseSignInTemplate, PIP_URL, MARK_PATH } from "./supabase.js";
