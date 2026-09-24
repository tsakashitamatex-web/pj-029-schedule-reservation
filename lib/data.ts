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

export type ManagementDivisionRecord = {
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
  managementDivisionId: string
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
  notifyEmailDefault: boolean
  notifyTeamsDefault: boolean
  teamsUrl: string
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
  source: 'pj029' | 'company_calendar' | 'pj020'
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
  sourceReservationId?: string
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
    version: '0.4.6',
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
      status: 'pending_user_send',
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
    version: '0.4.6',
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
      status: 'pending_user_send',
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
    version: '0.4.6',
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
        sourceReservationId: (data as Partial<CalendarEventInput> & { sourceReservationId?: string }).sourceReservationId,
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

  const [managementDivisionSnapshot, resourceTypeSnapshot, resourceSnapshot, categorySnapshot] = await Promise.all([
    getDocs(collection(db, 'managementDivisions')),
    getDocs(collection(db, 'resourceTypes')),
    getDocs(collection(db, 'resourceMasters')),
    getDocs(collection(db, 'eventCategories')),
  ])

  const batch = writeBatch(db)

  if (managementDivisionSnapshot.empty) {
    const defaults: Array<{ id: string } & Omit<ManagementDivisionRecord, 'id'>> = [
      { id: 'head_office', name: '本社', color: '#2563eb', sortOrder: 1, active: true },
      { id: 'seal_engineering', name: 'シールエンジ', color: '#059669', sortOrder: 2, active: true },
    ]
    defaults.forEach((row) => {
      const { id, ...data } = row
      batch.set(doc(db, 'managementDivisions', id), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })
  }

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
      { name: '第1会議室', typeId: 'meeting_room', managementDivisionId: 'head_office', color: '#2563eb', sortOrder: 1, active: true },
      { name: '第2会議室', typeId: 'meeting_room', managementDivisionId: 'head_office', color: '#2563eb', sortOrder: 2, active: true },
      { name: '社用車A', typeId: 'vehicle', managementDivisionId: 'seal_engineering', color: '#059669', sortOrder: 1, active: true },
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
      { id: 'meeting', name: '会議', color: '#2563eb', sortOrder: 1, active: true, notifyEmailDefault: false, notifyTeamsDefault: false, teamsUrl: '' },
      { id: 'visitor', name: '来客', color: '#db2777', sortOrder: 2, active: true, notifyEmailDefault: false, notifyTeamsDefault: false, teamsUrl: '' },
      { id: 'business_trip', name: '出張', color: '#0891b2', sortOrder: 3, active: true, notifyEmailDefault: false, notifyTeamsDefault: false, teamsUrl: '' },
      { id: 'construction', name: '工事', color: '#059669', sortOrder: 4, active: true, notifyEmailDefault: false, notifyTeamsDefault: false, teamsUrl: '' },
      { id: 'outing', name: '外出', color: '#4f46e5', sortOrder: 5, active: true, notifyEmailDefault: false, notifyTeamsDefault: false, teamsUrl: '' },
      { id: 'leave', name: '休暇', color: '#dc2626', sortOrder: 6, active: true, notifyEmailDefault: false, notifyTeamsDefault: false, teamsUrl: '' },
      { id: 'company_event', name: '会社行事', color: '#d97706', sortOrder: 7, active: true, notifyEmailDefault: false, notifyTeamsDefault: false, teamsUrl: '' },
      { id: 'other', name: 'その他', color: '#6b7280', sortOrder: 8, active: true, notifyEmailDefault: false, notifyTeamsDefault: false, teamsUrl: '' },
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

  if (managementDivisionSnapshot.empty || resourceTypeSnapshot.empty || resourceSnapshot.empty || categorySnapshot.empty) await batch.commit()
}



export function subscribeManagementDivisions(onChange: (divisions: ManagementDivisionRecord[]) => void): Unsubscribe {
  let unsubscribe: Unsubscribe = () => undefined
  let active = true

  Promise.all([ensureSignedIn(), getDb()]).then(([signedIn, db]) => {
    if (!active) return
    if (!signedIn || !db) {
      onChange([])
      return
    }
    unsubscribe = onSnapshot(collection(db, 'managementDivisions'), (snapshot) => {
      const rows = snapshot.docs
        .map((divisionDoc) => {
          const data = divisionDoc.data() as Partial<Omit<ManagementDivisionRecord, 'id'>>
          return {
            id: divisionDoc.id,
            name: data.name ?? '',
            color: data.color ?? '#6b7280',
            sortOrder: data.sortOrder ?? 999,
            active: data.active ?? true,
            notifyEmailDefault: data.notifyEmailDefault ?? false,
            notifyTeamsDefault: data.notifyTeamsDefault ?? false,
            teamsUrl: data.teamsUrl ?? '',
          }
        })
        .filter((row) => row.active)
        .sort((a,b)=>a.sortOrder-b.sortOrder || a.name.localeCompare(b.name,'ja'))
      onChange(rows)
    })
  })

  return () => { active = false; unsubscribe() }
}

export async function saveManagementDivision(
  input: Omit<ManagementDivisionRecord, 'id'>,
  divisionId?: string,
) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  if (divisionId) {
    await updateDoc(doc(db, 'managementDivisions', divisionId), { ...input, updatedAt: serverTimestamp() })
    return divisionId
  }
  const ref = await addDoc(collection(db, 'managementDivisions'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function deactivateManagementDivision(divisionId: string) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  await updateDoc(doc(db, 'managementDivisions', divisionId), {
    active: false,
    updatedAt: serverTimestamp(),
  })
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
            managementDivisionId: data.managementDivisionId ?? '',
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


type Pj020MigrationPayload = {
  source: 'PJ-020'
  schemaVersion: number
  setup?: {
    categories?: Array<{ id: string; name: string; color?: string }>
    resources?: Array<{ id: string; name: string; categoryId: string; managementGroupId?: string; color?: string }>
    managementGroups?: Array<{ id: string; name: string }>
  }
  reservations?: Array<{
    id: string
    resourceId: string
    date: string
    endDate?: string
    start: number
    end: number
    user?: string
    meetingName?: string
    purpose?: string
    visitorCompany?: string
    visitorInfo?: string
    internalCount?: string
    visitorCount?: string
    createdAt?: number
  }>
}

function hhmm(totalMinutes: number) {
  const value = Math.max(0, Math.min(24 * 60 - 1, Number(totalMinutes) || 0))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function migrationTypeId(categoryId: string, categoryName?: string) {
  if (categoryId === 'meeting' || categoryName?.includes('会議')) return 'meeting_room'
  if (categoryId === 'car' || categoryName?.includes('車')) return 'vehicle'
  return `pj020-type-${categoryId}`
}

export async function importPj020MigrationData(raw: string) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')

  let payload: Pj020MigrationPayload
  try {
    payload = JSON.parse(raw) as Pj020MigrationPayload
  } catch {
    throw new Error('INVALID_JSON')
  }
  if (payload.source !== 'PJ-020' || !payload.setup) throw new Error('INVALID_PJ020_DATA')

  const categories = payload.setup.categories ?? []
  const managementGroups = payload.setup.managementGroups ?? []
  const resources = payload.setup.resources ?? []
  const reservations = payload.reservations ?? []
  const categoryById = new Map(categories.map((row) => [row.id, row]))
  const resourceById = new Map(resources.map((row) => [row.id, row]))

  const operations: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = []

  managementGroups.forEach((row, index) => {
    operations.push({
      ref: doc(db, 'managementDivisions', `pj020-${row.id}`),
      data: {
        name: row.name,
        color: index % 2 === 0 ? '#2563eb' : '#059669',
        sortOrder: index + 1,
        active: true,
        source: 'pj020',
        sourceId: row.id,
        updatedAt: serverTimestamp(),
      },
    })
  })

  categories.forEach((row, index) => {
    const typeId = migrationTypeId(row.id, row.name)
    operations.push({
      ref: doc(db, 'resourceTypes', typeId),
      data: {
        name: row.name === '社用車' ? '車両' : row.name,
        color: row.id === 'meeting' ? '#2563eb' : row.id === 'car' ? '#059669' : '#6b7280',
        sortOrder: index + 1,
        active: true,
        source: 'pj020',
        sourceId: row.id,
        updatedAt: serverTimestamp(),
      },
    })
  })

  resources.forEach((row, index) => {
    const category = categoryById.get(row.categoryId)
    operations.push({
      ref: doc(db, 'resourceMasters', `pj020-${row.id}`),
      data: {
        name: row.name,
        typeId: migrationTypeId(row.categoryId, category?.name),
        managementDivisionId: row.managementGroupId ? `pj020-${row.managementGroupId}` : '',
        color: row.color || '#2463a8',
        sortOrder: index + 1,
        active: true,
        source: 'pj020',
        sourceId: row.id,
        updatedAt: serverTimestamp(),
      },
    })
  })

  reservations.forEach((row) => {
    const resource = resourceById.get(row.resourceId)
    if (!resource) return
    const category = categoryById.get(resource.categoryId)
    const eventId = `pj020-${row.id}`
    const resourceMasterId = `pj020-${resource.id}`
    const title = row.meetingName || row.purpose || `${resource.name}予約`
    const externalParticipants = [row.visitorCompany, row.visitorInfo].filter(Boolean).join(' ')
    const detailParts = [
      row.purpose ? `目的：${row.purpose}` : '',
      row.internalCount ? `社内人数：${row.internalCount}` : '',
      row.visitorCount ? `来訪者人数：${row.visitorCount}` : '',
      row.visitorCompany ? `来訪会社：${row.visitorCompany}` : '',
      row.visitorInfo ? `来訪者：${row.visitorInfo}` : '',
    ].filter(Boolean)
    const eventCategory = resource.categoryId === 'meeting' ? 'meeting' : 'other'
    const meetingRoom = resource.categoryId === 'meeting' ? resource.name : ''
    const vehicle = resource.categoryId === 'car' ? resource.name : ''

    operations.push({
      ref: doc(db, 'events', eventId),
      data: {
        title,
        date: row.date,
        endDate: row.endDate || row.date,
        startTime: hhmm(row.start),
        endTime: hhmm(row.end),
        allDay: false,
        category: eventCategory,
        scope: 'company',
        source: 'pj020',
        sourceReservationId: row.id,
        participants: row.user || '',
        participantIds: [],
        participantEmails: [],
        externalParticipants,
        location: '',
        description: detailParts.join('\n'),
        resource: resource.name,
        resourceIds: [resourceMasterId],
        resourceNames: [resource.name],
        meetingRoom,
        vehicle,
        notifyEmail: false,
        notifyTeams: false,
        status: 'active',
        version: '0.4.6',
        migratedAt: serverTimestamp(),
        sourceCreatedAt: row.createdAt ?? null,
        legacyReservation: {
          user: row.user ?? '',
          internalCount: row.internalCount ?? '',
          visitorCount: row.visitorCount ?? '',
          visitorCompany: row.visitorCompany ?? '',
          visitorInfo: row.visitorInfo ?? '',
          purpose: row.purpose ?? '',
          meetingName: row.meetingName ?? '',
        },
        updatedAt: serverTimestamp(),
      },
    })
    operations.push({
      ref: doc(db, 'reservations', `pj020-${row.id}`),
      data: {
        eventId,
        resourceName: resource.name,
        resourceId: resourceMasterId,
        date: row.date,
        endDate: row.endDate || row.date,
        startTime: hhmm(row.start),
        endTime: hhmm(row.end),
        source: 'pj020',
        sourceReservationId: row.id,
        status: 'active',
        updatedAt: serverTimestamp(),
      },
    })
  })

  for (let start = 0; start < operations.length; start += 350) {
    const batch = writeBatch(db)
    operations.slice(start, start + 350).forEach((operation) => batch.set(operation.ref, operation.data, { merge: true }))
    await batch.commit()
  }

  return {
    managementDivisions: managementGroups.length,
    resourceTypes: categories.length,
    resources: resources.length,
    reservations: reservations.length,
  }
}

export async function saveFeedback(input: FeedbackInput) {
  const signedIn = await ensureSignedIn()
  const db = await getDb()
  if (!signedIn || !db) throw new Error('AUTH_REQUIRED')
  const ref = await addDoc(collection(db, 'feedbacks'), {
    ...input,
    createdAt: serverTimestamp(),
    appVersion: '0.4.6',
    status: 'new',
  })
  return { id: ref.id, demo: false as const }
}
