import type { RouteObject } from "react-router";
import { InstrumentDetailScreen } from "./screens/instrument-detail";
import { NotOnTheListScreen } from "./screens/not-on-the-list";
import { PotDetailScreen } from "./screens/pot-detail";
import { PotsScreen } from "./screens/pots";
import { RulesScreen } from "./screens/rules";
import { SetupScreen } from "./screens/setup";
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
      { index: true, element: <PotsScreen /> },
      { path: "pots/:bucket", element: <PotDetailScreen /> },
      { path: "instruments/:id", element: <InstrumentDetailScreen /> },
      { path: "rules", element: <RulesScreen /> },
      { path: "setup", element: <SetupScreen /> },
    ],
  },
  { path: "/sign-in", element: <SignInScreen /> },
  { path: "/not-on-the-list", element: <NotOnTheListScreen /> },
];
