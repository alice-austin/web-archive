/*
 * ECA Graduate Show — Vimeo archival behaviour
 *
 * Target:
 *   https://www.2021.graduateshow.eca.ed.ac.uk/portfolio/*
 *
 * Purpose:
 *   - Discover Vimeo videos embedded in ECA portfolio pages.
 *   - Create proper Vimeo player iframes directly.
 *   - Allow Vimeo to initialise its normal media pipeline.
 *   - Start playback automatically.
 *   - Keep playback running until the video ends.
 *   - Recover from stalls / Vimeo replacing the <video> element.
 *   - Avoid the Vimeo /config endpoint, which returns HTTP 403.
 *
 * Browsertrix notes:
 *   - Run with autoplay/autofetch enabled.
 *   - Set the behaviour timeout high enough for the longest video.
 */

class ECAVimeoArchive {
  static id = "ECA Vimeo Archive";

  static isMatch() {
    const host = window.location.hostname;
    const path = window.location.pathname;

    /*
     * ECA portfolio pages.
     */
    if (
      host === "www.2021.graduateshow.eca.ed.ac.uk" ||
      host === "2021.graduateshow.eca.ed.ac.uk"
    ) {
      return path.startsWith("/portfolio/");
    }

    /*
     * Vimeo child frames.
     */
    if (
      host === "player.vimeo.com"
    ) {
      return true;
    }

    return false;
  }

  static init() {
    return {};
  }

  /*
   * The Vimeo part of the behaviour must also run in child frames.
   */
  static runInIframe = true;

  async* run(ctx) {
    /*
     * ------------------------------------------------------------
     * Utilities
     * ------------------------------------------------------------
     */

    const sleep = (ms) =>
      new Promise(resolve =>
        setTimeout(resolve, ms)
      );

    const log = (msg) => {
      try {
        ctx.log({
          msg: `[ECA Vimeo] ${msg}`
        });
      } catch (_) {
        console.log(
          `[ECA Vimeo] ${msg}`
        );
      }
    };

    /*
     * Maximum amount of time we'll allow an individual Vimeo
     * iframe to run.
     *
     * Increase this if you have exceptionally long videos.
     */
    const MAX_VIMEO_RUNTIME =
      30 * 60 * 1000;

    /*
     * Number of seconds without currentTime advancing before
     * we consider playback stalled.
     */
    const STALL_LIMIT = 20;


    /*
     * ============================================================
     * VIMEO IFRAME
     * ============================================================
     */

    if (
      window.location.hostname ===
      "player.vimeo.com"
    ) {
      log(
        `Entered Vimeo iframe: ${location.href}`
      );

      /*
       * ----------------------------------------------------------
       * Vimeo video ID
       * ----------------------------------------------------------
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
          params.get("clip_id") ||
          params.get("video_id") ||
          params.get("id") ||
          null
        );
      }


      /*
       * ----------------------------------------------------------
       * HTML5 video element
       * ----------------------------------------------------------
       */

      function getVideo() {
        return document.querySelector(
          "video"
        );
      }


      /*
       * ----------------------------------------------------------
       * Wait for Vimeo to create its <video>.
       *
       * Vimeo can initialise asynchronously, so don't assume the
       * element exists immediately after the iframe loads.
       * ----------------------------------------------------------
       */

      async function waitForVideo(
        timeout = 60000
      ) {
        const started =
          Date.now();

        while (
          Date.now() - started <
          timeout
        ) {
          const video =
            getVideo();

          if (video) {
            return video;
          }

          await sleep(500);
        }

        return null;
      }


      /*
       * ----------------------------------------------------------
       * Attempt to click Vimeo's play control.
       *
       * Usually video.play() is sufficient, but this provides a
       * fallback for Vimeo's UI.
       * ----------------------------------------------------------
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
          const selector of selectors
        ) {
          const buttons =
            document.querySelectorAll(
              selector
            );

          for (
            const button of buttons
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
       * ----------------------------------------------------------
       * Get Vimeo ID
       * ----------------------------------------------------------
       */

      const videoId =
        getVideoId();

      log(
        `Vimeo video ID: ${
          videoId || "UNKNOWN"
        }`
      );

      if (!videoId) {
        log(
          "ERROR: could not determine Vimeo video ID"
        );

        return;
      }


      /*
       * ----------------------------------------------------------
       * IMPORTANT:
       *
       * Do NOT call:
       *
       *   https://player.vimeo.com/video/{id}/config
       *
       * The iframe environment returned HTTP 403 for that request.
       *
       * Instead we let Vimeo's own player initialise normally.
       * Browsertrix's autoplay/autofetch behaviour can then capture
       * the actual media requests generated by the player.
       * ----------------------------------------------------------
       */


      /*
       * ----------------------------------------------------------
       * Wait for the Vimeo video element.
       * ----------------------------------------------------------
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
       * ----------------------------------------------------------
       * Configure HTML5 playback.
       * ----------------------------------------------------------
       */

      try {
        video.muted = true;
        video.autoplay = true;
        video.preload = "auto";

        video.setAttribute(
          "playsinline",
          ""
        );

      } catch (_) {}


      /*
       * ----------------------------------------------------------
       * Give Vimeo a few seconds to initialise its actual source.
       * ----------------------------------------------------------
       */

      await sleep(3000);

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
       * ----------------------------------------------------------
       * Report Vimeo's actual media state.
       *
       * This is particularly useful when diagnosing whether Vimeo
       * is using:
       *
       *   - a normal MP4 URL
       *   - a blob:/MediaSource URL
       *   - or no source yet.
       * ----------------------------------------------------------
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


      /*
       * ----------------------------------------------------------
       * Start playback.
       * ----------------------------------------------------------
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
          await sleep(500);
          continue;
        }

        try {
          video.muted = true;

          await video.play();

          if (!video.paused) {
            playing = true;
            break;
          }

        } catch (err) {
          log(
            `play() attempt ${attempt} failed: ${
              err && err.message
                ? err.message
                : err
            }`
          );
        }

        /*
         * Give Vimeo's own controls a chance.
         */
        clickPlay();

        await sleep(1000);
      }

      log(
        playing
          ? "Vimeo playback started"
          : "WARNING: Vimeo playback did not start"
      );


      /*
       * ----------------------------------------------------------
       * Monitor playback.
       *
       * We deliberately do NOT replace currentSrc here.
       *
       * If Vimeo is using:
       *
       *   blob:https://player.vimeo.com/...
       *
       * that is expected for a MediaSource-based player.
       *
       * Our objective is to keep Chromium consuming the stream so
       * Browsertrix can capture the underlying network requests.
       * ----------------------------------------------------------
       */

      const startedAt =
        Date.now();

      let previousTime =
        -1;

      let stalledFor =
        0;


      while (
        Date.now() - startedAt <
        MAX_VIMEO_RUNTIME
      ) {
        await sleep(2000);

        video =
          getVideo();


        /*
         * --------------------------------------------------------
         * Vimeo replaced its <video> element.
         * --------------------------------------------------------
         */

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
            video.muted = true;
            video.autoplay = true;
            video.preload = "auto";

            video.setAttribute(
              "playsinline",
              ""
            );

            await video.play();

            log(
              "Restarted replacement Vimeo video"
            );

          } catch (err) {
            log(
              `Could not restart replacement video: ${
                err && err.message
                  ? err.message
                  : err
              }`
            );
          }

          continue;
        }


        /*
         * --------------------------------------------------------
         * Playback state.
         * --------------------------------------------------------
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
         * Determine how much media Vimeo says it has buffered.
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
                video.buffered.length - 1
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
         * --------------------------------------------------------
         * Finished.
         * --------------------------------------------------------
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
           * Keep the page alive briefly so that outstanding media
           * requests can finish being written to the WARC.
           */
          await sleep(10000);

          return;
        }


        /*
         * --------------------------------------------------------
         * Detect stalled playback.
         * --------------------------------------------------------
         */

        if (
          previousTime >= 0 &&
          currentTime <=
            previousTime + 0.05
        ) {
          stalledFor += 2;

        } else {
          stalledFor = 0;
        }

        previousTime =
          currentTime;


        /*
         * --------------------------------------------------------
         * Recover from a stall.
         * --------------------------------------------------------
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
            await video.play();
          } catch (_) {}

          if (
            video.paused
          ) {
            clickPlay();
          }

          stalledFor = 0;
        }


        /*
         * --------------------------------------------------------
         * Yield status to Browsertrix.
         * --------------------------------------------------------
         */

        yield {
          msg:
            `Vimeo playback ` +
            `${currentTime.toFixed(1)}s`
        };
      }


      /*
       * ----------------------------------------------------------
       * Safety timeout.
       * ----------------------------------------------------------
       */

      log(
        "Reached Vimeo 30-minute safety limit"
      );

      return;
    }


    /*
     * ============================================================
     * ECA PORTFOLIO PAGE
     * ============================================================
     */

    log(
      `Running ECA page: ${location.href}`
    );


    /*
     * ------------------------------------------------------------
     * Search the page source for Vimeo URLs.
     *
     * This is more reliable than trying to guess which ECA DOM
     * element needs clicking.
     * ------------------------------------------------------------
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
         */
        /(?:^|[^a-z])vimeo\.com\/(?:video\/)?(\d+)/gi
      ];


      for (
        const regex of patterns
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
     * ------------------------------------------------------------
     * Search complete HTML.
     * ------------------------------------------------------------
     */

    findVimeoIdsInText(
      document.documentElement.outerHTML
    );


    /*
     * ------------------------------------------------------------
     * Search element attributes.
     * ------------------------------------------------------------
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
     * ------------------------------------------------------------
     * Search inline JavaScript.
     * ------------------------------------------------------------
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


    log(
      `Discovered Vimeo IDs: ${
        Array.from(
          foundVimeoIds
        ).join(", ") ||
        "NONE"
      }`
    );


    /*
     * ------------------------------------------------------------
     * No Vimeo IDs found.
     * ------------------------------------------------------------
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
     * ------------------------------------------------------------
     * Check for Vimeo frames already present.
     * ------------------------------------------------------------
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
     * ------------------------------------------------------------
     * Create Vimeo iframes directly.
     *
     * The ECA site uses:
     *
     *   app_id=122963
     *
     * Preserve that parameter.
     * ------------------------------------------------------------
     */

    for (
      const videoId of
        foundVimeoIds
    ) {
      /*
       * Avoid creating the same iframe twice.
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


      const iframe =
        document.createElement(
          "iframe"
        );


      /*
       * Use the same Vimeo application ID seen in the original
       * ECA embed.
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
       * Don't use display:none.
       *
       * Vimeo/player code can behave differently when the iframe
       * has no layout.
       *
       * Put it well off-screen instead.
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
       * Required permissions for Vimeo playback.
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
       * Mark this iframe so we don't create it again.
       */

      iframe.dataset.ecaVimeoId =
        videoId;


      /*
       * Append to page.
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
       * Allow the child frame to initialise.
       */

      await sleep(5000);
    }


    /*
     * ------------------------------------------------------------
     * Keep top-level page alive.
     *
     * Vimeo playback itself is handled by the child-frame section
     * above.
     * ------------------------------------------------------------
     */

    for (
      let i = 0;
      i < 60;
      i++
    ) {
      await sleep(1000);

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
