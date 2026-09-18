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
import { db } from './firebase'

export type CalendarEventInput = {
  title: string
  date: string
  startTime: string
  endTime: string
  participants: string
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

  if (!db) return { id: `demo-${Date.now()}`, demo: true as const }

  const conflict = await checkReservationConflict(input)
  if (conflict) throw new Error('RESERVATION_CONFLICT')

  const eventRef = await addDoc(collection(db, 'events'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: 'active',
    version: '0.1.2',
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
      status: 'pending',
      createdAt: serverTimestamp(),
    }))
  }

  await Promise.all(writes)
  return { id: eventRef.id, demo: false as const }
}

export function subscribeCalendarEvents(onChange: (events: CalendarEventRecord[]) => void): Unsubscribe {
  if (!db) {
    onChange([])
    return () => undefined
  }

  const q = query(collection(db, 'events'), where('status', '==', 'active'))
  return onSnapshot(q, (snapshot) => {
    const events = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as CalendarEventInput & { status?: string }),
    }))
    onChange(events)
  })
}

export async function saveFeedback(input: FeedbackInput) {
  if (!db) return { id: `demo-${Date.now()}`, demo: true as const }
  const ref = await addDoc(collection(db, 'feedbacks'), {
    ...input,
    createdAt: serverTimestamp(),
    appVersion: '0.1.2',
    status: 'new',
  })
  return { id: ref.id, demo: false as const }
}
