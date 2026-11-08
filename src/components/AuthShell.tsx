import type { ReactNode } from "react";
import { readFlash } from "@/lib/flash";
import { FlashBox } from "./LegacyBits";

interface Props {
  heading: string;
  blurb: string;
  features: Array<[icon: string, title: string, text: string]>;
  cardTitle: string;
  cardText: string;
  children: ReactNode; // the form
  links: ReactNode;
}

/** The two-column layout shared by login / register / forgot / verify / reset. */
export async function AuthShell({ heading, blurb, features, cardTitle, cardText, children, links }: Props) {
  const messages = await readFlash();
  return (
    <div className="premium-login-page">
      <div className="login-bg-shape shape-one"></div>
      <div className="login-bg-shape shape-two"></div>
      <div className="premium-login-wrapper">
        <div className="premium-login-left">
          <div className="brand-badge">Smart Expense Tracker</div>
          <h1>{heading}</h1>
          <p>{blurb}</p>
          <div className="login-feature-list">
            {features.map(([icon, title, text]) => (
              <div className="login-feature-card" key={title}>
                <span>{icon}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="premium-login-right">
          <div className="premium-auth-card">
            <div className="premium-auth-header">
              <h2>{cardTitle}</h2>
              <p>{cardText}</p>
            </div>
            {children}
            <div className="premium-auth-links">{links}</div>
            <FlashBox messages={messages} className="premium-flash-box" />
          </div>
        </div>
      </div>
    </div>
  );
}
