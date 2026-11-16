import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  code: z.string().min(8).max(4000),
  verifier: z.string().min(43).max(128),
  clientId: z.string().min(2).max(200),
  redirectUri: z.string().url().max(500),
});

export const exchangeOAuthCode = createServerFn({ method: "POST" })
  .validator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data }) => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: data.clientId,
      code: data.code,
      code_verifier: data.verifier,
      redirect_uri: data.redirectUri,
    });
    const res = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false as const, error: text.replace(/\s+/g, " ").slice(0, 360) };
    }
    let json: { access_token?: string; expires_in?: number };
    try {
      json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    } catch {
      return { ok: false as const, error: "Token response was not JSON." };
    }
    if (!json.access_token) return { ok: false as const, error: "No access token in the response." };
    return { ok: true as const, accessToken: json.access_token, expiresIn: json.expires_in ?? 0 };
  });
