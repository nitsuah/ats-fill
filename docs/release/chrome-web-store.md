# Chrome Web Store release setup

Apply Workspace uses the Chrome Web Store API v2 with a Google Cloud service account for subsequent releases. The first Store listing remains a manual setup step; after that, a protected GitHub Actions environment can publish tagged releases.

## One-time Google setup

1. Create/select a Google Cloud project.
2. Enable the **Chrome Web Store API**.
3. Create a Google Cloud service account.
4. In the Chrome Web Store Developer Dashboard, add the service account email under the publisher's **Account** section.
5. Create a JSON key for the service account in Google Cloud.
6. Copy the publisher ID from the Chrome Web Store Developer Dashboard.
7. Record the extension ID after the first Store item exists.

The Chrome Web Store API supports service accounts specifically for server-to-server and CI/CD workflows, so no interactive OAuth flow is required for GitHub Actions.

Google requires 2-step verification for developers publishing/updating extensions.

## One-time Chrome Web Store setup

Before the first automated publish:

1. Register the extension manually in the Chrome Web Store Developer Dashboard.
2. Complete the Store listing and Privacy tabs.
3. Upload the first package manually.
4. Complete any required developer verification/payment steps.
5. Publish the initial item manually and confirm its extension ID.
6. Confirm the listing's visibility settings are compatible with API publishing.

The first listing cannot be created by this repository workflow; the workflow assumes an existing Store item.

## GitHub setup

Create a GitHub Actions environment named `production`. Configure required reviewers if you want a human approval before a Store submission.

Add these secrets to the `production` environment:

| Secret | Value |
| --- | --- |
| `CWS_SERVICE_ACCOUNT_JSON` | Complete Google Cloud service-account JSON key |
| `CWS_PUBLISHER_ID` | Chrome Web Store publisher ID |
| `CWS_EXTENSION_ID` | Published extension ID |

Do not put the service-account JSON, private key, or any other secret in the repository, workflow YAML, release notes, or GitHub Actions logs.

## Release flow

1. Update `manifest.json` to the next semantic version.
2. Merge the change to `main`.
3. Create and push a matching tag, e.g. `v1.1.0`.
4. The workflow checks that the tag and manifest version match.
5. It builds the extension and produces a ZIP containing the contents of `dist/`.
6. It verifies the ZIP and records a SHA-256 checksum.
7. A GitHub Release is created with the ZIP and checksum.
8. The `production` environment approval gate runs.
9. The workflow authenticates the service account and uploads the ZIP using Chrome Web Store API v2.
10. If the upload is asynchronous, the workflow polls `fetchStatus` for up to two minutes.
11. The workflow calls `publish`, submitting the release for Chrome Web Store review.

A Store submission may remain under review after the workflow succeeds. A successful API publish call means the package was submitted; it does not guarantee immediate public availability.

## Rollback

Do not reuse a published version number. Fix the issue, increment the manifest version, create a new tag, and release the new version.

## Local validation

```bash
node scripts/validate-manifest.mjs
node scripts/validate-release-version.mjs v1.0.0
node scripts/package-extension.mjs
```
