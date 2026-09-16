import type { RouteObject } from "react-router";
import { Placeholder } from "./screens/placeholder";

/** Every screen the design describes (DESIGN.md §7). */
export const routes: RouteObject[] = [
  { path: "/", element: <Placeholder name="Pots" /> },
  { path: "/pots/:bucket", element: <Placeholder name="Pot" /> },
  { path: "/instruments/:id", element: <Placeholder name="Holding" /> },
  { path: "/rules", element: <Placeholder name="Your rules" /> },
  { path: "/setup", element: <Placeholder name="Setup" /> },
  { path: "/sign-in", element: <Placeholder name="Sign in" /> },
  { path: "/not-on-the-list", element: <Placeholder name="Not on the list" /> },
];
