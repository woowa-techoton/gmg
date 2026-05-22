import { App } from "@slack/bolt";
import type { GmgConfig } from "../config.js";
import { MeetingService } from "../domain/meeting-service.js";
import { MemoryMeetingStore } from "../storage/memory-meeting-store.js";
import { FileMeetingStore } from "../storage/file-meeting-store.js";
import { InMemoryMeetingScheduler } from "../reminders/in-memory-scheduler.js";
import { ReminderService } from "../reminders/reminder-service.js";
import { buildFinalConfirmationMessage } from "./blocks.js";
import {
  ACTION_IDS,
  CREATE_MODAL_CALLBACK_ID,
  createSlackHandlers,
  updateAnnouncement,
  updateCreatorControlsMessage
} from "./handlers.js";

export function createGmgSlackApp(config: GmgConfig) {
  const app = new App({
    token: config.botToken,
    signingSecret: config.signingSecret,
    socketMode: config.socketMode,
    appToken: config.appToken,
    port: config.port
  });

  const store = config.dataFile
    ? new FileMeetingStore(config.dataFile)
    : new MemoryMeetingStore();
  const service = new MeetingService(store);
  const notifier = {
    postMessage: (payload: Record<string, unknown>) =>
      app.client.chat.postMessage(payload as any)
  };
  const reminderService = new ReminderService(store, notifier);
  const scheduler = new InMemoryMeetingScheduler({
    onDeadline: async (meetingId) => {
      const result = await service.confirmByDeadline(meetingId);
      if (!result.ok || !result.events.includes("deadline_confirmed")) {
        return;
      }

      await updateAnnouncement(app.client as any, result.meeting);
      await updateCreatorControlsMessage(app.client as any, result.meeting);
      await app.client.chat.postMessage({
        channel: result.meeting.announcementChannelId,
        ...buildFinalConfirmationMessage(result.meeting, "deadline")
      });
    },
    onApproaching: async (meetingId) => {
      await reminderService.sendApproachingReminder(meetingId);
    },
    onConsidering: async (meetingId) => {
      await reminderService.sendConsideringReminder(meetingId);
    }
  });

  restoreSchedules(store, scheduler).catch((error) => {
    console.error("GMG schedule restore failed", error);
  });

  const handlers = createSlackHandlers({
    announcementChannelId: config.announcementChannelId,
    clock: { now: () => new Date() },
    service,
    scheduler,
    timezoneOffset: config.timezoneOffset
  });

  app.command("/gmg", async ({ ack, client, command }) => {
    await handlers.handleCommand({
      ack: async () => {
        await ack();
      },
      client: client as any,
      command: command as any
    });
  });

  app.view(CREATE_MODAL_CALLBACK_ID, async ({ ack, body, client, view }) => {
    await handlers.handleViewSubmission({
      ack: async (response?: Record<string, unknown>) => {
        await ack(response as any);
      },
      client: client as any,
      body: body as any,
      view: view as any
    });
  });

  app.event("app_home_opened", async ({ event, client }) => {
    await handlers.handleAppHomeOpened({
      client: client as any,
      event: event as any
    });
  });

  app.action(ACTION_IDS.app_home.create_meeting, async ({ ack, body, client }) => {
    await handlers.handleAppHomeCreateAction({
      ack: async () => {
        await ack();
      },
      client: client as any,
      body: body as any
    });
  });

  app.action(ACTION_IDS.app_home.submit_meeting, async ({ ack, body, client }) => {
    await handlers.handleAppHomeSubmitAction({
      ack: async () => {
        await ack();
      },
      client: client as any,
      body: body as any
    });
  });

  for (const actionId of Object.values(ACTION_IDS.participant)) {
    app.action(actionId, async ({ ack, body, client, action, respond }) => {
      await handlers.handleParticipantAction({
        ack: async () => {
          await ack();
        },
        client: client as any,
        body: body as any,
        action: action as any,
        respond: respond as any
      });
    });
  }

  for (const actionId of Object.values(ACTION_IDS.creator)) {
    app.action(actionId, async ({ ack, body, client, action, respond }) => {
      await handlers.handleCreatorAction({
        ack: async () => {
          await ack();
        },
        client: client as any,
        body: body as any,
        action: action as any,
        respond: respond as any
      });
    });
  }

  return { app, service, store, scheduler, reminderService };
}

async function restoreSchedules(
  store: Pick<MemoryMeetingStore, "list">,
  scheduler: InMemoryMeetingScheduler
): Promise<void> {
  const meetings = await store.list();
  const now = Date.now();
  for (const meeting of meetings) {
    if (meeting.state === "cancelled") {
      continue;
    }
    if (new Date(meeting.meetingTime).getTime() <= now) {
      continue;
    }
    scheduler.scheduleMeeting(meeting);
  }
}
