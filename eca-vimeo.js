class ECAVimeoAutoplay {
  static id = "ECA Vimeo two-click autoplay";

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

  static runInIframe = true;

  async *run(ctx) {
    const sleep = (ms) =>
      new Promise(resolve => setTimeout(resolve, ms));

    const log = (msg) => {
      ctx.log({
        msg: `[ECA Vimeo] ${msg}`
      });
    };

    /*
     * ============================================================
     * VIMEO IFRAME
     * ============================================================
     */

    if (
      window.location.hostname === "player.vimeo.com" ||
      window.location.hostname === "vimeo.com"
    ) {
      log("Running inside Vimeo iframe");

      /*
       * Find Vimeo's play button.
       */
      function findPlayButton() {
        const selectors = [
          'button[aria-label*="Play" i]',
          'button[title*="Play" i]',
          '[role="button"][aria-label*="Play" i]',
          '[role="button"][title*="Play" i]',
          '.vp-play-button',
          '.vp-controls .play',
          '.play-button'
        ];

        for (const selector of selectors) {
          const el = document.querySelector(selector);

          if (el) {
            const rect = el.getBoundingClientRect();

            if (rect.width > 0 && rect.height > 0) {
              return el;
            }
          }
        }

        /*
         * Fallback: inspect visible buttons.
         */
        const candidates = Array.from(
          document.querySelectorAll(
            'button, [role="button"], a'
          )
        );

        return candidates.find(el => {
          const label = [
            el.innerText || "",
            el.getAttribute("aria-label") || "",
            el.getAttribute("title") || ""
          ].join(" ");

          const rect = el.getBoundingClientRect();

          return (
            /play/i.test(label) &&
            rect.width > 0 &&
            rect.height > 0
          );
        });
      }

      /*
       * Send Vimeo Player API commands.
       *
       * Vimeo's player accepts these postMessage commands from
       * the embedding page.
       */
      function sendVimeoCommand(method, value) {
        try {
          window.parent.postMessage(
            JSON.stringify({
              method,
              value
            }),
            "*"
          );

          log(`Sent Vimeo command: ${method}`);
        } catch (e) {
          log(`Vimeo postMessage failed: ${e}`);
        }
      }

      /*
       * First actual user-style click.
       */
      let playButton = null;

      for (let attempt = 0; attempt < 30; attempt++) {
        playButton = findPlayButton();

        if (playButton) {
          break;
        }

        await sleep(1000);
      }

      if (playButton) {
        log("Found Vimeo play button");

        try {
          playButton.scrollIntoView({
            block: "center",
            inline: "center"
          });
        } catch (_) {}

        await sleep(500);

        try {
          playButton.click();
          log("Clicked Vimeo play button");
        } catch (e) {
          log(`Vimeo click failed: ${e}`);
        }
      } else {
        log("No Vimeo play button found");
      }

      /*
       * Give Vimeo time to initialise playback.
       */
      await sleep(3000);

      /*
       * Tell the Vimeo player to play as a second mechanism.
       */
      sendVimeoCommand("play");

      /*
       * ========================================================
       * PLAYBACK MONITOR
       * ========================================================
       *
       * Keep checking for a paused/stopped player.
       *
       * Vimeo exposes the underlying <video> element inside the
       * iframe. We can inspect it directly because this behavior
       * is executing inside the Vimeo iframe.
       */

      let lastTime = -1;
      let stalledChecks = 0;

      /*
       * Five minutes of monitoring.
       */
      for (let i = 0; i < 60; i++) {
        await sleep(5000);

        const video = document.querySelector("video");

        if (!video) {
          log("No HTML5 video element found");

          /*
           * Vimeo may recreate the video element. Try the API
           * regardless.
           */
          sendVimeoCommand("play");

          continue;
        }

        const currentTime = video.currentTime;
        const paused = video.paused;
        const ended = video.ended;
        const readyState = video.readyState;

        log(
          `video state: time=${currentTime.toFixed(2)} ` +
          `paused=${paused} ended=${ended} ` +
          `readyState=${readyState}`
        );

        /*
         * Detect actual progress.
         */
        if (currentTime > lastTime + 0.2) {
          stalledChecks = 0;
        } else {
          stalledChecks++;
        }

        lastTime = currentTime;

        /*
         * If Vimeo has paused, attempt to resume.
         */
        if (paused && !ended) {
          log("Video is paused — attempting resume");

          try {
            await video.play();

            log("video.play() succeeded");
          } catch (e) {
            log(`video.play() rejected: ${e}`);
          }

          sendVimeoCommand("play");

          /*
           * If necessary, click the visible button again.
           */
          const button = findPlayButton();

          if (button) {
            try {
              button.click();
              log("Clicked Vimeo play button again");
            } catch (_) {}
          }
        }

        /*
         * If playback has stalled without technically being
         * paused, ask Vimeo to resume.
         */
        if (stalledChecks >= 2 && !ended) {
          log("Playback appears stalled — requesting resume");

          sendVimeoCommand("play");

          try {
            await video.play();
          } catch (_) {}

          stalledChecks = 0;
        }

        /*
         * Video ended normally.
         */
        if (ended) {
          log("Video reached the end");
          break;
        }

        yield {
          msg: `Vimeo playback monitor ${i + 1}/60`
        };
      }

      log("Vimeo playback monitoring finished");
      return;
    }

    /*
     * ============================================================
     * ECA PAGE
     * ============================================================
     */

    log("Running on ECA page");

    function findLoadControl() {
      const candidates = Array.from(
        document.querySelectorAll(
          'button, a, [role="button"], [class*="video"], [class*="vimeo"], [class*="embed"]'
        )
      );

      return candidates.find(el => {
        const text = [
          el.innerText || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.getAttribute("data-label") || ""
        ].join(" ");

        const rect = el.getBoundingClientRect();

        if (!rect.width || !rect.height) {
          return false;
        }

        return (
          /load\s+(video|media|player)/i.test(text) ||
          /load\s+vimeo/i.test(text) ||
          /watch\s+(video|film)/i.test(text) ||
          /play\s+(video|film)/i.test(text)
        );
      });
    }

    function findVideoContainer() {
      const selectors = [
        '[data-vimeo]',
        '[data-vimeo-id]',
        '[data-video]',
        '[data-video-id]',
        '[data-embed]',
        '.vimeo',
        '.vimeo-player',
        '.video-embed',
        '.video-container',
        '.video-wrapper',
        '.embed-container',
        '.fluid-width-video-wrapper'
      ];

      for (const selector of selectors) {
        const elements = Array.from(
          document.querySelectorAll(selector)
        );

        for (const el of elements) {
          const rect = el.getBoundingClientRect();

          if (
            rect.width > 100 &&
            rect.height > 50
          ) {
            return el;
          }
        }
      }

      return null;
    }

    /*
     * ========================================================
     * FIRST CLICK
     * ========================================================
     */

    let firstClickDone = false;

    for (let attempt = 0; attempt < 30; attempt++) {
      let control = findLoadControl();

      if (!control) {
        control = findVideoContainer();
      }

      if (control) {
        log("Found ECA video load control");

        try {
          control.scrollIntoView({
            block: "center",
            inline: "center"
          });
        } catch (_) {}

        await sleep(500);

        try {
          control.click();
          log("Clicked ECA video load control");
        } catch (e) {
          log(`First click failed: ${e}`);
        }

        firstClickDone = true;

        yield {
          msg: "ECA video load click performed"
        };

        break;
      }

      await sleep(1000);
    }

    if (!firstClickDone) {
      log("Could not find ECA video load control");
    }

    /*
     * ========================================================
     * WAIT FOR VIMEO
     * ========================================================
     */

    for (let attempt = 0; attempt < 30; attempt++) {
      const frames = Array.from(
        document.querySelectorAll(
          'iframe[src*="vimeo.com"], iframe[src*="player.vimeo.com"]'
        )
      );

      if (frames.length) {
        log(`Found ${frames.length} Vimeo iframe(s)`);

        /*
         * Give the Vimeo player time to initialise.
         */
        await sleep(3000);

        /*
         * Request playback through Vimeo's player API.
         */
        for (const iframe of frames) {
          try {
            iframe.contentWindow.postMessage(
              JSON.stringify({
                method: "play"
              }),
              "*"
            );

            log("Sent initial Vimeo play request");
          } catch (_) {}
        }

        /*
         * Keep the parent page alive while the iframe behavior
         * handles playback.
         */
        for (let i = 0; i < 60; i++) {
          await sleep(5000);

          yield {
            msg: `Waiting for Vimeo ${i + 1}/60`
          };
        }

        return;
      }

      await sleep(1000);
    }

    log("No Vimeo iframe detected");
  }
}
