const DEFAULT_GATEWAY = "http://127.0.0.1:8000";

export function gatewayBaseUrl(): string {
  return (process.env.AI_GATEWAY_URL || DEFAULT_GATEWAY).replace(/\/$/, "");
}

export async function checkReply(text: string): Promise<string> {
  const url = `${gatewayBaseUrl()}/v1/guard/check-reply`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.warn(`check-reply failed status=${res.status}`);
      return text;
    }
    const body = (await res.json()) as { text?: string };
    return typeof body.text === "string" ? body.text : text;
  } catch (err) {
    console.warn("check-reply error", err);
    return text;
  }
}
