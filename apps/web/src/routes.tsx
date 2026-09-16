import type { RouteObject } from "react-router";
import { NotOnTheListScreen } from "./screens/not-on-the-list";
import { Placeholder } from "./screens/placeholder";
import { SignInScreen } from "./screens/sign-in";
import { RequireSession } from "./shell/require-session";

/**
 * Every screen the design describes (DESIGN.md §7). The signed-in screens sit
 * inside the shell, behind the session check; sign-in and the refusal screen
 * deliberately don't, because neither has a sidebar or a hero number.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <RequireSession />,
    children: [
      { index: true, element: <Placeholder name="Pots" /> },
      { path: "pots/:bucket", element: <Placeholder name="Pot" /> },
      { path: "instruments/:id", element: <Placeholder name="Holding" /> },
      { path: "rules", element: <Placeholder name="Your rules" /> },
      { path: "setup", element: <Placeholder name="Setup" /> },
    ],
  },
  { path: "/sign-in", element: <SignInScreen /> },
  { path: "/not-on-the-list", element: <NotOnTheListScreen /> },
];
