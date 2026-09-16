import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { UnauthenticatedError } from "./lib/api";
import { supabaseAuthClient, type AuthClient } from "./lib/auth-client";
import { useAppearance } from "./lib/use-appearance";
import { routes } from "./routes";
import { AuthProvider } from "./shell/auth-provider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Being signed out isn't a flaky request; retrying it just delays the
      // redirect to sign-in.
      retry: (failureCount, error) => !(error instanceof UnauthenticatedError) && failureCount < 2,
      staleTime: 30_000,
    },
  },
});

const router = createBrowserRouter(routes);

// Built once. Missing configuration is shown plainly rather than as a blank page.
let authClient: AuthClient | Error;
try {
  authClient = supabaseAuthClient();
} catch (error) {
  authClient = error instanceof Error ? error : new Error(String(error));
}

function App() {
  useAppearance();

  if (authClient instanceof Error) {
    return (
      <main className="bg-ground text-ink grid min-h-svh place-items-center px-6 text-center">
        <div>
          <h1 className="font-heading m-0 text-xl font-normal">Pip isn't configured</h1>
          <p className="text-ink2 mt-2 text-sm">{authClient.message}</p>
        </div>
      </main>
    );
  }

  return (
    <AuthProvider client={authClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
