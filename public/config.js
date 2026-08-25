/* =====================================================================
   CONFIG.JS  -  the only file you need to edit to change the site.
   ---------------------------------------------------------------------
   Save the file, commit, push - Cloudflare redeploys automatically.
   Every value below is a plain string / number, no build step needed.
   ===================================================================== */
window.SITE_CONFIG = {

  /* ---------- Branding -------------------------------------------- */
  /* CHANGE: your site name (shown in the browser tab, nav and hero)   */
  siteTitle: "TokDrop",

  /* CHANGE: the short line under the big title                        */
  tagline: "Paste a TikTok link. Get the video.",

  /* CHANGE: logo image URL (png/svg, square works best).             */
  /*         Leave "" to keep the built-in gradient mark.             */
  logoUrl: "",

  /* CHANGE: accent colour - buttons, links, glows (any CSS colour)   */
  accentColor: "#22d3ee",

  /* ---------- Background ------------------------------------------- */
  background: {
    /* CHANGE: background image URL. "" = use the built-in gradient.   */
    imageUrl: "https://cdn.discordapp.com/attachments/1495934459432796362/1541863479248552116/IMG_1613.jpg?ex=6a8f23c3&is=6a8dd243&hm=9aaf9f039a33dfe90de74bc4cbb10945a81a4eb588a6b736ce328180f5e4c2f5&",

    /* 0 = invisible, 1 = fully visible                                */
    opacity: 0.9,

    /* blur in px (0 = sharp)                                          */
    blur: 6,

    /* any CSS background-position: "center", "top", "50% 20%" ...     */
    position: "center",

    /* dark film on top of everything, 0 - 0.95 (higher = darker)      */
    overlayDarkness: 0.55
  },

  /* ---------- Optional background music ---------------------------- */
  music: {
    /* CHANGE: set enabled to true and paste a direct .mp3 URL.        */
    /* Browsers block autoplay, so music starts on the first click     */
    /* of the music button in the top-right corner.                    */
    enabled: true,

    url: "",

    /* 0 = silent, 1 = full volume                                     */
    volume: 1,

    /* true = restart when the track finishes                          */
    loop: true
  }
};
