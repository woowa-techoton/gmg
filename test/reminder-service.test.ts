import { describe, expect, it, vi } from "vitest";
import { MeetingService } from "../src/domain/meeting-service.js";
import { MemoryMeetingStore } from "../src/storage/memory-meeting-store.js";
import { ReminderService } from "../src/reminders/reminder-service.js";
import type { SlackNotifier } from "../src/reminders/reminder-service.js";
import type { Clock } from "../src/domain/types.js";

describe("ReminderService", () => {
  const clock: Clock = { now: () => new Date("2026-05-22T09:00:00.000Z") };

  it("mentions only considering users in the 30-minute considering reminder", async () => {
    const { service, reminderService, notifier } = makeSubject();
    const meeting = await service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      announcementMessageTs: "1716372000.000100",
      title: "저녁 번개",
      type: "회식",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: 4
    });
    await service.respond(meeting.id, { userId: "U1", status: "considering" });
    await service.respond(meeting.id, { userId: "U2", status: "GMG" });
    await service.respond(meeting.id, { userId: "U3", status: "not_attending" });

    const sent = await reminderService.sendConsideringReminder(meeting.id);

    expect(sent).toBe(true);
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "CANNOUNCE",
        text: expect.stringContaining("GMG")
      })
    );
    const payload = notifier.postMessage.mock.calls[0][0];
    expect(JSON.stringify(payload)).toContain("<@U1>");
    expect(JSON.stringify(payload)).not.toContain("<@U2>");
    expect(JSON.stringify(payload)).not.toContain("<@U3>");
  });

  it("suppresses considering reminders when there are no considering users or the meeting is cancelled", async () => {
    const { service, reminderService, notifier } = makeSubject();
    const meeting = await service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      announcementMessageTs: "1716372000.000100",
      title: "저녁 번개",
      type: "회식",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: 4
    });

    expect(await reminderService.sendConsideringReminder(meeting.id)).toBe(false);

    await service.respond(meeting.id, { userId: "U1", status: "considering" });
    await service.cancelMeeting(meeting.id, { userId: "UCREATOR" });

    expect(await reminderService.sendConsideringReminder(meeting.id)).toBe(false);
    expect(notifier.postMessage).not.toHaveBeenCalled();
  });

  it("suppresses approaching reminders after cancellation", async () => {
    const { service, reminderService, notifier } = makeSubject();
    const meeting = await service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      announcementMessageTs: "1716372000.000100",
      title: "저녁 번개",
      type: "회식",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: undefined
    });
    await service.respond(meeting.id, { userId: "U1", status: "GMG" });
    await service.cancelMeeting(meeting.id, { userId: "UCREATOR" });

    expect(await reminderService.sendApproachingReminder(meeting.id)).toBe(false);
    expect(notifier.postMessage).not.toHaveBeenCalled();
  });

  function makeSubject() {
    const store = new MemoryMeetingStore();
    const service = new MeetingService(store, clock);
    const notifier = {
      postMessage: vi.fn(async (_payload: Record<string, unknown>) => ({ ok: true }))
    } satisfies SlackNotifier;
    const reminderService = new ReminderService(store, notifier);
    return { service, reminderService, notifier };
  }
});
