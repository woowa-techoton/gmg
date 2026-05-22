import { randomUUID } from "node:crypto";
import type {
  Clock,
  CreateMeetingInput,
  Meeting,
  MeetingEvent,
  MeetingMutationResult,
  MeetingStore,
  ParticipantMutationInput,
  UserScopedMutationInput
} from "./types.js";
import { isCountedStatus, isLockedState } from "./types.js";

const systemClock: Clock = {
  now: () => new Date()
};

export class MeetingService {
  constructor(
    private readonly store: MeetingStore,
    private readonly clock: Clock = systemClock,
    private readonly idFactory: () => string = randomUUID
  ) {}

  async getMeeting(meetingId: string): Promise<Meeting | undefined> {
    return this.store.get(meetingId);
  }

  async listMeetingsForCreator(creatorUserId: string): Promise<Meeting[]> {
    const meetings = await this.store.list();
    return meetings
      .filter((meeting) => meeting.creatorUserId === creatorUserId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    const now = this.clock.now();
    validateCreateMeeting(input, now);

    const timestamp = now.toISOString();
    const meeting: Meeting = {
      id: this.idFactory(),
      creatorUserId: input.creatorUserId,
      sourceChannelId: input.sourceChannelId,
      announcementChannelId: input.announcementChannelId,
      announcementMessageTs: input.announcementMessageTs,
      title: input.title.trim(),
      type: input.type.trim(),
      meetingTime: input.meetingTime.toISOString(),
      deadline: input.deadline.toISOString(),
      capacity: input.capacity,
      state: "open",
      participants: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.store.save(meeting);
    return meeting;
  }

  async recordAnnouncementMessage(
    meetingId: string,
    announcementMessageTs: string
  ): Promise<MeetingMutationResult> {
    return this.store.update(meetingId, (meeting) => {
      meeting.announcementMessageTs = announcementMessageTs;
      meeting.updatedAt = this.clock.now().toISOString();
      return success(meeting, []);
    });
  }

  async recordCreatorControlsMessage(
    meetingId: string,
    creatorControlsChannelId: string,
    creatorControlsMessageTs: string
  ): Promise<MeetingMutationResult> {
    return this.store.update(meetingId, (meeting) => {
      meeting.creatorControlsChannelId = creatorControlsChannelId;
      meeting.creatorControlsMessageTs = creatorControlsMessageTs;
      meeting.updatedAt = this.clock.now().toISOString();
      return success(meeting, []);
    });
  }

  async respond(
    meetingId: string,
    input: ParticipantMutationInput
  ): Promise<MeetingMutationResult> {
    return this.store.update(meetingId, (meeting) => {
      const guard = this.guardParticipantMutation(meeting);
      if (guard) {
        return failure(meeting, guard);
      }

      const previousStatus = meeting.participants[input.userId];
      meeting.participants[input.userId] = input.status;
      meeting.updatedAt = this.clock.now().toISOString();
      const events = this.reconcileCapacityState(meeting);
      return success(meeting, events, {
        userId: input.userId,
        previousStatus,
        status: input.status,
        changed: previousStatus !== input.status
      });
    });
  }

  async cancelResponse(
    meetingId: string,
    input: UserScopedMutationInput
  ): Promise<MeetingMutationResult> {
    return this.store.update(meetingId, (meeting) => {
      const guard = this.guardParticipantMutation(meeting);
      if (guard) {
        return failure(meeting, guard);
      }

      const previousStatus = meeting.participants[input.userId];
      delete meeting.participants[input.userId];
      meeting.updatedAt = this.clock.now().toISOString();
      const events = this.reconcileCapacityState(meeting);
      return success(meeting, events, {
        userId: input.userId,
        previousStatus,
        changed: previousStatus !== undefined
      });
    });
  }

  async confirmByDeadline(meetingId: string): Promise<MeetingMutationResult> {
    return this.store.update(meetingId, (meeting) => {
      if (meeting.state === "confirmed_by_deadline") {
        return success(meeting, []);
      }
      if (meeting.state === "cancelled" || meeting.state === "confirmed_manually") {
        return failure(meeting, "meeting_locked");
      }

      meeting.state = "confirmed_by_deadline";
      meeting.updatedAt = this.clock.now().toISOString();
      return success(meeting, ["deadline_confirmed"]);
    });
  }

  async confirmManually(
    meetingId: string,
    input: UserScopedMutationInput
  ): Promise<MeetingMutationResult> {
    return this.store.update(meetingId, (meeting) => {
      const creatorGuard = this.guardCreator(meeting, input.userId);
      if (creatorGuard) {
        return failure(meeting, creatorGuard);
      }
      if (isLockedState(meeting.state)) {
        return failure(meeting, "meeting_locked");
      }

      meeting.state = "confirmed_manually";
      meeting.updatedAt = this.clock.now().toISOString();
      return success(meeting, ["manual_confirmed"]);
    });
  }

  async cancelMeeting(
    meetingId: string,
    input: UserScopedMutationInput
  ): Promise<MeetingMutationResult> {
    return this.store.update(meetingId, (meeting) => {
      const creatorGuard = this.guardCreator(meeting, input.userId);
      if (creatorGuard) {
        return failure(meeting, creatorGuard);
      }
      if (isLockedState(meeting.state)) {
        return failure(meeting, "meeting_locked");
      }

      meeting.state = "cancelled";
      meeting.updatedAt = this.clock.now().toISOString();
      return success(meeting, ["cancelled"]);
    });
  }

  countedParticipantIds(meeting: Meeting): string[] {
    return Object.entries(meeting.participants)
      .filter(([, status]) => isCountedStatus(status))
      .map(([userId]) => userId);
  }

  participantIdsByStatus(meeting: Meeting, status: string): string[] {
    return Object.entries(meeting.participants)
      .filter(([, participantStatus]) => participantStatus === status)
      .map(([userId]) => userId);
  }

  private guardParticipantMutation(meeting: Meeting) {
    if (isLockedState(meeting.state)) {
      return "meeting_locked" as const;
    }
    if (this.clock.now().getTime() >= new Date(meeting.deadline).getTime()) {
      return "deadline_passed" as const;
    }
    return undefined;
  }

  private guardCreator(meeting: Meeting, userId: string) {
    if (meeting.creatorUserId !== userId) {
      return "not_creator" as const;
    }
    return undefined;
  }

  private reconcileCapacityState(meeting: Meeting): MeetingEvent[] {
    if (meeting.capacity === undefined) {
      return [];
    }

    const counted = this.countedParticipantIds(meeting).length;
    if (meeting.state === "confirmed_by_capacity" && counted < meeting.capacity) {
      meeting.state = "open";
      return ["capacity_reopened"];
    }

    if (meeting.state === "open" && counted >= meeting.capacity) {
      meeting.state = "confirmed_by_capacity";
      return ["capacity_confirmed"];
    }

    return [];
  }
}

function success(
  meeting: Meeting,
  events: MeetingEvent[],
  participantStatusChange?: MeetingMutationResult["participantStatusChange"]
): MeetingMutationResult {
  return { ok: true, meeting, events, participantStatusChange };
}

function failure(
  meeting: Meeting,
  reason: MeetingMutationResult["reason"]
): MeetingMutationResult {
  return { ok: false, meeting, events: [], reason };
}

function validateCreateMeeting(input: CreateMeetingInput, now: Date): void {
  if (!input.title.trim()) {
    throw new Error("Meeting title is required.");
  }
  if (!input.type.trim()) {
    throw new Error("Meeting type is required.");
  }
  if (input.meetingTime.getTime() <= now.getTime()) {
    throw new Error("Meeting time must be in the future.");
  }
  if (input.deadline.getTime() <= now.getTime()) {
    throw new Error("Deadline must be in the future.");
  }
  if (input.deadline.getTime() > input.meetingTime.getTime()) {
    throw new Error("Deadline must be earlier than or equal to meeting time.");
  }
  if (
    input.capacity !== undefined &&
    (!Number.isInteger(input.capacity) || input.capacity <= 0)
  ) {
    throw new Error("Capacity must be a positive integer.");
  }
}
