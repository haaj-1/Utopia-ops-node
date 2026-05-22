/**
 * RiskPolicy — task scoring and risk classification.
 *
 * Risk levels:
 *   red   — any task is overdue (past 17:00 Doha on the due date)
 *   amber — a task is due today and still incomplete
 *   green — no urgent items
 */
export class RiskPolicy {
  constructor(ownerChannels = {}) {
    this.ownerChannels = {
      ops:            "#ops-onboarding",
      tech:           "#studio-tech",
      "welcome-pack": "#ops-onboarding",
      ...ownerChannels,
    };
  }

  /**
   * Enrich a raw task with computed timing and risk fields.
   * @param {object} task  Raw task with { dueDate, status, criticality, owner }
   * @param {Date}   now   Current time (injectable for tests)
   */
  assessTask(task, now) {
    // Deadline is 17:00 Doha time (UTC+3) on the due date
    const due = new Date(`${task.dueDate}T17:00:00+03:00`);
    const daysUntilDue = this.daysBetween(now, due);
    const isDone    = task.status === "done";
    const isOverdue = !isDone && daysUntilDue < 0;
    const dueSoon   = !isDone && daysUntilDue === 0; // only today counts

    return {
      ...task,
      status_label:   this._statusLabel(task.status),
      due_date:       task.dueDate,
      owner_channel:  this.ownerChannels[task.owner] || "#ops-onboarding",
      days_until_due: daysUntilDue,
      is_overdue:     isOverdue,
      due_soon:       dueSoon,
      risk_points:    this._scoreTask(task, isOverdue, dueSoon),
    };
  }

  /** Classify a fellow's overall risk from their full assessed task list. */
  classify(tasks) {
    if (tasks.some((t) => t.is_overdue))                          return "red";
    if (tasks.some((t) => t.due_soon && t.status !== "done"))     return "amber";
    return "green";
  }

  /** Score a task 0–5. Used for sorting escalations by urgency. */
  _scoreTask(task, isOverdue, dueSoon) {
    if (task.status === "blocked")                return 5;
    if (isOverdue && task.criticality === "high") return 4;
    if (isOverdue)                                return 3;
    if (dueSoon  && task.criticality === "high")  return 2;
    if (dueSoon)                                  return 1;
    return 0;
  }

  _statusLabel(status) {
    return { done: "Done", pending: "In progress", not_started: "To be started", blocked: "Blocked" }[status] || status;
  }

  /**
   * Whole-day difference between two dates (positive = future, negative = past).
   * Uses UTC midnight to avoid timezone off-by-one errors.
   */
  daysBetween(start, end) {
    const ms = 24 * 60 * 60 * 1000;
    const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const e = Date.UTC(end.getUTCFullYear(),   end.getUTCMonth(),   end.getUTCDate());
    return Math.ceil((e - s) / ms);
  }
}
