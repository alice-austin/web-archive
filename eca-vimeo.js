class ECAVimeoAutoplay {
  static id = "ECA Vimeo two-click autoplay";

  static isMatch() {
    const host = window.location.hostname;

    // Run on the ECA Graduate Show pages themselves...
    if (host === "www.2021.graduateshow.eca.ed.ac.uk" ||
        host === "2021.graduateshow.eca.ed.ac.uk") {
      return true;
    }

    // ...and inside Vimeo iframes loaded by those pages.
    if (
      host === "player.vimeo.com" ||
      host === "vimeo.com"
    ) {
      return true;
    }

    return false;
  }

  static init() {
    return {};
  }

  // This is important: Browsertrix will also run the behavior
  // inside the Vimeo iframe.
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
     * ------------------------------------------------------------
     * VIMEO IFRAME
     * ------------------------------------------------------------
     *
     * Once the ECA page has loaded the Vimeo iframe, this part
     * looks for Vimeo's play controls.
     */
    if (
      window.location.hostname === "player.vimeo.com" ||
      window.location.hostname === "vimeo.com"
    ) {
      log("Running inside Vimeo iframe");

      let clicked = false;

      for (let attempt = 0; attempt < 30; attempt++) {
        const selectors = [
          'button[aria-label*="Play" i]',
          'button[title*="Play" i]',
          '[role="button"][aria-label*="Play" i]',
          '[role="button"][title*="Play" i]',
          '.vp-telecine-button',
          '.vp-controls .play',
          '.vp-play-button',
          '.play-button'
        ];

        let playButton = null;

        for (const selector of selectors) {
          playButton = document.querySelector(selector);

          if (playButton) {
            break;
          }
        }

        /*
         * Vimeo has changed its player markup over time, so also
         * search visible buttons for text/labels containing Play.
         */
        if (!playButton) {
          const candidates = Array.from(
            document.querySelectorAll(
              'button, [role="button"], a'
            )
          );

          playButton = candidates.find(el => {
            const text = [
              el.innerText || "",
              el.getAttribute("aria-label") || "",
              el.getAttribute("title") || ""
            ].join(" ");

            const rect = el.getBoundingClientRect();

            return (
              /(^|\s)play(\s|$)/i.test(text) &&
              rect.width > 0 &&
              rect.height > 0
            );
          });
        }

        if (playButton) {
          log("Found Vimeo play control");

          try {
            playButton.scrollIntoView({
              block: "center",
              inline: "center"
            });
          } catch (_) {}

          /*
           * Use a sequence of real DOM mouse events rather than
           * only element.click(). This is more closely analogous
           * to an actual user click.
           */
          try {
            const rect = playButton.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            for (const type of [
              "pointerdown",
              "mousedown",
              "pointerup",
              "mouseup",
              "click"
            ]) {
              playButton.dispatchEvent(
                new MouseEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: x,
                  clientY: y
                })
              );
            }
          } catch (_) {
            playButton.click();
          }

          clicked = true;
          log("Clicked Vimeo play control");

          yield {
            msg: "Vimeo play button clicked"
          };

          /*
           * Keep the iframe alive for a while so that the video
           * media segments have time to be requested and captured.
           */
          for (let i = 0; i < 12; i++) {
            await sleep(5000);
            yield {
              msg: `Vimeo playback wait ${i + 1}/12`
            };
          }

          return;
        }

        await sleep(1000);
      }

      log(
        clicked
          ? "Vimeo playback initiated"
          : "Could not find Vimeo play control"
      );

      return;
    }

    /*
     * ------------------------------------------------------------
     * ECA PAGE
     * ------------------------------------------------------------
     *
     * First interaction: click the ECA/lazy-load video control.
     */

    log("Running on ECA page");

    let firstClickDone = false;

    /*
     * These are common selectors for lazy-loaded video embeds.
     * The text/attribute search below provides additional
     * protection against changes to the site's CSS.
     */
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

    /*
     * First look for an explicit "load video" / "load" control.
     */
    function findLoadControl() {
      const elements = Array.from(
        document.querySelectorAll(
          'button, a, [role="button"], [class*="video"], [class*="vimeo"], [class*="embed"]'
        )
      );

      return elements.find(el => {
        const text = [
          el.innerText || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.getAttribute("data-label") || ""
        ].join(" ").trim();

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

    /*
     * If there is no text-labelled control, look for a known
     * video/embed container that is itself clickable.
     */
    function findVideoContainer() {
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
     * Wait for the first interaction control.
     */
    for (let attempt = 0; attempt < 30; attempt++) {
      let control = findLoadControl();

      if (!control) {
        control = findVideoContainer();
      }

      if (control) {
        log("Found ECA video load control/container");

        try {
          control.scrollIntoView({
            block: "center",
            inline: "center"
          });
        } catch (_) {}

        await sleep(500);

        try {
          control.click();
        } catch (_) {
          try {
            const rect = control.getBoundingClientRect();

            control.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
              })
            );
          } catch (_) {}
        }

        firstClickDone = true;

        log("Performed first video/load click");

        yield {
          msg: "ECA video load click performed"
        };

        break;
      }

      await sleep(1000);
    }

    if (!firstClickDone) {
      log("No first-stage video control found");
    }

    /*
     * ------------------------------------------------------------
     * WAIT FOR VIMEO
     * ------------------------------------------------------------
     *
     * The first click can cause the iframe to be created
     * asynchronously.
     */

    for (let attempt = 0; attempt < 30; attempt++) {
      const vimeoFrames = Array.from(
        document.querySelectorAll(
          'iframe[src*="vimeo.com"], iframe[src*="player.vimeo.com"]'
        )
      );

      if (vimeoFrames.length > 0) {
        log(
          `Found ${vimeoFrames.length} Vimeo iframe(s)`
        );

        yield {
          msg: `Found ${vimeoFrames.length} Vimeo iframe(s)`
        };

        /*
         * Give Vimeo a little time to initialise before the
         * iframe-specific instance of this behavior attempts
         * its second click.
         */
        await sleep(3000);

        /*
         * Send Vimeo's player API a play request as an additional
         * mechanism. This does not replace the actual click.
         */
        for (const iframe of vimeoFrames) {
          try {
            iframe.contentWindow.postMessage(
              JSON.stringify({
                method: "play"
              }),
              "*"
            );

            log("Sent Vimeo play postMessage");
          } catch (_) {}
        }

        /*
         * Keep the parent page alive. The Vimeo iframe behavior
         * will perform the actual play-button click.
         */
        for (let i = 0; i < 12; i++) {
          await sleep(5000);

          yield {
            msg: `Waiting for Vimeo playback ${i + 1}/12`
          };
        }

        return;
      }

      await sleep(1000);
    }

    log("No Vimeo iframe appeared after first click");

    /*
     * Keep the page alive briefly even if the iframe was not
     * detected, since the site's JavaScript may still be loading.
     */
    await sleep(5000);

    yield {
      msg: "ECA Vimeo behavior finished"
    };
  }
}