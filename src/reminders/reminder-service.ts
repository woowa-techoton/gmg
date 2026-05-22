import type { MeetingStore } from "../domain/types.js";
import {
  buildApproachingReminderMessage,
  buildCancellationMessage,
  buildConsideringReminderMessage,
  buildFinalConfirmationMessage
} from "../slack/blocks.js";

export interface SlackNotifier {
  postMessage(payload: Record<string, unknown>): Promise<unknown>;
}

export class ReminderService {
  constructor(
    private readonly store: MeetingStore,
    private readonly notifier: SlackNotifier
  ) {}

  async sendConsideringReminder(meetingId: string): Promise<boolean> {
    const meeting = await this.store.get(meetingId);
    if (!meeting || meeting.state === "cancelled") {
      return false;
    }

    const consideringUserIds = Object.entries(meeting.participants)
      .filter(([, status]) => status === "considering")
      .map(([userId]) => userId)
      .sort();
    if (consideringUserIds.length === 0) {
      return false;
    }

    await this.notifier.postMessage({
      channel: meeting.announcementChannelId,
      ...buildConsideringReminderMessage(meeting, consideringUserIds)
    });
    return true;
  }

  async sendApproachingReminder(meetingId: string): Promise<boolean> {
    const meeting = await this.store.get(meetingId);
    if (!meeting || meeting.state === "cancelled") {
      return false;
    }

    await this.notifier.postMessage({
      channel: meeting.announcementChannelId,
      ...buildApproachingReminderMessage(meeting)
    });
    return true;
  }

  async sendFinalConfirmation(
    meetingId: string,
    reason: "deadline" | "manual"
  ): Promise<boolean> {
    const meeting = await this.store.get(meetingId);
    if (!meeting || meeting.state === "cancelled") {
      return false;
    }

    await this.notifier.postMessage({
      channel: meeting.announcementChannelId,
      ...buildFinalConfirmationMessage(meeting, reason)
    });
    return true;
  }

  async sendCancellation(meetingId: string): Promise<boolean> {
    const meeting = await this.store.get(meetingId);
    if (!meeting || meeting.state !== "cancelled") {
      return false;
    }

    await this.notifier.postMessage({
      channel: meeting.announcementChannelId,
      ...buildCancellationMessage(meeting)
    });
    return true;
  }

}
