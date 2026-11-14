import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { toast } from "sonner";

import { isKicked } from "./api/client";
import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";

// Marks artwork that failed to load so glass.css can swap in a music note.
// Error events don't bubble, so listen in the capture phase.
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement) e.target.dataset.broken = "";
  },
  true,
);
document.addEventListener(
  "load",
  (e) => {
    if (e.target instanceof HTMLImageElement) delete e.target.dataset.broken;
  },
  true,
);

const queryClient = new QueryClient({
  // Failed commands surface the server's message here, unless the screen
  // shows it next to what failed (mutations marked meta.inlineError). A
  // guest the host removed gets the removed screen instead, wherever they were.
  mutationCache: new MutationCache({
    onError: (err, _variables, _result, mutation) => {
      if (isKicked(err)) router.navigate({ to: "/removed", replace: true });
      else if (!mutation.meta?.inlineError) toast.error(err.message);
    },
  }),
});

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultPendingComponent: () => <Loader />,
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
