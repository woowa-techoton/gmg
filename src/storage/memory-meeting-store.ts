import type { Meeting, MeetingStore } from "../domain/types.js";
import { cloneMeeting } from "../domain/types.js";

export class MemoryMeetingStore implements MeetingStore {
  private readonly meetings = new Map<string, Meeting>();

  async get(id: string): Promise<Meeting | undefined> {
    const meeting = this.meetings.get(id);
    return meeting ? cloneMeeting(meeting) : undefined;
  }

  async save(meeting: Meeting): Promise<void> {
    this.meetings.set(meeting.id, cloneMeeting(meeting));
  }

  async update<T>(id: string, updater: (meeting: Meeting) => T): Promise<T> {
    const existing = this.meetings.get(id);
    if (!existing) {
      throw new Error(`Meeting not found: ${id}`);
    }

    const draft = cloneMeeting(existing);
    const result = updater(draft);
    this.meetings.set(id, cloneMeeting(draft));
    return result;
  }

  async list(): Promise<Meeting[]> {
    return Array.from(this.meetings.values()).map(cloneMeeting);
  }
}
