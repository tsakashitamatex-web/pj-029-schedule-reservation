import {
  addDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { getDb } from './firebase'

export type CalendarEventInput = {
  title: string
  date: string
  startTime: string
  endTime: string
  participants: string
  externalParticipants: string
  resource: string
  notifyEmail: boolean
  notifyTeams: boolean
}

export type CalendarEventRecord = CalendarEventInput & {
  id: string
  status?: string
}

export type FeedbackInput = {
  type: 'improvement' | 'bug' | 'other'
  message: string
  screen: string
}

function minutes(value: string) {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

export function overlaps(startA: string, endA: string, startB: string, endB: string) {
  return minutes(startA) < minutes(endB) && minutes(startB) < minutes(endA)
}

export async function checkReservationConflict(input: Pick<CalendarEventInput, 'resource' | 'date' | 'startTime' | 'endTime'>) {
  const db = await getDb()
  if (!db || !input.resource) return null

  const q = query(
    collection(db, 'reservations'),
    where('resourceName', '==', input.resource),
    where('date', '==', input.date),
  )
  const snapshot = await getDocs(q)
  const conflict = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as { id: string; startTime?: string; endTime?: string; status?: string }))
    .find((row) => row.status !== 'cancelled' && row.startTime && row.endTime && overlaps(input.startTime, input.endTime, row.startTime, row.endTime))

  return conflict ?? null
}

export async function saveCalendarEvent(input: CalendarEventInput) {
  if (minutes(input.endTime) <= minutes(input.startTime)) {
    throw new Error('END_BEFORE_START')
  }

  const db = await getDb()
  if (!db) return { id: `demo-${Date.now()}`, demo: true as const }

  const conflict = await checkReservationConflict(input)
  if (conflict) throw new Error('RESERVATION_CONFLICT')

  const eventRef = await addDoc(collection(db, 'events'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: 'active',
    version: '0.1.3',
  })

  const writes: Promise<unknown>[] = []

  if (input.resource) {
    writes.push(addDoc(collection(db, 'reservations'), {
      eventId: eventRef.id,
      resourceName: input.resource,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      createdAt: serverTimestamp(),
      status: 'active',
    }))
  }

  if (input.notifyEmail) {
    writes.push(addDoc(collection(db, 'notifications'), {
      eventId: eventRef.id,
      channel: 'email',
      type: 'event_created',
      status: 'pending',
      createdAt: serverTimestamp(),
    }))
  }

  if (input.notifyTeams) {
    writes.push(addDoc(collection(db, 'notifications'), {
      eventId: eventRef.id,
      channel: 'teams',
      type: 'event_created',
      status: 'pending_user_send',
      createdAt: serverTimestamp(),
    }))
  }

  await Promise.all(writes)
  return { id: eventRef.id, demo: false as const }
}

export function subscribeCalendarEvents(onChange: (events: CalendarEventRecord[]) => void): Unsubscribe {
  let unsubscribe: Unsubscribe = () => undefined
  let active = true

  getDb().then((db) => {
    if (!active) return
    if (!db) {
      onChange([])
      return
    }

    const q = query(collection(db, 'events'), where('status', '==', 'active'))
    unsubscribe = onSnapshot(q, (snapshot) => {
    const events = snapshot.docs.map((doc) => {
      const data = doc.data() as Partial<CalendarEventInput> & { status?: string }
      return {
        id: doc.id,
        title: data.title ?? '',
        date: data.date ?? '',
        startTime: data.startTime ?? '',
        endTime: data.endTime ?? '',
        participants: data.participants ?? '',
        externalParticipants: data.externalParticipants ?? '',
        resource: data.resource ?? '',
        notifyEmail: data.notifyEmail ?? false,
        notifyTeams: data.notifyTeams ?? false,
        status: data.status,
      }
    })
    onChange(events)
    })
  })

  return () => {
    active = false
    unsubscribe()
  }
}

export async function saveFeedback(input: FeedbackInput) {
  const db = await getDb()
  if (!db) return { id: `demo-${Date.now()}`, demo: true as const }
  const ref = await addDoc(collection(db, 'feedbacks'), {
    ...input,
    createdAt: serverTimestamp(),
    appVersion: '0.1.3',
    status: 'new',
  })
  return { id: ref.id, demo: false as const }
}
