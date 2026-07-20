// Cloudflare Turnstile siteverify (#25-A step 5). Config-gated: staging starts disabled,
// production requires it. Fetch is injected for tests. UNREACHABLE → fail OPEN (allow, but
// downgraded to rate-limit-only + a review flag); a REACHED "invalid token" is a real
// rejection. The distinction matters: an outage must not take the funnel down.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileOutcome =
  | { verdict: "pass" }
  | { verdict: "fail" } // reached siteverify, token invalid → reject
  | { verdict: "fail_open" }; // unreachable → allow + review flag

export type FetchLike = (url: string, init?: any) => Promise<{ json: () => Promise<any> }>;

export async function verifyTurnstile(token: string | undefined, secret: string, remoteIp: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<TurnstileOutcome> {
  try {
    const res = await fetchImpl(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token ?? "", remoteip: remoteIp }).toString(),
    });
    const data = await res.json();
    return data?.success ? { verdict: "pass" } : { verdict: "fail" };
  } catch {
    return { verdict: "fail_open" }; // network/timeout → don't take the funnel down
  }
}
