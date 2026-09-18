import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { ensureSignedIn, getDb } from './firebase'

export type CalendarEventInput = {
  title: string
  date: string
  endDate: string
  startTime: string
  endTime: string
  allDay: boolean
  category: 'meeting' | 'visitor' | 'business_trip' | 'construction' | 'outing' | 'leave' | 'company_event' | 'other'
  scope: 'personal' | 'department' | 'company'
  source: 'pj029' | 'company_calendar'
  participants: string
  externalParticipants: string
  location: string
  description: string
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

export async function checkReservationConflict(
  input: Pick<CalendarEventInput, 'resource' | 'date' | 'startTime' | 'endTime'>,
  excludeEventId?: string,
) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db || !input.resource) return null

  const q = query(
    collection(db, 'reservations'),
    where('resourceName', '==', input.resource),
    where('date', '==', input.date),
  )
  const snapshot = await getDocs(q)
  const conflict = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as { id: string; eventId?: string; startTime?: string; endTime?: string; status?: string }))
    .filter((row) => !excludeEventId || row.eventId !== excludeEventId)
    .find((row) => row.status !== 'cancelled' && row.startTime && row.endTime && row.id && overlaps(input.startTime, input.endTime, row.startTime, row.endTime))

  return conflict ?? null
}

export async function saveCalendarEvent(input: CalendarEventInput) {
  if (!input.allDay && minutes(input.endTime) <= minutes(input.startTime)) {
    throw new Error('END_BEFORE_START')
  }

  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')

  const conflict = input.allDay ? null : await checkReservationConflict(input)
  if (conflict) throw new Error('RESERVATION_CONFLICT')

  const eventRef = await addDoc(collection(db, 'events'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: 'active',
    version: '0.2.1',
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


export async function updateCalendarEvent(eventId: string, input: CalendarEventInput) {
  if (!input.allDay && minutes(input.endTime) <= minutes(input.startTime)) {
    throw new Error('END_BEFORE_START')
  }

  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')

  const conflict = input.allDay ? null : await checkReservationConflict(input, eventId)
  if (conflict) throw new Error('RESERVATION_CONFLICT')

  const reservationQuery = query(collection(db, 'reservations'), where('eventId', '==', eventId))
  const reservationSnapshot = await getDocs(reservationQuery)
  const batch = writeBatch(db)

  batch.update(doc(db, 'events', eventId), {
    ...input,
    updatedAt: serverTimestamp(),
    version: '0.2.1',
  })

  reservationSnapshot.docs.forEach((reservationDoc) => batch.delete(reservationDoc.ref))

  if (input.resource) {
    const reservationRef = doc(collection(db, 'reservations'))
    batch.set(reservationRef, {
      eventId,
      resourceName: input.resource,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: 'active',
    })
  }

  await batch.commit()

  const writes: Promise<unknown>[] = []
  if (input.notifyEmail) {
    writes.push(addDoc(collection(db, 'notifications'), {
      eventId,
      channel: 'email',
      type: 'event_updated',
      status: 'pending',
      createdAt: serverTimestamp(),
    }))
  }
  if (input.notifyTeams) {
    writes.push(addDoc(collection(db, 'notifications'), {
      eventId,
      channel: 'teams',
      type: 'event_updated',
      status: 'pending_user_send',
      createdAt: serverTimestamp(),
    }))
  }
  await Promise.all(writes)
}

export async function cancelCalendarEvent(eventId: string) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')

  const reservationQuery = query(collection(db, 'reservations'), where('eventId', '==', eventId))
  const reservationSnapshot = await getDocs(reservationQuery)
  const batch = writeBatch(db)

  batch.update(doc(db, 'events', eventId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
    cancelledAt: serverTimestamp(),
    version: '0.2.1',
  })

  reservationSnapshot.docs.forEach((reservationDoc) => {
    batch.update(reservationDoc.ref, {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    })
  })

  await batch.commit()
  await addDoc(collection(db, 'notifications'), {
    eventId,
    channel: 'system',
    type: 'event_cancelled',
    status: 'logged',
    createdAt: serverTimestamp(),
  })
}

export function subscribeCalendarEvents(onChange: (events: CalendarEventRecord[]) => void): Unsubscribe {
  let unsubscribe: Unsubscribe = () => undefined
  let active = true

  Promise.all([ensureSignedIn(), getDb()]).then(([signedIn, db]) => {
    if (!active) return
    if (!signedIn || !db) {
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
        endDate: data.endDate ?? data.date ?? '',
        startTime: data.startTime ?? '',
        endTime: data.endTime ?? '',
        allDay: data.allDay ?? false,
        category: data.category ?? 'other',
        scope: data.scope ?? 'personal',
        source: data.source ?? 'pj029',
        participants: data.participants ?? '',
        externalParticipants: data.externalParticipants ?? '',
        location: data.location ?? '',
        description: data.description ?? '',
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
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  const ref = await addDoc(collection(db, 'feedbacks'), {
    ...input,
    createdAt: serverTimestamp(),
    appVersion: '0.2.1',
    status: 'new',
  })
  return { id: ref.id, demo: false as const }
}
