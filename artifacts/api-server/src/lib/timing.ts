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
  if (
    ![
      input.window.start,
      input.window.end,
      input.renderedDuration,
      safetyMargin,
    ].every(Number.isFinite) ||
    input.window.start < 0 ||
    input.window.end <= input.window.start ||
    input.renderedDuration <= 0 ||
    safetyMargin < 0
  ) {
    return {
      status: "failed",
      availableDuration: 0,
      requiredDuration: 0,
      reason: "A valid window and measured narration duration are required.",
    };
  }
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
      reason:
        "Rendered narration plus safety margin exceeds the assigned window.",
    };
  }

  return {
    status: "pass",
    availableDuration,
    requiredDuration,
    reason: "Rendered narration fits with the required safety margin.",
  };
}

export function mergeIntervals(
  intervals: TimedInterval[],
  duration: number,
  margin = 0,
): TimedInterval[] {
  const sorted = intervals
    .map((interval) => {
      if (
        !Number.isFinite(interval.start) ||
        !Number.isFinite(interval.end) ||
        interval.end < interval.start
      )
        throw new Error("Invalid protected interval.");
      return {
        start: Math.max(0, interval.start - margin),
        end: Math.min(duration, interval.end + margin),
      };
    })
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: TimedInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

export function narrationWindows(
  intervals: TimedInterval[],
  duration: number,
): TimedInterval[] {
  const protectedIntervals = mergeIntervals(intervals, duration, 0.25);
  const windows: TimedInterval[] = [];
  let cursor = 0;
  for (const interval of protectedIntervals) {
    if (interval.start - cursor >= 0.5)
      windows.push({ start: cursor, end: interval.start });
    cursor = interval.end;
  }
  if (duration - cursor >= 0.5) windows.push({ start: cursor, end: duration });
  return windows;
}
