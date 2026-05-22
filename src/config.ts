export interface GmgConfig {
  botToken: string;
  signingSecret: string;
  appToken?: string;
  socketMode: boolean;
  port: number;
  announcementChannelId: string;
  timezoneOffset: string;
  dataFile: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GmgConfig {
  const socketMode = parseBoolean(env.SLACK_SOCKET_MODE, true);
  const config: GmgConfig = {
    botToken: requiredEnv(env, "SLACK_BOT_TOKEN"),
    signingSecret: requiredEnv(env, "SLACK_SIGNING_SECRET"),
    appToken: env.SLACK_APP_TOKEN,
    socketMode,
    port: parsePort(env.PORT),
    announcementChannelId: requiredEnv(env, "GMG_ANNOUNCEMENT_CHANNEL_ID"),
    timezoneOffset: env.GMG_TIMEZONE_OFFSET ?? "+09:00",
    dataFile: env.GMG_DATA_FILE ?? ".gmg/meetings.json"
  };

  if (config.socketMode && !config.appToken) {
    throw new Error("SLACK_APP_TOKEN is required when SLACK_SOCKET_MODE=true.");
  }

  return config;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3000;
  }
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer.");
  }
  return port;
}
