class ECAVimeoAll {
  static id = "ECA Graduate Show Vimeo";

  static isMatch() {
    const host = window.location.hostname;
    const path = window.location.pathname;

    // Top-level ECA portfolio pages only.
    if (
      host === "www.2021.graduateshow.eca.ed.ac.uk" ||
      host === "2021.graduateshow.eca.ed.ac.uk"
    ) {
      return path.startsWith("/portfolio/");
    }

    // Run inside Vimeo players.
    if (host === "player.vimeo.com") {
      return true;
    }

    return false;
  }

  static init() {
    return {};
  }

  static runInIframe = true;

  async* run(ctx) {
    const { Lib } = ctx;

    const sleep =
      Lib && Lib.sleep
        ? Lib.sleep
        : (ms) =>
            new Promise((resolve) =>
              setTimeout(resolve, ms)
            );

    const log = (msg) => {
      ctx.log({
        msg: `[ECA Vimeo] ${msg}`
      });
    };

    /*
     * ============================================================
     * VIMEO PLAYER
     * ============================================================
     */

    if (
      window.location.hostname === "player.vimeo.com"
    ) {
      log("Entered Vimeo player iframe");

      const getVideo = () =>
        document.querySelector("video");

      const getPlayButtons = () => {
        const selectors = [
          'button[aria-label="Play"]',
          'button[aria-label*="Play" i]',
          '[role="button"][aria-label*="Play" i]',
          '[aria-label="Play"]',
          ".vp-play-button",
          ".PlayButton_module_playButtonWrapper__d6312f47"
        ];

        const results = [];

        for (const selector of selectors) {
          for (
            const el of document.querySelectorAll(selector)
          ) {
            const rect =
              el.getBoundingClientRect();

            if (
              rect.width > 0 &&
              rect.height > 0 &&
              !results.includes(el)
            ) {
              results.push(el);
            }
          }
        }

        return results;
      };

      const clickElement = (el) => {
        if (!el) {
          return false;
        }

        try {
          el.scrollIntoView({
            block: "center",
            inline: "center"
          });
        } catch (_) {}

        try {
          el.click();
          return true;
        } catch (_) {}

        return false;
      };

      /*
       * ----------------------------------------------------------
       * WAIT FOR VIDEO ELEMENT
       * ----------------------------------------------------------
       */

      let video = null;

      for (let i = 0; i < 60; i++) {
        video = getVideo();

        if (video) {
          log(
            `Found HTML5 video: ` +
            `readyState=${video.readyState}`
          );

          break;
        }

        await sleep(500);
      }

      if (!video) {
        log("ERROR: no HTML5 video found");
        return;
      }

      /*
       * ----------------------------------------------------------
       * WAIT FOR MEDIA TO LOAD
       * ----------------------------------------------------------
       *
       * readyState 0 means HAVE_NOTHING.
       *
       * We previously tried to play immediately at this point.
       * Instead, wait for Vimeo to initialise the media.
       */

      for (let i = 0; i < 60; i++) {
        video = getVideo();

        if (!video) {
          await sleep(500);
          continue;
        }

        log(
          `Waiting for video readiness: ` +
          `readyState=${video.readyState} ` +
          `networkState=${video.networkState}`
        );

        if (video.readyState >= 2) {
          log(
            `Video is ready: readyState=${video.readyState}`
          );

          break;
        }

        await sleep(500);
      }

      /*
       * ----------------------------------------------------------
       * START PLAYBACK
       * ----------------------------------------------------------
       */

      let playing = false;

      for (let attempt = 0; attempt < 15; attempt++) {
        video = getVideo();

        if (!video) {
          await sleep(500);
          continue;
        }

        log(
          `Play attempt ${attempt + 1}: ` +
          `time=${video.currentTime.toFixed(2)} ` +
          `paused=${video.paused} ` +
          `ended=${video.ended} ` +
          `readyState=${video.readyState}`
        );

        if (!video.paused) {
          playing = true;
          break;
        }

        /*
         * Try HTML5 play().
         */
        try {
          await video.play();

          if (!video.paused) {
            log("video.play() succeeded");
            playing = true;
            break;
          }
        } catch (err) {
          log(
            `video.play() rejected: ${
              err.message || err
            }`
          );
        }

        /*
         * Try visible Vimeo Play controls.
         */
        const buttons = getPlayButtons();

        for (const button of buttons) {
          log(
            `Clicking Vimeo Play control`
          );

          clickElement(button);

          await sleep(1000);

          video = getVideo();

          if (video && !video.paused) {
            log(
              "Vimeo started after Play button click"
            );

            playing = true;
            break;
          }
        }

        if (playing) {
          break;
        }

        await sleep(1000);
      }

      if (!playing) {
        log(
          "WARNING: unable to start Vimeo playback"
        );
      }

      /*
       * ----------------------------------------------------------
       * MONITOR PLAYBACK
       * ----------------------------------------------------------
       *
       * 15-minute safety limit.
       */

      let lastTime = video.currentTime;
      let stalledFor = 0;

      for (let i = 0; i < 180; i++) {
        await sleep(5000);

        video = getVideo();

        if (!video) {
          log(
            "Video element disappeared; waiting for replacement"
          );

          continue;
        }

        const currentTime =
          video.currentTime;

        const duration =
          Number.isFinite(video.duration)
            ? video.duration
            : null;

        log(
          `video state: ` +
          `time=${currentTime.toFixed(2)} ` +
          `duration=${
            duration !== null
              ? duration.toFixed(2)
              : "unknown"
          } ` +
          `paused=${video.paused} ` +
          `ended=${video.ended} ` +
          `readyState=${video.readyState}`
        );

        /*
         * Finished.
         */
        if (video.ended) {
          log(
            "Vimeo video finished"
          );

          return;
        }

        /*
         * Detect movement.
         */
        if (currentTime > lastTime + 0.2) {
          stalledFor = 0;
        } else {
          stalledFor += 5;
        }

        lastTime = currentTime;

        /*
         * Vimeo paused.
         */
        if (video.paused) {
          log(
            "Vimeo paused — attempting resume"
          );

          try {
            await video.play();
          } catch (_) {}

          await sleep(500);

          if (video.paused) {
            const buttons =
              getPlayButtons();

            for (const button of buttons) {
              clickElement(button);

              await sleep(500);

              if (!video.paused) {
                break;
              }
            }
          }
        }

        /*
         * Vimeo hasn't advanced for 10 seconds.
         */
        if (
          stalledFor >= 10 &&
          !video.ended
        ) {
          log(
            "Playback stalled — attempting recovery"
          );

          try {
            await video.play();
          } catch (_) {}

          if (video.paused) {
            const buttons =
              getPlayButtons();

            for (const button of buttons) {
              clickElement(button);

              await sleep(500);

              if (!video.paused) {
                break;
              }
            }
          }

          stalledFor = 0;
        }

        yield {
          msg:
            `Vimeo playback ${currentTime.toFixed(1)}s`
        };
      }

      log(
        "Reached Vimeo 15-minute safety limit"
      );

      return;
    }

    /*
     * ============================================================
     * ECA PORTFOLIO PAGE
     * ============================================================
     */

    log(
      `Running on ECA portfolio page: ${window.location.pathname}`
    );

    /*
     * Find ECA video thumbnails.
     */

    const selectors = [
      ".video-image-container img",
      "[class*='video-image'] img",
      "[data-vimeo] img",
      "[data-vimeo-id] img",
      "[data-video] img",
      "[data-video-id] img"
    ];

    const thumbnails = [];

    for (const selector of selectors) {
      for (
        const el of document.querySelectorAll(selector)
      ) {
        const rect =
          el.getBoundingClientRect();

        if (
          rect.width >= 100 &&
          rect.height >= 50 &&
          !thumbnails.includes(el)
        ) {
          thumbnails.push(el);
        }
      }
    }

    log(
      `Found ${thumbnails.length} possible video thumbnail(s)`
    );

    if (!thumbnails.length) {
      return;
    }

    /*
     * ----------------------------------------------------------
     * PROCESS THUMBNAILS
     * ----------------------------------------------------------
     */

    for (
      let index = 0;
      index < thumbnails.length;
      index++
    ) {
      const thumbnail = thumbnails[index];

      log(
        `Processing video ${index + 1}/${thumbnails.length}`
      );

      try {
        thumbnail.scrollIntoView({
          block: "center",
          inline: "center"
        });
      } catch (_) {}

      await sleep(500);

      /*
       * FIRST CLICK:
       *
       * ECA thumbnail → /media/oembed
       */

      try {
        thumbnail.click();

        log(
          "Clicked ECA video thumbnail"
        );
      } catch (err) {
        log(
          `Thumbnail click failed: ${
            err.message || err
          }`
        );

        continue;
      }

      yield {
        msg:
          `Clicked video ${index + 1}/${thumbnails.length}`
      };

      /*
       * --------------------------------------------------------
       * IMPORTANT:
       *
       * Do NOT try to discover the Vimeo iframe here.
       *
       * Browsertrix's runInIframe mechanism is already detecting
       * and executing this behavior inside the Vimeo iframe.
       *
       * We simply give the iframe time to initialise and play.
       * --------------------------------------------------------
       */

      await sleep(10000);

      log(
        `Allowing Vimeo video ${index + 1} time to initialise`
      );

      /*
       * If the page has multiple videos, allow the current
       * iframe to continue operating before opening the next.
       */
      await sleep(5000);

      yield {
        msg:
          `Finished activating video ${index + 1}/${thumbnails.length}`
      };
    }

    log(
      `Finished processing ${thumbnails.length} video(s)`
    );

    yield {
      msg:
        `Processed ${thumbnails.length} ECA video(s)`
    };
  }
}
