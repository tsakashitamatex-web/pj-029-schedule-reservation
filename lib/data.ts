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

export type EmployeeRecord = {
  id: string
  name: string
  email: string
  division: string
  group: string
  department: string
  color: string
  active: boolean
}

export type ResourceTypeRecord = {
  id: string
  name: string
  color: string
  sortOrder: number
  active: boolean
}

export type ResourceMasterRecord = {
  id: string
  name: string
  typeId: string
  color: string
  sortOrder: number
  active: boolean
}

export type EventCategoryRecord = {
  id: string
  name: string
  color: string
  sortOrder: number
  active: boolean
}

export type CalendarEventInput = {
  title: string
  date: string
  endDate: string
  startTime: string
  endTime: string
  allDay: boolean
  category: string
  scope: 'personal' | 'department' | 'company'
  source: 'pj029' | 'company_calendar'
  participants: string
  participantIds: string[]
  participantEmails: string[]
  externalParticipants: string
  location: string
  description: string
  resource: string
  resourceIds: string[]
  resourceNames: string[]
  meetingRoom: string
  vehicle: string
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
  resourceName: string,
  input: Pick<CalendarEventInput, 'date' | 'startTime' | 'endTime'>,
  excludeEventId?: string,
) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db || !resourceName) return null

  const q = query(
    collection(db, 'reservations'),
    where('resourceName', '==', resourceName),
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

  const requestedResources = input.resourceNames?.length
    ? input.resourceNames.filter(Boolean)
    : [input.meetingRoom, input.vehicle].filter(Boolean)
  if (!input.allDay) {
    for (const resourceName of requestedResources) {
      const conflict = await checkReservationConflict(resourceName, input)
      if (conflict) throw new Error(`RESERVATION_CONFLICT:${resourceName}`)
    }
  }

  const eventRef = await addDoc(collection(db, 'events'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: 'active',
    version: '0.4.1',
  })

  const writes: Promise<unknown>[] = []

  for (const resourceName of requestedResources) {
    writes.push(addDoc(collection(db, 'reservations'), {
      eventId: eventRef.id,
      resourceName,
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
      recipients: input.participantEmails,
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

  const requestedResources = input.resourceNames?.length
    ? input.resourceNames.filter(Boolean)
    : [input.meetingRoom, input.vehicle].filter(Boolean)
  if (!input.allDay) {
    for (const resourceName of requestedResources) {
      const conflict = await checkReservationConflict(resourceName, input, eventId)
      if (conflict) throw new Error(`RESERVATION_CONFLICT:${resourceName}`)
    }
  }

  const reservationQuery = query(collection(db, 'reservations'), where('eventId', '==', eventId))
  const reservationSnapshot = await getDocs(reservationQuery)
  const batch = writeBatch(db)

  batch.update(doc(db, 'events', eventId), {
    ...input,
    updatedAt: serverTimestamp(),
    version: '0.4.1',
  })

  reservationSnapshot.docs.forEach((reservationDoc) => batch.delete(reservationDoc.ref))

  for (const resourceName of requestedResources) {
    const reservationRef = doc(collection(db, 'reservations'))
    batch.set(reservationRef, {
      eventId,
      resourceName,
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
      recipients: input.participantEmails,
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
    version: '0.4.1',
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
        participantIds: data.participantIds ?? [],
        participantEmails: data.participantEmails ?? [],
        externalParticipants: data.externalParticipants ?? '',
        location: data.location ?? '',
        description: data.description ?? '',
        resource: data.resource ?? data.resourceNames?.join('、') ?? data.meetingRoom ?? data.vehicle ?? '',
        resourceIds: data.resourceIds ?? [],
        resourceNames: data.resourceNames ?? [data.meetingRoom, data.vehicle].filter((v): v is string => Boolean(v)),
        meetingRoom: data.meetingRoom ?? '',
        vehicle: data.vehicle ?? '',
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


export function subscribeEmployees(onChange: (employees: EmployeeRecord[]) => void): Unsubscribe {
  let unsubscribe: Unsubscribe = () => undefined
  let active = true

  Promise.all([ensureSignedIn(), getDb()]).then(([signedIn, db]) => {
    if (!active) return
    if (!signedIn || !db) {
      onChange([])
      return
    }

    unsubscribe = onSnapshot(collection(db, 'employees'), (snapshot) => {
      const employees = snapshot.docs
        .map((employeeDoc) => {
          const data = employeeDoc.data() as Partial<Omit<EmployeeRecord, 'id'>>
          return {
            id: employeeDoc.id,
            name: data.name ?? '',
            email: data.email ?? '',
            division: data.division ?? '',
            group: data.group ?? '',
            department: data.department ?? data.group ?? data.division ?? '',
            color: data.color ?? '#2463a8',
            active: data.active ?? true,
          }
        })
        .filter((employee) => employee.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      onChange(employees)
    })
  })

  return () => {
    active = false
    unsubscribe()
  }
}

export async function saveEmployee(input: Omit<EmployeeRecord, 'id'>, employeeId?: string) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')

  if (employeeId) {
    await updateDoc(doc(db, 'employees', employeeId), {
      ...input,
      updatedAt: serverTimestamp(),
    })
    return employeeId
  }

  const ref = await addDoc(collection(db, 'employees'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}


export async function deactivateEmployee(employeeId: string) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')

  await updateDoc(doc(db, 'employees', employeeId), {
    active: false,
    updatedAt: serverTimestamp(),
  })
}



export async function ensureDefaultMasters() {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) return

  const [resourceTypeSnapshot, resourceSnapshot, categorySnapshot] = await Promise.all([
    getDocs(collection(db, 'resourceTypes')),
    getDocs(collection(db, 'resourceMasters')),
    getDocs(collection(db, 'eventCategories')),
  ])

  const batch = writeBatch(db)

  if (resourceTypeSnapshot.empty) {
    const defaults: Array<{ id: string } & Omit<ResourceTypeRecord, 'id'>> = [
      { id: 'meeting_room', name: '会議室', color: '#2563eb', sortOrder: 1, active: true },
      { id: 'vehicle', name: '車両', color: '#059669', sortOrder: 2, active: true },
      { id: 'test_machine', name: '試験機', color: '#7c3aed', sortOrder: 3, active: true },
      { id: 'other', name: 'その他設備', color: '#6b7280', sortOrder: 99, active: true },
    ]
    defaults.forEach((row) => {
      const { id, ...data } = row
      batch.set(doc(db, 'resourceTypes', id), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })
  }

  if (resourceSnapshot.empty) {
    const defaults: Array<Omit<ResourceMasterRecord, 'id'>> = [
      { name: '第1会議室', typeId: 'meeting_room', color: '#2563eb', sortOrder: 1, active: true },
      { name: '第2会議室', typeId: 'meeting_room', color: '#2563eb', sortOrder: 2, active: true },
      { name: '社用車A', typeId: 'vehicle', color: '#059669', sortOrder: 1, active: true },
    ]
    defaults.forEach((row, index) => {
      batch.set(doc(db, 'resourceMasters', `default-resource-${index + 1}`), {
        ...row,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })
  }

  if (categorySnapshot.empty) {
    const defaults: Array<{ id: string } & Omit<EventCategoryRecord, 'id'>> = [
      { id: 'meeting', name: '会議', color: '#2563eb', sortOrder: 1, active: true },
      { id: 'visitor', name: '来客', color: '#db2777', sortOrder: 2, active: true },
      { id: 'business_trip', name: '出張', color: '#0891b2', sortOrder: 3, active: true },
      { id: 'construction', name: '工事', color: '#059669', sortOrder: 4, active: true },
      { id: 'outing', name: '外出', color: '#4f46e5', sortOrder: 5, active: true },
      { id: 'leave', name: '休暇', color: '#dc2626', sortOrder: 6, active: true },
      { id: 'company_event', name: '会社行事', color: '#d97706', sortOrder: 7, active: true },
      { id: 'other', name: 'その他', color: '#6b7280', sortOrder: 8, active: true },
    ]
    defaults.forEach((row) => {
      const { id, ...data } = row
      batch.set(doc(db, 'eventCategories', id), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })
  }

  if (resourceTypeSnapshot.empty || resourceSnapshot.empty || categorySnapshot.empty) await batch.commit()
}


export function subscribeResourceTypes(onChange: (types: ResourceTypeRecord[]) => void): Unsubscribe {
  let unsubscribe: Unsubscribe = () => undefined
  let active = true

  Promise.all([ensureSignedIn(), getDb()]).then(([signedIn, db]) => {
    if (!active) return
    if (!signedIn || !db) {
      onChange([])
      return
    }
    unsubscribe = onSnapshot(collection(db, 'resourceTypes'), (snapshot) => {
      const rows = snapshot.docs
        .map((typeDoc) => {
          const data = typeDoc.data() as Partial<Omit<ResourceTypeRecord, 'id'>>
          return {
            id: typeDoc.id,
            name: data.name ?? '',
            color: data.color ?? '#6b7280',
            sortOrder: data.sortOrder ?? 999,
            active: data.active ?? true,
          }
        })
        .filter((row) => row.active)
        .sort((a,b)=>a.sortOrder-b.sortOrder || a.name.localeCompare(b.name,'ja'))
      onChange(rows)
    })
  })

  return () => { active = false; unsubscribe() }
}

export async function saveResourceType(
  input: Omit<ResourceTypeRecord, 'id'>,
  typeId?: string,
) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  if (typeId) {
    await updateDoc(doc(db, 'resourceTypes', typeId), { ...input, updatedAt: serverTimestamp() })
    return typeId
  }
  const ref = await addDoc(collection(db, 'resourceTypes'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function deactivateResourceType(typeId: string) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  await updateDoc(doc(db, 'resourceTypes', typeId), {
    active: false,
    updatedAt: serverTimestamp(),
  })
}

export function subscribeResourceMasters(onChange: (resources: ResourceMasterRecord[]) => void): Unsubscribe {
  let unsubscribe: Unsubscribe = () => undefined
  let active = true

  Promise.all([ensureSignedIn(), getDb()]).then(([signedIn, db]) => {
    if (!active) return
    if (!signedIn || !db) {
      onChange([])
      return
    }
    unsubscribe = onSnapshot(collection(db, 'resourceMasters'), (snapshot) => {
      const rows = snapshot.docs
        .map((resourceDoc) => {
          const data = resourceDoc.data() as Partial<Omit<ResourceMasterRecord, 'id'>>
          return {
            id: resourceDoc.id,
            name: data.name ?? '',
            typeId: data.typeId ?? '',
            color: data.color ?? '#2463a8',
            sortOrder: data.sortOrder ?? 999,
            active: data.active ?? true,
          }
        })
        .filter((row) => row.active)
        .sort((a,b)=>a.sortOrder-b.sortOrder || a.name.localeCompare(b.name,'ja'))
      onChange(rows)
    })
  })

  return () => { active = false; unsubscribe() }
}

export async function saveResourceMaster(
  input: Omit<ResourceMasterRecord, 'id'>,
  resourceId?: string,
) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  if (resourceId) {
    await updateDoc(doc(db, 'resourceMasters', resourceId), { ...input, updatedAt: serverTimestamp() })
    return resourceId
  }
  const ref = await addDoc(collection(db, 'resourceMasters'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function deactivateResourceMaster(resourceId: string) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  await updateDoc(doc(db, 'resourceMasters', resourceId), {
    active: false,
    updatedAt: serverTimestamp(),
  })
}

export function subscribeEventCategories(onChange: (categories: EventCategoryRecord[]) => void): Unsubscribe {
  let unsubscribe: Unsubscribe = () => undefined
  let active = true

  Promise.all([ensureSignedIn(), getDb()]).then(([signedIn, db]) => {
    if (!active) return
    if (!signedIn || !db) {
      onChange([])
      return
    }
    unsubscribe = onSnapshot(collection(db, 'eventCategories'), (snapshot) => {
      const rows = snapshot.docs
        .map((categoryDoc) => {
          const data = categoryDoc.data() as Partial<Omit<EventCategoryRecord, 'id'>>
          return {
            id: categoryDoc.id,
            name: data.name ?? '',
            color: data.color ?? '#6b7280',
            sortOrder: data.sortOrder ?? 999,
            active: data.active ?? true,
          }
        })
        .filter((row) => row.active)
        .sort((a,b)=>a.sortOrder-b.sortOrder || a.name.localeCompare(b.name,'ja'))
      onChange(rows)
    })
  })

  return () => { active = false; unsubscribe() }
}

export async function saveEventCategory(
  input: Omit<EventCategoryRecord, 'id'>,
  categoryId?: string,
) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  if (categoryId) {
    await updateDoc(doc(db, 'eventCategories', categoryId), { ...input, updatedAt: serverTimestamp() })
    return categoryId
  }
  const ref = await addDoc(collection(db, 'eventCategories'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function deactivateEventCategory(categoryId: string) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  await updateDoc(doc(db, 'eventCategories', categoryId), {
    active: false,
    updatedAt: serverTimestamp(),
  })
}

export async function saveFeedback(input: FeedbackInput) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  const ref = await addDoc(collection(db, 'feedbacks'), {
    ...input,
    createdAt: serverTimestamp(),
    appVersion: '0.4.1',
    status: 'new',
  })
  return { id: ref.id, demo: false as const }
}
