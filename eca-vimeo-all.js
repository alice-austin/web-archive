class ECAVimeoArchive {
  static id = "ECA Vimeo Archive";

  static isMatch() {
    const host = window.location.hostname;
    const path = window.location.pathname;

    // ECA portfolio pages
    if (
      host === "www.2021.graduateshow.eca.ed.ac.uk" ||
      host === "2021.graduateshow.eca.ed.ac.uk"
    ) {
      return path.startsWith("/portfolio/");
    }

    // Vimeo iframe
    if (host === "player.vimeo.com") {
      return true;
    }

    return false;
  }

  static init() {
    return {};
  }

  /*
   * Browsertrix will run this behaviour in Vimeo child frames too.
   */
  static runInIframe = true;

  async* run(ctx) {
    const { Lib } = ctx;

    const sleep =
      Lib && Lib.sleep
        ? Lib.sleep
        : (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const log = (msg) => {
      try {
        ctx.log({
          msg: `[ECA Vimeo] ${msg}`
        });
      } catch (_) {
        console.log(`[ECA Vimeo] ${msg}`);
      }
    };

    /*
     * ============================================================
     * VIMEO IFRAME
     * ============================================================
     */

    if (window.location.hostname === "player.vimeo.com") {
      log(`Entered Vimeo iframe: ${location.href}`);

      const MAX_RUNTIME = 30 * 60 * 1000;
      const STALL_LIMIT = 20;

      /*
       * ------------------------------------------------------------
       * Find the Vimeo video ID
       * ------------------------------------------------------------
       */

      function getVideoId() {
        const match =
          location.pathname.match(/\/video\/(\d+)/);

        if (match) {
          return match[1];
        }

        const params =
          new URLSearchParams(location.search);

        return (
          params.get("clip_id") ||
          params.get("video_id") ||
          params.get("id")
        );
      }

      /*
       * ------------------------------------------------------------
       * Find HTML5 video
       * ------------------------------------------------------------
       */

      function getVideo() {
        return document.querySelector("video");
      }

      /*
       * ------------------------------------------------------------
       * Fetch Vimeo's player configuration
       *
       * Vimeo exposes the actual available renditions here.
       * We are particularly interested in:
       *
       *     request.files.progressive[]
       *
       * because those are ordinary MP4 resources.
       * ------------------------------------------------------------
       */

      async function getVimeoConfig(videoId) {
        if (!videoId) {
          log("Could not determine Vimeo video ID");
          return null;
        }

        const url =
          `https://player.vimeo.com/video/${videoId}/config`;

        log(`Requesting Vimeo config: ${url}`);

        try {
          const response = await fetch(url, {
            credentials: "include",
            cache: "no-store"
          });

          if (!response.ok) {
            log(
              `Vimeo config returned HTTP ${response.status}`
            );

            return null;
          }

          return await response.json();

        } catch (err) {
          log(
            `Vimeo config request failed: ${
              err && err.message ? err.message : err
            }`
          );

          return null;
        }
      }

      /*
       * ------------------------------------------------------------
       * Extract progressive MP4 URLs
       * ------------------------------------------------------------
       */

      function getProgressiveFiles(config) {
        const progressive =
          config &&
          config.request &&
          config.request.files &&
          config.request.files.progressive;

        if (!Array.isArray(progressive)) {
          return [];
        }

        return progressive
          .filter(file => {
            return (
              file &&
              typeof file.url === "string" &&
              /^https?:\/\//i.test(file.url)
            );
          })
          .sort((a, b) => {
            return (
              (Number(b.height) || 0) -
              (Number(a.height) || 0)
            );
          });
      }

      /*
       * ------------------------------------------------------------
       * Select an MP4
       *
       * Prefer 1080p or below. This avoids accidentally selecting
       * an enormous 2K/4K resource when the archive doesn't need it.
       * ------------------------------------------------------------
       */

      function selectProgressive(files) {
        if (!files.length) {
          return null;
        }

        return (
          files.find(file =>
            (Number(file.height) || 0) <= 1080
          ) ||
          files[0]
        );
      }

      /*
       * ------------------------------------------------------------
       * Wait for the Vimeo video element
       * ------------------------------------------------------------
       */

      async function waitForVideo(timeout = 60000) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
          const video = getVideo();

          if (video) {
            return video;
          }

          await sleep(500);
        }

        return null;
      }

      /*
       * ------------------------------------------------------------
       * Install progressive MP4
       * ------------------------------------------------------------
       */

      async function installProgressiveSource() {
        const videoId = getVideoId();

        if (!videoId) {
          return null;
        }

        log(`Vimeo video ID: ${videoId}`);

        const config =
          await getVimeoConfig(videoId);

        if (!config) {
          return null;
        }

        const files =
          getProgressiveFiles(config);

        if (!files.length) {
          log(
            "No progressive MP4 files exposed by Vimeo"
          );

          return null;
        }

        log(
          `Found ${files.length} progressive MP4 rendition(s)`
        );

        for (const file of files) {
          log(
            `MP4: ${file.width || "?"}x${file.height || "?"} ` +
            `${file.url}`
          );
        }

        const selected =
          selectProgressive(files);

        log(
          `Selected MP4: ` +
          `${selected.width || "?"}x${selected.height || "?"}`
        );

        let video =
          await waitForVideo();

        if (!video) {
          log(
            "Vimeo <video> element never appeared"
          );

          return null;
        }

        /*
         * Important:
         *
         * Remove Vimeo's existing MediaSource-backed source before
         * installing the ordinary MP4 URL.
         */

        try {
          video.pause();

          video.removeAttribute("src");

          while (video.firstChild) {
            video.removeChild(
              video.firstChild
            );
          }

        } catch (_) {}

        /*
         * Force the progressive MP4.
         */

        try {
          video.preload = "auto";
          video.muted = true;
          video.setAttribute(
            "playsinline",
            ""
          );

          video.src = selected.url;

          video.load();

          log(
            "Installed progressive MP4 source"
          );

        } catch (err) {
          log(
            `Could not install MP4: ${
              err && err.message
                ? err.message
                : err
            }`
          );

          return null;
        }

        /*
         * Wait for the MP4 to become readable.
         */

        const start =
          Date.now();

        while (
          Date.now() - start <
          60000
        ) {
          video = getVideo();

          if (!video) {
            await sleep(500);
            continue;
          }

          if (
            video.readyState >= 2 &&
            Number.isFinite(video.duration)
          ) {
            log(
              `MP4 ready: duration=${video.duration.toFixed(2)}s`
            );

            return {
              video,
              url: selected.url,
              duration: video.duration
            };
          }

          await sleep(500);
        }

        log(
          "MP4 did not become ready within 60 seconds"
        );

        return {
          video,
          url: selected.url,
          duration:
            Number.isFinite(video.duration)
              ? video.duration
              : null
        };
      }

      /*
       * ------------------------------------------------------------
       * Start playback
       * ------------------------------------------------------------
       */

      let result =
        await installProgressiveSource();

      let video =
        result && result.video
          ? result.video
          : await waitForVideo();

      if (!video) {
        log(
          "ERROR: Vimeo video element not found"
        );

        return;
      }

      video.muted = true;
      video.setAttribute(
        "playsinline",
        ""
      );

      let playing = false;

      for (
        let attempt = 0;
        attempt < 20;
        attempt++
      ) {
        video = getVideo();

        if (!video) {
          await sleep(500);
          continue;
        }

        try {
          await video.play();

          if (!video.paused) {
            playing = true;
            break;
          }

        } catch (err) {
          log(
            `play() attempt ${attempt + 1} failed: ${
              err && err.message
                ? err.message
                : err
            }`
          );
        }

        await sleep(1000);
      }

      log(
        playing
          ? "Progressive MP4 playback started"
          : "WARNING: playback did not start"
      );

      /*
       * ------------------------------------------------------------
       * Keep playback alive and detect Vimeo replacing our source
       * ------------------------------------------------------------
       */

      const startTime =
        Date.now();

      let previousTime = -1;
      let stalledFor = 0;

      while (
        Date.now() - startTime <
        MAX_RUNTIME
      ) {
        await sleep(2000);

        video = getVideo();

        if (!video) {
          log(
            "Vimeo replaced the video element"
          );

          /*
           * Give Vimeo time to recreate it, then reinstall MP4.
           */

          await sleep(1000);

          if (result && result.url) {
            const replacement =
              await waitForVideo(10000);

            if (replacement) {
              try {
                replacement.pause();

                replacement.src =
                  result.url;

                replacement.preload =
                  "auto";

                replacement.muted =
                  true;

                replacement.load();

                await replacement.play();

                video =
                  replacement;

                log(
                  "Restored progressive MP4 after video replacement"
                );

              } catch (err) {
                log(
                  `Could not restore MP4: ${
                    err && err.message
                      ? err.message
                      : err
                  }`
                );
              }
            }
          }

          continue;
        }

        const currentTime =
          Number(video.currentTime) || 0;

        const duration =
          Number.isFinite(video.duration)
            ? video.duration
            : null;

        log(
          `Playback: ${currentTime.toFixed(1)}s` +
          (
            duration !== null
              ? ` / ${duration.toFixed(1)}s`
              : ""
          ) +
          ` paused=${video.paused}` +
          ` readyState=${video.readyState}`
        );

        /*
         * Completed.
         */

        if (
          video.ended ||
          (
            duration !== null &&
            currentTime >= duration - 0.5
          )
        ) {
          log(
            "Vimeo MP4 reached the end"
          );

          /*
           * Keep the page alive briefly after the end. This gives
           * Browsertrix time to finish outstanding media requests.
           */

          await sleep(5000);

          return;
        }

        /*
         * Detect stalled playback.
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
         * Recovery.
         */

        if (
          video.paused ||
          stalledFor >= 20
        ) {
          log(
            `Playback recovery: stalled=${stalledFor}s`
          );

          try {
            await video.play();
          } catch (_) {}

          if (
            video.paused &&
            result &&
            result.url
          ) {
            try {
              /*
               * Re-installing the same MP4 is more reliable than
               * allowing Vimeo to fall back to MSE.
               */

              const position =
                video.currentTime || 0;

              video.src =
                result.url;

              video.load();

              /*
               * Do not always restart at zero after a transient
               * failure.
               */

              try {
                video.currentTime =
                  position;
              } catch (_) {}

              await video.play();

              log(
                `Restarted MP4 at ${position.toFixed(1)}s`
              );

            } catch (err) {
              log(
                `MP4 recovery failed: ${
                  err && err.message
                    ? err.message
                    : err
                }`
              );
            }
          }

          stalledFor = 0;
        }

        /*
         * If Vimeo has silently switched us back to an MSE source,
         * put the progressive MP4 back.
         */

        if (
          result &&
          result.url &&
          video.currentSrc &&
          video.currentSrc !== result.url
        ) {
          log(
            `Vimeo changed currentSrc to ${video.currentSrc}`
          );

          try {
            const position =
              video.currentTime || 0;

            video.src =
              result.url;

            video.load();

            try {
              video.currentTime =
                position;
            } catch (_) {}

            await video.play();

            log(
              "Restored progressive MP4 source"
            );

          } catch (err) {
            log(
              `Could not restore MP4 source: ${
                err && err.message
                  ? err.message
                  : err
              }`
            );
          }
        }

        yield {
          msg:
            `Vimeo MP4 playback ${currentTime.toFixed(1)}s`
        };
      }

      log(
        "Reached 30-minute Vimeo safety limit"
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
     * The ECA site appears to create the Vimeo player after the
     * visitor activates the media thumbnail. Find both the image
     * and its clickable container.
     */

    const selectors = [
      ".video-image-container",
      ".video-image-container img",
      "[class*='video-image']",
      "[class*='video-image'] img",
      "[data-vimeo]",
      "[data-vimeo-id]",
      "[data-video]",
      "[data-video-id]"
    ];

    const elements = [];

    for (const selector of selectors) {
      for (
        const el of document.querySelectorAll(selector)
      ) {
        if (!elements.includes(el)) {
          elements.push(el);
        }
      }
    }

    /*
     * Turn thumbnails into their actual clickable element.
     */

    const targets = [];

    for (const el of elements) {
      const target =
        el.closest(
          "a, button, [role='button'], .video-image-container"
        ) || el;

      if (
        !targets.includes(target)
      ) {
        targets.push(target);
      }
    }

    log(
      `Found ${targets.length} possible video targets`
    );

    /*
     * Also account for Vimeo frames that are already present.
     */

    const existingFrames =
      document.querySelectorAll(
        "iframe[src*='player.vimeo.com']"
      );

    log(
      `Existing Vimeo frames: ${existingFrames.length}`
    );

    /*
     * Activate every video.
     */

    for (
      let i = 0;
      i < targets.length;
      i++
    ) {
      const target =
        targets[i];

      try {
        target.scrollIntoView({
          block: "center",
          inline: "center"
        });
      } catch (_) {}

      await sleep(1000);

      try {
        target.click();

        log(
          `Clicked ECA video ${i + 1}/${targets.length}`
        );

      } catch (err) {
        log(
          `Could not click video ${i + 1}: ${
            err && err.message
              ? err.message
              : err
          }`
        );

        continue;
      }

      yield {
        msg:
          `Activated ECA video ${i + 1}/${targets.length}`
      };

      /*
       * Don't immediately click the next video. The Vimeo iframe
       * needs time to initialise and request its config.
       */

      await sleep(5000);
    }

    /*
     * Keep the portfolio page alive for late-created iframes.
     */

    for (
      let i = 0;
      i < 30;
      i++
    ) {
      await sleep(1000);

      const frames =
        document.querySelectorAll(
          "iframe[src*='player.vimeo.com']"
        );

      log(
        `Vimeo frames currently present: ${frames.length}`
      );

      yield {
        msg:
          `Waiting for Vimeo media (${i + 1}/30)`
      };
    }

    log(
      "ECA Vimeo behaviour completed"
    );
  }
}
