const STORAGE_KEY = "aetherlife-onboarding-v1";

export type OnboardingStepId = "move" | "npc" | "speak" | "drawer";

export const ONBOARDING_STEPS: ReadonlyArray<{ id: OnboardingStepId; text: string }> = [
  { id: "move", text: "用 WASD 或方向键移动；点击地图格子也可寻路。" },
  { id: "npc", text: "点击地图上的村民，或打开左上角菜单选择「附近的人」。" },
  { id: "speak", text: "用自然语言告诉 TA 你想做什么——开门、取物、同行都可以。" },
  { id: "drawer", text: "底栏可打开「历史」「见闻」「已发现」「记忆」查看回忆与探索。" },
];

export function isOnboardingComplete(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(STORAGE_KEY) === "done";
}

export function markOnboardingComplete(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, "done");
}
