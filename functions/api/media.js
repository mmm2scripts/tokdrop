/* =====================================================================
   /api/media  -  Cloudflare Pages Function (the download proxy)
   ---------------------------------------------------------------------
   TikTok's CDN rejects browser requests that miss the Referer header, so
   the file is fetched here (with the right headers) and streamed to the
   visitor with a Content-Disposition: attachment header.

   Query string:
     u  = the TikTok CDN url (url-encoded)
     f  = the file name to save as
     dl = 1 download (default) / 0 inline (used by the <video> preview)
   ===================================================================== */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const ALLOWED = /\.(tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|akamaized\.net|bytedance\.com|byteoversea\.com|ibyteimg\.com|muscdn\.com)$/;

function sanitize(name) {
  const cleaned = String(name || "").replace(/[\\/:*?"<>|\r\n]+/g, "").trim();
  return (cleaned || "tiktok-video.mp4").slice(0, 120);
}

export async function onRequestGet(context) {
  const request = context.request;
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("u");
  const fileName = sanitize(requestUrl.searchParams.get("f"));
  const inline = requestUrl.searchParams.get("dl") === "0";

  if (!target) return new Response("Missing media URL.", { status: 400 });

  let parsed;
  try {
    parsed = new URL(target);
  } catch (error) {
    return new Response("Invalid media URL.", { status: 400 });
  }

  const host = parsed.hostname.toLowerCase();
  if (host.indexOf("tiktok.com") === -1 && !ALLOWED.test(host)) {
    return new Response("This proxy only streams TikTok media hosts.", { status: 400 });
  }

  const range = request.headers.get("range");
  const headers = {
    "User-Agent": DESKTOP_UA,
    Referer: "https://www.tiktok.com/",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (range) headers.Range = range;

  let upstream;
  try {
    upstream = await fetch(parsed.toString(), { headers: headers, redirect: "follow" });
  } catch (error) {
    return new Response("Could not reach TikTok's media server. Resolve the link again.", { status: 504 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(
      "TikTok's media server refused the download (HTTP " + upstream.status + "). Signed links expire fast - resolve the video again and download right away.",
      { status: 502 }
    );
  }

  const out = new Headers();
  const type = upstream.headers.get("content-type");
  out.set("content-type", type && type !== "application/octet-stream" ? type : /\.mp3$/i.test(fileName) ? "audio/mpeg" : "video/mp4");
  const length = upstream.headers.get("content-length");
  if (length) out.set("content-length", length);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) out.set("content-range", contentRange);
  out.set("accept-ranges", upstream.headers.get("accept-ranges") || "bytes");
  out.set("cache-control", "no-store");
  if (!inline) out.set("content-disposition", 'attachment; filename="' + fileName + '"');

  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers: out });
}
