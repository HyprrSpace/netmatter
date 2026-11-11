import type { Metadata } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Backdrop, Logo } from "@/components/chrome";
import {
  getPanelPassword,
  isValidPanelSessionToken,
  PANEL_SESSION_COOKIE,
  safePanelRedirect,
} from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in · netmatter",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await connection();
  const password = getPanelPassword();
  if (!password) redirect("/");

  const params = await searchParams;
  const returnTo = safePanelRedirect(params.next ?? null);
  const session = (await cookies()).get(PANEL_SESSION_COOKIE)?.value;
  if (isValidPanelSessionToken(session, password)) redirect(returnTo);

  const invalid = params.error === "invalid";

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden px-4 py-12">
      <Backdrop />
      <section className="glass w-full max-w-[420px] rounded-[28px] p-2">
        <div className="rounded-[22px] border border-white/[0.06] bg-black/20 px-6 pb-7 pt-6 sm:px-8 sm:pb-8 sm:pt-7">
          <div className="flex items-center justify-between">
            <Logo />
            <div className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-muted-foreground">
              <LockKeyhole className="size-4" strokeWidth={1.7} aria-hidden />
            </div>
          </div>

          <div className="my-8 flex items-center" aria-hidden>
            {[0, 1, 2, 3].map((hop, index) => (
              <div key={hop} className="contents">
                <span
                  className={
                    index === 3
                      ? "size-2.5 rounded-full bg-foreground shadow-[0_0_16px_rgba(255,255,255,0.45)]"
                      : "size-2 rounded-full border border-white/30 bg-background"
                  }
                />
                {index < 3 && <span className="h-px flex-1 bg-white/15" />}
              </div>
            ))}
          </div>

          <h1 className="text-2xl font-semibold tracking-[-0.025em]">Open the panel</h1>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Enter the panel password to inspect fleet health and network paths.
          </p>

          <form action="/api/auth/login" method="post" className="mt-7">
            <input type="hidden" name="next" value={returnTo} />
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              aria-invalid={invalid}
              aria-describedby={invalid ? "login-error" : undefined}
              className="mt-2 h-12 w-full rounded-xl border border-white/12 bg-white/[0.035] px-4 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/50 focus:border-white/30 focus:ring-4 focus:ring-white/[0.05] aria-invalid:border-critical/60 aria-invalid:ring-4 aria-invalid:ring-critical/10"
              placeholder="Panel password"
            />
            {invalid && (
              <p id="login-error" role="alert" className="mt-2.5 text-sm text-critical">
                That password didn&apos;t match.
              </p>
            )}
            <button
              type="submit"
              className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Sign in
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
