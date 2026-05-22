import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileMeetingStore } from "../src/storage/file-meeting-store.js";
import type { Meeting } from "../src/domain/types.js";

describe("FileMeetingStore", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("persists meetings across store instances", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gmg-store-"));
    const filePath = join(tempDir, "meetings.json");
    const firstStore = new FileMeetingStore(filePath);

    await firstStore.save(meetingFixture({ id: "M1", title: "저녁 번개" }));

    const secondStore = new FileMeetingStore(filePath);
    expect(await secondStore.get("M1")).toMatchObject({
      id: "M1",
      title: "저녁 번개"
    });
  });

  it("updates a meeting and keeps the JSON file readable", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gmg-store-"));
    const filePath = join(tempDir, "meetings.json");
    const store = new FileMeetingStore(filePath);
    await store.save(meetingFixture({ id: "M1", title: "저녁 번개" }));

    await store.update("M1", (meeting) => {
      meeting.announcementMessageTs = "1716372000.000100";
    });

    const reloaded = new FileMeetingStore(filePath);
    expect((await reloaded.list()).map((meeting) => meeting.id)).toEqual(["M1"]);
    expect((await reloaded.get("M1"))?.announcementMessageTs).toBe(
      "1716372000.000100"
    );
  });
});

function meetingFixture(input: { id: string; title: string }): Meeting {
  return {
    id: input.id,
    creatorUserId: "UCREATOR",
    sourceChannelId: "CSOURCE",
    announcementChannelId: "CANNOUNCE",
    title: input.title,
    type: "회식",
    meetingTime: "2026-05-22T11:00:00.000Z",
    deadline: "2026-05-22T10:00:00.000Z",
    capacity: 4,
    state: "open",
    participants: {},
    createdAt: "2026-05-22T09:00:00.000Z",
    updatedAt: "2026-05-22T09:00:00.000Z"
  };
}
