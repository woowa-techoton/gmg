export type ParticipantStatus =
  | "GMG"
  | "late_join"
  | "considering"
  | "not_attending";

export type MeetingState =
  | "open"
  | "confirmed_by_capacity"
  | "confirmed_by_deadline"
  | "confirmed_manually"
  | "cancelled";

export type MeetingEvent =
  | "capacity_confirmed"
  | "capacity_reopened"
  | "deadline_confirmed"
  | "manual_confirmed"
  | "cancelled";

export type FailureReason =
  | "deadline_passed"
  | "meeting_locked"
  | "not_creator"
  | "invalid_status";

export interface Clock {
  now(): Date;
}

export interface Meeting {
  id: string;
  creatorUserId: string;
  sourceChannelId: string;
  announcementChannelId: string;
  announcementMessageTs?: string;
  creatorControlsChannelId?: string;
  creatorControlsMessageTs?: string;
  title: string;
  type: string;
  meetingTime: string;
  deadline: string;
  capacity?: number;
  state: MeetingState;
  participants: Record<string, ParticipantStatus>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMeetingInput {
  creatorUserId: string;
  sourceChannelId: string;
  announcementChannelId: string;
  announcementMessageTs?: string;
  title: string;
  type: string;
  meetingTime: Date;
  deadline: Date;
  capacity?: number;
}

export interface ParticipantMutationInput {
  userId: string;
  status: ParticipantStatus;
}

export interface UserScopedMutationInput {
  userId: string;
}

export interface ParticipantStatusChange {
  userId: string;
  previousStatus?: ParticipantStatus;
  status?: ParticipantStatus;
  changed: boolean;
}

export interface MeetingMutationResult {
  ok: boolean;
  meeting: Meeting;
  events: MeetingEvent[];
  reason?: FailureReason;
  participantStatusChange?: ParticipantStatusChange;
}

export interface MeetingStore {
  get(id: string): Promise<Meeting | undefined>;
  save(meeting: Meeting): Promise<void>;
  update<T>(id: string, updater: (meeting: Meeting) => T): Promise<T>;
  list(): Promise<Meeting[]>;
}

export const COUNTED_STATUSES = new Set<ParticipantStatus>([
  "GMG",
  "late_join"
]);

export const LOCKED_STATES = new Set<MeetingState>([
  "confirmed_by_deadline",
  "confirmed_manually",
  "cancelled"
]);

export function isCountedStatus(status: ParticipantStatus | undefined): boolean {
  return status !== undefined && COUNTED_STATUSES.has(status);
}

export function isLockedState(state: MeetingState): boolean {
  return LOCKED_STATES.has(state);
}

export function cloneMeeting(meeting: Meeting): Meeting {
  return {
    ...meeting,
    participants: { ...meeting.participants }
  };
}
