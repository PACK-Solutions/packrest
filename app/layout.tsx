import type { Metadata } from "next";
import { listApiSummaries } from "@/lib/specs";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PackRest — client REST",
  description:
    "Client REST guidé pour les APIs Pack Solutions. Postman-like, pensé pour les non-développeurs.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apis = await listApiSummaries();

  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AppShell apis={apis.map((a) => ({ id: a.id, title: a.title }))}>
            {children}
          </AppShell>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
