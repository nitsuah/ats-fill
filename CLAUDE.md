# ats-fill agent notes

- This is a Manifest V3 Chrome extension. Use the `chrome-extensions` skill for extension code and `modern-web-guidance` before any popup/content-script UI, form, or CSS work (it runs `npx.cmd -y modern-web-guidance@latest search|retrieve`).
- The skills are installed per checkout (pinned in `skills-lock.json`, files gitignored). On a fresh clone:
  `npx -y modern-web-guidance@latest install` then `npx -y skills@latest add https://github.com/GoogleChrome/modern-web-guidance.git --skill chrome-extensions -a claude-code -y`
- Whenever you create or change extension code, create and maintain `CHROMEWEBSTORE.md` (format per the `chrome-extensions` skill), including a justification for every permission and host permission in `manifest.json`. Seed it from `docs/release/chrome-web-store.md` rather than duplicating it by hand.
- To test in a real browser, use the `chrome-devtools` MCP server (`.mcp.json`): it can install, reload, and inspect the extension's popup, side panel, and service worker. It needs remote debugging turned on at `chrome://inspect/#remote-debugging` in each new Chrome session.
