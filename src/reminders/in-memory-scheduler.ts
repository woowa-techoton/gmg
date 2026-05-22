import type { Meeting } from "../domain/types.js";

export interface MeetingSchedulerCallbacks {
  onDeadline(meetingId: string): Promise<void>;
  onApproaching(meetingId: string): Promise<void>;
  onConsidering(meetingId: string): Promise<void>;
}

export class InMemoryMeetingScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout[]>();

  constructor(private readonly callbacks: MeetingSchedulerCallbacks) {}

  scheduleMeeting(meeting: Meeting): void {
    this.cancelMeeting(meeting.id);

    const deadlineAt = new Date(meeting.deadline).getTime();
    const meetingAt = new Date(meeting.meetingTime).getTime();
    const reminderAt = meetingAt - 30 * 60 * 1000;

    const timers = [
      meeting.state === "open" || meeting.state === "confirmed_by_capacity"
        ? this.schedule(deadlineAt, () => this.callbacks.onDeadline(meeting.id))
        : undefined,
      this.schedule(reminderAt, () => this.callbacks.onConsidering(meeting.id)),
      this.schedule(reminderAt, () => this.callbacks.onApproaching(meeting.id))
    ].filter((timer): timer is NodeJS.Timeout => timer !== undefined);

    this.timers.set(meeting.id, timers);
  }

  cancelMeeting(meetingId: string): void {
    const timers = this.timers.get(meetingId) ?? [];
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.timers.delete(meetingId);
  }

  private schedule(at: number, callback: () => Promise<void>): NodeJS.Timeout | undefined {
    const delay = at - Date.now();
    if (delay <= 0) {
      return undefined;
    }

    return setTimeout(() => {
      callback().catch((error) => {
        console.error("GMG scheduled job failed", error);
      });
    }, delay);
  }
}
