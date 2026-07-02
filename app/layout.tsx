import type { Metadata } from "next";
import { Suspense } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { TauriProvider } from "@/components/tauri-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "PackRest — client REST",
  description:
    "Client REST guidé pour les APIs Pack Solutions, pensé pour les non-développeurs.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TauriProvider>
            {/* AppShell reads the query string (active-nav highlight); the
                Suspense boundary satisfies static export's useSearchParams rule. */}
            <Suspense>
              <AppShell>{children}</AppShell>
            </Suspense>
          </TauriProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
