# Chrome Web Store assets

CI generates the store listing assets from the deterministic Playwright fixture data.

| Asset | Size | Format | Purpose |
| --- | ---: | --- | --- |
| screenshot-01-main.jpg | 1280×800 | JPEG | Primary product screenshot |
| screenshot-02-tracker.jpg | 1280×800 | JPEG | Job tracker workflow |
| screenshot-03-job-search.jpg | 1280×800 | JPEG | Multi-board job search |
| screenshot-04-interview-prep.jpg | 1280×800 | JPEG | Interview preparation |
| screenshot-05-analytics.jpg | 1280×800 | JPEG | Local application analytics |
| small-promo.jpg | 440×280 | JPEG | Chrome Web Store small promo tile |
| marquee-promo.jpg | 1400×560 | JPEG | Chrome Web Store marquee promo tile |

The five screenshots are the complete listing set; the two promo tiles are separate store assets.

## Privacy / determinism

The capture uses tests/e2e/helpers/demo-state.mjs. Names, companies, URLs, resume content and application history are fictional. No developer profile, resume, API key or live application data is used.

CI validates exact dimensions and that each JPEG has three color components (24-bit RGB), then uploads the assets as the chrome-web-store-assets workflow artifact.
