class ECAVimeoAll {
  static id = "ECA Graduate Show Vimeo";

  static isMatch() {
    const host = window.location.hostname;

    return (
      host === "www.2021.graduateshow.eca.ed.ac.uk" ||
      host === "2021.graduateshow.eca.ed.ac.uk" ||
      host === "player.vimeo.com" ||
      host === "vimeo.com"
    );
  }

  static init() {
    return {};
  }

  /*
   * Run in the top-level ECA page AND inside Vimeo iframes.
   */
  static runInIframe = true;

  async* run(ctx) {
    const { Lib } = ctx;

    const sleep = Lib.sleep || (
      ms => new Promise(resolve => setTimeout(resolve, ms))
    );

    const log = (msg) => {
      ctx.log({
        msg: `[ECA Vimeo] ${msg}`
      });
    };

    /*
     * ============================================================
     * VIMEO FRAME
     * ============================================================
     *
     * This section runs inside player.vimeo.com.
     *
     * We deliberately support several versions/states of the
     * Vimeo player because the two Recorder recordings showed
     * different player controls.
     */

    if (
      window.location.hostname === "player.vimeo.com" ||
      window.location.hostname === "vimeo.com"
    ) {
      log("Entered Vimeo iframe");

      const getVideo = () => document.querySelector("video");

      const getPlayControls = () => {
        const selectors = [
          'button[aria-label="Play"]',
          'button[aria-label*="Play" i]',
          '[role="button"][aria-label*="Play" i]',
          '[aria-label="Play"]',
          '.PlayButton_module_playButtonWrapper__d6312f47',
          '.vp-target',
          '.vp-play-button',
          '.play-button'
        ];

        const result = [];

        for (const selector of selectors) {
          for (const el of document.querySelectorAll(selector)) {
            const rect = el.getBoundingClientRect();

            if (
              rect.width > 0 &&
              rect.height > 0
            ) {
              result.push(el);
            }
          }
        }

        return result;
      };

      const clickElement = (el) => {
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

        try {
          const rect = el.getBoundingClientRect();

          const options = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          };

          el.dispatchEvent(new PointerEvent(
            "pointerdown",
            options
          ));

          el.dispatchEvent(new MouseEvent(
            "mousedown",
            options
          ));

          el.dispatchEvent(new PointerEvent(
            "pointerup",
            options
          ));

          el.dispatchEvent(new MouseEvent(
            "mouseup",
            options
          ));

          el.dispatchEvent(new MouseEvent(
            "click",
            options
          ));

          return true;
        } catch (_) {}

        return false;
      };

      /*
       * Wait for the actual HTML5 video element.
       */
      let video = null;

      for (let i = 0; i < 30; i++) {
        video = getVideo();

        if (video) {
          log("Found Vimeo HTML5 video element");
          break;
        }

        await sleep(1000);
      }

      if (!video) {
        log("No Vimeo video element found");

        yield {
          msg: "No Vimeo video element found"
        };

        return;
      }

      /*
       * ========================================================
       * INITIAL PLAY
       * ========================================================
       */

      let started = false;

      for (let attempt = 0; attempt < 10; attempt++) {
        video = getVideo();

        if (!video) {
          await sleep(1000);
          continue;
        }

        log(
          `Initial video state: ` +
          `time=${video.currentTime.toFixed(2)} ` +
          `paused=${video.paused} ` +
          `readyState=${video.readyState}`
        );

        /*
         * First try the actual HTML5 video API.
         *
         * This is especially useful after the real click has
         * already established Vimeo's user interaction state.
         */
        if (video.paused && !video.ended) {
          try {
            await video.play();

            started = true;

            log("video.play() succeeded");
          } catch (err) {
            log(
              `video.play() rejected: ${err.message || err}`
            );
          }
        }

        /*
         * If that didn't work, use Vimeo's visible controls.
         *
         * Recorder showed both:
         *
         *   aria/Play
         *
         * and:
         *
         *   div.vp-target
         */
        if (video.paused && !video.ended) {
          const controls = getPlayControls();

          for (const control of controls) {
            if (clickElement(control)) {
              log(
                `Clicked Vimeo control: ${control.className || control.tagName}`
              );

              await sleep(1000);

              if (!video.paused) {
                started = true;
                break;
              }
            }
          }
        }

        if (!video.paused) {
          started = true;
          break;
        }

        await sleep(1000);
      }

      /*
       * Give Vimeo a little time to begin requesting media.
       */
      await sleep(3000);

      /*
       * ========================================================
       * PLAYBACK MONITOR
       * ========================================================
       *
       * Rather than waiting an arbitrary 60/120 seconds, monitor
       * the actual video.
       *
       * This means a 30-second video can finish normally while a
       * 4-minute video gets the time it needs.
       */

      let lastTime = video.currentTime;
      let stalledFor = 0;

      /*
       * Maximum safety limit: 15 minutes per Vimeo video.
       */
      const maxChecks = 180;

      for (let i = 0; i < maxChecks; i++) {
        await sleep(5000);

        video = getVideo();

        if (!video) {
          log("Vimeo video element disappeared");

          /*
           * Vimeo occasionally recreates its <video> element.
           * Wait for the replacement.
           */
          for (let j = 0; j < 10; j++) {
            await sleep(1000);

            video = getVideo();

            if (video) {
              log("Vimeo video element recreated");
              break;
            }
          }

          continue;
        }

        const currentTime = video.currentTime;
        const paused = video.paused;
        const ended = video.ended;

        log(
          `video state: ` +
          `time=${currentTime.toFixed(2)} ` +
          `duration=${
            Number.isFinite(video.duration)
              ? video.duration.toFixed(2)
              : "unknown"
          } ` +
          `paused=${paused} ` +
          `ended=${ended} ` +
          `readyState=${video.readyState}`
        );

        /*
         * Normal completion.
         */
        if (ended) {
          log("Vimeo video finished");

          yield {
            msg: "Vimeo video finished"
          };

          return;
        }

        /*
         * Detect progress.
         */
        if (currentTime > lastTime + 0.2) {
          stalledFor = 0;
        } else {
          stalledFor += 5;
        }

        lastTime = currentTime;

        /*
         * ======================================================
         * RESUME PAUSED PLAYBACK
         * ======================================================
         */

        if (paused) {
          log("Vimeo playback is paused — attempting resume");

          let resumed = false;

          try {
            await video.play();

            resumed = true;

            log("video.play() successfully resumed playback");
          } catch (err) {
            log(
              `video.play() rejected while resuming: ${
                err.message || err
              }`
            );
          }

          /*
           * If video.play() was rejected, try the visible player
           * control.
           */
          if (!resumed || video.paused) {
            const controls = getPlayControls();

            for (const control of controls) {
              if (clickElement(control)) {
                log("Clicked Vimeo playback control");

                await sleep(1000);

                if (!video.paused) {
                  resumed = true;
                  break;
                }
              }
            }
          }

          /*
           * Last resort: click the main Vimeo player target.
           *
           * This corresponds to the Gisela Recorder recording,
           * which recorded:
           *
           *   div.vp-target
           */
          if (!resumed || video.paused) {
            const target = document.querySelector(
              "div.vp-target"
            );

            if (target) {
              clickElement(target);

              await sleep(1000);

              try {
                await video.play();
              } catch (_) {}
            }
          }
        }

        /*
         * ======================================================
         * STALL RECOVERY
         * ======================================================
         *
         * If currentTime hasn't advanced for 10 seconds, attempt
         * playback again.
         */

        if (
          stalledFor >= 10 &&
          !ended
        ) {
          log(
            "Vimeo playback appears stalled — attempting recovery"
          );

          try {
            await video.play();
          } catch (_) {}

          if (video.paused) {
            const controls = getPlayControls();

            for (const control of controls) {
              clickElement(control);

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
            `Vimeo playback: ${currentTime.toFixed(1)}s`
        };
      }

      log(
        `Reached maximum Vimeo playback monitor time; ` +
        `started=${started}`
      );

      return;
    }

    /*
     * ============================================================
     * ECA PORTFOLIO PAGE
     * ============================================================
     *
     * This part runs in the top-level ECA page.
     */

    log(
      `Running on ECA portfolio page: ${window.location.pathname}`
    );

    /*
     * Find likely video thumbnails.
     *
     * We deliberately DON'T use section:nth-of-type(), because
     * the two recordings showed section 3 and section 6.
     */

    const videoSelectors = [
      ".video-image-container img",

      /*
       * Generic video/image containers.
       */
      "[class*='video-image'] img",
      "[class*='video'] img",
      "[class*='vimeo'] img",

      /*
       * Common clickable image/video wrappers.
       */
      "[data-vimeo] img",
      "[data-vimeo-id] img",
      "[data-video] img",
      "[data-video-id] img"
    ];

    function getVideoThumbnails() {
      const found = [];

      for (const selector of videoSelectors) {
        for (const el of document.querySelectorAll(selector)) {
          if (!found.includes(el)) {
            found.push(el);
          }
        }
      }

      /*
       * Filter out tiny/invisible images.
       */
      return found.filter(el => {
        const rect = el.getBoundingClientRect();

        return (
          rect.width >= 100 &&
          rect.height >= 50
        );
      });
    }

    /*
     * Some ECA pages may have several video thumbnails.
     *
     * We process them one at a time.
     */
    const thumbnails = getVideoThumbnails();

    log(
      `Found ${thumbnails.length} possible video thumbnail(s)`
    );

    if (!thumbnails.length) {
      yield {
        msg: "No video thumbnails found"
      };

      return;
    }

    /*
     * Track Vimeo iframes we've already activated.
     */
    const processedFrames = new Set();

    for (
      let thumbnailIndex = 0;
      thumbnailIndex < thumbnails.length;
      thumbnailIndex++
    ) {
      const thumbnail = thumbnails[thumbnailIndex];

      log(
        `Processing video ${thumbnailIndex + 1}/${thumbnails.length}`
      );

      /*
       * Scroll the thumbnail into view.
       */
      try {
        thumbnail.scrollIntoView({
          behavior: "instant",
          block: "center",
          inline: "center"
        });
      } catch (_) {}

      await sleep(500);

      /*
       * Record the Vimeo frames that already exist.
       */
      const beforeFrames = new Set(
        Array.from(
          document.querySelectorAll(
            'iframe[src*="vimeo.com"]'
          )
        )
      );

      /*
       * ========================================================
       * FIRST CLICK
       * ========================================================
       *
       * This corresponds to BOTH Recorder recordings:
       *
       * Anne-Catherine:
       *   section:nth-of-type(3) ... img
       *
       * Gisela:
       *   section:nth-of-type(6) ... img
       *
       * The stable part is the video image/container.
       */

      try {
        thumbnail.click();

        log("Clicked ECA video thumbnail");
      } catch (err) {
        log(
          `Thumbnail click failed: ${err.message || err}`
        );

        continue;
      }

      yield {
        msg:
          `Clicked video thumbnail ${thumbnailIndex + 1}/${thumbnails.length}`
      };

      /*
       * ========================================================
       * WAIT FOR THE EMBED
       * ========================================================
       */

      let vimeoFrame = null;

      for (let attempt = 0; attempt < 30; attempt++) {
        const frames = Array.from(
          document.querySelectorAll(
            'iframe[src*="player.vimeo.com"], iframe[src*="vimeo.com"]'
          )
        );

        /*
         * Prefer a newly created Vimeo iframe.
         */
        vimeoFrame =
          frames.find(frame => !beforeFrames.has(frame)) ||
          frames.find(frame => !processedFrames.has(frame)) ||
          null;

        if (vimeoFrame) {
          break;
        }

        await sleep(1000);
      }

      if (!vimeoFrame) {
        log(
          "No new Vimeo iframe appeared after thumbnail click"
        );

        continue;
      }

      processedFrames.add(vimeoFrame);

      log(
        `Found Vimeo iframe: ${vimeoFrame.src}`
      );

      /*
       * ========================================================
       * INTERMEDIATE IFRAME CLICK
       * ========================================================
       *
       * Gisela's Recorder recording showed an additional click
       * on an iframe before the Vimeo player interaction.
       *
       * We reproduce that here, but only when appropriate.
       */

      try {
        vimeoFrame.scrollIntoView({
          block: "center",
          inline: "center"
        });
      } catch (_) {}

      await sleep(1000);

      try {
        vimeoFrame.click();

        log("Clicked Vimeo iframe/container");
      } catch (_) {
        /*
         * iframe.click() isn't guaranteed to generate a pointer
         * event in every browser state. That's okay — the
         * Vimeo iframe behavior will handle the actual player.
         */
      }

      yield {
        msg:
          `Activated Vimeo iframe ${thumbnailIndex + 1}`
      };

      /*
       * Give the iframe time to initialise.
       */
      await sleep(3000);

      /*
       * Send a play request from the parent as an additional
       * mechanism. The actual player-side behavior will also
       * click/play the HTML5 video.
       */
      try {
        vimeoFrame.contentWindow.postMessage(
          JSON.stringify({
            method: "play"
          }),
          "*"
        );

        log("Sent Vimeo play request");
      } catch (_) {}

      /*
       * Don't immediately process the next thumbnail.
       *
       * The Vimeo iframe behavior is running independently and
       * will monitor this player's actual playback until it
       * finishes.
       */
      yield {
        msg:
          `Started Vimeo processing ${thumbnailIndex + 1}/${thumbnails.length}`
      };

      /*
       * Give the iframe behavior time to start before moving on.
       */
      await sleep(5000);
    }

    /*
     * ============================================================
     * FINISH
     * ============================================================
     */

    log(
      `Finished processing ${thumbnails.length} video thumbnail(s)`
    );

    yield {
      msg:
        `Processed ${thumbnails.length} ECA video thumbnail(s)`
    };
  }
}