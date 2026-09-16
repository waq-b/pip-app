import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { UnauthenticatedError } from "./lib/api";
import { useAppearance } from "./lib/use-appearance";
import { routes } from "./routes";

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

function App() {
  useAppearance();

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export default App;
