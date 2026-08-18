class ECAVimeoAll {
  static id = "ECA Graduate Show Vimeo";

  static isMatch() {
    const host = window.location.hostname;
    const path = window.location.pathname;

    /*
     * Only run on actual ECA portfolio pages at the top level,
     * or inside actual Vimeo player frames.
     *
     * IMPORTANT:
     * Do NOT match /media/oembed here. Those are intermediate
     * ECA frames and are handled by the parent page.
     */
    if (
      host === "www.2021.graduateshow.eca.ed.ac.uk" ||
      host === "2021.graduateshow.eca.ed.ac.uk"
    ) {
      return path.startsWith("/portfolio/");
    }

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
            new Promise((resolve) => setTimeout(resolve, ms));

    const log = (msg) => {
      ctx.log({
        msg: `[ECA Vimeo] ${msg}`
      });
    };

    /*
     * ============================================================
     * VIMEO PLAYER
     * ============================================================
     *
     * This executes inside player.vimeo.com.
     */

    if (
      window.location.hostname === "player.vimeo.com"
    ) {
      log("Entered Vimeo player iframe");

      const getVideo = () =>
        document.querySelector("video");

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

      const findPlayControls = () => {
        const selectors = [
          'button[aria-label="Play"]',
          'button[aria-label*="Play" i]',
          '[role="button"][aria-label*="Play" i]',
          '[aria-label="Play"]',
          ".vp-play-button",
          ".PlayButton_module_playButtonWrapper__d6312f47",
          ".vp-target"
        ];

        const found = [];

        for (const selector of selectors) {
          for (const el of document.querySelectorAll(selector)) {
            const rect =
              el.getBoundingClientRect();

            if (
              rect.width > 0 &&
              rect.height > 0 &&
              !found.includes(el)
            ) {
              found.push(el);
            }
          }
        }

        return found;
      };

      /*
       * Wait for Vimeo's HTML5 video.
       */
      let video = null;

      for (let i = 0; i < 60; i++) {
        video = getVideo();

        if (video) {
          log(
            `Found HTML5 video: readyState=${video.readyState}`
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
       * ========================================================
       * INITIAL PLAY
       * ========================================================
       */

      for (let attempt = 0; attempt < 10; attempt++) {
        video = getVideo();

        if (!video) {
          await sleep(500);
          continue;
        }

        log(
          `Initial state: ` +
          `time=${video.currentTime.toFixed(2)} ` +
          `paused=${video.paused} ` +
          `ended=${video.ended} ` +
          `readyState=${video.readyState}`
        );

        if (!video.paused) {
          log("Vimeo is already playing");
          break;
        }

        /*
         * First try the actual video element.
         */
        try {
          await video.play();

          log("video.play() succeeded");
        } catch (err) {
          log(
            `video.play() rejected: ${
              err.message || err
            }`
          );
        }

        if (!video.paused) {
          break;
        }

        /*
         * Then try visible Vimeo controls.
         */
        const controls = findPlayControls();

        for (const control of controls) {
          log(
            `Trying Vimeo control: ${
              control.className || control.tagName
            }`
          );

          clickElement(control);

          await sleep(500);

          video = getVideo();

          if (video && !video.paused) {
            log("Vimeo started playing");
            break;
          }
        }

        if (video && !video.paused) {
          break;
        }

        await sleep(1000);
      }

      /*
       * ========================================================
       * MONITOR PLAYBACK
       * ========================================================
       *
       * Up to 15 minutes.
       */

      let lastTime = video.currentTime;
      let stalledSeconds = 0;

      for (let i = 0; i < 180; i++) {
        await sleep(5000);

        video = getVideo();

        if (!video) {
          log("Video element disappeared");
          continue;
        }

        const currentTime =
          video.currentTime;

        const duration =
          Number.isFinite(video.duration)
            ? video.duration
            : null;

        const paused = video.paused;
        const ended = video.ended;

        log(
          `video state: ` +
          `time=${currentTime.toFixed(2)} ` +
          `duration=${
            duration !== null
              ? duration.toFixed(2)
              : "unknown"
          } ` +
          `paused=${paused} ` +
          `ended=${ended} ` +
          `readyState=${video.readyState}`
        );

        if (ended) {
          log("Vimeo video finished");
          return;
        }

        /*
         * Detect progress.
         */
        if (currentTime > lastTime + 0.2) {
          stalledSeconds = 0;
        } else {
          stalledSeconds += 5;
        }

        lastTime = currentTime;

        /*
         * If Vimeo has paused, resume it.
         */
        if (paused && !ended) {
          log(
            "Vimeo paused — attempting resume"
          );

          try {
            await video.play();
          } catch (_) {}

          await sleep(500);

          if (video.paused) {
            const controls =
              findPlayControls();

            for (const control of controls) {
              clickElement(control);

              await sleep(500);

              if (!video.paused) {
                break;
              }
            }
          }
        }

        /*
         * Recover from a genuine stall.
         */
        if (
          stalledSeconds >= 10 &&
          !ended
        ) {
          log(
            "Playback stalled — attempting recovery"
          );

          try {
            await video.play();
          } catch (_) {}

          if (video.paused) {
            const controls =
              findPlayControls();

            for (const control of controls) {
              clickElement(control);

              await sleep(500);

              if (!video.paused) {
                break;
              }
            }
          }

          stalledSeconds = 0;
        }

        yield {
          msg:
            `Vimeo playback ${currentTime.toFixed(1)}s`
        };
      }

      log(
        "Reached 15-minute Vimeo safety limit"
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
     * Find video thumbnails.
     *
     * We deliberately avoid section numbers because the
     * recordings showed section 3 and section 6.
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
     * ========================================================
     * PROCESS EACH VIDEO
     * ========================================================
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

      /*
       * Record the player.vimeo.com frames that exist before
       * opening this video.
       */
      const existingPlayerFrames =
        new Set(
          Array.from(
            document.querySelectorAll(
              'iframe[src*="player.vimeo.com"]'
            )
          )
        );

      /*
       * Record ECA oEmbed frames too.
       */
      const existingOembedFrames =
        new Set(
          Array.from(
            document.querySelectorAll(
              'iframe[src*="/media/oembed"]'
            )
          )
        );

      /*
       * Scroll thumbnail into view.
       */
      try {
        thumbnail.scrollIntoView({
          block: "center",
          inline: "center"
        });
      } catch (_) {}

      await sleep(500);

      /*
       * ======================================================
       * CLICK 1 — ECA VIDEO THUMBNAIL
       * ======================================================
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
       * ======================================================
       * WAIT FOR ECA OEmbed OR DIRECT VIMEO
       * ======================================================
       */

      let oembedFrame = null;
      let playerFrame = null;

      for (let attempt = 0; attempt < 30; attempt++) {
        /*
         * First look for a NEW direct Vimeo player.
         */
        const players =
          Array.from(
            document.querySelectorAll(
              'iframe[src*="player.vimeo.com"]'
            )
          );

        playerFrame =
          players.find(
            (frame) =>
              !existingPlayerFrames.has(frame)
          ) || null;

        if (playerFrame) {
          log(
            `Found direct Vimeo player: ${playerFrame.src}`
          );

          break;
        }

        /*
         * Otherwise look for the ECA oEmbed iframe.
         */
        const oembeds =
          Array.from(
            document.querySelectorAll(
              'iframe[src*="/media/oembed"]'
            )
          );

        oembedFrame =
          oembeds.find(
            (frame) =>
              !existingOembedFrames.has(frame)
          ) || null;

        if (oembedFrame) {
          log(
            `Found ECA oEmbed iframe: ${oembedFrame.src}`
          );

          break;
        }

        await sleep(500);
      }

      /*
       * ======================================================
       * DIRECT VIMEO CASE
       * ======================================================
       */

      if (playerFrame) {
        try {
          playerFrame.scrollIntoView({
            block: "center",
            inline: "center"
          });
        } catch (_) {}

        await sleep(500);

        try {
          playerFrame.click();

          log(
            "Clicked direct Vimeo iframe"
          );
        } catch (_) {}

        await sleep(2000);

        continue;
      }

      /*
       * ======================================================
       * ECA OEmbed CASE
       * ======================================================
       */

      if (oembedFrame) {
        try {
          oembedFrame.scrollIntoView({
            block: "center",
            inline: "center"
          });
        } catch (_) {}

        await sleep(500);

        /*
         * This corresponds to the Gisela Recorder's
         * intermediate iframe click.
         */
        try {
          oembedFrame.click();

          log(
            "Clicked ECA oEmbed iframe"
          );
        } catch (_) {
          log(
            "Could not directly click oEmbed iframe"
          );
        }

        /*
         * Now wait for the REAL Vimeo player to appear.
         */
        for (
          let attempt = 0;
          attempt < 30;
          attempt++
        ) {
          const players =
            Array.from(
              document.querySelectorAll(
                'iframe[src*="player.vimeo.com"]'
              )
            );

          playerFrame =
            players.find(
              (frame) =>
                !existingPlayerFrames.has(frame)
            ) || null;

          if (playerFrame) {
            log(
              `Found nested Vimeo player: ${playerFrame.src}`
            );

            break;
          }

          /*
           * Also check inside the oEmbed iframe.
           *
           * This is useful if the browser exposes the
           * frame's DOM to the parent.
           */
          try {
            if (
              oembedFrame.contentDocument
            ) {
              playerFrame =
                oembedFrame.contentDocument.querySelector(
                  'iframe[src*="player.vimeo.com"]'
                );

              if (playerFrame) {
                log(
                  `Found Vimeo player inside oEmbed iframe: ${
                    playerFrame.src
                  }`
                );

                break;
              }
            }
          } catch (_) {
            /*
             * Cross-origin access is expected to fail here.
             */
          }

          await sleep(500);
        }
      }

      /*
       * ======================================================
       * RESULT
       * ======================================================
       */

      if (playerFrame) {
        log(
          `Activating Vimeo player ${index + 1}`
        );

        try {
          playerFrame.scrollIntoView({
            block: "center",
            inline: "center"
          });
        } catch (_) {}

        await sleep(500);

        try {
          playerFrame.click();

          log(
            "Clicked Vimeo player iframe"
          );
        } catch (_) {}

        /*
         * Give the iframe behavior time to initialise.
         */
        await sleep(3000);

        yield {
          msg:
            `Activated Vimeo video ${index + 1}/${thumbnails.length}`
        };
      } else {
        log(
          `WARNING: could not find player.vimeo.com iframe for video ${
            index + 1
          }`
        );
      }

      /*
       * Give the current video a chance to start before
       * opening another one.
       */
      await sleep(5000);
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
