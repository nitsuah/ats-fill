# ats-fill agent notes

- This is a Manifest V3 Chrome extension. Use the `chrome-extensions` and `modern-web-guidance` skills (Modern Web Guidance) when they are installed.
- Whenever you create or change extension code, create and maintain `CHROMEWEBSTORE.md` (format per the `chrome-extensions` skill), including a justification for every permission and host permission in `manifest.json`. Seed it from `docs/release/chrome-web-store.md` rather than duplicating it by hand.
- To test in a real browser, use the `chrome-devtools` MCP server (`.mcp.json`): it can install, reload, and inspect the extension's popup, side panel, and service worker. It needs remote debugging turned on at `chrome://inspect/#remote-debugging` in each new Chrome session.
