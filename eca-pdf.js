class ClickPdfLinksOnly {
  static id = "Click PDF Links Only";

  static isMatch() {
    return true;
  }

  static init() {
    return {};
  }

  async* run(ctx) {
    const { Lib } = ctx;
    const links = Array.from(document.querySelectorAll("a[href]"));

    for (const link of links) {
      const raw = link.getAttribute("href");
      if (!raw) continue;

      let pathname;
      try {
        pathname = new URL(raw.trim(), location.href).pathname;
      } catch (e) {
        continue; // skip malformed hrefs (mailto:, javascript:, etc.)
      }

      if (pathname.toLowerCase().endsWith(".pdf")) {
        if (Lib.scrollAndClick) {
          await Lib.scrollAndClick(link);
        } else {
          link.click();
        }
        yield Lib.getState(ctx, `Clicked PDF link: ${pathname}`, "pdfClicks");
        await Lib.sleep(500);
      }
    }
  }
}
