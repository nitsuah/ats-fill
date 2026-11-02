import assert from "node:assert/strict";
import test from "node:test";

import { existingReleaseState, publishIfNeeded } from "../scripts/chrome-web-store-publish-lib.mjs";

const revision = (state, ...versions) => ({
  state,
  distributionChannels: versions.map((crxVersion) => ({ crxVersion, deployPercentage: 100 })),
});

test("an exact published version skips upload and publish", async () => {
  const calls = [];
  const result = await publishIfNeeded({
    version: "1.0.4",
    fetchStatus: async () => {
      calls.push("status");
      return { publishedItemRevisionStatus: revision("PUBLISHED", "1.0.3", "1.0.4") };
    },
    upload: async () => calls.push("upload"),
    publish: async () => calls.push("publish"),
    onSkip: ({ version, state }) => calls.push(`skip:${version}:${state}`),
  });

  assert.deepEqual(result, { skipped: true, state: "published" });
  assert.deepEqual(calls, ["status", "skip:1.0.4:published"]);
});

for (const state of ["PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"]) {
  test(`an exact active submitted version skips upload and publish (${state})`, async () => {
    const calls = [];
    const result = await publishIfNeeded({
      version: "1.0.4",
      fetchStatus: async () => {
        calls.push("status");
        return { submittedItemRevisionStatus: revision(state, "1.0.4") };
      },
      upload: async () => calls.push("upload"),
      publish: async () => calls.push("publish"),
    });

    assert.deepEqual(result, { skipped: true, state: `submitted:${state}` });
    assert.deepEqual(calls, ["status"]);
  });
}

test("a different or missing version follows the normal upload/publish path", async () => {
  for (const status of [
    { publishedItemRevisionStatus: revision("PUBLISHED", "1.0.3") },
    {},
    null,
  ]) {
    const calls = [];
    const result = await publishIfNeeded({
      version: "1.0.4",
      fetchStatus: async () => {
        calls.push("status");
        return status;
      },
      upload: async () => {
        calls.push("upload");
        return { uploadState: "SUCCEEDED" };
      },
      publish: async (uploaded) => {
        calls.push("publish");
        return { state: "PENDING_REVIEW", uploaded };
      },
    });

    assert.equal(result.skipped, false);
    assert.deepEqual(calls, ["status", "upload", "publish"]);
  }
});

test("rejected, cancelled, and unknown submitted states are not idempotent success", async () => {
  for (const state of ["REJECTED", "CANCELLED", "ITEM_STATE_UNSPECIFIED", undefined]) {
    const status = {
      submittedItemRevisionStatus: revision(state, "1.0.4"),
    };
    assert.equal(existingReleaseState(status, "1.0.4"), null);
  }
});

test("a failed status request stops before upload or publish", async () => {
  const calls = [];
  await assert.rejects(
    publishIfNeeded({
      version: "1.0.4",
      fetchStatus: async () => {
        calls.push("status");
        throw new Error("status unavailable");
      },
      upload: async () => calls.push("upload"),
      publish: async () => calls.push("publish"),
    }),
    /status unavailable/,
  );
  assert.deepEqual(calls, ["status"]);
});

test("version matching is exact and missing channel data is not a match", () => {
  assert.equal(existingReleaseState({ publishedItemRevisionStatus: revision("PUBLISHED", "1.0.40") }, "1.0.4"), null);
  assert.equal(existingReleaseState({ publishedItemRevisionStatus: { state: "PUBLISHED" } }, "1.0.4"), null);
  assert.equal(existingReleaseState({}, "1.0.4"), null);
});

test("an empty manifest version is rejected before any API operation", async () => {
  await assert.rejects(
    publishIfNeeded({
      version: "",
      fetchStatus: async () => assert.fail("fetchStatus must not run"),
      upload: async () => assert.fail("upload must not run"),
      publish: async () => assert.fail("publish must not run"),
    }),
    /manifest version/,
  );
});
