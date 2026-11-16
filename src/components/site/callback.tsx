import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { startDesk } from "@/lib/desk/session";
import { useDesk } from "@/lib/desk/store";

export function Callback() {
  const navigate = useNavigate();
  const auth = useDesk((s) => s.auth);
  const authError = useDesk((s) => s.authError);

  useEffect(() => startDesk(), []);

  useEffect(() => {
    if (auth === "ready") void navigate({ to: "/desk" });
  }, [auth, navigate]);

  return (
    <div className="grid min-h-dvh place-items-center bg-navy px-4 text-fg">
      <div className="w-full max-w-sm rounded-md border border-line bg-surface p-5">
        <p className="font-mono text-xs tracking-widest text-gold uppercase">RICHGANGFX AI</p>
        <h1 className="mt-2 text-xl font-semibold">{auth === "error" ? "Sign-in did not finish" : "Signing in"}</h1>
        <p className="mt-3 text-sm text-pretty text-muted">
          {auth === "error" ? authError : "Deriv is returning your account. The desk opens when the balance is ready."}
        </p>
        {auth === "error" ? (
          <Link to="/" className="mt-4 inline-flex min-h-11 items-center text-sm text-blue">
            Back to home
          </Link>
        ) : null}
      </div>
    </div>
  );
}
