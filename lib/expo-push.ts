const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type ExpoPushMessage = {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, any>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
};

export async function sendExpoPush(messages: ExpoPushMessage | ExpoPushMessage[]) {
  const payload = Array.isArray(messages) ? messages : [messages];
  const valid = payload.filter((m) => typeof m.to === "string" && m.to.startsWith("ExponentPushToken"));
  if (!valid.length) return { ok: false, reason: "no_valid_tokens" };

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(valid.map((m) => ({
        sound: m.sound === null ? undefined : (m.sound || "default"),
        ...m,
      }))),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err: any) {
    console.error("[expo-push] error:", err?.message);
    return { ok: false, error: err?.message };
  }
}
