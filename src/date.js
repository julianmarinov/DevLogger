const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(value) {
  return String(value).padStart(2, "0");
}

export function getTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function getDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function getTimestamp(date = new Date(), pattern = "HH:mm") {
  return formatDate(date, pattern);
}

export function buildDateHeading(date = new Date(), pattern = "YYYY-MM-DD (ddd)") {
  return formatDate(date, pattern);
}

export function buildMonthTitle(projectName, date = new Date()) {
  return `${projectName} - ${getMonthKey(date)}`;
}

export function buildDailyTitle(projectName, date = new Date()) {
  return `${projectName} - ${getDateKey(date)}`;
}

export function buildSingleTitle(projectName) {
  return `${projectName} - Log`;
}

export function toIso(date = new Date()) {
  return date.toISOString();
}

export function humanizeLastEdited(isoString) {
  if (!isoString) {
    return "Never edited";
  }

  const date = new Date(isoString);
  const deltaMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < minute) {
    return "Just now";
  }

  if (deltaMs < hour) {
    return `${Math.max(1, Math.round(deltaMs / minute))} min ago`;
  }

  if (deltaMs < day) {
    return `${Math.max(1, Math.round(deltaMs / hour))} hr ago`;
  }

  if (deltaMs < day * 7) {
    return `${Math.max(1, Math.round(deltaMs / day))} days ago`;
  }

  return `${getDateKey(date)} ${getTimestamp(date, "HH:mm")}`;
}

export function formatDate(date = new Date(), pattern = "YYYY-MM-DD (ddd)") {
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const meridiem = hours24 >= 12 ? "PM" : "AM";

  const replacements = [
    ["YYYY", String(date.getFullYear())],
    ["ddd", WEEKDAYS[date.getDay()]],
    ["MM", pad(date.getMonth() + 1)],
    ["DD", pad(date.getDate())],
    ["HH", pad(hours24)],
    ["hh", pad(hours12)],
    ["mm", pad(date.getMinutes())],
    ["A", meridiem],
  ];

  return replacements.reduce((result, [token, value]) => result.replaceAll(token, value), pattern);
}

export function parseDateHeading(line) {
  const match = line.match(/^##\s+(\d{4}-\d{2}-\d{2})(?:\s|$)/);
  return match ? match[1] : null;
}

export function compareIsoDesc(left, right) {
  const leftValue = left ? Date.parse(left) : 0;
  const rightValue = right ? Date.parse(right) : 0;
  return rightValue - leftValue;
}
