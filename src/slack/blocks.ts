import type { Meeting, MeetingState, ParticipantStatus } from "../domain/types.js";
import { isLockedState } from "../domain/types.js";

export interface SlackMessagePayload {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export const ACTION_IDS = {
  participant: {
    GMG: "gmg_participant_GMG",
    late_join: "gmg_participant_late_join",
    considering: "gmg_participant_considering",
    not_attending: "gmg_participant_not_attending",
    cancel_response: "gmg_participant_cancel_response"
  },
  creator: {
    open_controls: "gmg_creator_open_controls",
    confirm_meeting: "gmg_creator_confirm_meeting",
    cancel_meeting: "gmg_creator_cancel_meeting"
  },
  app_home: {
    create_meeting: "gmg_app_home_create_meeting",
    submit_meeting: "gmg_app_home_submit_meeting"
  }
} as const;

export const APP_HOME_SOURCE_CHANNEL_ID = "APP_HOME";

export const CREATE_MODAL_FIELD_IDS = {
  title: { blockId: "gmg_title_block", actionId: "gmg_title" },
  type: { blockId: "gmg_type_block", actionId: "gmg_type" },
  meetingDate: { blockId: "gmg_meeting_date_block", actionId: "gmg_meeting_date" },
  meetingTime: { blockId: "gmg_meeting_time_block", actionId: "gmg_meeting_time" },
  meetingMinute: { blockId: "gmg_meeting_minute_block", actionId: "gmg_meeting_minute" },
  capacityMode: {
    blockId: "gmg_capacity_mode_block",
    actionId: "gmg_capacity_mode"
  },
  capacity: { blockId: "gmg_capacity_block", actionId: "gmg_capacity" },
  deadlineDate: { blockId: "gmg_deadline_date_block", actionId: "gmg_deadline_date" },
  deadlineTime: { blockId: "gmg_deadline_time_block", actionId: "gmg_deadline_time" },
  deadlineMinute: { blockId: "gmg_deadline_minute_block", actionId: "gmg_deadline_minute" }
} as const;

export const CREATE_HOME_FIELD_IDS = {
  meetingDate: {
    blockId: "gmg_home_meeting_when_block",
    actionId: CREATE_MODAL_FIELD_IDS.meetingDate.actionId
  },
  meetingTime: {
    blockId: "gmg_home_meeting_when_block",
    actionId: CREATE_MODAL_FIELD_IDS.meetingTime.actionId
  },
  meetingMinute: {
    blockId: "gmg_home_meeting_when_block",
    actionId: CREATE_MODAL_FIELD_IDS.meetingMinute.actionId
  },
  deadlineDate: {
    blockId: "gmg_home_deadline_when_block",
    actionId: CREATE_MODAL_FIELD_IDS.deadlineDate.actionId
  },
  deadlineTime: {
    blockId: "gmg_home_deadline_when_block",
    actionId: CREATE_MODAL_FIELD_IDS.deadlineTime.actionId
  },
  deadlineMinute: {
    blockId: "gmg_home_deadline_when_block",
    actionId: CREATE_MODAL_FIELD_IDS.deadlineMinute.actionId
  }
} as const;

const hourOptions = Array.from({ length: 24 }, (_, hour) => {
  const value = hour.toString().padStart(2, "0");
  return option(`${value}시`, value);
});

const minuteOptions = Array.from({ length: 12 }, (_, index) => {
  const value = (index * 5).toString().padStart(2, "0");
  return option(`${value}분`, value);
});

const statusLabels: Record<ParticipantStatus, string> = {
  GMG: "GMG",
  late_join: "늦참",
  considering: "고민중",
  not_attending: "불참"
};

const participantThreadNudgeText: Record<ParticipantStatus, string> = {
  GMG: "어서 오고~",
  late_join: "빨리빨리!",
  considering: "그냥 나가라;;",
  not_attending: "이걸 안 와?!"
};

const stateLabels: Record<MeetingState, string> = {
  open: "모집 중",
  confirmed_by_capacity: "정원 도달",
  confirmed_by_deadline: "마감 확정",
  confirmed_manually: "수동 확정",
  cancelled: "취소됨"
};

export function buildAnnouncementMessage(meeting: Meeting): SlackMessagePayload {
  const countedCount = countedParticipantIds(meeting).length;
  const capacityText =
    meeting.capacity === undefined
      ? `무제한 · 현재 ${countedCount}명`
      : `${countedCount}/${meeting.capacity}명`;
  const locked = isLockedState(meeting.state);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `GMG: ${meeting.title}`,
        emoji: true
      }
    },
    {
      type: "section",
      fields: [
        markdownField(`*종류*\n${meeting.type}`),
        markdownField(`*상태*\n${stateLabels[meeting.state]}`),
        markdownField(`*생성자*\n<@${meeting.creatorUserId}>`),
        markdownField(`*정원*\n${capacityText}`),
        markdownField(`*약속 시간*\n${formatSlackDate(meeting.meetingTime)}`),
        markdownField(`*마감 시간*\n${formatSlackDate(meeting.deadline)}`)
      ]
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: renderParticipantGroups(meeting)
      }
    }
  ];

  if (locked) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "이 모임은 잠겨서 더 이상 참여 상태를 바꿀 수 없습니다."
        }
      ]
    });
  } else {
    blocks.push(participantActionsBlock(meeting.id));
  }

  return {
    text: `GMG: ${meeting.title} 모집 상태 ${stateLabels[meeting.state]}. 마감 ${shortDate(meeting.deadline)}.`,
    blocks
  };
}

export function buildCreatorControlsMessage(meeting: Meeting): SlackMessagePayload {
  if (isLockedState(meeting.state)) {
    return {
      text: `GMG 생성자 관리 만료: ${meeting.title}`,
      blocks: [
        section(
          `*GMG 생성자 관리:* ${meeting.title}\n만료된 모임입니다. 더 이상 확정하거나 취소할 수 없습니다.`
        )
      ]
    };
  }

  return {
    text: `GMG 생성자 관리: ${meeting.title}`,
    blocks: [
      section(
        `*GMG 생성자 관리:* ${meeting.title}\n이 메시지는 생성자에게만 보입니다.`
      ),
      creatorActionsBlock(meeting.id)
    ]
  };
}

export function buildHomeView(
  userId: string,
  creatorMeetings: Meeting[] = [],
  options: { formErrors?: Record<string, string> } = {}
): Record<string, unknown> {
  const activeMeetings = creatorMeetings
    .filter((meeting) => !isLockedState(meeting.state))
    .slice(0, 10);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "GMG", emoji: true }
    },
    section(`<@${userId}>님의 번개 모임을 빠르게 만들고 관리합니다.`),
    { type: "divider" },
    ...buildCreateMeetingErrorBlocks(options.formErrors),
    ...buildCreateMeetingHomeBlocks(),
    {
      type: "actions",
      elements: [
        button("공지", ACTION_IDS.app_home.submit_meeting, "submit", "primary")
      ]
    },
    { type: "divider" }
  ];

  if (activeMeetings.length === 0) {
    blocks.push(section("진행 중인 생성 모임이 없습니다."));
  } else {
    blocks.push(section("*내가 만든 진행 중인 모임*"));
    for (const meeting of activeMeetings) {
      blocks.push(activeMeetingSummaryBlock(meeting));
    }
  }

  return {
    type: "home",
    private_metadata: JSON.stringify({ sourceChannelId: APP_HOME_SOURCE_CHANNEL_ID }),
    blocks
  };
}

export function buildCreateMeetingFormBlocks(): Array<Record<string, unknown>> {
  return [
    textInputBlock(CREATE_MODAL_FIELD_IDS.title, "모임명", "예: 저녁 번개"),
    textInputBlock(CREATE_MODAL_FIELD_IDS.type, "종류", "예: 회식, 커피, 보드게임"),
    datePickerBlock(CREATE_MODAL_FIELD_IDS.meetingDate, "약속 날짜"),
    ...timeSelectBlocks(
      CREATE_MODAL_FIELD_IDS.meetingTime,
      CREATE_MODAL_FIELD_IDS.meetingMinute,
      "약속 시간"
    ),
    {
      type: "input",
      block_id: CREATE_MODAL_FIELD_IDS.capacityMode.blockId,
      label: { type: "plain_text", text: "정원 모드", emoji: true },
      element: {
        type: "static_select",
        action_id: CREATE_MODAL_FIELD_IDS.capacityMode.actionId,
        options: [
          option("정원 있음", "limited"),
          option("정원 없음", "unlimited")
        ]
      }
    },
    textInputBlock(CREATE_MODAL_FIELD_IDS.capacity, "정원 수", "정원 없음이면 비워두세요", true),
    datePickerBlock(CREATE_MODAL_FIELD_IDS.deadlineDate, "마감 날짜"),
    ...timeSelectBlocks(
      CREATE_MODAL_FIELD_IDS.deadlineTime,
      CREATE_MODAL_FIELD_IDS.deadlineMinute,
      "마감 시간"
    )
  ];
}

function buildCreateMeetingHomeBlocks(): Array<Record<string, unknown>> {
  return [
    section("*새 모임 만들기*\n제목과 일정만 채우면 바로 공지할 수 있어요."),
    textInputBlock(CREATE_MODAL_FIELD_IDS.title, "모임명", "예: 저녁 번개"),
    textInputBlock(CREATE_MODAL_FIELD_IDS.type, "종류", "예: 회식, 커피, 보드게임"),
    section("*일정*"),
    dateTimeActionsBlock(
      CREATE_HOME_FIELD_IDS.meetingDate,
      CREATE_HOME_FIELD_IDS.meetingTime,
      CREATE_HOME_FIELD_IDS.meetingMinute,
      "약속"
    ),
    dateTimeActionsBlock(
      CREATE_HOME_FIELD_IDS.deadlineDate,
      CREATE_HOME_FIELD_IDS.deadlineTime,
      CREATE_HOME_FIELD_IDS.deadlineMinute,
      "마감"
    ),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "시간은 5분 단위로 선택합니다."
        }
      ]
    },
    section("*정원*"),
    {
      type: "input",
      block_id: CREATE_MODAL_FIELD_IDS.capacityMode.blockId,
      label: { type: "plain_text", text: "정원 모드", emoji: true },
      element: {
        type: "static_select",
        action_id: CREATE_MODAL_FIELD_IDS.capacityMode.actionId,
        options: [
          option("정원 있음", "limited"),
          option("정원 없음", "unlimited")
        ]
      }
    },
    textInputBlock(CREATE_MODAL_FIELD_IDS.capacity, "정원 수", "정원 없음이면 비워두세요", true)
  ];
}

export function buildCapacityConfirmedMessage(meeting: Meeting): SlackMessagePayload {
  const attendees = mentions(countedParticipantIds(meeting));
  return {
    text: `GMG: ${meeting.title} 정원에 도달했습니다. 참석자 ${countedParticipantIds(meeting).length}명.`,
    blocks: [
      section(
        `*GMG 정원 도달:* ${meeting.title}\n${attendees || "아직 참석자가 없습니다."}\n정원 도달 알림입니다. 추가 참여와 변경은 마감 전까지 가능합니다.`
      )
    ]
  };
}

export function buildParticipantThreadNudgeMessage(
  userId: string,
  status: ParticipantStatus
): SlackMessagePayload {
  const text = `<@${userId}> ${participantThreadNudgeText[status]}`;
  return {
    text,
    blocks: [section(text)]
  };
}

export function buildFinalConfirmationMessage(
  meeting: Meeting,
  reason: "deadline" | "manual"
): SlackMessagePayload {
  const reasonText = reason === "deadline" ? "마감 시간이 되어" : "생성자가";
  const attendees = mentions(countedParticipantIds(meeting));
  return {
    text: `GMG: ${meeting.title} 확정되었습니다. 참석자 ${countedParticipantIds(meeting).length}명.`,
    blocks: [
      section(
        `*GMG 확정:* ${meeting.title}\n${reasonText} 모임을 확정했습니다.\n*참석자:* ${attendees || "없음"}`
      )
    ]
  };
}

export function buildCancellationMessage(meeting: Meeting): SlackMessagePayload {
  return {
    text: `GMG: ${meeting.title} 취소되었습니다.`,
    blocks: [
      section(
        `*GMG 취소:* ${meeting.title}\n<@${meeting.creatorUserId}>님이 모임을 취소했습니다.`
      )
    ]
  };
}

export function buildConsideringReminderMessage(
  meeting: Meeting,
  consideringUserIds: string[]
): SlackMessagePayload {
  const people = mentions(consideringUserIds);
  return {
    text: `GMG: ${meeting.title} 30분 전입니다. 아직 고민중인 사람이 있습니다.`,
    blocks: [
      section(
        `${people}님이 아직도!? 고민중입니다. GMG 버튼으로 마음을 정해볼까요?\n*모임:* ${meeting.title}`
      )
    ]
  };
}

export function buildApproachingReminderMessage(
  meeting: Meeting
): SlackMessagePayload {
  const attendees = mentions(countedParticipantIds(meeting));
  return {
    text: `GMG: ${meeting.title} 약속 시간이 다가왔습니다.`,
    blocks: [
      section(
        `*GMG 리마인더:* ${meeting.title}\n약속 시간이 다가왔습니다.\n*참석자:* ${attendees || "없음"}`
      )
    ]
  };
}

export function countedParticipantIds(meeting: Meeting): string[] {
  return Object.entries(meeting.participants)
    .filter(([, status]) => status === "GMG" || status === "late_join")
    .map(([userId]) => userId)
    .sort();
}

function participantActionsBlock(meetingId: string): Record<string, unknown> {
  return {
    type: "actions",
    elements: [
      button("GMG", ACTION_IDS.participant.GMG, meetingId, "primary"),
      button("늦참", ACTION_IDS.participant.late_join, meetingId),
      button("고민중", ACTION_IDS.participant.considering, meetingId),
      button("불참", ACTION_IDS.participant.not_attending, meetingId),
      button("응답 취소", ACTION_IDS.participant.cancel_response, meetingId)
    ]
  };
}

function activeMeetingSummaryBlock(meeting: Meeting): Record<string, unknown> {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${meeting.title}*\n${meeting.type} · ${formatSlackDate(meeting.meetingTime)} · ${stateLabels[meeting.state]} · ${capacitySummary(meeting)}`
    }
  };
}

function capacitySummary(meeting: Meeting): string {
  const countedCount = countedParticipantIds(meeting).length;
  return meeting.capacity === undefined
    ? `무제한 · 현재 ${countedCount}명`
    : `${countedCount}/${meeting.capacity}명`;
}

function creatorActionsBlock(meetingId: string): Record<string, unknown> {
  return {
    type: "actions",
    elements: [
      button("마감", ACTION_IDS.creator.confirm_meeting, meetingId, "primary"),
      {
        ...button("취소", ACTION_IDS.creator.cancel_meeting, meetingId, "danger"),
        confirm: {
          title: { type: "plain_text", text: "모임을 취소할까요?", emoji: true },
          text: {
            type: "mrkdwn",
            text: "취소하면 참여 상태가 잠기고 취소 알림이 공지 채널에 올라갑니다."
          },
          confirm: { type: "plain_text", text: "취소", emoji: true },
          deny: { type: "plain_text", text: "유지", emoji: true }
        }
      }
    ]
  };
}

function button(
  text: string,
  actionId: string,
  value: string,
  style?: "primary" | "danger"
): Record<string, unknown> {
  return {
    type: "button",
    text: { type: "plain_text", text, emoji: true },
    action_id: actionId,
    value,
    ...(style ? { style } : {})
  };
}

function buildCreateMeetingErrorBlocks(
  errors: Record<string, string> | undefined
): Array<Record<string, unknown>> {
  if (!errors || Object.keys(errors).length === 0) {
    return [];
  }

  const uniqueMessages = Array.from(new Set(Object.values(errors)));
  return [
    section(`*입력값을 확인해주세요.*\n${uniqueMessages.map((message) => `- ${message}`).join("\n")}`)
  ];
}

function textInputBlock(
  ids: { blockId: string; actionId: string },
  label: string,
  placeholder: string,
  optional = false
): Record<string, unknown> {
  return {
    type: "input",
    block_id: ids.blockId,
    optional,
    label: { type: "plain_text", text: label, emoji: true },
    element: {
      type: "plain_text_input",
      action_id: ids.actionId,
      placeholder: { type: "plain_text", text: placeholder, emoji: true }
    }
  };
}

function datePickerBlock(
  ids: { blockId: string; actionId: string },
  label: string
): Record<string, unknown> {
  return {
    type: "input",
    block_id: ids.blockId,
    label: { type: "plain_text", text: label, emoji: true },
    element: {
      type: "datepicker",
      action_id: ids.actionId
    }
  };
}

function timeSelectBlocks(
  hourIds: { blockId: string; actionId: string },
  minuteIds: { blockId: string; actionId: string },
  label: string
): Array<Record<string, unknown>> {
  return [
    staticSelectBlock(hourIds, `${label} - 시`, "시 선택", hourOptions),
    staticSelectBlock(minuteIds, `${label} - 분`, "5분 단위", minuteOptions)
  ];
}

function dateTimeActionsBlock(
  dateIds: { blockId: string; actionId: string },
  hourIds: { blockId: string; actionId: string },
  minuteIds: { blockId: string; actionId: string },
  label: string
): Record<string, unknown> {
  return {
    type: "actions",
    block_id: dateIds.blockId,
    elements: [
      datePickerElement(dateIds, `${label} 날짜`),
      staticSelectElement(hourIds, "시", hourOptions),
      staticSelectElement(minuteIds, "분", minuteOptions)
    ]
  };
}

function staticSelectBlock(
  ids: { blockId: string; actionId: string },
  label: string,
  placeholder: string,
  options: Array<Record<string, unknown>>
): Record<string, unknown> {
  return {
    type: "input",
    block_id: ids.blockId,
    label: { type: "plain_text", text: label, emoji: true },
    element: {
      type: "static_select",
      action_id: ids.actionId,
      placeholder: { type: "plain_text", text: placeholder, emoji: true },
      options
    }
  };
}

function datePickerElement(
  ids: { actionId: string },
  placeholder: string
): Record<string, unknown> {
  return {
    type: "datepicker",
    action_id: ids.actionId,
    placeholder: { type: "plain_text", text: placeholder, emoji: true }
  };
}

function staticSelectElement(
  ids: { actionId: string },
  placeholder: string,
  options: Array<Record<string, unknown>>
): Record<string, unknown> {
  return {
    type: "static_select",
    action_id: ids.actionId,
    placeholder: { type: "plain_text", text: placeholder, emoji: true },
    options
  };
}

function option(text: string, value: string): Record<string, unknown> {
  return {
    text: { type: "plain_text", text, emoji: true },
    value
  };
}

function renderParticipantGroups(meeting: Meeting): string {
  return [
    renderGroup("GMG", meeting, "GMG"),
    renderGroup("늦참", meeting, "late_join"),
    renderGroup("고민중", meeting, "considering"),
    renderGroup("불참", meeting, "not_attending")
  ].join("\n");
}

function renderGroup(
  label: string,
  meeting: Meeting,
  status: ParticipantStatus
): string {
  const userIds = Object.entries(meeting.participants)
    .filter(([, participantStatus]) => participantStatus === status)
    .map(([userId]) => userId)
    .sort();
  return `*${label}:* ${mentions(userIds) || "없음"}`;
}

function mentions(userIds: string[]): string {
  return userIds.map((userId) => `<@${userId}>`).join(", ");
}

function markdownField(text: string): Record<string, unknown> {
  return { type: "mrkdwn", text };
}

function section(text: string): Record<string, unknown> {
  return {
    type: "section",
    text: { type: "mrkdwn", text }
  };
}

function formatSlackDate(iso: string): string {
  const epochSeconds = Math.floor(new Date(iso).getTime() / 1000);
  return `<!date^${epochSeconds}^{date_short_pretty} {time}|${shortDate(iso)}>`;
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(iso));
}
