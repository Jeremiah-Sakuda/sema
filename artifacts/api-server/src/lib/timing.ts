export type TimedInterval = {
  start: number;
  end: number;
};

export type NarrationFit = {
  status: "pass" | "failed" | "blocked";
  availableDuration: number;
  requiredDuration: number;
  reason: string;
};

export function intervalsOverlap(
  left: TimedInterval,
  right: TimedInterval,
  margin = 0,
): boolean {
  return left.start < right.end + margin && right.start < left.end + margin;
}

export function hasProtectedCollision(
  narration: TimedInterval,
  protectedIntervals: TimedInterval[],
  margin = 0.2,
): boolean {
  return protectedIntervals.some((interval) =>
    intervalsOverlap(narration, interval, margin),
  );
}

export function verifyRenderedFit(input: {
  window: TimedInterval;
  renderedDuration: number;
  safetyMargin?: number;
  protectedCollision?: boolean;
}): NarrationFit {
  const safetyMargin = input.safetyMargin ?? 0.2;
  const availableDuration = Math.max(0, input.window.end - input.window.start);
  const requiredDuration = Math.max(0, input.renderedDuration) + safetyMargin;

  if (input.protectedCollision) {
    return {
      status: "blocked",
      availableDuration,
      requiredDuration,
      reason: "The assigned interval overlaps protected speech.",
    };
  }

  if (requiredDuration > availableDuration) {
    return {
      status: "failed",
      availableDuration,
      requiredDuration,
      reason: "Rendered narration plus safety margin exceeds the assigned window.",
    };
  }

  return {
    status: "pass",
    availableDuration,
    requiredDuration,
    reason: "Rendered narration fits with the required safety margin.",
  };
}
