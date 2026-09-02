/*
 * ============================================================
 * ECA Graduate Show — Vimeo Archive Behaviour
 * ============================================================
 *
 * Target:
 *   https://www.2021.graduateshow.eca.ed.ac.uk/portfolio/*
 *
 * Vimeo:
 *   https://player.vimeo.com/video/{id}
 *
 * PURPOSE
 * -------
 * Drive Vimeo's own player so that Browsertrix records the
 * actual media requests made by the player.
 *
 * IMPORTANT
 * ---------
 * This behaviour deliberately does NOT request:
 *
 *   /video/{id}/config
 *
 * Vimeo returns HTTP 403 for that endpoint in the crawl
 * environment.
 *
 * Instead, the behaviour:
 *
 *   1. Discovers Vimeo video IDs from the ECA page.
 *   2. Creates one Vimeo player iframe at a time.
 *   3. Allows the player to initialise normally.
 *   4. Starts muted playback.
 *   5. Verifies that currentTime actually advances.
 *   6. Recovers from stalls and pauses.
 *   7. Keeps the page alive while Vimeo requests media.
 *   8. Logs Vimeo/CDN/HLS/DASH/media resources.
 *
 * ============================================================
 */

class ECAVimeoArchive {
  static id = "ECA Vimeo Archive";

  /*
   * ------------------------------------------------------------
   * CONFIGURATION
   * ------------------------------------------------------------
   */

  /*
   * How long the TOP-LEVEL page stays alive for each Vimeo
   * iframe.
   *
   * This is intentionally much longer than the old 60-second
   * total keep-alive.
   *
   * 5 minutes gives short videos plenty of time to finish and
   * gives longer videos time to request substantially more
   * media segments.
   */
  static PER_VIDEO_KEEPALIVE = 5 * 60 * 1000;

  /*
   * Maximum time the Vimeo iframe behaviour itself will run.
   */
  static MAX_RUNTIME = 30 * 60 * 1000;

  /*
   * Consider playback stalled after this many seconds without
   * currentTime advancing.
   */
  static STALL_LIMIT = 10;

  /*
   * How frequently playback is checked.
   */
  static MONITOR_INTERVAL = 2000;

  /*
   * Time to leave the player alive after the video reaches the
   * end, so final media requests can settle.
   */
  static END_SETTLE_TIME = 10000;

  /*
   * Number of times to retry starting playback.
   */
  static PLAY_ATTEMPTS = 15;

  /*
   * ------------------------------------------------------------
   * MATCHING
   * ------------------------------------------------------------
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
     * Vimeo player iframe.
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
   * Browsertrix should also execute this behaviour in child
   * frames.
   */
  static runInIframe = true;

  /*
   * ------------------------------------------------------------
   * MAIN BEHAVIOUR
   * ------------------------------------------------------------
   */

  async* run(ctx) {
    const sleep =
      ctx.Lib &&
      ctx.Lib.sleep
        ? ctx.Lib.sleep
        : (ms) =>
            new Promise(
              (resolve) =>
                setTimeout(
                  resolve,
                  ms
                )
            );

    const log = (msg) => {
      ctx.log({
        msg:
          `[ECA Vimeo] ${msg}`
      });
    };

    /*
     * ==========================================================
     * VIMEO PLAYER
     * ==========================================================
     */

    if (
      window.location.hostname ===
      "player.vimeo.com"
    ) {
      yield* this.runVimeoPlayer(
        ctx,
        sleep,
        log
      );

      return;
    }

    /*
     * ==========================================================
     * ECA PORTFOLIO PAGE
     * ==========================================================
     */

    yield* this.runPortfolioPage(
      ctx,
      sleep,
      log
    );
  }

  /*
   * ============================================================
   * VIMEO PLAYER BEHAVIOUR
   * ============================================================
   */

  async* runVimeoPlayer(
    ctx,
    sleep,
    log
  ) {
    log(
      "Entered Vimeo player iframe"
    );

    /*
     * ----------------------------------------------------------
     * VIDEO ID
     * ----------------------------------------------------------
     */

    function getVideoId() {
      const path =
        window.location.pathname;

      const match =
        path.match(
          /\/video\/(\d+)/
        );

      if (match) {
        return match[1];
      }

      const params =
        new URLSearchParams(
          window.location.search
        );

      return (
        params.get("video") ||
        params.get("id") ||
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
     * ----------------------------------------------------------
     * VIDEO HELPERS
     * ----------------------------------------------------------
     */

    function getVideo() {
      return document.querySelector(
        "video"
      );
    }

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

        await sleep(500);
      }

      return null;
    }

    /*
     * ----------------------------------------------------------
     * PLAY BUTTON
     * ----------------------------------------------------------
     */

    function clickPlay() {
      const selectors = [
        'button[aria-label="Play"]',
        'button[aria-label*="Play" i]',
        '[role="button"][aria-label*="Play" i]',
        '[aria-label="Play"]',
        ".vp-play-button",
        '[data-play-button]',
        ".PlayButton_module_playButtonWrapper__d6312f47"
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
            const rect =
              button.getBoundingClientRect();

            /*
             * Ignore completely invisible controls.
             */
            if (
              rect.width <= 0 ||
              rect.height <= 0
            ) {
              continue;
            }

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
     * CONFIGURE VIDEO
     * ----------------------------------------------------------
     */

    function configureVideo(
      video
    ) {
      if (!video) {
        return;
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

        /*
         * Make the browser more willing to continue loading
         * the media.
         */
        video.setAttribute(
          "webkit-playsinline",
          ""
        );
      } catch (_) {}
    }

    /*
     * ----------------------------------------------------------
     * WAIT FOR MEDIA READINESS
     * ----------------------------------------------------------
     */

    async function waitForMediaReady(
      timeout = 60000
    ) {
      const started =
        Date.now();

      let lastReadyState =
        -1;

      while (
        Date.now() -
          started <
        timeout
      ) {
        const video =
          getVideo();

        if (!video) {
          await sleep(500);
          continue;
        }

        configureVideo(
          video
        );

        if (
          video.readyState !==
          lastReadyState
        ) {
          log(
            `Video readiness: ` +
              `readyState=${video.readyState} ` +
              `networkState=${video.networkState}`
          );

          lastReadyState =
            video.readyState;
        }

        /*
         * HAVE_CURRENT_DATA or better.
         */
        if (
          video.readyState >=
          2
        ) {
          return video;
        }

        await sleep(500);
      }

      return getVideo();
    }

    /*
     * ----------------------------------------------------------
     * NETWORK RESOURCE DIAGNOSTICS
     * ----------------------------------------------------------
     */

    function getVimeoResources() {
      const entries =
        performance.getEntriesByType(
          "resource"
        );

      const urls =
        entries
          .map(
            (entry) =>
              entry.name
          )
          .filter(
            (url) => {
              const lower =
                url.toLowerCase();

              return (
                lower.includes(
                  "vimeo"
                ) ||
                lower.includes(
                  "akamaized"
                ) ||
                lower.includes(
                  "cloudfront"
                ) ||
                lower.includes(
                  ".m3u8"
                ) ||
                lower.includes(
                  ".mpd"
                ) ||
                lower.includes(
                  ".mp4"
                ) ||
                lower.includes(
                  "progressive"
                ) ||
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
        `${label}: ${resources.length}`
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
     * ----------------------------------------------------------
     * START PLAYBACK
     * ----------------------------------------------------------
     */

    async function startPlayback() {
      let video =
        getVideo();

      if (!video) {
        return false;
      }

      configureVideo(
        video
      );

      for (
        let attempt = 1;
        attempt <=
        ECAVimeoArchive.PLAY_ATTEMPTS;
        attempt++
      ) {
        video =
          getVideo();

        if (!video) {
          await sleep(500);
          continue;
        }

        configureVideo(
          video
        );

        log(
          `Play attempt ${attempt}: ` +
            `time=${Number(video.currentTime || 0).toFixed(2)} ` +
            `paused=${video.paused} ` +
            `ended=${video.ended} ` +
            `readyState=${video.readyState}`
        );

        /*
         * Already playing.
         */
        if (
          !video.paused &&
          !video.ended
        ) {
          return true;
        }

        /*
         * First try the HTML5 API.
         */
        try {
          await video.play();

          if (
            !video.paused &&
            !video.ended
          ) {
            log(
              "video.play() succeeded"
            );

            return true;
          }
        } catch (error) {
          log(
            `video.play() rejected: ${
              error &&
              error.message
                ? error.message
                : error
            }`
          );
        }

        /*
         * Then try Vimeo's own control.
         */
        clickPlay();

        await sleep(
          1000
        );

        video =
          getVideo();

        if (
          video &&
          !video.paused &&
          !video.ended
        ) {
          log(
            "Vimeo started after Play button click"
          );

          return true;
        }

        /*
         * Give Vimeo a little time to recover before the next
         * attempt.
         */
        await sleep(
          1000
        );
      }

      return false;
    }

    /*
     * ----------------------------------------------------------
     * VERIFY ACTUAL PLAYBACK
     * ----------------------------------------------------------
     *
     * This is deliberately different from simply checking
     * video.paused.
     *
     * A player can report "playing" while currentTime is not
     * actually advancing because media hasn't arrived.
     * ----------------------------------------------------------
     */

    async function verifyPlaybackProgress(
      minimumAdvance = 0.5,
      timeout = 15000
    ) {
      let video =
        getVideo();

      if (!video) {
        return false;
      }

      const startTime =
        Number(
          video.currentTime
        ) || 0;

      const started =
        Date.now();

      log(
        `Verifying playback progress from ${startTime.toFixed(2)}s`
      );

      while (
        Date.now() -
          started <
        timeout
      ) {
        await sleep(
          1000
        );

        video =
          getVideo();

        if (!video) {
          return false;
        }

        const currentTime =
          Number(
            video.currentTime
          ) || 0;

        if (
          currentTime >=
          startTime +
            minimumAdvance
        ) {
          log(
            `Playback confirmed: ` +
              `${startTime.toFixed(2)}s → ` +
              `${currentTime.toFixed(2)}s`
          );

          return true;
        }

        /*
         * If Vimeo has paused, try to restart it while we're
         * waiting for genuine progress.
         */
        if (
          video.paused &&
          !video.ended
        ) {
          try {
            video.muted =
              true;

            await video.play();
          } catch (_) {
            clickPlay();
          }
        }
      }

      video =
        getVideo();

      const finalTime =
        video
          ? Number(
              video.currentTime
            ) || 0
          : 0;

      log(
        `WARNING: playback did not advance sufficiently: ` +
          `${startTime.toFixed(2)}s → ` +
          `${finalTime.toFixed(2)}s`
      );

      return false;
    }

    /*
     * ----------------------------------------------------------
     * INITIALISE PLAYER
     * ----------------------------------------------------------
     */

    let video =
      await waitForVideo(
        60000
      );

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

    configureVideo(
      video
    );

    /*
     * Give Vimeo time to populate MediaSource.
     */
    await sleep(
      3000
    );

    video =
      await waitForMediaReady(
        60000
      );

    if (!video) {
      log(
        "ERROR: Vimeo media never became ready"
      );

      return;
    }

    log(
      `Vimeo media ready: ` +
        `readyState=${video.readyState} ` +
        `networkState=${video.networkState}`
    );

    /*
     * Log resources before playback.
     */
    logVimeoResources(
      "Vimeo network resources before playback"
    );

    /*
     * ----------------------------------------------------------
     * START + VERIFY PLAYBACK
     * ----------------------------------------------------------
     */

    let playing =
      await startPlayback();

    if (!playing) {
      /*
       * Explicit second-stage recovery.
       *
       * This is important for the "player is having trouble"
       * situation: don't simply accept failure and proceed.
       */
      log(
        "WARNING: initial Vimeo playback start failed; entering recovery"
      );

      for (
        let retry = 1;
        retry <= 3;
        retry++
      ) {
        log(
          `Playback recovery attempt ${retry}/3`
        );

        await sleep(
          3000
        );

        video =
          await waitForMediaReady(
            15000
          );

        if (!video) {
          continue;
        }

        configureVideo(
          video
        );

        playing =
          await startPlayback();

        if (playing) {
          break;
        }
      }
    }

    if (!playing) {
      log(
        "ERROR: Vimeo playback could not be started"
      );

      /*
       * Keep the player alive briefly anyway. Sometimes Vimeo
       * starts after a delayed network response.
       */
      await sleep(
        15000
      );

      video =
        getVideo();

      if (
        video &&
        !video.paused
      ) {
        playing = true;
      }
    }

    if (!playing) {
      log(
        "ERROR: Vimeo playback still not running after recovery"
      );

      logVimeoResources(
        "Vimeo resources after failed playback"
      );

      return;
    }

    log(
      "Vimeo playback started"
    );

    /*
     * Log resources immediately after playback starts.
     */
    logVimeoResources(
      "Vimeo network resources after playback started"
    );

    /*
     * ----------------------------------------------------------
     * VERIFY ACTUAL MEDIA PROGRESS
     * ----------------------------------------------------------
     */

    let progressConfirmed =
      await verifyPlaybackProgress(
        0.5,
        15000
      );

    if (!progressConfirmed) {
      log(
        "WARNING: first playback-progress verification failed"
      );

      /*
       * Attempt one more complete restart.
       */
      video =
        getVideo();

      if (video) {
        try {
          video.pause();
        } catch (_) {}

        await sleep(
          1000
        );
      }

      playing =
        await startPlayback();

      if (playing) {
        progressConfirmed =
          await verifyPlaybackProgress(
            0.5,
            15000
          );
      }
    }

    if (!progressConfirmed) {
      log(
        "WARNING: Vimeo player is running but actual media progress could not be confirmed"
      );
    } else {
      log(
        "Confirmed Vimeo media is actually advancing"
      );
    }

    /*
     * ==========================================================
     * MONITOR PLAYBACK
     * ==========================================================
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
      ECAVimeoArchive.MAX_RUNTIME
    ) {
      await sleep(
        ECAVimeoArchive.MONITOR_INTERVAL
      );

      /*
       * Vimeo can replace its video element during initialisation
       * or recovery.
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
            "No replacement Vimeo video appeared"
          );

          continue;
        }

        configureVideo(
          video
        );

        try {
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

          clickPlay();
        }

        continue;
      }

      configureVideo(
        video
      );

      /*
       * --------------------------------------------------------
       * CURRENT PLAYBACK STATE
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
       * --------------------------------------------------------
       * BUFFERED RANGE
       * --------------------------------------------------------
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
       * --------------------------------------------------------
       * PERIODIC RESOURCE LOGGING
       * --------------------------------------------------------
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
       * --------------------------------------------------------
       * FINISHED
       * --------------------------------------------------------
       */

      if (
        video.ended ||
        (
          duration !== null &&
          currentTime >=
            duration -
              0.5
        )
      ) {
        log(
          "Vimeo video reached the end"
        );

        /*
         * Allow final media/network requests to settle.
         */
        await sleep(
          ECAVimeoArchive.END_SETTLE_TIME
        );

        logVimeoResources(
          "Final Vimeo network resources"
        );

        return;
      }

      /*
       * --------------------------------------------------------
       * DETECT ACTUAL MOVEMENT
       * --------------------------------------------------------
       */

      if (
        previousTime >= 0 &&
        currentTime <=
          previousTime +
            0.05
      ) {
        stalledFor +=
          ECAVimeoArchive.MONITOR_INTERVAL /
          1000;
      } else {
        stalledFor = 0;
      }

      previousTime =
        currentTime;

      /*
       * --------------------------------------------------------
       * PAUSED
       * --------------------------------------------------------
       */

      if (
        video.paused &&
        !video.ended
      ) {
        log(
          "Vimeo paused unexpectedly — attempting resume"
        );

        try {
          video.muted =
            true;

          await video.play();
        } catch (_) {}

        await sleep(
          500
        );

        video =
          getVideo();

        if (
          video &&
          video.paused &&
          !video.ended
        ) {
          clickPlay();
        }
      }

      /*
       * --------------------------------------------------------
       * STALLED
       * --------------------------------------------------------
       */

      if (
        stalledFor >=
        ECAVimeoArchive.STALL_LIMIT
      ) {
        log(
          `Playback stalled for ${stalledFor}s — attempting recovery`
        );

        video =
          getVideo();

        if (!video) {
          stalledFor = 0;
          continue;
        }

        /*
         * First recovery attempt: play().
         */
        try {
          video.muted =
            true;

          await video.play();
        } catch (_) {}

        await sleep(
          1000
        );

        video =
          getVideo();

        /*
         * Second recovery attempt: Vimeo Play control.
         */
        if (
          video &&
          video.paused &&
          !video.ended
        ) {
          clickPlay();
        }

        /*
         * Give the player a chance to advance before resetting
         * the stall counter.
         */
        await sleep(
          2000
        );

        video =
          getVideo();

        if (video) {
          const recoveryTime =
            Number(
              video.currentTime
            ) || 0;

          log(
            `Post-recovery playback position: ${recoveryTime.toFixed(2)}s`
          );
        }

        stalledFor = 0;
      }

      yield {
        msg:
          `Vimeo playback ${currentTime.toFixed(1)}s`
      };
    }

    /*
     * ----------------------------------------------------------
     * SAFETY TIMEOUT
     * ----------------------------------------------------------
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
   * ============================================================
   * ECA PORTFOLIO PAGE
   * ============================================================
   */

  async* runPortfolioPage(
    ctx,
    sleep,
    log
  ) {
    log(
      `Running ECA page: ${location.href}`
    );

    /*
     * ----------------------------------------------------------
     * FIND VIMEO IDS
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
          (
            match =
              regex.exec(text)
          ) !== null
        ) {
          foundVimeoIds.add(
            match[1]
          );
        }
      }
    }

    /*
     * Search complete HTML.
     */
    findVimeoIdsInText(
      document.documentElement
        .outerHTML
    );

    /*
     * Search element attributes.
     */
    for (
      const element of
        document.querySelectorAll(
          "*"
        )
    ) {
      for (
        const attribute of
          Array.from(
            element.attributes ||
              []
          )
      ) {
        findVimeoIdsInText(
          attribute.value
        );
      }
    }

    /*
     * Search inline JavaScript.
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
     * EXISTING VIMEO FRAMES
     * ----------------------------------------------------------
     */

    const existingFrames =
      document.querySelectorAll(
        "iframe[src*='player.vimeo.com']"
      );

    log(
      `Existing Vimeo frames: ${existingFrames.length}`
    );

    /*
     * ----------------------------------------------------------
     * BUILD LIST OF VIDEOS TO PROCESS
     * ----------------------------------------------------------
     */

    const videosToProcess =
      [];

    for (
      const videoId of
        foundVimeoIds
    ) {
      /*
       * Already-created frame from this behaviour.
       */
      const existing =
        document.querySelector(
          `iframe[data-eca-vimeo-id="${videoId}"]`
        );

      if (existing) {
        log(
          `Vimeo ${videoId} already has an ECA iframe; skipping duplicate`
        );

        continue;
      }

      /*
       * Existing site iframe.
       */
      const existingBySrc =
        Array.from(
          document.querySelectorAll(
            "iframe[src*='player.vimeo.com']"
          )
        ).find(
          (iframe) =>
            iframe.src.includes(
              `/video/${videoId}`
            )
        );

      if (
        existingBySrc
      ) {
        log(
          `Existing Vimeo iframe already contains ${videoId}`
        );

        existingBySrc.dataset
          .ecaVimeoId =
          videoId;

        /*
         * We still include it in the processing list so that the
         * top-level page remains alive while the existing Vimeo
         * player runs.
         */
        videosToProcess.push({
          videoId,
          iframe:
            existingBySrc,
          created: false
        });

        continue;
      }

      videosToProcess.push({
        videoId,
        iframe: null,
        created: true
      });
    }

    log(
      `Vimeo videos to process: ${videosToProcess.length}`
    );

    /*
     * ==========================================================
     * PROCESS VIDEOS ONE AT A TIME
     * ==========================================================
     *
     * This is the key change.
     *
     * The previous version created all Vimeo iframes and then
     * only kept the parent page alive for 60 seconds total.
     *
     * Here we give EACH player its own keep-alive period.
     * ==========================================================
     */

    for (
      let index = 0;
      index <
        videosToProcess.length;
      index++
    ) {
      const item =
        videosToProcess[index];

      const videoId =
        item.videoId;

      log(
        `Processing Vimeo video ${index + 1}/${videosToProcess.length}: ${videoId}`
      );

      let iframe =
        item.iframe;

      /*
       * --------------------------------------------------------
       * CREATE PLAYER IF NECESSARY
       * --------------------------------------------------------
       */

      if (!iframe) {
        iframe =
          document.createElement(
            "iframe"
          );

        /*
         * Preserve the ECA Vimeo application ID.
         *
         * autoplay + muted makes playback much more likely to
         * start without a user gesture.
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
         * IMPORTANT:
         *
         * Do NOT use display:none.
         *
         * Vimeo can fail to initialise correctly when the iframe
         * has no layout.
         *
         * Keep it laid out, but outside the viewport.
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

        iframe.dataset
          .ecaVimeoId =
          videoId;

        document.body.appendChild(
          iframe
        );

        log(
          `Created Vimeo iframe for ${videoId}`
        );
      } else {
        /*
         * Make sure an existing iframe has the expected marker.
         */
        iframe.dataset
          .ecaVimeoId =
          videoId;

        log(
          `Using existing Vimeo iframe for ${videoId}`
        );
      }

      yield {
        msg:
          `Started Vimeo video ${index + 1}/${videosToProcess.length}: ${videoId}`
      };

      /*
       * --------------------------------------------------------
       * WAIT FOR THIS VIDEO
       * --------------------------------------------------------
       *
       * The child behaviour is responsible for:
       *
       *   - player initialisation
       *   - playback
       *   - progress verification
       *   - stall recovery
       *   - media-resource logging
       *
       * The parent behaviour's job is to keep the document alive
       * long enough for all of that to happen.
       */

      log(
        `Keeping page alive for Vimeo video ${videoId} for ` +
          `${ECAVimeoArchive.PER_VIDEO_KEEPALIVE / 1000}s`
      );

      const keepAliveStarted =
        Date.now();

      while (
        Date.now() -
          keepAliveStarted <
        ECAVimeoArchive.PER_VIDEO_KEEPALIVE
      ) {
        await sleep(
          5000
        );

        /*
         * Make sure the iframe hasn't disappeared.
         */
        const currentIframe =
          document.querySelector(
            `iframe[data-eca-vimeo-id="${videoId}"]`
          );

        if (!currentIframe) {
          log(
            `WARNING: Vimeo iframe ${videoId} disappeared; recreating it`
          );

          /*
           * Recreate it if the site removed it.
           */
          const replacement =
            document.createElement(
              "iframe"
            );

          replacement.src =
            `https://player.vimeo.com/video/${videoId}` +
            `?app_id=122963` +
            `&autoplay=1` +
            `&muted=1` +
            `&playsinline=1`;

          replacement.width =
            "640";

          replacement.height =
            "360";

          replacement.style.position =
            "fixed";

          replacement.style.left =
            "-10000px";

          replacement.style.top =
            "0";

          replacement.style.width =
            "640px";

          replacement.style.height =
            "360px";

          replacement.style.opacity =
            "0.01";

          replacement.style.pointerEvents =
            "none";

          replacement.setAttribute(
            "allow",
            "autoplay; fullscreen"
          );

          replacement.setAttribute(
            "allowfullscreen",
            ""
          );

          replacement.dataset
            .ecaVimeoId =
            videoId;

          document.body.appendChild(
            replacement
          );

          iframe =
            replacement;
        }

        yield {
          msg:
            `Waiting for Vimeo media ${videoId} ` +
            `(${Math.round(
              (Date.now() -
                keepAliveStarted) /
                1000
            )}s)`
        };
      }

      log(
        `Finished keep-alive period for Vimeo video ${videoId}`
      );

      /*
       * --------------------------------------------------------
       * DO NOT REMOVE THE IFRAME
       * --------------------------------------------------------
       *
       * Leaving the player in the document gives Browsertrix the
       * best chance of retaining any late media/network activity.
       *
       * We simply move on to the next video.
       * --------------------------------------------------------
       */

      yield {
        msg:
          `Finished Vimeo video ${index + 1}/${videosToProcess.length}: ${videoId}`
      };
    }

    /*
     * ==========================================================
     * FINAL KEEP-ALIVE
     * ==========================================================
     *
     * Give any final Vimeo/network activity a short settling
     * period before the top-level behaviour ends.
     * ==========================================================
     */

    log(
      "All Vimeo videos processed; allowing final network activity to settle"
    );

    await sleep(
      15000
    );

    log(
      "ECA Vimeo behaviour completed"
    );
  }
}
