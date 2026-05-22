import type { Clock, Meeting, ParticipantStatus } from "../domain/types.js";
import { isLockedState } from "../domain/types.js";
import type { MeetingService } from "../domain/meeting-service.js";
import type { InMemoryMeetingScheduler } from "../reminders/in-memory-scheduler.js";
import {
  ACTION_IDS,
  APP_HOME_SOURCE_CHANNEL_ID,
  buildAnnouncementMessage,
  buildCancellationMessage,
  buildCapacityConfirmedMessage,
  buildCreateMeetingFormBlocks,
  buildCreatorControlsMessage,
  buildFinalConfirmationMessage,
  buildHomeView,
  buildParticipantThreadNudgeMessage,
  CREATE_HOME_FIELD_IDS,
  CREATE_MODAL_FIELD_IDS
} from "./blocks.js";

export { ACTION_IDS, CREATE_HOME_FIELD_IDS, CREATE_MODAL_FIELD_IDS } from "./blocks.js";

export const CREATE_MODAL_CALLBACK_ID = "gmg_create_meeting";

export interface SlackHandlersDependencies {
  announcementChannelId: string;
  clock: Clock;
  service: MeetingService;
  scheduler?: Pick<InMemoryMeetingScheduler, "scheduleMeeting" | "cancelMeeting">;
  timezoneOffset?: string;
  onSlowSideEffect?: (name: string) => void;
}

export function createSlackHandlers(deps: SlackHandlersDependencies) {
  const timezoneOffset = deps.timezoneOffset ?? "+09:00";
  const createAndAnnounceMeeting = async (
    client: PostMessageClient,
    creatorUserId: string,
    parsed: ParsedCreateMeetingView
  ): Promise<Meeting> => {
    const meeting = await deps.service.createMeeting({
      creatorUserId,
      sourceChannelId: parsed.sourceChannelId,
      announcementChannelId: deps.announcementChannelId,
      title: parsed.title,
      type: parsed.type,
      meetingTime: parsed.meetingTime,
      deadline: parsed.deadline,
      capacity: parsed.capacity
    });

    const message = buildAnnouncementMessage(meeting);
    const postResult = await client.chat.postMessage({
      channel: deps.announcementChannelId,
      ...message
    });
    const ts = typeof postResult?.ts === "string" ? postResult.ts : undefined;
    const storedMeeting = ts
      ? (await deps.service.recordAnnouncementMessage(meeting.id, ts)).meeting
      : meeting;
    const creatorControlsRef = await sendCreatorControlsToAppChat(
      client,
      storedMeeting
    );
    const meetingWithCreatorControls = creatorControlsRef
      ? (
          await deps.service.recordCreatorControlsMessage(
            storedMeeting.id,
            creatorControlsRef.channelId,
            creatorControlsRef.messageTs
          )
        ).meeting
      : storedMeeting;
    deps.scheduler?.scheduleMeeting(meetingWithCreatorControls);
    return meetingWithCreatorControls;
  };

  const publishHome = async (
    client: HomeClient,
    userId: string,
    options: { formErrors?: Record<string, string> } = {}
  ): Promise<void> => {
    const meetings = await deps.service.listMeetingsForCreator(userId);
    await client.views.publish({
      user_id: userId,
      view: buildHomeView(userId, meetings, {
        ...options,
        now: deps.clock.now(),
        timezoneOffset
      })
    });
  };

  return {
    async handleCommand(args: {
      ack: () => Promise<void>;
      client: ViewsClient;
      command: { trigger_id: string; channel_id: string; user_id: string };
    }) {
      await args.ack();
      await args.client.views.open({
        trigger_id: args.command.trigger_id,
        view: buildCreateMeetingModal(
          {
            sourceChannelId: args.command.channel_id,
            creatorUserId: args.command.user_id
          },
          deps.clock.now(),
          timezoneOffset
        )
      });
    },

    async handleAppHomeOpened(args: {
      client: HomeClient;
      event: { user: string };
    }) {
      await publishHome(args.client, args.event.user);
    },

    async handleAppHomeCreateAction(args: {
      ack: () => Promise<void>;
      client: ViewsClient;
      body: { trigger_id: string; user: { id: string } };
    }) {
      await args.ack();
      await args.client.views.open({
        trigger_id: args.body.trigger_id,
        view: buildCreateMeetingModal(
          {
            sourceChannelId: APP_HOME_SOURCE_CHANNEL_ID,
            creatorUserId: args.body.user.id
          },
          deps.clock.now(),
          timezoneOffset
        )
      });
    },

    async handleAppHomeSubmitAction(args: {
      ack: () => Promise<void>;
      client: HomeSubmitClient;
      body: { user: { id: string }; view: SlackViewSubmission };
    }) {
      await args.ack();
      const parsed = parseCreateMeetingView(
        args.body.view,
        timezoneOffset,
        deps.clock.now()
      );
      if (!parsed.ok) {
        await publishHome(args.client, args.body.user.id, {
          formErrors: parsed.errors
        });
        return;
      }

      await createAndAnnounceMeeting(args.client, args.body.user.id, parsed.value);
      await publishHome(args.client, args.body.user.id);
    },

    async handleViewSubmission(args: {
      ack: (response?: Record<string, unknown>) => Promise<void>;
      client: PostMessageClient;
      body: { user: { id: string } };
      view: SlackViewSubmission;
    }) {
      const parsed = parseCreateMeetingView(
        args.view,
        timezoneOffset,
        deps.clock.now()
      );
      if (!parsed.ok) {
        await args.ack({
          response_action: "errors",
          errors: parsed.errors
        });
        return;
      }

      await args.ack();
      await createAndAnnounceMeeting(args.client, args.body.user.id, parsed.value);
    },

    async handleParticipantAction(args: {
      ack: () => Promise<void>;
      client: ChatClient;
      body: { user: { id: string } };
      action: { action_id: string; value?: string };
      respond?: (message: Record<string, unknown>) => Promise<void>;
    }) {
      await args.ack();
      const meetingId = args.action.value;
      if (!meetingId) {
        await privateReply(args.respond, "모임 정보를 찾을 수 없습니다.");
        return;
      }

      const participantStatus = statusFromActionId(args.action.action_id);
      const result =
        args.action.action_id === ACTION_IDS.participant.cancel_response
          ? await deps.service.cancelResponse(meetingId, {
              userId: args.body.user.id
            })
          : participantStatus
            ? await deps.service.respond(meetingId, {
                userId: args.body.user.id,
                status: participantStatus
              })
            : undefined;

      if (!result) {
        await privateReply(args.respond, "알 수 없는 GMG 버튼입니다.");
        return;
      }
      if (!result.ok) {
        await privateReply(args.respond, rejectionText(result.reason));
        return;
      }

      await updateAnnouncement(args.client, result.meeting, args.body.user.id);
      if (participantStatus && result.participantStatusChange?.changed) {
        await postParticipantThreadNudge(
          args.client,
          result.meeting,
          args.body.user.id,
          participantStatus
        );
      }
      if (result.events.includes("capacity_confirmed")) {
        await args.client.chat.postMessage({
          channel: result.meeting.announcementChannelId,
          ...buildCapacityConfirmedMessage(result.meeting)
        });
      }
    },

    async handleCreatorAction(args: {
      ack: () => Promise<void>;
      client: ChatClient;
      body: CreatorActionBody;
      action: { action_id: string; value?: string };
      respond?: (message: Record<string, unknown>) => Promise<void>;
    }) {
      await args.ack();
      const meetingId = args.action.value;
      if (!meetingId) {
        await privateReply(args.respond, "모임 정보를 찾을 수 없습니다.");
        return;
      }

      if (args.action.action_id === ACTION_IDS.creator.open_controls) {
        await showCreatorControls({
          service: deps.service,
          meetingId,
          userId: args.body.user.id,
          respond: args.respond
        });
        return;
      }

      const result =
        args.action.action_id === ACTION_IDS.creator.confirm_meeting
          ? await deps.service.confirmManually(meetingId, {
              userId: args.body.user.id
            })
          : args.action.action_id === ACTION_IDS.creator.cancel_meeting
            ? await deps.service.cancelMeeting(meetingId, {
                userId: args.body.user.id
              })
            : undefined;

      if (!result) {
        await privateReply(args.respond, "알 수 없는 생성자 버튼입니다.");
        return;
      }
      if (!result.ok) {
        if (result.reason === "meeting_locked") {
          await updateCreatorControlsMessage(args.client, result.meeting, args.body);
        }
        await privateReply(args.respond, rejectionText(result.reason));
        return;
      }

      await updateAnnouncement(args.client, result.meeting);
      await updateCreatorControlsMessage(args.client, result.meeting, args.body);
      if (result.events.includes("manual_confirmed")) {
        await args.client.chat.postMessage({
          channel: result.meeting.announcementChannelId,
          ...buildFinalConfirmationMessage(result.meeting, "manual")
        });
      }
      if (result.events.includes("cancelled")) {
        deps.scheduler?.cancelMeeting(result.meeting.id);
        await args.client.chat.postMessage({
          channel: result.meeting.announcementChannelId,
          ...buildCancellationMessage(result.meeting)
        });
      }
    }
  };
}

export async function updateAnnouncement(
  client: UpdateMessageClient,
  meeting: Meeting,
  selectedUserId?: string
): Promise<void> {
  if (!meeting.announcementMessageTs) {
    return;
  }

  try {
    await client.chat.update({
      channel: meeting.announcementChannelId,
      ts: meeting.announcementMessageTs,
      ...buildAnnouncementMessage(meeting, { selectedUserId })
    });
  } catch (error) {
    console.error("GMG announcement update failed", error);
  }
}

async function postParticipantThreadNudge(
  client: PostMessageClient,
  meeting: Meeting,
  userId: string,
  status: ParticipantStatus
): Promise<void> {
  if (!meeting.announcementMessageTs) {
    return;
  }

  try {
    await client.chat.postMessage({
      channel: meeting.announcementChannelId,
      thread_ts: meeting.announcementMessageTs,
      ...buildParticipantThreadNudgeMessage(userId, status)
    });
  } catch (error) {
    console.error("GMG participant thread nudge failed", error);
  }
}

function statusFromActionId(actionId: string): ParticipantStatus | undefined {
  const entries = Object.entries(ACTION_IDS.participant).filter(
    ([key]) => key !== "cancel_response"
  ) as Array<[ParticipantStatus, string]>;
  return entries.find(([, value]) => value === actionId)?.[0];
}

async function privateReply(
  respond: ((message: Record<string, unknown>) => Promise<void>) | undefined,
  text: string
): Promise<void> {
  if (!respond) {
    return;
  }
  await respond({
    response_type: "ephemeral",
    text
  });
}

async function sendCreatorControlsToAppChat(
  client: PostMessageClient,
  meeting: Meeting
): Promise<PostedMessageRef | undefined> {
  try {
    const result = await client.chat.postMessage({
      channel: meeting.creatorUserId,
      ...buildCreatorControlsMessage(meeting)
    });
    const messageTs = typeof result?.ts === "string" ? result.ts : undefined;
    if (!messageTs) {
      return undefined;
    }

    return {
      channelId: typeof result?.channel === "string" ? result.channel : meeting.creatorUserId,
      messageTs
    };
  } catch (error) {
    console.error("GMG creator controls app chat message failed", error);
    return undefined;
  }
}

export async function updateCreatorControlsMessage(
  client: UpdateMessageClient,
  meeting: Meeting,
  body?: CreatorActionBody
): Promise<void> {
  const target = creatorControlsTarget(meeting, body);
  if (!target) {
    return;
  }

  try {
    await client.chat.update({
      channel: target.channelId,
      ts: target.messageTs,
      ...buildCreatorControlsMessage(meeting)
    });
  } catch (error) {
    console.error("GMG creator controls update failed", error);
  }
}

function creatorControlsTarget(
  meeting: Meeting,
  body?: CreatorActionBody
): PostedMessageRef | undefined {
  if (meeting.creatorControlsChannelId && meeting.creatorControlsMessageTs) {
    return {
      channelId: meeting.creatorControlsChannelId,
      messageTs: meeting.creatorControlsMessageTs
    };
  }

  const channelId = body?.container?.channel_id ?? body?.channel?.id;
  const messageTs = body?.container?.message_ts ?? body?.message?.ts;
  return channelId && messageTs ? { channelId, messageTs } : undefined;
}

async function showCreatorControls(args: {
  service: MeetingService;
  meetingId: string;
  userId: string;
  respond?: (message: Record<string, unknown>) => Promise<void>;
}): Promise<void> {
  const meeting = await args.service.getMeeting(args.meetingId);
  if (!meeting) {
    await privateReply(args.respond, "모임 정보를 찾을 수 없습니다.");
    return;
  }
  if (meeting.creatorUserId !== args.userId) {
    await privateReply(args.respond, rejectionText("not_creator"));
    return;
  }
  if (isLockedState(meeting.state)) {
    await privateReply(args.respond, rejectionText("meeting_locked"));
    return;
  }

  if (!args.respond) {
    return;
  }

  await args.respond({
    response_type: "ephemeral",
    ...buildCreatorControlsMessage(meeting)
  });
}

function rejectionText(reason: string | undefined): string {
  switch (reason) {
    case "deadline_passed":
      return "마감 시간이 지나 참여 상태를 바꿀 수 없습니다.";
    case "meeting_locked":
      return "이미 확정되었거나 취소된 모임입니다.";
    case "not_creator":
      return "모임 생성자만 할 수 있는 작업입니다.";
    default:
      return "요청을 처리할 수 없습니다.";
  }
}

interface ParsedCreateMeetingView {
  sourceChannelId: string;
  title: string;
  type: string;
  meetingTime: Date;
  deadline: Date;
  capacity?: number;
}

type ParseResult =
  | { ok: true; value: ParsedCreateMeetingView }
  | { ok: false; errors: Record<string, string> };

function parseCreateMeetingView(
  view: SlackViewSubmission,
  timezoneOffset: string,
  now: Date
): ParseResult {
  const errors: Record<string, string> = {};
  const metadata = parsePrivateMetadata(view.private_metadata);
  const values = view.state.values;

  const title = textValue(values, CREATE_MODAL_FIELD_IDS.title);
  const type = textValue(values, CREATE_MODAL_FIELD_IDS.type);
  const meetingDate = selectedDateFrom(values, [
    CREATE_HOME_FIELD_IDS.meetingDate,
    CREATE_MODAL_FIELD_IDS.meetingDate
  ]);
  const meetingTime = selectedFiveMinuteTimeFrom(values, [
    {
      hourIds: CREATE_HOME_FIELD_IDS.meetingTime,
      minuteIds: CREATE_HOME_FIELD_IDS.meetingMinute
    },
    {
      hourIds: CREATE_MODAL_FIELD_IDS.meetingTime,
      minuteIds: CREATE_MODAL_FIELD_IDS.meetingMinute
    }
  ]);
  const capacityMode = selectedOptionValueFrom(values, [
    CREATE_HOME_FIELD_IDS.capacityMode,
    CREATE_MODAL_FIELD_IDS.capacityMode
  ]);
  const capacityRaw =
    selectedOptionValueFrom(values, [
      CREATE_HOME_FIELD_IDS.capacity,
      CREATE_MODAL_FIELD_IDS.capacity
    ]) ?? textValue(values, CREATE_MODAL_FIELD_IDS.capacity);
  const deadlineDate = selectedDateFrom(values, [
    CREATE_HOME_FIELD_IDS.deadlineDate,
    CREATE_MODAL_FIELD_IDS.deadlineDate
  ]);
  const deadlineTime = selectedFiveMinuteTimeFrom(values, [
    {
      hourIds: CREATE_HOME_FIELD_IDS.deadlineTime,
      minuteIds: CREATE_HOME_FIELD_IDS.deadlineMinute
    },
    {
      hourIds: CREATE_MODAL_FIELD_IDS.deadlineTime,
      minuteIds: CREATE_MODAL_FIELD_IDS.deadlineMinute
    }
  ]);

  if (!metadata.sourceChannelId) {
    errors[CREATE_MODAL_FIELD_IDS.title.blockId] = "source channel을 찾을 수 없습니다.";
  }
  if (!title) {
    errors[CREATE_MODAL_FIELD_IDS.title.blockId] = "모임명을 입력해주세요.";
  }
  if (!type) {
    errors[CREATE_MODAL_FIELD_IDS.type.blockId] = "모임 종류를 입력해주세요.";
  }
  if (!meetingDate || !meetingTime.value || meetingTime.incomplete) {
    errors[CREATE_MODAL_FIELD_IDS.meetingDate.blockId] = "약속 날짜와 시간을 선택해주세요.";
  }
  if (!deadlineDate || !deadlineTime.value || deadlineTime.incomplete) {
    errors[CREATE_MODAL_FIELD_IDS.deadlineDate.blockId] = "마감 날짜와 시간을 선택해주세요.";
  }
  if (meetingTime.invalidStep) {
    errors[CREATE_MODAL_FIELD_IDS.meetingTime.blockId] =
      "약속 시간은 5분 단위로 선택해주세요.";
  }
  if (deadlineTime.invalidStep) {
    errors[CREATE_MODAL_FIELD_IDS.deadlineTime.blockId] =
      "마감 시간은 5분 단위로 선택해주세요.";
  }
  if (capacityMode !== "limited" && capacityMode !== "unlimited") {
    errors[CREATE_MODAL_FIELD_IDS.capacityMode.blockId] = "정원 모드를 선택해주세요.";
  }

  let capacity: number | undefined;
  if (capacityMode === "limited") {
    const parsedCapacity = Number.parseInt(capacityRaw ?? "", 10);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity <= 0) {
      errors[CREATE_MODAL_FIELD_IDS.capacity.blockId] = "정원은 양의 정수여야 합니다.";
    } else {
      capacity = parsedCapacity;
    }
  }

  const parsedMeetingTime =
    meetingDate && meetingTime.value
      ? dateFromSlackDateTime(meetingDate, meetingTime.value, timezoneOffset)
      : undefined;
  const parsedDeadline =
    deadlineDate && deadlineTime.value
      ? dateFromSlackDateTime(deadlineDate, deadlineTime.value, timezoneOffset)
      : undefined;

  if (
    parsedMeetingTime &&
    parsedDeadline &&
    parsedDeadline.getTime() > parsedMeetingTime.getTime()
  ) {
    errors[CREATE_MODAL_FIELD_IDS.deadlineDate.blockId] =
      "마감 시간은 약속 시간보다 이르거나 같아야 합니다.";
  }
  if (parsedMeetingTime && parsedMeetingTime.getTime() <= now.getTime()) {
    errors[CREATE_MODAL_FIELD_IDS.meetingTime.blockId] =
      "약속 시간은 현재 시간보다 이후여야 합니다.";
  }
  if (parsedDeadline && parsedDeadline.getTime() <= now.getTime()) {
    errors[CREATE_MODAL_FIELD_IDS.deadlineTime.blockId] =
      "마감 시간은 현재 시간보다 이후여야 합니다.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      sourceChannelId: metadata.sourceChannelId ?? "",
      title: title ?? "",
      type: type ?? "",
      meetingTime: parsedMeetingTime ?? new Date(),
      deadline: parsedDeadline ?? new Date(),
      capacity
    }
  };
}

function buildCreateMeetingModal(
  input: {
    sourceChannelId: string;
    creatorUserId: string;
  },
  now: Date,
  timezoneOffset: string
): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: CREATE_MODAL_CALLBACK_ID,
    title: { type: "plain_text", text: "GMG 만들기", emoji: true },
    submit: { type: "plain_text", text: "공지", emoji: true },
    close: { type: "plain_text", text: "취소", emoji: true },
    private_metadata: JSON.stringify(input),
    blocks: buildCreateMeetingFormBlocks({ now, timezoneOffset })
  };
}

function parsePrivateMetadata(metadata: string | undefined): {
  sourceChannelId?: string;
} {
  if (!metadata) {
    return {};
  }
  try {
    const parsed = JSON.parse(metadata) as { sourceChannelId?: string };
    return parsed;
  } catch {
    return {};
  }
}

function dateFromSlackDateTime(
  date: string,
  time: string,
  timezoneOffset: string
): Date {
  return new Date(`${date}T${time}:00${timezoneOffset}`);
}

function textValue(
  values: SlackViewSubmission["state"]["values"],
  ids: { blockId: string; actionId: string }
): string | undefined {
  const value = values[ids.blockId]?.[ids.actionId]?.value;
  return typeof value === "string" ? value.trim() : undefined;
}

function selectedDateFrom(
  values: SlackViewSubmission["state"]["values"],
  candidates: Array<{ blockId: string; actionId: string }>
): string | undefined {
  for (const ids of candidates) {
    const value = selectedDate(values, ids);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function selectedDate(
  values: SlackViewSubmission["state"]["values"],
  ids: { blockId: string; actionId: string }
): string | undefined {
  const value = values[ids.blockId]?.[ids.actionId]?.selected_date;
  return typeof value === "string" ? value : undefined;
}

function selectedFiveMinuteTimeFrom(
  values: SlackViewSubmission["state"]["values"],
  candidates: Array<{
    hourIds: { blockId: string; actionId: string };
    minuteIds: { blockId: string; actionId: string };
  }>
): { value?: string; incomplete?: boolean; invalidStep?: boolean } {
  for (const candidate of candidates) {
    const result = selectedFiveMinuteTime(
      values,
      candidate.hourIds,
      candidate.minuteIds
    );
    if (result.value || result.incomplete || result.invalidStep) {
      return result;
    }
  }
  return {};
}

function selectedFiveMinuteTime(
  values: SlackViewSubmission["state"]["values"],
  hourIds: { blockId: string; actionId: string },
  minuteIds: { blockId: string; actionId: string }
): { value?: string; incomplete?: boolean; invalidStep?: boolean } {
  const hour = selectedOptionValue(values, hourIds);
  const minute = selectedOptionValue(values, minuteIds);
  const hasSplitTime = hour !== undefined || minute !== undefined;

  if (hasSplitTime) {
    if (!hour || !minute) {
      return { incomplete: true };
    }
    if (!isHourValue(hour) || !isFiveMinuteValue(minute)) {
      return { invalidStep: true };
    }
    return { value: `${hour}:${minute}` };
  }

  const legacyTimepickerValue = selectedTime(values, hourIds);
  if (!legacyTimepickerValue) {
    return {};
  }
  if (!isFiveMinuteTime(legacyTimepickerValue)) {
    return { invalidStep: true };
  }
  return { value: legacyTimepickerValue };
}

function selectedTime(
  values: SlackViewSubmission["state"]["values"],
  ids: { blockId: string; actionId: string }
): string | undefined {
  const value = values[ids.blockId]?.[ids.actionId]?.selected_time;
  return typeof value === "string" ? value : undefined;
}

function selectedOptionValue(
  values: SlackViewSubmission["state"]["values"],
  ids: { blockId: string; actionId: string }
): string | undefined {
  const value = values[ids.blockId]?.[ids.actionId]?.selected_option?.value;
  return typeof value === "string" ? value : undefined;
}

function selectedOptionValueFrom(
  values: SlackViewSubmission["state"]["values"],
  candidates: Array<{ blockId: string; actionId: string }>
): string | undefined {
  for (const ids of candidates) {
    const value = selectedOptionValue(values, ids);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function isHourValue(value: string): boolean {
  return /^(?:[01]\d|2[0-3])$/.test(value);
}

function isFiveMinuteValue(value: string): boolean {
  return /^(?:[0-5]\d)$/.test(value) && Number.parseInt(value, 10) % 5 === 0;
}

function isFiveMinuteTime(value: string): boolean {
  const [hour, minute, extra] = value.split(":");
  return extra === undefined && isHourValue(hour ?? "") && isFiveMinuteValue(minute ?? "");
}

interface SlackViewSubmission {
  callback_id?: string;
  private_metadata?: string;
  state: {
    values: Record<
      string,
      Record<
        string,
        {
          value?: string;
          selected_date?: string;
          selected_time?: string;
          selected_option?: { value?: string };
        }
      >
    >;
  };
}

interface ViewsClient {
  views: {
    open(payload: any): Promise<any>;
  };
}

interface PostMessageClient {
  chat: {
    postMessage(payload: any): Promise<any>;
  };
}

interface HomeClient {
  views: {
    publish(payload: any): Promise<any>;
  };
}

interface HomeSubmitClient extends PostMessageClient, HomeClient {}

interface PostedMessageRef {
  channelId: string;
  messageTs: string;
}

interface CreatorActionBody {
  user: { id: string };
  container?: {
    channel_id?: string;
    message_ts?: string;
  };
  channel?: {
    id?: string;
  };
  message?: {
    ts?: string;
  };
}

interface UpdateMessageClient {
  chat: {
    update(payload: any): Promise<any>;
  };
}

interface ChatClient {
  chat: {
    postMessage(payload: any): Promise<any>;
    update(payload: any): Promise<any>;
  };
}
