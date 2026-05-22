import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Meeting, MeetingStore } from "../domain/types.js";
import { cloneMeeting } from "../domain/types.js";

export class FileMeetingStore implements MeetingStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async get(id: string): Promise<Meeting | undefined> {
    const meetings = await this.readAll();
    const meeting = meetings.get(id);
    return meeting ? cloneMeeting(meeting) : undefined;
  }

  async save(meeting: Meeting): Promise<void> {
    await this.withWriteLock(async () => {
      const meetings = await this.readAll();
      meetings.set(meeting.id, cloneMeeting(meeting));
      await this.writeAll(meetings);
    });
  }

  async update<T>(id: string, updater: (meeting: Meeting) => T): Promise<T> {
    return this.withWriteLock(async () => {
      const meetings = await this.readAll();
      const existing = meetings.get(id);
      if (!existing) {
        throw new Error(`Meeting not found: ${id}`);
      }

      const draft = cloneMeeting(existing);
      const result = updater(draft);
      meetings.set(id, cloneMeeting(draft));
      await this.writeAll(meetings);
      return result;
    });
  }

  async list(): Promise<Meeting[]> {
    const meetings = await this.readAll();
    return Array.from(meetings.values()).map(cloneMeeting);
  }

  private async readAll(): Promise<Map<string, Meeting>> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("GMG meeting store file must contain an array.");
      }
      return new Map(
        parsed.map((meeting) => {
          const typedMeeting = meeting as Meeting;
          return [typedMeeting.id, cloneMeeting(typedMeeting)];
        })
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        return new Map();
      }
      throw error;
    }
  }

  private async writeAll(meetings: Map<string, Meeting>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const data = `${JSON.stringify(Array.from(meetings.values()), null, 2)}\n`;
    await writeFile(tempPath, data, "utf8");
    await rename(tempPath, this.filePath);
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
