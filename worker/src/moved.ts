/**
 * The former Worker after the move to tempra.dev (v2 spec: Move to tempra.dev): every request is
 * redirected to the same path on the new host. Library stays exported while its Durable Objects'
 * handoff to the new Worker rolls out (cloudflare.config.ts, phase "forward").
 */
export { Library } from "./library";

export default {
  fetch(req: Request, env: { MOVED_TO: string }): Response {
    const url = new URL(req.url);
    return Response.redirect(`${env.MOVED_TO}${url.pathname}${url.search}`, 308);
  },
};
