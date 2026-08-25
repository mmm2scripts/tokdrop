/* =====================================================================
   worker.js  -  Cloudflare Workers entry point (static assets + API)
   ---------------------------------------------------------------------
   Cloudflare serves every file inside public/ as a static asset. Any
   request that does NOT match a file (our two API routes) is handled here:

     POST /api/resolve  -> functions/api/resolve.js  (read TikTok, return JSON)
     GET  /api/media    -> functions/api/media.js    (stream the file)

   The handlers are shared with Cloudflare Pages, so you can deploy this
   project either way without touching any code.
   ===================================================================== */

import { onRequestPost as resolvePost, onRequestGet as resolveGet } from "./functions/api/resolve.js";
import { onRequestGet as mediaGet } from "./functions/api/media.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/resolve") {
      if (request.method === "POST") return resolvePost({ request });
      return resolveGet({ request });
    }

    if (path === "/api/media") return mediaGet({ request });

    return new Response(JSON.stringify({ ok: false, error: "Not found." }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  },
};
