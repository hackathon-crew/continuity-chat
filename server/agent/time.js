const dayMs = 24 * 60 * 60 * 1000
const minuteMs = 60 * 1000
const quietStartHour = 23
const quietEndHour = 8

export function quietUntil(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour').value)
  const minute = Number(parts.find((part) => part.type === 'minute').value)
  if (hour >= quietEndHour && hour < quietStartHour) {
    return null
  }
  const hours = quietEndHour + (hour >= quietStartHour ? 24 : 0) - hour
  return new Date(now.getTime() + (hours * 60 - minute) * minuteMs)
}

function offsetMinutes(day, timezone) {
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
    .formatToParts(day)
    .find((part) => part.type === 'timeZoneName').value
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(zone)
  return match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0
}

export function nextReminder(at, repeat, timezone, now = Date.now()) {
  if (repeat === 'once') {
    return null
  }
  const interval = dayMs * (repeat === 'weekly' ? 7 : 1)
  const originalOffset = offsetMinutes(at, timezone)
  let next = new Date(at.getTime() + interval)
  while (next.getTime() <= now) {
    next = new Date(next.getTime() + interval)
  }
  const difference = originalOffset - offsetMinutes(next, timezone)
  return new Date(next.getTime() + difference * minuteMs)
}
