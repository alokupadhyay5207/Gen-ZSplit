import type { CSSProperties } from "react";
import { hue, initials } from "@/lib/format";

/** Deterministic coloured initials. */
export function Avatar({ name, size = "" }: { name: string; size?: string }) {
  return (
    <span className={`gz-avatar ${size}`.trim()} style={{ "--h": hue(name) } as CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
