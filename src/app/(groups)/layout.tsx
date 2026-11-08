import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { logoutAction } from "@/actions/auth";
import { Avatar } from "@/components/Avatar";
import { Icon, IconSprite } from "@/components/Icon";
import { ConfirmProvider } from "@/components/confirm";
import { ModalProvider } from "@/components/modal";
import { ToastProvider } from "@/components/toast";
import { getSession } from "@/lib/session";
import "../globals.css";

export const metadata: Metadata = { title: "Gen-ZSplit" };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090A1E",
  colorScheme: "dark",
};

export default async function GroupsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (typeof session.uid !== "number") redirect("/login");
  const name = session.name || "You";

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Sora:wght@500;600;700&display=swap"
        />
      </head>
      <body className="gz">
        <IconSprite />
        <a className="gz-skip" href="#main">
          Skip to content
        </a>
        <ToastProvider>
          <ModalProvider>
            <ConfirmProvider>
              <header className="gz-appbar gz-glass">
                <div className="gz-appbar-inner">
                  <a className="gz-brand" href="/groups" aria-label="Gen-ZSplit home">
                    <svg className="gz-logo" viewBox="0 0 32 32" aria-hidden="true">
                      <defs>
                        <linearGradient id="gz-lg" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0" stopColor="#818CF8" />
                          <stop offset="1" stopColor="#C084FC" />
                        </linearGradient>
                      </defs>
                      <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#gz-lg)" />
                      <path
                        d="M9 12.5h10.5M9 12.5l3-3M23 19.5H12.5M23 19.5l-3 3"
                        fill="none"
                        stroke="#0B0C26"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Gen-ZSplit</span>
                  </a>
                  <nav className="gz-nav" aria-label="Primary">
                    <a href="/dashboard">
                      <Icon name="grid" />
                      <span>Personal</span>
                    </a>
                    <a href="/groups" aria-current="page">
                      <Icon name="users" />
                      <span>Groups</span>
                    </a>
                  </nav>
                  <div className="gz-appbar-user">
                    <Avatar name={name} />
                    <span className="gz-appbar-name">{name}</span>
                    <form action={logoutAction}>
                      <button type="submit" className="gz-iconbtn" aria-label="Log out" title="Log out">
                        <Icon name="logout" />
                      </button>
                    </form>
                  </div>
                </div>
              </header>
              <main id="main" className="gz-main">
                {children}
              </main>
            </ConfirmProvider>
          </ModalProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
