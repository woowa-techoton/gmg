import { describe, expect, it, vi } from "vitest";
import { MeetingService } from "../src/domain/meeting-service.js";
import { MemoryMeetingStore } from "../src/storage/memory-meeting-store.js";
import {
  buildAnnouncementMessage,
  buildCreatorControlsMessage,
  buildHomeView
} from "../src/slack/blocks.js";
import {
  ACTION_IDS,
  CREATE_HOME_FIELD_IDS,
  CREATE_MODAL_CALLBACK_ID,
  CREATE_MODAL_FIELD_IDS,
  createSlackHandlers
} from "../src/slack/handlers.js";
import type { Clock, Meeting } from "../src/domain/types.js";

describe("Slack platform contract", () => {
  const clock: Clock = { now: () => new Date("2026-05-22T09:00:00.000Z") };

  it("acknowledges /gmg before opening the modal and uses the Slack trigger_id", async () => {
    const calls: string[] = [];
    const { handlers } = makeHandlers(calls);
    const ack = vi.fn(async () => {
      calls.push("ack");
    });
    const client = {
      views: {
        open: vi.fn(async (_payload: Record<string, unknown>) => {
          calls.push("views.open");
          return { ok: true };
        })
      }
    };

    await handlers.handleCommand({
      ack,
      client,
      command: {
        trigger_id: "TRIGGER123",
        channel_id: "CSOURCE",
        user_id: "UCREATOR"
      }
    });

    expect(calls).toEqual(["ack", "views.open"]);
    expect(client.views.open).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_id: "TRIGGER123",
        view: expect.objectContaining({
          callback_id: CREATE_MODAL_CALLBACK_ID
        })
      })
    );
    const modalOpenPayload = client.views.open.mock.calls[0]?.[0] as
      | { view: unknown }
      | undefined;
    expect(modalOpenPayload).toBeDefined();
    const rendered = JSON.stringify(modalOpenPayload?.view);
    expect(rendered).toContain(CREATE_MODAL_FIELD_IDS.meetingMinute.blockId);
    expect(rendered).toContain(CREATE_MODAL_FIELD_IDS.deadlineMinute.blockId);
    expect(rendered).toContain('"value":"05"');
    expect(rendered).not.toContain('"type":"timepicker"');
  });

  it("acknowledges modal submission before posting, posts public output only to the announcement channel, and sends creator controls to the app chat", async () => {
    const calls: string[] = [];
    const { handlers, store } = makeHandlers(calls);
    const ack = vi.fn(async () => {
      calls.push("ack");
    });
    const client = {
      chat: {
        postMessage: vi.fn(async (payload: Record<string, unknown>) => {
          calls.push("chat.postMessage");
          return {
            ok: true,
            channel: payload.channel === "UCREATOR" ? "DAPP" : payload.channel,
            ts:
              payload.channel === "UCREATOR"
                ? "1716372000.000200"
                : "1716372000.000100"
          };
        })
      }
    };

    await handlers.handleViewSubmission({
      ack,
      client,
      body: { user: { id: "UCREATOR" } },
      view: validCreateView("CSOURCE")
    });

    expect(calls[0]).toBe("ack");
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "CANNOUNCE",
        text: expect.stringContaining("GMG")
      })
    );
    expect(client.chat.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ channel: "CSOURCE" })
    );
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "UCREATOR",
        text: expect.stringContaining("생성자 관리")
      })
    );
    const creatorControlCall = client.chat.postMessage.mock.calls.find(
      ([payload]) => payload.channel === "UCREATOR"
    );
    expect(JSON.stringify(creatorControlCall?.[0].blocks)).toContain(
      ACTION_IDS.creator.cancel_meeting
    );

    const [meeting] = await store.list();
    expect(meeting.announcementChannelId).toBe("CANNOUNCE");
    expect(meeting.sourceChannelId).toBe("CSOURCE");
    expect(meeting.meetingTime).toBe("2026-05-22T11:35:00.000Z");
    expect(meeting.deadline).toBe("2026-05-22T10:05:00.000Z");
    expect(meeting.announcementMessageTs).toBe("1716372000.000100");
    expect(meeting.creatorControlsChannelId).toBe("DAPP");
    expect(meeting.creatorControlsMessageTs).toBe("1716372000.000200");
  });

  it("allows any Slack user to create a meeting and stores that user as the creator", async () => {
    const { handlers, store } = makeHandlers([]);
    const ack = vi.fn(async () => undefined);
    const client = {
      chat: {
        postMessage: vi.fn(async () => ({ ok: true, ts: "1716372000.000100" })),
      }
    };

    await handlers.handleViewSubmission({
      ack,
      client,
      body: { user: { id: "UOTHER_CREATOR" } },
      view: validCreateView("CANYWHERE")
    });

    const [meeting] = await store.list();
    expect(meeting.creatorUserId).toBe("UOTHER_CREATOR");
    expect(meeting.sourceChannelId).toBe("CANYWHERE");
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "CANNOUNCE" })
    );
  });

  it("returns modal field errors instead of throwing when meeting or deadline time is not in the future", async () => {
    const { handlers, store } = makeHandlers([]);
    const ack = vi.fn(async () => undefined);
    const client = {
      chat: {
        postMessage: vi.fn(async () => ({ ok: true, ts: "1716372000.000100" })),
      }
    };

    await handlers.handleViewSubmission({
      ack,
      client,
      body: { user: { id: "UOTHER_CREATOR" } },
      view: validCreateView("CANYWHERE", { deadlineTime: "17:00" })
    });

    expect(ack).toHaveBeenCalledWith({
      response_action: "errors",
      errors: expect.objectContaining({
        [CREATE_MODAL_FIELD_IDS.deadlineTime.blockId]:
          "마감 시간은 현재 시간보다 이후여야 합니다."
      })
    });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });

  it("rejects submitted times that are not on a 5-minute boundary", async () => {
    const { handlers, store } = makeHandlers([]);
    const ack = vi.fn(async () => undefined);
    const client = {
      chat: {
        postMessage: vi.fn(async () => ({ ok: true, ts: "1716372000.000100" })),
      }
    };

    await handlers.handleViewSubmission({
      ack,
      client,
      body: { user: { id: "UOTHER_CREATOR" } },
      view: validCreateView("CANYWHERE", { deadlineTime: "19:07" })
    });

    expect(ack).toHaveBeenCalledWith({
      response_action: "errors",
      errors: expect.objectContaining({
        [CREATE_MODAL_FIELD_IDS.deadlineTime.blockId]:
          "마감 시간은 5분 단위로 선택해주세요."
      })
    });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });

  it("acknowledges button actions before persistence/update work", async () => {
    const calls: string[] = [];
    const { handlers, service } = makeHandlers(calls);
    const meeting = await service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      announcementMessageTs: "1716372000.000100",
      title: "점심 번개",
      type: "식사",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: 2
    });
    const ack = vi.fn(async () => {
      calls.push("ack");
    });
    const client = {
      chat: {
        update: vi.fn(async () => {
          calls.push("chat.update");
          return { ok: true };
        }),
        postMessage: vi.fn(async () => {
          calls.push("chat.postMessage");
          return { ok: true };
        })
      }
    };

    await handlers.handleParticipantAction({
      ack,
      client,
      body: { user: { id: "U1" } },
      action: {
        action_id: ACTION_IDS.participant.GMG,
        value: meeting.id
      }
    });

    expect(calls[0]).toBe("ack");
    expect(calls).toContain("chat.update");
  });

  it("posts status-specific threaded mention nudges for participant status changes", async () => {
    const cases = [
      { actionId: ACTION_IDS.participant.GMG, expectedText: "<@U1> 어서 오고~" },
      { actionId: ACTION_IDS.participant.not_attending, expectedText: "<@U1> 이걸 안 와?!" },
      { actionId: ACTION_IDS.participant.considering, expectedText: "<@U1> 그냥 나가라;;" },
      { actionId: ACTION_IDS.participant.late_join, expectedText: "<@U1> 빨리빨리!" }
    ];

    for (const testCase of cases) {
      const { handlers, service } = makeHandlers([]);
      const meeting = await createParticipantMeeting(service);
      const client = {
        chat: {
          update: vi.fn(async () => ({ ok: true })),
          postMessage: vi.fn(async (_payload: Record<string, unknown>) => ({
            ok: true
          }))
        }
      };

      await handlers.handleParticipantAction({
        ack: vi.fn(async () => undefined),
        client,
        body: { user: { id: "U1" } },
        action: {
          action_id: testCase.actionId,
          value: meeting.id
        }
      });

      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "CANNOUNCE",
          thread_ts: "1716372000.000100",
          text: testCase.expectedText
        })
      );
      const nudgePayload = client.chat.postMessage.mock.calls[0]?.[0];
      expect(JSON.stringify(nudgePayload?.blocks)).toContain(testCase.expectedText);
    }
  });

  it("does not post duplicate participant nudges for repeated same-status clicks", async () => {
    const { handlers, service } = makeHandlers([]);
    const meeting = await createParticipantMeeting(service);
    const client = {
      chat: {
        update: vi.fn(async () => ({ ok: true })),
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };

    const clickGmg = () =>
      handlers.handleParticipantAction({
        ack: vi.fn(async () => undefined),
        client,
        body: { user: { id: "U1" } },
        action: {
          action_id: ACTION_IDS.participant.GMG,
          value: meeting.id
        }
      });

    await clickGmg();
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    client.chat.postMessage.mockClear();

    await clickGmg();

    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("skips participant nudges for cancel, rejected, unknown, and unthreaded actions", async () => {
    const cancelCase = makeHandlers([]);
    const cancelMeeting = await createParticipantMeeting(cancelCase.service);
    await cancelCase.service.respond(cancelMeeting.id, {
      userId: "U1",
      status: "GMG"
    });
    const cancelClient = {
      chat: {
        update: vi.fn(async () => ({ ok: true })),
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };

    await cancelCase.handlers.handleParticipantAction({
      ack: vi.fn(async () => undefined),
      client: cancelClient,
      body: { user: { id: "U1" } },
      action: {
        action_id: ACTION_IDS.participant.cancel_response,
        value: cancelMeeting.id
      }
    });

    expect(cancelClient.chat.postMessage).not.toHaveBeenCalled();

    const rejectedCase = makeHandlers([]);
    const rejectedMeeting = await createParticipantMeeting(rejectedCase.service);
    await rejectedCase.service.confirmManually(rejectedMeeting.id, {
      userId: "UCREATOR"
    });
    const rejectedClient = {
      chat: {
        update: vi.fn(async () => ({ ok: true })),
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };
    const rejectedRespond = vi.fn(async (_message: Record<string, unknown>) => undefined);

    await rejectedCase.handlers.handleParticipantAction({
      ack: vi.fn(async () => undefined),
      client: rejectedClient,
      body: { user: { id: "U1" } },
      action: {
        action_id: ACTION_IDS.participant.GMG,
        value: rejectedMeeting.id
      },
      respond: rejectedRespond
    });

    expect(rejectedClient.chat.postMessage).not.toHaveBeenCalled();
    expect(rejectedRespond).toHaveBeenCalledWith(
      expect.objectContaining({ text: "이미 확정되었거나 취소된 모임입니다." })
    );

    const unknownCase = makeHandlers([]);
    const unknownMeeting = await createParticipantMeeting(unknownCase.service);
    const unknownClient = {
      chat: {
        update: vi.fn(async () => ({ ok: true })),
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };
    const unknownRespond = vi.fn(async (_message: Record<string, unknown>) => undefined);

    await unknownCase.handlers.handleParticipantAction({
      ack: vi.fn(async () => undefined),
      client: unknownClient,
      body: { user: { id: "U1" } },
      action: {
        action_id: "gmg_participant_unknown",
        value: unknownMeeting.id
      },
      respond: unknownRespond
    });

    expect(unknownClient.chat.postMessage).not.toHaveBeenCalled();
    expect(unknownRespond).toHaveBeenCalledWith(
      expect.objectContaining({ text: "알 수 없는 GMG 버튼입니다." })
    );

    const unthreadedCase = makeHandlers([]);
    const unthreadedMeeting = await createParticipantMeeting(
      unthreadedCase.service,
      { withAnnouncement: false }
    );
    const unthreadedClient = {
      chat: {
        update: vi.fn(async () => ({ ok: true })),
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };

    await unthreadedCase.handlers.handleParticipantAction({
      ack: vi.fn(async () => undefined),
      client: unthreadedClient,
      body: { user: { id: "U1" } },
      action: {
        action_id: ACTION_IDS.participant.GMG,
        value: unthreadedMeeting.id
      }
    });

    expect(unthreadedClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it("keeps capacity messages working when participant nudge posting fails", async () => {
    const { handlers, service } = makeHandlers([]);
    const meeting = await createParticipantMeeting(service, { capacity: 1 });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const client = {
      chat: {
        update: vi.fn(async () => ({ ok: true })),
        postMessage: vi.fn(async (payload: Record<string, unknown>) => {
          if (payload.thread_ts) {
            throw new Error("nudge failed");
          }
          return { ok: true };
        })
      }
    };

    try {
      await handlers.handleParticipantAction({
        ack: vi.fn(async () => undefined),
        client,
        body: { user: { id: "U1" } },
        action: {
          action_id: ACTION_IDS.participant.GMG,
          value: meeting.id
        }
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_ts: "1716372000.000100",
        text: "<@U1> 어서 오고~"
      })
    );
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "CANNOUNCE",
        text: expect.stringContaining("정원에 도달했습니다")
      })
    );
  });

  it("publishes an App Home with an embedded meeting creation form", async () => {
    const calls: string[] = [];
    const { handlers } = makeHandlers(calls);
    const client = {
      views: {
        publish: vi.fn(async (_payload: Record<string, unknown>) => {
          calls.push("views.publish");
          return { ok: true };
        })
      }
    };

    await handlers.handleAppHomeOpened({
      client,
      event: { user: "UHOME" }
    });

    expect(calls).toEqual(["views.publish"]);
    expect(client.views.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "UHOME",
        view: expect.objectContaining({ type: "home" })
      })
    );
    const rendered = JSON.stringify(client.views.publish.mock.calls[0][0].view);
    expect(rendered).toContain(CREATE_MODAL_FIELD_IDS.title.blockId);
    expect(rendered).toContain(CREATE_HOME_FIELD_IDS.meetingDate.blockId);
    expect(rendered).toContain(CREATE_HOME_FIELD_IDS.deadlineDate.blockId);
    expect(rendered).not.toContain(CREATE_MODAL_FIELD_IDS.meetingDate.blockId);
    expect(rendered).toContain(ACTION_IDS.app_home.submit_meeting);
    expect(rendered).not.toContain(ACTION_IDS.app_home.create_meeting);
  });

  it("creates a meeting from the embedded App Home form without opening a modal", async () => {
    const calls: string[] = [];
    const { handlers, store } = makeHandlers(calls);
    const ack = vi.fn(async () => {
      calls.push("ack");
    });
    const client = {
      views: {
        publish: vi.fn(async (_payload: Record<string, unknown>) => {
          calls.push("views.publish");
          return { ok: true };
        })
      },
      chat: {
        postMessage: vi.fn(async (payload: Record<string, unknown>) => {
          calls.push("chat.postMessage");
          return {
            ok: true,
            channel: payload.channel === "UHOME" ? "DAPP" : payload.channel,
            ts:
              payload.channel === "UHOME"
                ? "1716372000.000200"
                : "1716372000.000100"
          };
        })
      }
    };

    await handlers.handleAppHomeSubmitAction({
      ack,
      client,
      body: {
        user: { id: "UHOME" },
        view: validHomeCreateView("APP_HOME")
      }
    });

    expect(calls[0]).toBe("ack");
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "CANNOUNCE" })
    );
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "UHOME",
        text: expect.stringContaining("생성자 관리")
      })
    );
    expect(client.views.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "UHOME",
        view: expect.objectContaining({ type: "home" })
      })
    );
    const [meeting] = await store.list();
    expect(meeting.creatorUserId).toBe("UHOME");
    expect(meeting.sourceChannelId).toBe("APP_HOME");
    expect(meeting.announcementMessageTs).toBe("1716372000.000100");
    expect(meeting.creatorControlsChannelId).toBe("DAPP");
  });

  it("republishes App Home validation errors without posting a meeting", async () => {
    const calls: string[] = [];
    const { handlers, store } = makeHandlers(calls);
    const ack = vi.fn(async () => {
      calls.push("ack");
    });
    const client = {
      views: {
        publish: vi.fn(async (_payload: Record<string, unknown>) => {
          calls.push("views.publish");
          return { ok: true };
        })
      },
      chat: {
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };

    await handlers.handleAppHomeSubmitAction({
      ack,
      client,
      body: {
        user: { id: "UHOME" },
        view: validHomeCreateView("APP_HOME", { deadlineTime: "17:00" })
      }
    });

    expect(calls).toEqual(["ack", "views.publish"]);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
    const homePublishPayload = client.views.publish.mock.calls[0]?.[0];
    expect(homePublishPayload).toBeDefined();
    const rendered = JSON.stringify(homePublishPayload?.view);
    expect(rendered).toContain("마감 시간은 현재 시간보다 이후여야 합니다.");
  });

  it("rejects direct cancellation clicks from non-creators without locking the meeting", async () => {
    const { handlers, service, store } = makeHandlers([]);
    const meeting = await service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      announcementMessageTs: "1716372000.000100",
      title: "점심 번개",
      type: "식사",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: 2
    });
    const client = {
      chat: {
        update: vi.fn(async (_payload: Record<string, unknown>) => ({ ok: true })),
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };
    const respond = vi.fn(async (_message: Record<string, unknown>) => undefined);

    await handlers.handleCreatorAction({
      ack: vi.fn(async () => undefined),
      client,
      body: { user: { id: "UNONCREATOR" } },
      action: {
        action_id: ACTION_IDS.creator.cancel_meeting,
        value: meeting.id
      },
      respond
    });

    expect((await store.get(meeting.id))?.state).toBe("open");
    expect(client.chat.update).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: "ephemeral",
        text: "모임 생성자만 할 수 있는 작업입니다."
      })
    );
  });

  it("replaces creator controls with an expired meeting notice after manual confirmation", async () => {
    const { handlers, service } = makeHandlers([]);
    const meeting = await service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      announcementMessageTs: "1716372000.000100",
      title: "점심 번개",
      type: "식사",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: 2
    });
    await service.recordCreatorControlsMessage(
      meeting.id,
      "DAPP",
      "1716372000.000200"
    );
    const client = {
      chat: {
        update: vi.fn(async (_payload: Record<string, unknown>) => ({ ok: true })),
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };

    await handlers.handleCreatorAction({
      ack: vi.fn(async () => undefined),
      client,
      body: { user: { id: "UCREATOR" } },
      action: {
        action_id: ACTION_IDS.creator.confirm_meeting,
        value: meeting.id
      }
    });

    const creatorUpdate = client.chat.update.mock.calls.find(
      ([payload]) => payload.channel === "DAPP"
    )?.[0];
    const rendered = JSON.stringify(creatorUpdate?.blocks);
    expect(creatorUpdate).toEqual(
      expect.objectContaining({
        channel: "DAPP",
        ts: "1716372000.000200"
      })
    );
    expect(rendered).toContain("만료된 모임입니다");
    expect(rendered).not.toContain(ACTION_IDS.creator.confirm_meeting);
    expect(rendered).not.toContain(ACTION_IDS.creator.cancel_meeting);
  });

  it("expires stale creator controls when a locked meeting button is clicked again", async () => {
    const { handlers, service } = makeHandlers([]);
    const meeting = await service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      announcementMessageTs: "1716372000.000100",
      title: "점심 번개",
      type: "식사",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: 2
    });
    await service.confirmManually(meeting.id, { userId: "UCREATOR" });
    const client = {
      chat: {
        update: vi.fn(async (_payload: Record<string, unknown>) => ({ ok: true })),
        postMessage: vi.fn(async () => ({ ok: true }))
      }
    };
    const respond = vi.fn(async (_message: Record<string, unknown>) => undefined);

    await handlers.handleCreatorAction({
      ack: vi.fn(async () => undefined),
      client,
      body: {
        user: { id: "UCREATOR" },
        container: {
          channel_id: "DAPP",
          message_ts: "1716372000.000200"
        }
      },
      action: {
        action_id: ACTION_IDS.creator.cancel_meeting,
        value: meeting.id
      },
      respond
    });

    const creatorUpdate = client.chat.update.mock.calls.find(
      ([payload]) => payload.channel === "DAPP"
    )?.[0];
    expect(JSON.stringify(creatorUpdate?.blocks)).toContain("만료된 모임입니다");
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: "이미 확정되었거나 취소된 모임입니다." })
    );
  });

  it("builds public block messages without any creator controls", async () => {
    const meeting = meetingFixture();

    const message = buildAnnouncementMessage(meeting);

    expect(message.text).toContain("GMG");
    expect(message.blocks.length).toBeGreaterThan(0);
    const rendered = JSON.stringify(message.blocks);
    expect(rendered).toContain(ACTION_IDS.participant.GMG);
    expect(rendered).toContain(ACTION_IDS.participant.late_join);
    expect(rendered).toContain(ACTION_IDS.participant.considering);
    expect(rendered).toContain(ACTION_IDS.participant.not_attending);
    expect(rendered).toContain(ACTION_IDS.participant.cancel_response);
    expect(rendered).not.toContain(ACTION_IDS.creator.open_controls);
    expect(rendered).not.toContain(ACTION_IDS.creator.confirm_meeting);
    expect(rendered).not.toContain(ACTION_IDS.creator.cancel_meeting);
    expect(rendered).not.toContain("생성자 관리");
    expect(rendered).toContain(meeting.id);
  });

  it("builds creator-only controls with manual confirmation and cancellation actions", async () => {
    const meeting = meetingFixture();

    const message = buildCreatorControlsMessage(meeting);
    const rendered = JSON.stringify(message.blocks);

    expect(message.text).toContain("생성자 관리");
    expect(rendered).toContain(ACTION_IDS.creator.confirm_meeting);
    expect(rendered).toContain(ACTION_IDS.creator.cancel_meeting);
    expect(rendered).toContain(meeting.id);
  });

  it("builds expired creator controls without stale action buttons for locked meetings", async () => {
    const meeting = { ...meetingFixture(), state: "cancelled" as const };

    const message = buildCreatorControlsMessage(meeting);
    const rendered = JSON.stringify(message.blocks);

    expect(message.text).toContain("만료");
    expect(rendered).toContain("만료된 모임입니다");
    expect(rendered).not.toContain(ACTION_IDS.creator.confirm_meeting);
    expect(rendered).not.toContain(ACTION_IDS.creator.cancel_meeting);
  });

  it("builds App Home views with an embedded create form and no public creator actions", async () => {
    const view = buildHomeView("UCREATOR", [meetingFixture()]);
    const rendered = JSON.stringify(view);

    expect(view).toMatchObject({ type: "home" });
    expect(rendered).toContain(CREATE_MODAL_FIELD_IDS.title.blockId);
    expect(rendered).toContain(CREATE_HOME_FIELD_IDS.meetingDate.blockId);
    expect(rendered).toContain(CREATE_HOME_FIELD_IDS.deadlineDate.blockId);
    expect(rendered).not.toContain(CREATE_MODAL_FIELD_IDS.deadlineDate.blockId);
    expect(rendered).toContain(ACTION_IDS.app_home.submit_meeting);
    expect(rendered).not.toContain(ACTION_IDS.app_home.create_meeting);
    expect(rendered).not.toContain('"type":"timepicker"');
    expect(rendered).not.toContain(ACTION_IDS.creator.confirm_meeting);
    expect(rendered).not.toContain(ACTION_IDS.creator.cancel_meeting);
  });

  function makeHandlers(calls: string[]) {
    const store = new MemoryMeetingStore();
    const service = new MeetingService(store, clock, () => "MEETING-ID");
    const handlers = createSlackHandlers({
      announcementChannelId: "CANNOUNCE",
      clock,
      service,
      onSlowSideEffect: (name) => calls.push(name)
    });
    return { handlers, service, store };
  }

  async function createParticipantMeeting(
    service: MeetingService,
    options: { capacity?: number; withAnnouncement?: boolean } = {}
  ) {
    return service.createMeeting({
      creatorUserId: "UCREATOR",
      sourceChannelId: "CSOURCE",
      announcementChannelId: "CANNOUNCE",
      announcementMessageTs:
        options.withAnnouncement === false ? undefined : "1716372000.000100",
      title: "점심 번개",
      type: "식사",
      meetingTime: new Date("2026-05-22T11:00:00.000Z"),
      deadline: new Date("2026-05-22T10:00:00.000Z"),
      capacity: options.capacity ?? 10
    });
  }

  function validCreateView(
    sourceChannelId: string,
    overrides: Partial<{
      meetingDate: string;
      meetingTime: string;
      deadlineDate: string;
      deadlineTime: string;
    }> = {}
  ) {
    const meetingTime = splitSlackTime(overrides.meetingTime ?? "20:35");
    const deadlineTime = splitSlackTime(overrides.deadlineTime ?? "19:05");

    return {
      callback_id: CREATE_MODAL_CALLBACK_ID,
      private_metadata: JSON.stringify({ sourceChannelId }),
      state: {
        values: {
          [CREATE_MODAL_FIELD_IDS.title.blockId]: {
            [CREATE_MODAL_FIELD_IDS.title.actionId]: { value: "저녁 번개" }
          },
          [CREATE_MODAL_FIELD_IDS.type.blockId]: {
            [CREATE_MODAL_FIELD_IDS.type.actionId]: { value: "회식" }
          },
          [CREATE_MODAL_FIELD_IDS.meetingDate.blockId]: {
            [CREATE_MODAL_FIELD_IDS.meetingDate.actionId]: {
              selected_date: overrides.meetingDate ?? "2026-05-22"
            }
          },
          [CREATE_MODAL_FIELD_IDS.meetingTime.blockId]: {
            [CREATE_MODAL_FIELD_IDS.meetingTime.actionId]: {
              selected_option: { value: meetingTime.hour }
            }
          },
          [CREATE_MODAL_FIELD_IDS.meetingMinute.blockId]: {
            [CREATE_MODAL_FIELD_IDS.meetingMinute.actionId]: {
              selected_option: { value: meetingTime.minute }
            }
          },
          [CREATE_MODAL_FIELD_IDS.capacityMode.blockId]: {
            [CREATE_MODAL_FIELD_IDS.capacityMode.actionId]: {
              selected_option: { value: "limited" }
            }
          },
          [CREATE_MODAL_FIELD_IDS.capacity.blockId]: {
            [CREATE_MODAL_FIELD_IDS.capacity.actionId]: { value: "4" }
          },
          [CREATE_MODAL_FIELD_IDS.deadlineDate.blockId]: {
            [CREATE_MODAL_FIELD_IDS.deadlineDate.actionId]: {
              selected_date: overrides.deadlineDate ?? "2026-05-22"
            }
          },
          [CREATE_MODAL_FIELD_IDS.deadlineTime.blockId]: {
            [CREATE_MODAL_FIELD_IDS.deadlineTime.actionId]: {
              selected_option: { value: deadlineTime.hour }
            }
          },
          [CREATE_MODAL_FIELD_IDS.deadlineMinute.blockId]: {
            [CREATE_MODAL_FIELD_IDS.deadlineMinute.actionId]: {
              selected_option: { value: deadlineTime.minute }
            }
          }
        }
      }
    };
  }

  function validHomeCreateView(
    sourceChannelId: string,
    overrides: Partial<{
      meetingDate: string;
      meetingTime: string;
      deadlineDate: string;
      deadlineTime: string;
    }> = {}
  ) {
    const meetingTime = splitSlackTime(overrides.meetingTime ?? "20:35");
    const deadlineTime = splitSlackTime(overrides.deadlineTime ?? "19:05");

    return {
      private_metadata: JSON.stringify({ sourceChannelId }),
      state: {
        values: {
          [CREATE_MODAL_FIELD_IDS.title.blockId]: {
            [CREATE_MODAL_FIELD_IDS.title.actionId]: { value: "저녁 번개" }
          },
          [CREATE_MODAL_FIELD_IDS.type.blockId]: {
            [CREATE_MODAL_FIELD_IDS.type.actionId]: { value: "회식" }
          },
          [CREATE_HOME_FIELD_IDS.meetingDate.blockId]: {
            [CREATE_HOME_FIELD_IDS.meetingDate.actionId]: {
              selected_date: overrides.meetingDate ?? "2026-05-22"
            },
            [CREATE_HOME_FIELD_IDS.meetingTime.actionId]: {
              selected_option: { value: meetingTime.hour }
            },
            [CREATE_HOME_FIELD_IDS.meetingMinute.actionId]: {
              selected_option: { value: meetingTime.minute }
            }
          },
          [CREATE_MODAL_FIELD_IDS.capacityMode.blockId]: {
            [CREATE_MODAL_FIELD_IDS.capacityMode.actionId]: {
              selected_option: { value: "limited" }
            }
          },
          [CREATE_MODAL_FIELD_IDS.capacity.blockId]: {
            [CREATE_MODAL_FIELD_IDS.capacity.actionId]: { value: "4" }
          },
          [CREATE_HOME_FIELD_IDS.deadlineDate.blockId]: {
            [CREATE_HOME_FIELD_IDS.deadlineDate.actionId]: {
              selected_date: overrides.deadlineDate ?? "2026-05-22"
            },
            [CREATE_HOME_FIELD_IDS.deadlineTime.actionId]: {
              selected_option: { value: deadlineTime.hour }
            },
            [CREATE_HOME_FIELD_IDS.deadlineMinute.actionId]: {
              selected_option: { value: deadlineTime.minute }
            }
          }
        }
      }
    };
  }

  function splitSlackTime(time: string) {
    const [hour = "", minute = ""] = time.split(":");
    return { hour, minute };
  }
});

function meetingFixture(): Meeting {
  return {
    id: "M1",
    creatorUserId: "UCREATOR",
    sourceChannelId: "CSOURCE",
    announcementChannelId: "CANNOUNCE",
    announcementMessageTs: "1716372000.000100",
    title: "저녁 번개",
    type: "회식",
    meetingTime: "2026-05-22T11:00:00.000Z",
    deadline: "2026-05-22T10:00:00.000Z",
    capacity: 4,
    state: "open",
    participants: {
      U1: "GMG",
      U2: "late_join",
      U3: "considering",
      U4: "not_attending"
    },
    createdAt: "2026-05-22T09:00:00.000Z",
    updatedAt: "2026-05-22T09:00:00.000Z"
  };
}
