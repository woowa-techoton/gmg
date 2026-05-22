import { beforeEach, describe, expect, it } from "vitest";
import { MeetingService } from "../src/domain/meeting-service.js";
import { MemoryMeetingStore } from "../src/storage/memory-meeting-store.js";
import type { Clock } from "../src/domain/types.js";

describe("MeetingService", () => {
  let now: Date;
  let clock: Clock;
  let store: MemoryMeetingStore;
  let service: MeetingService;

  beforeEach(() => {
    now = new Date("2026-05-22T09:00:00.000Z");
    clock = { now: () => now };
    store = new MemoryMeetingStore();
    service = new MeetingService(store, clock);
  });

  it("counts only GMG and late_join, overwrites a user's status, and supports response cancellation", async () => {
    const meeting = await createMeeting({ capacity: 2 });

    const firstResponse = await service.respond(meeting.id, {
      userId: "U1",
      status: "considering"
    });
    expect(firstResponse.participantStatusChange).toMatchObject({
      userId: "U1",
      status: "considering",
      changed: true
    });
    expect(await countedIds(meeting.id)).toEqual([]);

    const changedResponse = await service.respond(meeting.id, {
      userId: "U1",
      status: "GMG"
    });
    expect(changedResponse.participantStatusChange).toMatchObject({
      userId: "U1",
      previousStatus: "considering",
      status: "GMG",
      changed: true
    });
    expect(await countedIds(meeting.id)).toEqual(["U1"]);
    expect(await statusOf(meeting.id, "U1")).toBe("GMG");

    const repeatedResponse = await service.respond(meeting.id, {
      userId: "U1",
      status: "GMG"
    });
    expect(repeatedResponse.participantStatusChange).toMatchObject({
      userId: "U1",
      previousStatus: "GMG",
      status: "GMG",
      changed: false
    });

    await service.respond(meeting.id, { userId: "U2", status: "late_join" });
    expect(await countedIds(meeting.id)).toEqual(["U1", "U2"]);

    await service.respond(meeting.id, { userId: "U2", status: "not_attending" });
    expect(await countedIds(meeting.id)).toEqual(["U1"]);

    await service.cancelResponse(meeting.id, { userId: "U1" });
    expect(await countedIds(meeting.id)).toEqual([]);
    expect(await statusOf(meeting.id, "U1")).toBeUndefined();
  });

  it("treats capacity full as a milestone, allows over-capacity responses, and reopens below capacity", async () => {
    const meeting = await createMeeting({ capacity: 2 });

    const first = await service.respond(meeting.id, { userId: "U1", status: "GMG" });
    expect(first.ok).toBe(true);
    expect(first.events).toEqual([]);

    const full = await service.respond(meeting.id, { userId: "U2", status: "late_join" });
    expect(full.ok).toBe(true);
    expect(full.events).toContain("capacity_confirmed");
    expect(full.meeting.state).toBe("confirmed_by_capacity");

    const overCapacity = await service.respond(meeting.id, { userId: "U3", status: "GMG" });
    expect(overCapacity.ok).toBe(true);
    expect(overCapacity.events).toEqual([]);
    expect(overCapacity.meeting.state).toBe("confirmed_by_capacity");
    expect(await countedIds(meeting.id)).toEqual(["U1", "U2", "U3"]);

    const reopened = await service.cancelResponse(meeting.id, { userId: "U1" });
    expect(reopened.ok).toBe(true);
    expect(reopened.events).toEqual([]);
    expect(reopened.meeting.state).toBe("confirmed_by_capacity");

    const belowCapacity = await service.cancelResponse(meeting.id, { userId: "U2" });
    expect(belowCapacity.ok).toBe(true);
    expect(belowCapacity.events).toContain("capacity_reopened");
    expect(belowCapacity.meeting.state).toBe("open");

    const accepted = await service.respond(meeting.id, { userId: "U4", status: "GMG" });
    expect(accepted.ok).toBe(true);
    expect(accepted.events).toContain("capacity_confirmed");
    expect(await countedIds(meeting.id)).toEqual(["U3", "U4"]);
  });

  it("allows unlimited counted participants when capacity is not set", async () => {
    const meeting = await createMeeting({ capacity: undefined });

    await service.respond(meeting.id, { userId: "U1", status: "GMG" });
    await service.respond(meeting.id, { userId: "U2", status: "late_join" });
    const third = await service.respond(meeting.id, { userId: "U3", status: "GMG" });

    expect(third.ok).toBe(true);
    expect(third.events).not.toContain("capacity_confirmed");
    expect((await store.get(meeting.id))?.state).toBe("open");
    expect(await countedIds(meeting.id)).toEqual(["U1", "U2", "U3"]);
  });

  it("locks participant changes after deadline confirmation and after manual confirmation", async () => {
    const byDeadline = await createMeeting({ capacity: 2 });
    await service.respond(byDeadline.id, { userId: "U1", status: "GMG" });

    const deadlineResult = await service.confirmByDeadline(byDeadline.id);
    expect(deadlineResult.ok).toBe(true);
    expect(deadlineResult.meeting.state).toBe("confirmed_by_deadline");

    const lateClick = await service.respond(byDeadline.id, { userId: "U2", status: "GMG" });
    expect(lateClick.ok).toBe(false);
    expect(lateClick.reason).toBe("meeting_locked");

    const byManual = await createMeeting({ capacity: 2 });
    const manualResult = await service.confirmManually(byManual.id, { userId: "UCREATOR" });
    expect(manualResult.ok).toBe(true);
    expect(manualResult.meeting.state).toBe("confirmed_manually");

    const postManualClick = await service.respond(byManual.id, { userId: "U2", status: "GMG" });
    expect(postManualClick.ok).toBe(false);
    expect(postManualClick.reason).toBe("meeting_locked");
  });

  it("allows only the creator to manually confirm or cancel, and rejects cancellation after final confirmation", async () => {
    const meeting = await createMeeting({ capacity: 2 });

    const nonCreatorConfirm = await service.confirmManually(meeting.id, { userId: "UOTHER" });
    expect(nonCreatorConfirm.ok).toBe(false);
    expect(nonCreatorConfirm.reason).toBe("not_creator");

    const creatorConfirm = await service.confirmManually(meeting.id, { userId: "UCREATOR" });
    expect(creatorConfirm.ok).toBe(true);

    const postConfirmCancel = await service.cancelMeeting(meeting.id, { userId: "UCREATOR" });
    expect(postConfirmCancel.ok).toBe(false);
    expect(postConfirmCancel.reason).toBe("meeting_locked");

    const cancellable = await createMeeting({ capacity: 2 });
    const cancelled = await service.cancelMeeting(cancellable.id, { userId: "UCREATOR" });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.meeting.state).toBe("cancelled");
  });

  async function createMeeting(options: { capacity: number | undefined }) {
    return service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      title: "저녁 번개",
      type: "회식",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: options.capacity
    });
  }

  async function countedIds(meetingId: string) {
    const meeting = await store.get(meetingId);
    return meeting ? service.countedParticipantIds(meeting).sort() : [];
  }

  async function statusOf(meetingId: string, userId: string) {
    return (await store.get(meetingId))?.participants[userId];
  }
});
