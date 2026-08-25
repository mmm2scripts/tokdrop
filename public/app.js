/* =====================================================================
   TikTok downloader - front-end (no framework, no build step)
   ---------------------------------------------------------------------
   You should not need to edit this file.
     * colours / background / logo / music  ->  config.js
     * server side logic                    ->  functions/api/*.js
   ===================================================================== */
(function () {
  "use strict";

  var CONFIG = window.SITE_CONFIG || {};
  var BG = CONFIG.background || {};
  var MUSIC = CONFIG.music || {};

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDuration(seconds) {
    if (!seconds) return "-";
    var s = Math.round(seconds);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function fmtNumber(value) {
    if (value === null || value === undefined || value === "") return "-";
    var n = Number(value);
    if (!isFinite(n)) return String(value);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }
  function fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }
  var toastTimer = null;
  function toast(message, kind) {
    var el = $("toast");
    el.textContent = message;
    el.className = "toast show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = "toast " + (kind || ""); }, 3200);
  }

  /* ---------------- 1. config.js -> CSS variables + branding ---------------- */
  function applyConfig() {
    var root = document.documentElement;
    if (CONFIG.accentColor) root.style.setProperty("--accent", CONFIG.accentColor);
    root.style.setProperty("--bg-image", BG.imageUrl ? 'url("' + BG.imageUrl + '")' : "none");
    root.style.setProperty("--bg-opacity", BG.opacity == null ? "0.9" : String(BG.opacity));
    root.style.setProperty("--bg-blur", (BG.blur || 0) + "px");
    root.style.setProperty("--bg-pos", BG.position || "center");
    root.style.setProperty("--overlay", BG.overlayDarkness == null ? "0.55" : String(BG.overlayDarkness));

    if (CONFIG.siteTitle) {
      document.title = CONFIG.siteTitle;
      var name = $("brandName");
      if (name) name.textContent = CONFIG.siteTitle;
    }
    var logo = $("brandLogo");
    var mark = $("brandMark");
    if (logo && mark && CONFIG.logoUrl) {
      logo.src = CONFIG.logoUrl;
      logo.hidden = false;
      mark.hidden = true;
    }
    var tagline = $("tagline");
    if (tagline && CONFIG.tagline) tagline.textContent = CONFIG.tagline;
  }

  /* ---------------- 2. boot screen / theme / music ---------------- */
  function hideBoot() {
    var boot = $("boot");
    if (!boot) return;
    boot.classList.add("hidden");
    setTimeout(function () { boot.remove(); }, 400);
  }

  function initTheme() {
    var saved = null;
    try { saved = window.localStorage.getItem("theme"); } catch (e) { saved = null; }
    var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    var theme = saved || (prefersLight ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
    var btn = $("themeBtn");
    if (!btn) return;
    btn.setAttribute("aria-label", "Toggle dark / light");
    btn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { window.localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
    });
  }

  var audio = null;
  function initMusic() {
    var btn = $("musicBtn");
    if (!btn) return;
    if (!MUSIC.enabled || !MUSIC.url) { btn.hidden = true; return; }

    audio = new Audio(MUSIC.url);
    audio.loop = MUSIC.loop !== false;
    audio.volume = typeof MUSIC.volume === "number" ? MUSIC.volume : 0.35;
    audio.preload = "none";

    btn.addEventListener("click", function () {
      if (!audio) return;
      if (audio.paused) {
        audio.play().then(function () {
          btn.classList.add("is-on");
          btn.textContent = "\u266A";
          toast("Music on");
        }).catch(function () {
          toast("Browser blocked the audio file - check the music URL in config.js", "err");
        });
      } else {
        audio.pause();
        btn.classList.remove("is-on");
        btn.textContent = "\u266B";
        toast("Music off");
      }
    });
  }

  /* ---------------- 3. resolve the link ---------------- */
  var STAGES = [
    "Reading the link\u2026",
    "Contacting TikTok\u2026",
    "Fetching the video data\u2026",
    "Listing every available quality\u2026",
    "Preparing the preview\u2026"
  ];
  var stageTimer = null;

  function showStatus(text, detail) {
    $("status").hidden = false;
    $("statusText").innerHTML = "<strong>" + esc(text) + "</strong>" + (detail ? esc(detail) : "");
  }
  function startStages() {
    var i = 0;
    showStatus(STAGES[0], "This usually takes a few seconds.");
    clearInterval(stageTimer);
    stageTimer = setInterval(function () {
      i = Math.min(i + 1, STAGES.length - 1);
      showStatus(STAGES[i], "");
    }, 1700);
  }
  function stopStages() {
    clearInterval(stageTimer);
    stageTimer = null;
    $("status").hidden = true;
  }
  function showError(title, detail) {
    $("errorTitle").textContent = title;
    $("errorText").textContent = detail || "";
    $("errorBox").hidden = false;
  }
  function hideStatus() {
    $("status").hidden = true;
    $("errorBox").hidden = true;
    $("result").hidden = true;
  }

  function looksLikeTikTokUrl(value) {
    return /(^|\.)tiktok\.com\//i.test(value) || /^https?:\/\/(vm|vt|m)\.tiktok\.com\//i.test(value);
  }

  function resolve() {
    var input = $("urlInput");
    var url = (input.value || "").trim();
    $("errorBox").hidden = true;
    $("result").hidden = true;

    if (!url) { showError("Paste a TikTok link first.", "Copy the link from the TikTok app: Share \u2192 Copy link."); input.focus(); return; }
    if (!looksLikeTikTokUrl(url)) { showError("That is not a TikTok link.", "It should look like https://www.tiktok.com/@user/video/123... or a vm.tiktok.com short link."); input.focus(); return; }

    var button = $("downloadBtn");
    button.disabled = true;
    button.textContent = "Processing\u2026";
    startStages();

    var finished = false;
    var timeout = setTimeout(function () {
      if (finished) return;
      finished = true;
      stopStages();
      button.disabled = false;
      button.textContent = "Download";
      showError("The request took too long.", "TikTok did not answer. Try again, and if it keeps failing run this site from your own Cloudflare deployment (see the README).");
    }, 45000);

    fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url })
    })
      .then(function (response) { return response.json().then(function (data) { return { status: response.status, data: data }; }); })
      .then(function (out) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        stopStages();
        button.disabled = false;
        button.textContent = "Download";
        if (!out.data || out.data.ok !== true) {
          showError((out.data && out.data.error) || "Could not process this link.", (out.data && out.data.hint) || "Only public TikTok videos can be processed.");
          return;
        }
        renderResult(out.data);
      })
      .catch(function () {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        stopStages();
        button.disabled = false;
        button.textContent = "Download";
        showError("Network error.", "The request to /api/resolve failed. Make sure the Cloudflare Functions are deployed (functions/ folder is in the repo root).");
      });
  }

  /* ---------------- 4. render the result ---------------- */
  function metaItem(label, value, full) {
    return '<div class="meta-item' + (full ? " full" : "") + '"><dt>' + esc(label) + '</dt><dd>' + esc(value || "-") + '</dd></div>';
  }

  function downloadRow(variant) {
    var tags = '<span class="tag">' + esc(variant.kind === "audio" ? "Audio" : "MP4") + "</span>";
    if (variant.watermarked) tags += ' <span class="tag tag-muted">Watermarked</span>';
    return '<div class="download-row">' +
      '<div class="info"><b>' + esc(variant.label) + "</b>" +
      "<span>" + esc(variant.detail || "") + (variant.sizeBytes ? " \u00B7 " + fmtSize(variant.sizeBytes) : "") + "</span></div>" +
      tags +
      '<a class="btn" href="' + esc(variant.url) + '" download="' + esc(variant.fileName) + '" data-dl>Download</a>' +
      "</div>";
  }

  function renderResult(data) {
    var player = $("player");
    if (data.preview && data.preview.url) {
      player.innerHTML = '<video controls playsinline preload="metadata" poster="' + esc(data.cover || "") + '" src="' + esc(data.preview.url) + '"></video>';
    } else if (data.cover) {
      player.innerHTML = '<img class="player-cover" src="' + esc(data.cover) + '" alt="Video cover">';
    } else {
      player.innerHTML = "<p>No preview available</p>";
    }

    var info = $("metaList");
    var best = data.best || (data.variants && data.variants[0]);
    info.innerHTML =
      metaItem("Author", "@" + (data.author ? data.author.uniqueId : "-")) +
      metaItem("Duration", fmtDuration(data.durationSeconds)) +
      metaItem("Best quality", best ? best.label : "n/a") +
      metaItem("Resolution", best && best.height ? best.width + " x " + best.height : "n/a") +
      metaItem("Sound", data.music && data.music.title ? data.music.title : "Original sound") +
      metaItem("Audio only", data.audio ? "Available (MP3)" : "Not available") +
      metaItem("Plays", fmtNumber(data.stats ? data.stats.plays : null)) +
      metaItem("Likes", fmtNumber(data.stats ? data.stats.likes : null)) +
      metaItem("Caption", data.title, true);

    var list = $("downloadList");
    var html = "";
    for (var i = 0; i < (data.variants || []).length; i++) html += downloadRow(data.variants[i]);
    if (data.audio) html += downloadRow(data.audio);
    list.innerHTML = html;

    $("sourceLink").href = data.pageUrl || "#";
    $("result").hidden = false;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });

    if (data.notes && data.notes.length) {
      toast(data.notes[0]);
    }
  }

  /* ---------------- wiring ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    applyConfig();
    initTheme();
    initMusic();

    $("downloadBtn").addEventListener("click", resolve);
    $("urlInput").addEventListener("keydown", function (event) { if (event.key === "Enter") resolve(); });
    $("urlInput").addEventListener("paste", function () { setTimeout(function () { if ($("urlInput").value) resolve(); }, 120); });

    var pasteBtn = $("pasteBtn");
    if (pasteBtn) {
      pasteBtn.addEventListener("click", function () {
        if (!navigator.clipboard || !navigator.clipboard.readText) { toast("Clipboard is not available in this browser", "err"); return; }
        navigator.clipboard.readText().then(function (text) {
          $("urlInput").value = (text || "").trim();
          if ($("urlInput").value) resolve();
        }).catch(function () { toast("Allow clipboard access to paste automatically", "err"); });
      });
    }

    // "Preparing download" state while the browser fetches the file.
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("[data-dl]") : null;
      if (!link) return;
      showStatus("Preparing download\u2026", "The file is streamed through your own Cloudflare Function.");
      setTimeout(function () { stopStages(); }, 2500);
    });

    window.addEventListener("load", hideBoot);
    setTimeout(hideBoot, 1200); // safety net
  });
})();
