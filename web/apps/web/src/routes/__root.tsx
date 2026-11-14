import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { Toaster } from "@web/ui/components/sonner";

import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { ThemeProvider } from "@/components/theme-provider";

import "../index.css";

export interface RouterAppContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      { title: "Nimbrung" },
      { name: "description", content: "Queue songs to the host’s YouTube Music from your phone" },
    ],
    links: [{ rel: "icon", href: "/favicon.ico" }],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      {/* Follows the OS: dark for dim rooms, light glass for a bright one. */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <AmbientBackdrop />
        <Outlet />
        {/* One quiet bar above the sticky "Add a song" button. */}
        <Toaster
          theme="system"
          position="bottom-center"
          offset={{ bottom: "6rem" }}
          mobileOffset={{ bottom: "6rem" }}
          visibleToasts={1}
          duration={3000}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast:
                "flex w-full items-center gap-2 rounded-2xl border border-[var(--lg-border-color)] bg-[var(--lg-bg-elevated)] px-4 py-3 text-sm text-[var(--lg-ink)] shadow-[var(--lg-shadow-high)] backdrop-blur-xl",
              error: "border-[color-mix(in_oklab,var(--nb-accent)_60%,transparent)]",
              icon: "text-muted-foreground",
              // The action (View, Undo) sits at the right edge, like the system's banners.
              title: "flex-1",
              content: "flex-1",
              actionButton:
                "ml-auto shrink-0 rounded-full px-3 py-1 text-sm font-semibold text-[var(--nb-accent-text)] hover:bg-[rgb(var(--nb-fg)/0.08)]",
            },
          }}
        />
      </ThemeProvider>
    </>
  );
}
