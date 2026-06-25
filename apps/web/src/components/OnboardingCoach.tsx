import { useCallback, useState } from "react";
import {
  isOnboardingComplete,
  markOnboardingComplete,
  ONBOARDING_STEPS,
} from "../lib/onboarding.js";

type Props = {
  /** Hide while booting or disconnected. */
  visible: boolean;
};

export function OnboardingCoach({ visible }: Props) {
  const [dismissed, setDismissed] = useState(() => isOnboardingComplete());
  const [stepIndex, setStepIndex] = useState(0);

  const finish = useCallback(() => {
    markOnboardingComplete();
    setDismissed(true);
  }, []);

  if (!visible || dismissed) return null;

  const step = ONBOARDING_STEPS[stepIndex];
  if (!step) return null;

  const isLast = stepIndex >= ONBOARDING_STEPS.length - 1;

  return (
    <div
      className="onboarding-coach"
      data-testid="onboarding-coach"
      role="region"
      aria-label="新手指引"
    >
      <p className="onboarding-coach__step" data-testid={`onboarding-step-${step.id}`}>
        <span className="onboarding-coach__badge">
          {stepIndex + 1}/{ONBOARDING_STEPS.length}
        </span>
        {step.text}
      </p>
      <div className="onboarding-coach__actions">
        <button type="button" className="btn onboarding-coach__skip" onClick={finish}>
          跳过
        </button>
        <button
          type="button"
          className="btn btn--primary onboarding-coach__next"
          data-testid="onboarding-next"
          onClick={() => {
            if (isLast) finish();
            else setStepIndex((i) => i + 1);
          }}
        >
          {isLast ? "开始游玩" : "下一步"}
        </button>
      </div>
    </div>
  );
}
