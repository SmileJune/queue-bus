import { readFile } from "node:fs/promises";
import https from "node:https";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env.codex-notify");
const TELEGRAM_HOST = "api.telegram.org";

function parseEnv(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function buildMessage(status, detail) {
  const projectName = "QueueBus";
  const normalizedStatus = status.trim();
  const normalizedDetail = detail.trim();

  if (normalizedDetail) {
    return `${projectName} ${normalizedStatus}: ${normalizedDetail}`;
  }

  return `${projectName} ${normalizedStatus}`;
}

async function loadConfig() {
  const content = await readFile(ENV_PATH, "utf8");
  const env = parseEnv(content);

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error(
      ".env.codex-notify must define TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID",
    );
  }

  return env;
}

async function sendTelegramMessage({ token, chatId, text }) {
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });

  await new Promise((resolvePromise, reject) => {
    const request = https.request(
      {
        hostname: TELEGRAM_HOST,
        path: `/bot${token}/sendMessage`,
        method: "POST",
        family: 4,
        timeout: 10_000,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();

        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolvePromise();
            return;
          }

          reject(
            new Error(`Telegram sendMessage failed with HTTP ${response.statusCode}`),
          );
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Telegram sendMessage timed out"));
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.end(body);
  });
}

async function main() {
  const [status, ...detailParts] = process.argv.slice(2);

  if (!status) {
    throw new Error(
      "Usage: node scripts/codex-notify.mjs <status> [message details...]",
    );
  }

  const env = await loadConfig();
  const text = buildMessage(status, detailParts.join(" "));

  await sendTelegramMessage({
    token: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    text,
  });

  console.log("Telegram notification sent.");
}

main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
