/*
 * ============================================================
 * ECA Graduate Show — Vimeo Archive Behaviour
 * ============================================================
 *
 * Target:
 *   https://www.2021.graduateshow.eca.ed.ac.uk/portfolio/*
 *
 * Vimeo example:
 *   https://player.vimeo.com/video/538340789?app_id=122963
 *
 * IMPORTANT:
 *
 * This behaviour deliberately does NOT request:
 *
 *   /video/{id}/config
 *
 * Vimeo returns HTTP 403 for that endpoint in the crawl
 * environment.
 *
 * Instead, we allow Vimeo's own player to initialise and
 * consume its normal MediaSource/HLS/DASH stream.
 *
 * The behaviour also logs the actual network resources Vimeo
 * requests. This is useful for determining whether the video
 * is being delivered as:
 *
 *   - progressive MP4
 *   - HLS
 *   - DASH
 *   - segmented Vimeo CDN media
 *
 * ============================================================
 */


class ECAVimeoArchive {

  static id = "ECA Vimeo Archive";

  /*
   * Run this behaviour on:
   *
   *   1. ECA portfolio pages
   *   2. Vimeo player iframes
   */

  static isMatch() {

    const host =
      window.location.hostname;

    const path =
      window.location.pathname;


    /*
     * ECA portfolio pages.
     */

    if (
      host ===
        "www.2021.graduateshow.eca.ed.ac.uk" ||
      host ===
        "2021.graduateshow.eca.ed.ac.uk"
    ) {
      return path.startsWith(
        "/portfolio/"
      );
    }


    /*
     * Vimeo iframe.
     */

    if (
      host ===
        "player.vimeo.com"
    ) {
      return true;
    }


    return false;
  }


  static init() {
    return {};
  }


  /*
   * We need the behaviour to run in Vimeo child frames.
   */

  static runInIframe = true;


  async* run(ctx) {

    /*
     * ==========================================================
     * COMMON UTILITIES
     * ==========================================================
     */

    const sleep =
      (ms) =>
        new Promise(
          resolve =>
            setTimeout(
              resolve,
              ms
            )
        );


    const log =
      (message) => {

        try {

          ctx.log({
            msg:
              `[ECA Vimeo] ${message}`
          });

        } catch (_) {

          console.log(
            `[ECA Vimeo] ${message}`
          );

        }
      };


    /*
     * Safety limit for a single video.
     *
     * 30 minutes should comfortably cover the ECA videos.
     */

    const MAX_RUNTIME =
      30 * 60 * 1000;


    /*
     * Number of seconds without playback progress before
     * attempting recovery.
     */

    const STALL_LIMIT =
      20;


    /*
     * ==========================================================
     * VIMEO PLAYER FRAME
     * ==========================================================
     */

    if (
      window.location.hostname ===
      "player.vimeo.com"
    ) {

      log(
        `Entered Vimeo iframe: ${location.href}`
      );


      /*
       * --------------------------------------------------------
       * Extract Vimeo ID
       * --------------------------------------------------------
       */

      function getVideoId() {

        const match =
          location.pathname.match(
            /\/video\/(\d+)/
          );


        if (match) {
          return match[1];
        }


        const params =
          new URLSearchParams(
            location.search
          );


        return (
          params.get(
            "clip_id"
          ) ||
          params.get(
            "video_id"
          ) ||
          params.get(
            "id"
          ) ||
          null
        );
      }


      const videoId =
        getVideoId();


      log(
        `Vimeo video ID: ${
          videoId || "UNKNOWN"
        }`
      );


      if (!videoId) {

        log(
          "ERROR: Could not determine Vimeo video ID"
        );

        return;
      }


      /*
       * --------------------------------------------------------
       * Find Vimeo HTML5 video
       * --------------------------------------------------------
       */

      function getVideo() {

        return document.querySelector(
          "video"
        );
      }


      /*
       * --------------------------------------------------------
       * Wait for Vimeo to create <video>
       * --------------------------------------------------------
       */

      async function waitForVideo(
        timeout = 60000
      ) {

        const started =
          Date.now();


        while (
          Date.now() -
            started <
          timeout
        ) {

          const video =
            getVideo();


          if (video) {
            return video;
          }


          await sleep(
            500
          );
        }


        return null;
      }


      /*
       * --------------------------------------------------------
       * Vimeo play-button fallback
       * --------------------------------------------------------
       */

      function clickPlay() {

        const selectors = [

          'button[aria-label="Play"]',

          'button[aria-label*="Play" i]',

          '[role="button"][aria-label*="Play" i]',

          ".vp-play-button",

          '[data-play-button]'

        ];


        for (
          const selector of
            selectors
        ) {

          const buttons =
            document.querySelectorAll(
              selector
            );


          for (
            const button of
              buttons
          ) {

            try {

              button.click();

              log(
                "Clicked Vimeo play control"
              );

              return true;

            } catch (_) {}

          }
        }


        return false;
      }


      /*
       * --------------------------------------------------------
       * Wait for the player.
       * --------------------------------------------------------
       */

      let video =
        await waitForVideo();


      if (!video) {

        log(
          "ERROR: Vimeo <video> element never appeared"
        );

        return;
      }


      log(
        `Vimeo <video> found: ` +
        `readyState=${video.readyState} ` +
        `networkState=${video.networkState}`
      );


      /*
       * --------------------------------------------------------
       * Configure playback.
       * --------------------------------------------------------
       */

      try {

        video.muted =
          true;

        video.autoplay =
          true;

        video.preload =
          "auto";

        video.setAttribute(
          "playsinline",
          ""
        );

      } catch (_) {}


      /*
       * --------------------------------------------------------
       * Allow Vimeo to populate MediaSource.
       * --------------------------------------------------------
       */

      await sleep(
        3000
      );


      video =
        getVideo();


      if (!video) {

        log(
          "Vimeo video disappeared during initialisation"
        );


        video =
          await waitForVideo(
            10000
          );


        if (!video) {

          log(
            "No replacement Vimeo video appeared"
          );

          return;
        }
      }


      /*
       * ========================================================
       * NETWORK RESOURCE DIAGNOSTICS
       * ========================================================
       *
       * Vimeo's currentSrc is a blob: URL because the player is
       * using MediaSource.
       *
       * The useful URLs are therefore the network resources that
       * created/populated that MediaSource.
       *
       * We inspect performance entries and log anything that
       * looks like Vimeo/video/HLS/DASH/media traffic.
       * ========================================================
       */

      function getVimeoResources() {

        const entries =
          performance
            .getEntriesByType(
              "resource"
            );


        const urls =
          entries
            .map(
              entry =>
                entry.name
            )
            .filter(
              url => {

                const lower =
                  url.toLowerCase();


                return (

                  /*
                   * Vimeo infrastructure
                   */

                  lower.includes(
                    "vimeo"
                  ) ||

                  lower.includes(
                    "akamaized"
                  ) ||

                  lower.includes(
                    "cloudfront"
                  ) ||

                  /*
                   * Streaming manifests
                   */

                  lower.includes(
                    ".m3u8"
                  ) ||

                  lower.includes(
                    ".mpd"
                  ) ||

                  /*
                   * Progressive media
                   */

                  lower.includes(
                    ".mp4"
                  ) ||

                  lower.includes(
                    "progressive"
                  ) ||

                  /*
                   * Common segment indicators
                   */

                  lower.includes(
                    "segment"
                  ) ||

                  lower.includes(
                    "fragment"
                  ) ||

                  lower.includes(
                    "playlist"
                  )
                );
              }
            );


        return [
          ...new Set(
            urls
          )
        ];
      }


      function logVimeoResources(
        label
      ) {

        const resources =
          getVimeoResources();


        log(
          `${label}: ${
            resources.length
          }`
        );


        for (
          const url of
            resources
        ) {

          log(
            `VIMEO RESOURCE: ${url}`
          );
        }


        return resources;
      }


      /*
       * Initial resource inspection.
       */

      log(
        `Vimeo media state: ` +
        `currentSrc=${
          video.currentSrc ||
          "(none)"
        } ` +
        `src=${
          video.src ||
          "(none)"
        } ` +
        `readyState=${
          video.readyState
        } ` +
        `networkState=${
          video.networkState
        } ` +
        `duration=${
          Number.isFinite(
            video.duration
          )
            ? video.duration
            : "unknown"
        }`
      );


      logVimeoResources(
        "Vimeo network resources before playback"
      );


      /*
       * ========================================================
       * START PLAYBACK
       * ========================================================
       */

      let playing =
        false;


      for (
        let attempt = 1;
        attempt <= 15;
        attempt++
      ) {

        video =
          getVideo();


        if (!video) {

          await sleep(
            500
          );

          continue;
        }


        try {

          video.muted =
            true;


          await video.play();


          if (
            !video.paused
          ) {

            playing =
              true;

            break;
          }

        } catch (error) {

          log(
            `play() attempt ${attempt} failed: ${
              error &&
              error.message
                ? error.message
                : error
            }`
          );
        }


        clickPlay();


        await sleep(
          1000
        );
      }


      log(
        playing
          ? "Vimeo playback started"
          : "WARNING: Vimeo playback did not start"
      );


      /*
       * Log resources again immediately after playback starts.
       */

      logVimeoResources(
        "Vimeo network resources after playback started"
      );


      /*
       * ========================================================
       * PLAY VIDEO TO COMPLETION
       * ========================================================
       */

      const startedAt =
        Date.now();


      let previousTime =
        -1;


      let stalledFor =
        0;


      let lastResourceLog =
        Date.now();


      while (
        Date.now() -
          startedAt <
        MAX_RUNTIME
      ) {

        await sleep(
          2000
        );


        /*
         * Vimeo occasionally replaces its <video> element.
         */

        video =
          getVideo();


        if (!video) {

          log(
            "Vimeo video element disappeared; waiting for replacement"
          );


          video =
            await waitForVideo(
              10000
            );


          if (!video) {

            log(
              "No replacement video appeared"
            );

            continue;
          }


          try {

            video.muted =
              true;

            video.autoplay =
              true;

            video.preload =
              "auto";

            video.setAttribute(
              "playsinline",
              ""
            );


            await video.play();


            log(
              "Restarted replacement Vimeo video"
            );

          } catch (error) {

            log(
              `Could not restart replacement video: ${
                error &&
                error.message
                  ? error.message
                  : error
              }`
            );
          }


          continue;
        }


        /*
         * ------------------------------------------------------
         * Current playback state
         * ------------------------------------------------------
         */

        const currentTime =
          Number(
            video.currentTime
          ) || 0;


        const duration =
          Number.isFinite(
            video.duration
          )
            ? video.duration
            : null;


        /*
         * Buffered range.
         */

        let bufferedEnd =
          0;


        try {

          if (
            video.buffered &&
            video.buffered.length
          ) {

            bufferedEnd =
              video.buffered.end(
                video.buffered.length -
                  1
              );
          }

        } catch (_) {}


        log(
          `Vimeo playback: ` +
          `${currentTime.toFixed(1)}s` +
          (
            duration !== null
              ? ` / ${duration.toFixed(1)}s`
              : ""
          ) +
          ` buffered=${bufferedEnd.toFixed(1)}s` +
          ` readyState=${video.readyState}` +
          ` networkState=${video.networkState}` +
          ` paused=${video.paused}` +
          ` ended=${video.ended}`
        );


        /*
         * ------------------------------------------------------
         * Periodically inspect network resources.
         *
         * This is intentionally repeated because adaptive
         * streaming manifests/segments appear progressively.
         * ------------------------------------------------------
         */

        if (
          Date.now() -
            lastResourceLog >
          10000
        ) {

          logVimeoResources(
            "Vimeo network resources during playback"
          );


          lastResourceLog =
            Date.now();
        }


        /*
         * ------------------------------------------------------
         * Video finished
         * ------------------------------------------------------
         */

        if (
          video.ended ||
          (
            duration !== null &&
            currentTime >=
              duration - 0.5
          )
        ) {

          log(
            "Vimeo video reached the end"
          );


          /*
           * Keep the page alive briefly to allow final media
           * requests to settle.
           */

          await sleep(
            10000
          );


          logVimeoResources(
            "Final Vimeo network resources"
          );


          return;
        }


        /*
         * ------------------------------------------------------
         * Detect lack of playback progress
         * ------------------------------------------------------
         */

        if (
          previousTime >= 0 &&
          currentTime <=
            previousTime + 0.05
        ) {

          stalledFor +=
            2;

        } else {

          stalledFor =
            0;
        }


        previousTime =
          currentTime;


        /*
         * ------------------------------------------------------
         * Recover from playback stalls
         * ------------------------------------------------------
         */

        if (
          video.paused ||
          stalledFor >=
            STALL_LIMIT
        ) {

          log(
            `Attempting Vimeo playback recovery ` +
            `(stalled ${stalledFor}s)`
          );


          try {

            video.muted =
              true;


            await video.play();

          } catch (_) {}


          if (
            video.paused
          ) {

            clickPlay();
          }


          stalledFor =
            0;
        }


        yield {
          msg:
            `Vimeo playback ` +
            `${currentTime.toFixed(1)}s`
        };
      }


      /*
       * --------------------------------------------------------
       * Safety timeout
       * --------------------------------------------------------
       */

      log(
        "Reached Vimeo 30-minute safety limit"
      );


      logVimeoResources(
        "Vimeo resources at safety timeout"
      );


      return;
    }


    /*
     * ==========================================================
     * ECA PORTFOLIO PAGE
     * ==========================================================
     */

    log(
      `Running ECA page: ${location.href}`
    );


    /*
     * ----------------------------------------------------------
     * Find Vimeo IDs
     * ----------------------------------------------------------
     */

    const foundVimeoIds =
      new Set();


    function findVimeoIdsInText(
      text
    ) {

      if (!text) {
        return;
      }


      const patterns = [

        /*
         * player.vimeo.com/video/538340789
         */

        /player\.vimeo\.com\/video\/(\d+)/gi,


        /*
         * vimeo.com/538340789
         * vimeo.com/video/538340789
         */

        /(?:^|[^a-z])vimeo\.com\/(?:video\/)?(\d+)/gi

      ];


      for (
        const regex of
          patterns
      ) {

        let match;


        while (
          (match =
            regex.exec(text)) !== null
        ) {

          foundVimeoIds.add(
            match[1]
          );
        }
      }
    }


    /*
     * ----------------------------------------------------------
     * Search complete HTML.
     * ----------------------------------------------------------
     */

    findVimeoIdsInText(
      document.documentElement.outerHTML
    );


    /*
     * ----------------------------------------------------------
     * Search element attributes.
     * ----------------------------------------------------------
     */

    for (
      const element of
        document.querySelectorAll("*")
    ) {

      for (
        const attribute of
          Array.from(
            element.attributes || []
          )
      ) {

        findVimeoIdsInText(
          attribute.value
        );
      }
    }


    /*
     * ----------------------------------------------------------
     * Search inline JavaScript.
     * ----------------------------------------------------------
     */

    for (
      const script of
        document.querySelectorAll(
          "script"
        )
    ) {

      findVimeoIdsInText(
        script.textContent
      );
    }


    /*
     * ----------------------------------------------------------
     * Report discovered IDs.
     * ----------------------------------------------------------
     */

    log(
      `Discovered Vimeo IDs: ${
        Array.from(
          foundVimeoIds
        ).join(", ") ||
        "NONE"
      }`
    );


    /*
     * ----------------------------------------------------------
     * No Vimeo IDs
     * ----------------------------------------------------------
     */

    if (
      !foundVimeoIds.size
    ) {

      log(
        "WARNING: no Vimeo IDs found in page source"
      );


      yield {
        msg:
          "No Vimeo IDs found"
      };


      return;
    }


    /*
     * ----------------------------------------------------------
     * Existing Vimeo frames
     * ----------------------------------------------------------
     */

    const existingFrames =
      document.querySelectorAll(
        "iframe[src*='player.vimeo.com']"
      );


    log(
      `Existing Vimeo frames: ${
        existingFrames.length
      }`
    );


    /*
     * ==========================================================
     * CREATE VIMEO IFRAMES
     * ==========================================================
     */

    for (
      const videoId of
        foundVimeoIds
    ) {

      /*
       * Don't create the same player more than once.
       */

      const existing =
        document.querySelector(
          `iframe[data-eca-vimeo-id="${videoId}"]`
        );


      if (existing) {

        log(
          `Vimeo ${videoId} already exists; skipping`
        );

        continue;
      }


      /*
       * Check whether the site's own iframe already contains
       * this video.
       */

      const existingBySrc =
        Array.from(
          document.querySelectorAll(
            "iframe[src*='player.vimeo.com']"
          )
        ).find(
          iframe =>
            iframe.src.includes(
              `/video/${videoId}`
            )
        );


      if (existingBySrc) {

        log(
          `Existing Vimeo iframe already contains ${videoId}`
        );


        existingBySrc.dataset
          .ecaVimeoId =
            videoId;


        continue;
      }


      /*
       * --------------------------------------------------------
       * Create iframe
       * --------------------------------------------------------
       */

      const iframe =
        document.createElement(
          "iframe"
        );


      /*
       * Preserve the ECA site's Vimeo application ID.
       */

      iframe.src =
        `https://player.vimeo.com/video/${videoId}` +
        `?app_id=122963` +
        `&autoplay=1` +
        `&muted=1` +
        `&playsinline=1`;


      iframe.width =
        "640";


      iframe.height =
        "360";


      /*
       * --------------------------------------------------------
       * IMPORTANT:
       *
       * Don't use:
       *
       *   display:none
       *
       * Vimeo can fail to initialise correctly when its iframe
       * has no layout.
       *
       * Instead put it far outside the viewport.
       * --------------------------------------------------------
       */

      iframe.style.position =
        "fixed";


      iframe.style.left =
        "-10000px";


      iframe.style.top =
        "0";


      iframe.style.width =
        "640px";


      iframe.style.height =
        "360px";


      iframe.style.opacity =
        "0.01";


      iframe.style.pointerEvents =
        "none";


      /*
       * Vimeo permissions.
       */

      iframe.setAttribute(
        "allow",
        "autoplay; fullscreen"
      );


      iframe.setAttribute(
        "allowfullscreen",
        ""
      );


      /*
       * Mark iframe with the Vimeo ID.
       */

      iframe.dataset
        .ecaVimeoId =
          videoId;


      /*
       * --------------------------------------------------------
       * Add iframe to page.
       * --------------------------------------------------------
       */

      document.body.appendChild(
        iframe
      );


      log(
        `Created Vimeo iframe for ${videoId}`
      );


      yield {
        msg:
          `Created Vimeo iframe ${videoId}`
      };


      /*
       * Allow the child Vimeo frame to initialise.
       */

      await sleep(
        5000
      );
    }


    /*
     * ==========================================================
     * TOP-LEVEL PAGE KEEP-ALIVE
     * ==========================================================
     *
     * The actual video monitoring happens inside the Vimeo
     * iframe. This keeps the parent behaviour alive while those
     * child frames are active.
     * ==========================================================
     */

    for (
      let i = 0;
      i < 60;
      i++
    ) {

      await sleep(
        1000
      );


      const frames =
        document.querySelectorAll(
          "iframe[src*='player.vimeo.com']"
        );


      log(
        `Vimeo frames currently present: ${
          frames.length
        }`
      );


      yield {
        msg:
          `Waiting for Vimeo media (${i + 1}/60)`
      };
    }


    log(
      "ECA Vimeo behaviour completed"
    );
  }
}
