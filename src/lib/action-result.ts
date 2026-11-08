/** What a group server action hands back to <ActionForm>. */
export type ActionResult =
  | { ok: true; message?: string; kind?: "success" | "info"; redirectTo?: string }
  | { ok: false; error: string; redirectTo?: string };
