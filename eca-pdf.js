class ClickPdfLinksOnly {
  static id = "Click PDF Links Only";

  // Run on every page (return true unconditionally)
  static isMatch() {
    return true;
  }

  static init() {
    return {};
  }

  async* run(ctx) {
    const { Lib } = ctx;
    const links = document.querySelectorAll("a[href]");

    for (const link of links) {
      const href = link.getAttribute("href") || "";

      // crude but effective: match .pdf at end of path, ignoring query/hash
      const isPdf = /\.pdf(?:[?#]|$)/i.test(href);

      if (isPdf) {
        Lib.scrollAndClick ? await Lib.scrollAndClick(link) : link.click();
        yield Lib.getState(ctx, "Clicked PDF link", "pdfClicks");
        await Lib.sleep(500); // small pause so the download/fetch registers
      }
    }
  }
}
