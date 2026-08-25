/* =====================================================================
   /api/resolve  -  Cloudflare Pages Function (runs on YOUR deployment)
   ---------------------------------------------------------------------
   Reads a TikTok URL and returns the video metadata plus every download
   option. It only talks to TikTok's own public endpoints:

     1. short links  -> follow the redirect to the full URL
     2. /oembed      -> public metadata (no key required)
     3. the web page -> __UNIVERSAL_DATA_FOR_REHYDRATION__ / SIGI_STATE JSON
     4. the mobile feed endpoint -> second attempt if the page is blocked

   There is NO third-party / paid API involved.
   ===================================================================== */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const ANDROID_UA =
  "com.zhiliaoapp.musically/2023205030 (Linux; U; Android 13; en_US; Pixel 7; Build/TQ3A.230901.001; Cronet/TTNetVersion)";
const TIKTOK = "https://www.tiktok.com";

function reply(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function pickString(...values) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
  }
  return null;
}

function pickNumber(...values) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const n = typeof value === "string" ? Number(value) : value;
    if (typeof n === "number" && isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractId(pathname) {
  const patterns = [/\/video\/(\d{6,})/, /\/photo\/(\d{6,})/, /\/v\/(\d{6,})/, /\/embed\/v2\/(\d{6,})/];
  for (let i = 0; i < patterns.length; i++) {
    const found = pathname.match(patterns[i]);
    if (found) return found[1];
  }
  const trailing = pathname.match(/(\d{15,})\/?$/);
  return trailing ? trailing[1] : null;
}

/**
 * TikTok returns several CDN addresses per quality. The first two
 * (v16/v19-webapp-prime...) often answer 403 without cookies, while the
 * www.tiktok.com/aweme/v1/play/ entry redirects to an open CDN url.
 */
function preferPlayableUrl(candidates) {
  const list = [];
  for (let i = 0; i < candidates.length; i++) {
    if (typeof candidates[i] === "string" && candidates[i].trim()) list.push(candidates[i].trim());
  }
  for (let i = 0; i < list.length; i++) {
    if (list[i].indexOf("/aweme/v1/play/") !== -1) return list[i];
  }
  return list[0] || null;
}

/** Tiny range request used to confirm an address really works before we show it. */
async function isReachable(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": DESKTOP_UA, Referer: TIKTOK + "/", Range: "bytes=0-1" },
      redirect: "follow",
    });
    const ok = response.status === 200 || response.status === 206;
    try { response.body && response.body.cancel(); } catch (error) { /* ignore */ }
    return ok;
  } catch (error) {
    return false;
  }
}

function safeFileBase(value, fallback) {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
    // keep the file name friendly on every operating system
    .replace(/[^\w\s.\-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}

function proxyUrl(directUrl, fileName) {
  return "/api/media?u=" + encodeURIComponent(directUrl) + "&f=" + encodeURIComponent(fileName) + "&dl=1";
}

function variant(input) {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    detail: input.detail || "",
    width: input.width || null,
    height: input.height || null,
    bitrateKbps: input.bitrate ? Math.round(input.bitrate / 1000) : null,
    sizeBytes: input.sizeBytes || null,
    ext: input.ext,
    fileName: input.fileName,
    directUrl: input.directUrl,
    url: proxyUrl(input.directUrl, input.fileName),
    watermarked: !!input.watermarked,
  };
}

async function fetchText(url, options) {
  try {
    const response = await fetch(url, Object.assign({ headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" } }, options || {}));
    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    return null;
  }
}

async function fetchOEmbed(pageUrl) {
  const text = await fetchText(TIKTOK + "/oembed?url=" + encodeURIComponent(pageUrl), {
    headers: { "User-Agent": DESKTOP_UA, Accept: "application/json" },
  });
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    return {
      title: pickString(data.title),
      authorName: pickString(data.author_name),
      authorUniqueId: pickString(data.author_unique_id) || (pickString(data.author_url) || "").split("@")[1] || null,
      thumbnail: pickString(data.thumbnail_url),
    };
  } catch (error) {
    return null;
  }
}

function parseEmbeddedJson(html) {
  const universal = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
  if (universal) {
    try {
      const json = JSON.parse(universal[1]);
      const item = json && json.__DEFAULT_SCOPE__ && json.__DEFAULT_SCOPE__["webapp.video-detail"];
      const itemStruct = item && item.itemInfo && item.itemInfo.itemStruct;
      if (itemStruct && itemStruct.id) return itemStruct;
    } catch (error) { /* ignore */ }
  }
  const sigi = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i);
  if (sigi) {
    try {
      const json = JSON.parse(sigi[1]);
      const modules = json && json.ItemModule;
      if (modules) {
        const keys = Object.keys(modules);
        if (keys.length && modules[keys[0]] && modules[keys[0]].id) return modules[keys[0]];
      }
    } catch (error) { /* ignore */ }
  }
  return null;
}

async function fetchWebItem(canonicalUrl) {
  const html = await fetchText(canonicalUrl, {
    headers: {
      "User-Agent": DESKTOP_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: TIKTOK + "/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
    },
  });
  return html ? parseEmbeddedJson(html) : null;
}

async function fetchMobileItem(videoId) {
  const query =
    "aweme_id=" + encodeURIComponent(videoId) +
    "&iid=7318518857994389254&device_id=7318517321748022790&channel=googleplay" +
    "&app_name=musical_ly&version_code=300904&device_platform=android&device_type=Pixel%207&os_version=13";
  let text = null;
  try {
    const response = await fetch("https://api22-normal-c-useast2a.tiktokv.com/aweme/v1/feed/?" + query, {
      headers: { "User-Agent": ANDROID_UA, Accept: "application/json" },
    });
    if (!response.ok) return null;
    text = await response.text();
  } catch (error) {
    return null;
  }
  if (!text) return null;
  try {
    const json = JSON.parse(text);
    const aweme = (json.aweme_list && json.aweme_list[0]) || json.aweme_detail;
    return aweme && (aweme.aweme_id || aweme.id) ? aweme : null;
  } catch (error) {
    return null;
  }
}

async function buildVariants(item, base, mobile) {
  const video = item.video || {};
  const variants = [];
  const seen = {};
  const gears = (mobile ? video.bit_rate : video.bitrateInfo) || [];

  for (let i = 0; i < gears.length; i++) {
    const gear = gears[i] || {};
    const addr = mobile ? gear.play_addr : gear.PlayAddr;
    const url = preferPlayableUrl([].concat((addr && addr.UrlList) || [], (addr && addr.url_list) || []));
    if (!url) continue;
    const height = pickNumber(mobile ? gear.play_addr && gear.play_addr.height : addr && addr.Height, mobile ? gear.height : addr && addr.Height);
    const width = pickNumber(mobile ? gear.play_addr && gear.play_addr.width : addr && addr.Width, mobile ? gear.width : addr && addr.Width);
    const bitrate = pickNumber(gear.bitrate, gear.Bitrate);
    const size = pickNumber(mobile ? gear.play_addr && gear.play_addr.data_size : addr && addr.DataSize);
    // Vertical videos: the short side is what people call the quality (1080p).
    const quality = width && height ? Math.min(width, height) : height;
    const key = String(quality || height || 0);
    if (seen[key]) continue;
    seen[key] = true;
    const bits = [];
    if (width && height) bits.push(width + " x " + height);
    if (bitrate) bits.push(Math.round(bitrate / 1000) + " kbps");
    if (size) bits.push((size / 1048576).toFixed(1) + " MB");
    variants.push(variant({
      id: "gear-" + key,
      kind: "video",
      label: quality ? quality + "p" : "Original",
      detail: bits.join(" \u00B7 "),
      width: width,
      height: height,
      bitrate: bitrate,
      sizeBytes: size,
      ext: "mp4",
      fileName: base + ".mp4",
      directUrl: url,
    }));
  }

  const playAddr = preferPlayableUrl([video.playAddr].concat((video.play_addr && video.play_addr.url_list) || []));
  if (playAddr && variants.length === 0) {
    // only used as a fallback when TikTok gave us no quality list at all
    variants.push(variant({
      id: "play",
      kind: "video",
      label: "Standard MP4",
      detail: "Direct play address (usually no watermark)",
      height: pickNumber(video.height, video.play_addr && video.play_addr.height),
      width: pickNumber(video.width, video.play_addr && video.play_addr.width),
      bitrate: pickNumber(video.bitrate),
      ext: "mp4",
      fileName: base + ".mp4",
      directUrl: playAddr,
    }));
  }

  const downloadAddr = preferPlayableUrl([video.downloadAddr].concat((video.download_addr && video.download_addr.url_list) || []));
  // Only offer the watermarked original when the address actually responds.
  if (downloadAddr && (await isReachable(downloadAddr))) {
    variants.push(variant({
      id: "download",
      kind: "video",
      label: "Original (watermarked)",
      detail: "TikTok's own download address",
      height: pickNumber(video.height),
      width: pickNumber(video.width),
      ext: "mp4",
      fileName: base + "-watermarked.mp4",
      directUrl: downloadAddr,
      watermarked: true,
    }));
  }

  variants.sort(function (a, b) {
    return Math.min(b.width || 0, b.height || 0) - Math.min(a.width || 0, a.height || 0) ||
      (b.bitrateKbps || 0) - (a.bitrateKbps || 0);
  });
  return variants;
}

function buildAudio(item, base, mobile) {
  const music = item.music || {};
  const url = preferPlayableUrl([music.playUrl].concat((music.play_url && music.play_url.url_list) || []));
  if (!url) return null;
  const detail = [pickString(music.title), pickString(music.authorName, music.author)].filter(Boolean).join(" \u00B7 ") || "Original sound";
  return variant({
    id: "music",
    kind: "audio",
    label: "Audio only (MP3)",
    detail: detail,
    bitrate: pickNumber(music.bitrate),
    ext: "mp3",
    fileName: base + "-audio.mp3",
    directUrl: url,
  });
}

async function resolveTikTok(rawUrl) {
  let candidate = String(rawUrl || "").trim();
  if (!candidate) return { ok: false, error: "Paste a TikTok link first.", hint: "" };
  if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (error) {
    return { ok: false, error: "That does not look like a valid URL.", hint: "Copy the link straight from the TikTok app." };
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host.indexOf("tiktok.com") === -1) {
    return { ok: false, error: "Only tiktok.com links are supported.", hint: "Example: https://www.tiktok.com/@user/video/123456789" };
  }

  let username = (parsed.pathname.match(/^\/@([^/]+)/) || [])[1] || null;
  let videoId = extractId(parsed.pathname);
  const notes = [];

  if (!videoId) {
    // Short link: follow the redirect (Workers follows redirects by default).
    try {
      const response = await fetch(parsed.toString(), { method: "GET", headers: { "User-Agent": DESKTOP_UA }, redirect: "follow" });
      const finalUrl = response.url || "";
      if (finalUrl) {
        const finalParsed = new URL(finalUrl);
        videoId = extractId(finalParsed.pathname);
        username = username || (finalParsed.pathname.match(/^\/@([^/]+)/) || [])[1] || null;
      }
    } catch (error) { /* handled below */ }
  }

  if (!videoId) {
    // Last resort: TikTok's public oEmbed accepts short links too and returns
    // the numeric video id (embed_product_id) plus the author handle.
    const shortOembed = await fetchOEmbed(parsed.toString());
    if (shortOembed && shortOembed.videoId) {
      videoId = shortOembed.videoId;
      username = username || shortOembed.authorUniqueId || null;
    }
  }

  if (!videoId) {
    return { ok: false, error: "Could not find a video ID in that link.", hint: "Use the full link (https://www.tiktok.com/@user/video/123...) or a vm.tiktok.com short link." };
  }

  const pageUrl = username ? TIKTOK + "/@" + username + "/video/" + videoId : TIKTOK + "/embed/v2/" + videoId;
  const oembed = await fetchOEmbed(pageUrl);
  const finalUsername = username || (oembed && oembed.authorUniqueId) || null;
  const canonicalUrl = finalUsername ? TIKTOK + "/@" + finalUsername + "/video/" + videoId : pageUrl;

  let item = finalUsername ? await fetchWebItem(canonicalUrl) : null;
  let mobile = false;
  if (!item) {
    notes.push("TikTok's web page did not return video data for this request.");
    item = await fetchMobileItem(videoId);
    mobile = true;
  }

  const title = pickString(item && item.desc) || (oembed && oembed.title) || "TikTok video";
  const author = (item && item.author) || {};
  const authorUniqueId = pickString(author.uniqueId, author.unique_id) || (oembed && oembed.authorUniqueId) || "unknown";
  const authorNickname = pickString(author.nickname, author.unique_id) || (oembed && oembed.authorName) || authorUniqueId;
  const base = safeFileBase(authorUniqueId + "-" + title, "tiktok-" + videoId);

  if (!item) {
    if (oembed) {
      return {
        ok: true,
        source: "oembed",
        videoId: videoId,
        pageUrl: canonicalUrl,
        title: title,
        cover: (oembed && oembed.thumbnail) || null,
        durationSeconds: null,
        createdAt: null,
        author: { uniqueId: authorUniqueId, nickname: authorNickname, avatar: null },
        stats: { plays: null, likes: null, comments: null, shares: null },
        music: { title: null, author: (oembed && oembed.authorName) || null, durationSeconds: null },
        variants: [],
        best: null,
        audio: null,
        notes: notes.concat(["Only public metadata could be read right now, so no media file is available."]),
      };
    }
    return {
      ok: false,
      error: "TikTok refused this request.",
      hint: "TikTok blocks some Cloudflare IPs and rotates its page structure. Wait a minute and try again, or deploy to a different Cloudflare account.",
    };
  }

  const stats = item.stats || item.statistics || {};
  const music = item.music || {};
  const variants = await buildVariants(item, base, mobile);
  const audio = buildAudio(item, base, mobile);

  if (!variants.length) {
    return {
      ok: false,
      error: "TikTok returned metadata but no playable file for this video.",
      hint: "The video may be private, deleted, age restricted or region locked. Only public videos work.",
    };
  }

  return {
    ok: true,
    source: mobile ? "mobile" : "web",
    videoId: videoId,
    pageUrl: canonicalUrl,
    title: title,
    cover: pickString(item.video && (item.video.originCover || item.video.cover), item.video && item.video.cover && item.video.cover.url_list && item.video.cover.url_list[0], oembed && oembed.thumbnail),
    durationSeconds: pickNumber(item.video && item.video.duration, music.duration),
    createdAt: pickNumber(item.createTime, item.create_time) ? new Date(pickNumber(item.createTime, item.create_time) * 1000).toISOString() : null,
    author: {
      uniqueId: authorUniqueId,
      nickname: authorNickname,
      avatar: pickString(author.avatarLarger, author.avatarMedium, author.avatarThumb && author.avatarThumb.url_list && author.avatarThumb.url_list[0]),
    },
    stats: {
      plays: pickNumber(stats.playCount, stats.play_count),
      likes: pickNumber(stats.diggCount, stats.digg_count),
      comments: pickNumber(stats.commentCount, stats.comment_count),
      shares: pickNumber(stats.shareCount, stats.share_count),
    },
    music: {
      title: pickString(music.title) || "Original sound",
      author: pickString(music.authorName, music.author),
      durationSeconds: pickNumber(music.duration),
    },
    variants: variants,
    best: variants[0],
    audio: audio,
    notes: notes,
  };
}

/* POST /api/resolve ------------------------------------------------------ */
export async function onRequestPost(context) {
  const request = context.request;
  let body = {};
  try {
    body = await request.json();
  } catch (error) {
    return reply({ ok: false, error: "Invalid JSON body.", hint: "" }, 400);
  }
  const url = typeof body.url === "string" ? body.url : "";
  if (!url.trim()) return reply({ ok: false, error: "Paste a TikTok link first.", hint: "" }, 400);

  const result = await resolveTikTok(url);
  return reply(result, result.ok ? 200 : 422);
}

/* GET /api/resolve -> tiny health/help check ---------------------------- */
export async function onRequestGet() {
  return reply({ ok: true, usage: 'POST { "url": "https://www.tiktok.com/@user/video/123..." }' });
}
