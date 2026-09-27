import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // On every route the saved offset is restored, and where there is none the
    // window is scrolled to the top - both of which run on the router's
    // onRendered, after a page's own effects. The chat has to end up at the
    // newest message, which is the bottom, so it parks its own scroll and the
    // router is told to leave that route alone. Anywhere else, restoring is
    // exactly what a reader wants when they come back to a long list.
    scrollRestoration: ({ location }) => location.pathname !== "/chat",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
