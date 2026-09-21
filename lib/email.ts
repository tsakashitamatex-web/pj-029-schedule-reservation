import type { CalendarEventInput } from './data'

export function shouldOpenEmail(input: CalendarEventInput) {
  return Boolean(input.notifyEmail && input.participantEmails.length)
}

export function buildEmailMessage(input: CalendarEventInput, kind: 'new' | 'update' | 'delete' = 'new') {
  const heading =
    kind === 'update'
      ? '予定が変更されました'
      : kind === 'delete'
        ? '予定がキャンセルされました'
        : '予定が登録されました'

  const dateLabel = input.endDate && input.endDate !== input.date
    ? `${input.date} 〜 ${input.endDate}`
    : input.date

  const timeLabel = input.allDay ? '終日' : `${input.startTime}〜${input.endTime}`

  return [
    heading,
    '',
    `件名：${input.title}`,
    `日時：${dateLabel} ${timeLabel}`,
    input.location ? `場所：${input.location}` : '',
    input.resource ? `設備・リソース：${input.resource}` : '',
    input.externalParticipants ? `外部参加者・来訪者：${input.externalParticipants}` : '',
    input.description ? `詳細：${input.description}` : '',
  ].filter(Boolean).join('\n')
}

export function openEmailNotification(input: CalendarEventInput, kind: 'new' | 'update' | 'delete' = 'new') {
  if (!shouldOpenEmail(input)) {
    return { ok: false as const, reason: 'NO_RECIPIENTS' as const }
  }

  const subjectPrefix = kind === 'update' ? '【予定変更】' : kind === 'delete' ? '【予定キャンセル】' : '【予定登録】'
  const subject = `${subjectPrefix}${input.title}`
  const body = buildEmailMessage(input, kind)
  const recipients = input.participantEmails.filter(Boolean).join(',')

  const href = `mailto:${encodeURIComponent(recipients)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  const opened = window.open(href, '_blank')

  if (!opened) {
    window.location.href = href
  }

  return { ok: true as const, reason: null }
}
