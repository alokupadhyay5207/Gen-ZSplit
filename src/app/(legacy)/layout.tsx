import type { Metadata, Viewport } from "next";
import "../globals.css";

export const metadata: Metadata = { title: { default: "Smart Expense Tracker", template: "%s" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Apply the saved theme before first paint (no light/dark flash).
const THEME_SCRIPT = `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("theme")||"light")}catch(e){}`;

export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
