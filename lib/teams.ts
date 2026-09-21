import type { CalendarEventInput } from './data'
import { getRuntimeConfig } from './firebase'

export function shouldOpenTeams(input: CalendarEventInput) {
  return Boolean(
    input.notifyTeams &&
    Boolean(input.meetingRoom) &&
    input.externalParticipants.trim(),
  )
}

export function buildTeamsMessage(input: CalendarEventInput, kind: 'new' | 'update' | 'delete' = 'new') {
  const heading =
    kind === 'update'
      ? '【来客予定 変更】'
      : kind === 'delete'
        ? '【来客予定 キャンセル】'
        : '【来客予定】'

  return [
    heading,
    `日時：${input.date} ${input.startTime}〜${input.endTime}`,
    `項目：${input.resource || '未設定'}`,
    input.externalParticipants ? `来訪者：${input.externalParticipants}` : '',
    `予約者・参加者：${input.participants || '未設定'}`,
    `会議名：${input.title}`,
  ].filter(Boolean).join('\n')
}

function fallbackCopyText(value: string) {
  const ta = document.createElement('textarea')
  ta.value = value
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  return ok
}

export async function openTeamsNotification(input: CalendarEventInput) {
  const runtime = await getRuntimeConfig()
  const teamsUrl = (runtime.teamsMeetingChatUrl || '').trim()
  if (!teamsUrl) {
    return { ok: false as const, reason: 'NO_URL' as const }
  }

  const message = buildTeamsMessage(input, 'new')
  let copied = false

  try {
    copied = fallbackCopyText(message)
  } catch {
    copied = false
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(message)
      copied = true
    } catch {
      // Fallback copy result is preserved.
    }
  }

  const opened = window.open(teamsUrl, '_blank', 'noopener')
  return {
    ok: Boolean(opened),
    copied,
    reason: opened ? null : 'POPUP_BLOCKED' as const,
  }
}
