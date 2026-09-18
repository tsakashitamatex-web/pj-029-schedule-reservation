'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { cancelCalendarEvent, deactivateEmployee, deactivateEventCategory, deactivateResourceMaster, deactivateResourceType, ensureDefaultMasters, saveCalendarEvent, saveEmployee, saveEventCategory, saveFeedback, saveResourceMaster, saveResourceType, subscribeCalendarEvents, subscribeEmployees, subscribeEventCategories, subscribeResourceMasters, subscribeResourceTypes, updateCalendarEvent, type CalendarEventInput, type CalendarEventRecord, type EmployeeRecord, type EventCategoryRecord, type ResourceMasterRecord, type ResourceTypeRecord } from '../lib/data'
import { getRuntimeConfig, isFirebaseConfigValid } from '../lib/firebase'
import { openTeamsNotification, shouldOpenTeams } from '../lib/teams'

type ViewMode = 'month' | 'week' | 'day'
type UiEvent = CalendarEventRecord & { demo?: boolean }

const categoryLabels: Record<CalendarEventInput['category'], string> = {
  meeting: '会議',
  visitor: '来客',
  business_trip: '出張',
  construction: '工事',
  outing: '外出',
  leave: '休暇',
  company_event: '会社行事',
  other: 'その他',
}

const scopeLabels: Record<CalendarEventInput['scope'], string> = {
  personal: '個人',
  department: '部署',
  company: '全社',
}

const times = Array.from({length:24},(_,i)=>{ const mins=8*60+i*30; return `${pad(Math.floor(mins/60))}:${pad(mins%60)}` })
const jpDays = ['日','月','火','水','木','金','土']
const COMPANY_HOLIDAYS_2026 = new Set([
  '2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20',
  '2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14',
  '2026-09-21','2026-09-22','2026-09-23',
  '2026-10-12',
  '2026-11-03','2026-11-23',
  '2026-12-29','2026-12-30','2026-12-31',
  '2027-01-01','2027-01-04','2027-01-11',
  '2027-02-11','2027-02-23',
  '2027-03-22',
])
const COMPANY_WORKDAY_OVERRIDES_2026 = new Set(['2027-04-29'])

function pad(n:number){ return String(n).padStart(2,'0') }
function toDateKey(d:Date){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
function dateFromKey(k:string){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d) }
function addDays(d:Date,n:number){ const x=new Date(d); x.setDate(x.getDate()+n); return x }
function startOfWeek(d:Date){ const x=new Date(d); const day=x.getDay(); return addDays(x,day===0?-6:1-day) }
function todayKey(){ return toDateKey(new Date()) }
function addOneHour(time:string){
  const [h,m]=time.split(':').map(Number)
  const next=Math.min(h+1,23)
  return `${pad(next)}:${pad(m)}`
}
function isCompanyHoliday(date:string){
  if (COMPANY_WORKDAY_OVERRIDES_2026.has(date)) return false
  const d=dateFromKey(date)
  return d.getDay()===0 || d.getDay()===6 || COMPANY_HOLIDAYS_2026.has(date)
}

function occursOn(event: UiEvent, date: string) {
  const end = event.endDate || event.date
  return event.date <= date && date <= end
}

function categoryClass(category: CalendarEventInput['category']) {
  return `cat-${category}`
}

export default function Home(){
  const [events,setEvents]=useState<UiEvent[]>([])
  const [viewMode,setViewMode]=useState<ViewMode>('month')
  const [selectedDate,setSelectedDate]=useState(todayKey())
  const [eventOpen,setEventOpen]=useState(false)
  const [detailOpen,setDetailOpen]=useState(false)
  const [selectedEvent,setSelectedEvent]=useState<UiEvent | null>(null)
  const [editingEvent,setEditingEvent]=useState<UiEvent | null>(null)
  const [feedbackOpen,setFeedbackOpen]=useState(false)
  const [eventState,setEventState]=useState<'idle'|'saving'|'sent'|'error'|'conflict'>('idle')
  const [eventError,setEventError]=useState('')
  const [feedbackState,setFeedbackState]=useState<'idle'|'saving'|'sent'|'error'>('idle')
  const [notice,setNotice]=useState('')
  const [loadState,setLoadState]=useState<'確認中'|'同期中'|'デモ'>('確認中')
  const [firebaseConfigured,setFirebaseConfigured]=useState(false)
  const [showCompany,setShowCompany]=useState(true)
  const [showPersonal,setShowPersonal]=useState(true)
  const [showDepartment,setShowDepartment]=useState(true)
  const [employees,setEmployees]=useState<EmployeeRecord[]>([])
  const [employeePickerOpen,setEmployeePickerOpen]=useState(false)
  const [selectedEmployeeIds,setSelectedEmployeeIds]=useState<string[]>([])
  const [employeeSearch,setEmployeeSearch]=useState('')
  const [employeeMasterOpen,setEmployeeMasterOpen]=useState(false)
  const [employeeState,setEmployeeState]=useState<'idle'|'saving'|'error'>('idle')
  const [employeeError,setEmployeeError]=useState('')
  const [editingEmployee,setEditingEmployee]=useState<EmployeeRecord | null>(null)
  const [resourceMasters,setResourceMasters]=useState<ResourceMasterRecord[]>([])
  const [resourceTypes,setResourceTypes]=useState<ResourceTypeRecord[]>([])
  const [eventCategories,setEventCategories]=useState<EventCategoryRecord[]>([])
  const [masterOpen,setMasterOpen]=useState(false)
  const [masterTab,setMasterTab]=useState<'resources'|'resourceTypes'|'categories'>('resources')
  const [editingResource,setEditingResource]=useState<ResourceMasterRecord | null>(null)
  const [editingResourceType,setEditingResourceType]=useState<ResourceTypeRecord | null>(null)
  const [editingCategory,setEditingCategory]=useState<EventCategoryRecord | null>(null)
  const [selectedResourceIds,setSelectedResourceIds]=useState<string[]>([])
  const [masterState,setMasterState]=useState<'idle'|'saving'|'error'>('idle')
  const [masterError,setMasterError]=useState('')
  const [timeDragDate,setTimeDragDate]=useState<string | null>(null)
  const [timeDragStart,setTimeDragStart]=useState<string | null>(null)
  const [timeDragEnd,setTimeDragEnd]=useState<string | null>(null)
  const [isTimeDragging,setIsTimeDragging]=useState(false)
  const [draftStartDate,setDraftStartDate]=useState(todayKey())
  const [draftEndDate,setDraftEndDate]=useState(todayKey())
  const [draftAllDay,setDraftAllDay]=useState(false)
  const [dragStartDate,setDragStartDate]=useState<string | null>(null)
  const [dragEndDate,setDragEndDate]=useState<string | null>(null)
  const [isMonthDragging,setIsMonthDragging]=useState(false)

  useEffect(()=>{
    let stop: () => void = () => {}
    let active = true

    getRuntimeConfig()
      .then((runtime)=>{
        if (!active) return
        const configured = isFirebaseConfigValid(runtime.firebase)
        setFirebaseConfigured(configured)
        setLoadState(configured ? '同期中' : 'デモ')
        if (configured) {
          stop = subscribeCalendarEvents(rows=>{ setEvents(rows); setLoadState('同期中') })
        }
      })
      .catch(()=>{
        if (!active) return
        setFirebaseConfigured(false)
        setLoadState('デモ')
      })

    ensureDefaultMasters().catch(()=>undefined)
    const stopEmployees = subscribeEmployees(setEmployees)
    const stopResources = subscribeResourceMasters(setResourceMasters)
    const stopResourceTypes = subscribeResourceTypes(setResourceTypes)
    const stopCategories = subscribeEventCategories(setEventCategories)

    return ()=>{
      active = false
      stop()
      stopEmployees()
      stopResources()
      stopResourceTypes()
      stopCategories()
    }
  },[])

  const selected=dateFromKey(selectedDate)
  const weekStart=startOfWeek(selected)
  const weekDays=Array.from({length:7},(_,i)=>addDays(weekStart,i))
  const monthGridStart=startOfWeek(new Date(selected.getFullYear(),selected.getMonth(),1))
  const monthDays=Array.from({length:42},(_,i)=>addDays(monthGridStart,i))
  const connectionText=useMemo(()=>firebaseConfigured?`Firestore ${loadState}`:loadState==='確認中'?'接続確認中':'デモモード：Firebase設定待ち',[firebaseConfigured,loadState])

  const selectedEmployees = useMemo(
    () => employees.filter((employee) => selectedEmployeeIds.includes(employee.id)),
    [employees, selectedEmployeeIds],
  )

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((employee) =>
      employee.name.toLowerCase().includes(q) ||
      employee.email.toLowerCase().includes(q) ||
      employee.division.toLowerCase().includes(q) ||
      employee.group.toLowerCase().includes(q) ||
      employee.department.toLowerCase().includes(q)
    )
  }, [employees, employeeSearch])

  const resourceTypeOptions = useMemo(() => {
    if (resourceTypes.length) return resourceTypes
    return [
      {id:'meeting_room',name:'会議室',color:'#2563eb',sortOrder:1,active:true},
      {id:'vehicle',name:'車両',color:'#059669',sortOrder:2,active:true},
      {id:'test_machine',name:'試験機',color:'#7c3aed',sortOrder:3,active:true},
      {id:'other',name:'その他設備',color:'#6b7280',sortOrder:99,active:true},
    ]
  }, [resourceTypes])

  const resourceOptions = useMemo(() => {
    if (resourceMasters.length) return resourceMasters
    return [
      {id:'room1',name:'第1会議室',typeId:'meeting_room',color:'#2563eb',sortOrder:1,active:true},
      {id:'room2',name:'第2会議室',typeId:'meeting_room',color:'#2563eb',sortOrder:2,active:true},
      {id:'carA',name:'社用車A',typeId:'vehicle',color:'#059669',sortOrder:1,active:true},
    ]
  }, [resourceMasters])

  const categoryOptions = useMemo(() => {
    if (eventCategories.length) return eventCategories
    return Object.entries(categoryLabels).map(([id,name],index)=>({
      id,name,color:'#6b7280',sortOrder:index+1,active:true,
    }))
  }, [eventCategories])

  const visibleEvents = useMemo(() => events.filter((event) => {
    if (event.scope === 'company') return showCompany
    if (event.scope === 'department') return showDepartment
    return showPersonal
  }), [events, showCompany, showDepartment, showPersonal])

  function move(step:number){
    if(viewMode==='month'){
      const d=new Date(selected); d.setMonth(d.getMonth()+step); setSelectedDate(toDateKey(d)); return
    }
    setSelectedDate(toDateKey(addDays(selected,step*(viewMode==='week'?7:1))))
  }

  function openNewEvent(date=selectedDate,time='10:00',endDate=date,allDay=false){
    setSelectedDate(date)
    setDraftStartDate(date)
    setDraftEndDate(endDate)
    setDraftAllDay(allDay)
    setEventState('idle')
    setEventError('')
    setEditingEvent(null)
    setSelectedEmployeeIds([])
    setSelectedResourceIds([])
    setEventOpen(true)
    requestAnimationFrame(()=>{
      const timeInput=document.querySelector<HTMLInputElement>('input[name="startTime"]')
      const endTimeInput=document.querySelector<HTMLInputElement>('input[name="endTime"]')
      if(timeInput) timeInput.value=time
      if(endTimeInput) endTimeInput.value=addOneHour(time)
    })
  }

  function beginMonthSelection(date:string){
    setDragStartDate(date)
    setDragEndDate(date)
    setIsMonthDragging(true)
  }

  function extendMonthSelection(date:string){
    if (!isMonthDragging || !dragStartDate) return
    setDragEndDate(date)
  }

  function finishMonthSelection(date:string){
    if (!isMonthDragging || !dragStartDate) return
    const start = dragStartDate <= date ? dragStartDate : date
    const end = dragStartDate <= date ? date : dragStartDate
    setIsMonthDragging(false)
    setDragStartDate(null)
    setDragEndDate(null)
    openNewEvent(start,'09:00',end,start !== end)
  }

  function isDateInDragRange(date:string){
    if (!isMonthDragging || !dragStartDate || !dragEndDate) return false
    const start = dragStartDate <= dragEndDate ? dragStartDate : dragEndDate
    const end = dragStartDate <= dragEndDate ? dragEndDate : dragStartDate
    return start <= date && date <= end
  }

  function timeIndex(time:string){ return times.indexOf(time) }

  function beginTimeSelection(date:string,time:string){
    setTimeDragDate(date)
    setTimeDragStart(time)
    setTimeDragEnd(time)
    setIsTimeDragging(true)
  }

  function extendTimeSelection(date:string,time:string){
    if (!isTimeDragging || timeDragDate !== date || !timeDragStart) return
    setTimeDragEnd(time)
  }

  function finishTimeSelection(date:string,time:string){
    if (!isTimeDragging || timeDragDate !== date || !timeDragStart) return
    const a=timeIndex(timeDragStart)
    const b=timeIndex(time)
    const start=times[Math.min(a,b)]
    const last=times[Math.max(a,b)]
    setIsTimeDragging(false)
    setTimeDragDate(null)
    setTimeDragStart(null)
    setTimeDragEnd(null)
    openNewEvent(date,start,date,false)
    requestAnimationFrame(()=>{
      const endTimeInput=document.querySelector<HTMLInputElement>('input[name="endTime"]')
      if(endTimeInput){
        const [h,m]=last.split(':').map(Number)
        const total=Math.min(h*60+m+30,23*60+59)
        endTimeInput.value=`${pad(Math.floor(total/60))}:${pad(total%60)}`
      }
    })
  }

  function isTimeInDragRange(date:string,time:string){
    if(!isTimeDragging || timeDragDate!==date || !timeDragStart || !timeDragEnd) return false
    const a=timeIndex(timeDragStart), b=timeIndex(timeDragEnd), x=timeIndex(time)
    return Math.min(a,b)<=x && x<=Math.max(a,b)
  }

  function toggleEmployee(id:string){
    setSelectedEmployeeIds((prev)=>prev.includes(id)?prev.filter((x)=>x!==id):[...prev,id])
  }

  function toggleResource(id:string){
    setSelectedResourceIds((prev)=>prev.includes(id)?prev.filter((x)=>x!==id):[...prev,id])
  }

  async function submitEmployee(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    const formElement=e.currentTarget
    setEmployeeState('saving')
    setEmployeeError('')
    const form=new FormData(formElement)
    try{
      await saveEmployee({
        name:String(form.get('employeeName')||''),
        email:String(form.get('employeeEmail')||''),
        division:String(form.get('employeeDivision')||''),
        group:String(form.get('employeeGroup')||''),
        department:String(form.get('employeeGroup')||form.get('employeeDivision')||''),
        color:String(form.get('employeeColor')||'#2463a8'),
        active:true,
      }, editingEmployee?.id)
      formElement.reset()
      setEditingEmployee(null)
      setEmployeeState('idle')
    }catch(err){
      const detail =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'code' in err
            ? String((err as { code?: unknown }).code ?? 'UNKNOWN_ERROR')
            : String(err)
      setEmployeeError(detail)
      setEmployeeState('error')
      console.error('PJ-029 employee save failed', err)
    }
  }

  function startEditEmployee(employee: EmployeeRecord){
    setEditingEmployee(employee)
    setEmployeeError('')
  }

  async function removeEmployee(employee: EmployeeRecord){
    if (!window.confirm(`「${employee.name}」を社員マスタから削除しますか？`)) return
    try{
      await deactivateEmployee(employee.id)
      if (editingEmployee?.id===employee.id) setEditingEmployee(null)
    }catch(err){
      setEmployeeError(err instanceof Error ? err.message : String(err))
      setEmployeeState('error')
    }
  }

  function eventPersonalStyle(event: UiEvent){
    const participantId = event.participantIds?.[0]
    const participantEmail = event.participantEmails?.[0]
    const employee =
      (participantId ? employees.find((item)=>item.id===participantId) : undefined) ??
      (participantEmail ? employees.find((item)=>item.email===participantEmail) : undefined)
    if (!employee?.color) return undefined
    return { borderLeftColor: employee.color }
  }

  async function submitResourceMaster(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    const formElement=e.currentTarget
    setMasterState('saving'); setMasterError('')
    const form=new FormData(formElement)
    try{
      await saveResourceMaster({
        name:String(form.get('resourceName')||''),
        typeId:String(form.get('resourceTypeId')||resourceTypeOptions[0]?.id||'other'),
        color:String(form.get('resourceColor')||'#2463a8'),
        sortOrder:Number(form.get('resourceSortOrder')||999),
        active:true,
      }, editingResource?.id)
      setEditingResource(null); formElement.reset(); setMasterState('idle')
    }catch(err){ setMasterError(err instanceof Error?err.message:String(err)); setMasterState('error') }
  }

  async function submitResourceType(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    const formElement=e.currentTarget
    setMasterState('saving'); setMasterError('')
    const form=new FormData(formElement)
    try{
      await saveResourceType({
        name:String(form.get('resourceTypeName')||''),
        color:String(form.get('resourceTypeColor')||'#6b7280'),
        sortOrder:Number(form.get('resourceTypeSortOrder')||999),
        active:true,
      }, editingResourceType?.id)
      setEditingResourceType(null); formElement.reset(); setMasterState('idle')
    }catch(err){ setMasterError(err instanceof Error?err.message:String(err)); setMasterState('error') }
  }

  async function submitEventCategory(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    const formElement=e.currentTarget
    setMasterState('saving'); setMasterError('')
    const form=new FormData(formElement)
    try{
      await saveEventCategory({
        name:String(form.get('categoryName')||''),
        color:String(form.get('categoryColor')||'#6b7280'),
        sortOrder:Number(form.get('categorySortOrder')||999),
        active:true,
      }, editingCategory?.id)
      setEditingCategory(null); formElement.reset(); setMasterState('idle')
    }catch(err){ setMasterError(err instanceof Error?err.message:String(err)); setMasterState('error') }
  }

  async function removeResourceMaster(row:ResourceMasterRecord){
    if(!window.confirm(`「${row.name}」を削除しますか？`)) return
    await deactivateResourceMaster(row.id)
    if(editingResource?.id===row.id) setEditingResource(null)
  }

  async function removeResourceType(row:ResourceTypeRecord){
    if(resourceOptions.some((resource)=>resource.typeId===row.id)){
      setMasterError('この種別を使用している設備があります。先に設備の種別を変更してください。')
      setMasterState('error')
      return
    }
    if(!window.confirm(`「${row.name}」を削除しますか？`)) return
    await deactivateResourceType(row.id)
    if(editingResourceType?.id===row.id) setEditingResourceType(null)
  }

  async function removeEventCategory(row:EventCategoryRecord){
    if(!window.confirm(`「${row.name}」を削除しますか？`)) return
    await deactivateEventCategory(row.id)
    if(editingCategory?.id===row.id) setEditingCategory(null)
  }

  function categoryLabelFor(id:string){
    return categoryOptions.find((x)=>x.id===id)?.name ?? categoryLabels[id as keyof typeof categoryLabels] ?? id
  }

  function categoryStyleFor(id:string){
    const color=categoryOptions.find((x)=>x.id===id)?.color
    return color ? { background: `${color}20`, borderLeftColor: color } : undefined
  }

  function openEventDetail(event: UiEvent){
    setSelectedEvent(event)
    setDetailOpen(true)
  }

  function openEditEvent(event: UiEvent){
    setEditingEvent(event)
    setSelectedEvent(event)
    setDetailOpen(false)
    setEventState('idle')
    setEventError('')
    setDraftStartDate(event.date)
    setDraftEndDate(event.endDate || event.date)
    setDraftAllDay(event.allDay)
    setSelectedEmployeeIds(
      event.participantIds?.length
        ? event.participantIds
        : employees.filter((employee)=>event.participantEmails?.includes(employee.email)).map((employee)=>employee.id)
    )
    setSelectedResourceIds(
      event.resourceIds?.length
        ? event.resourceIds
        : resourceOptions.filter((resource)=>event.resourceNames?.includes(resource.name) || event.meetingRoom===resource.name || event.vehicle===resource.name).map((resource)=>resource.id)
    )
    setEventOpen(true)
  }

  async function handleCancelEvent(event: UiEvent){
    if (!window.confirm(`「${event.title}」をキャンセルしますか？`)) return
    try{
      await cancelCalendarEvent(event.id)
      setDetailOpen(false)
      setSelectedEvent(null)
      setNotice('予定をキャンセルしました。設備予約も同時に解除しました。')
    }catch(err){
      setNotice(`キャンセルに失敗しました：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function submitEvent(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    setEventState('saving')
    setEventError('')
    const form=new FormData(e.currentTarget)
    const allDay=form.get('allDay')==='on'
    const date=String(form.get('date')||selectedDate)
    const input: CalendarEventInput = {
      title:String(form.get('title')||''),
      date,
      endDate:String(form.get('endDate')||date),
      startTime:allDay ? '00:00' : String(form.get('startTime')||'10:00'),
      endTime:allDay ? '23:59' : String(form.get('endTime')||'11:00'),
      allDay,
      category:String(form.get('category')||'other') as CalendarEventInput['category'],
      scope:String(form.get('scope')||'personal') as CalendarEventInput['scope'],
      source:'pj029',
      participants:selectedEmployees.map((employee)=>employee.name).join('・'),
      participantIds:selectedEmployees.map((employee)=>employee.id),
      participantEmails:selectedEmployees.map((employee)=>employee.email),
      externalParticipants:String(form.get('externalParticipants')||''),
      location:String(form.get('location')||''),
      description:String(form.get('description')||''),
      resource:resourceOptions.filter((row)=>selectedResourceIds.includes(row.id)).map((row)=>row.name).join('、'),
      resourceIds:selectedResourceIds,
      resourceNames:resourceOptions.filter((row)=>selectedResourceIds.includes(row.id)).map((row)=>row.name),
      meetingRoom:resourceOptions.find((row)=>selectedResourceIds.includes(row.id) && row.typeId==='meeting_room')?.name||'',
      vehicle:resourceOptions.find((row)=>selectedResourceIds.includes(row.id) && row.typeId==='vehicle')?.name||'',
      notifyEmail:form.get('notifyEmail')==='on',
      notifyTeams:form.get('notifyTeams')==='on',
    }

    try{
      const result = editingEvent ? null : await saveCalendarEvent(input)
      if (editingEvent) await updateCalendarEvent(editingEvent.id, input)
      setSelectedDate(input.date)
      setEventState('sent')
      let message = editingEvent
        ? '予定を更新しました。'
        : result?.demo
          ? '予定を画面へ追加しました。Firebase接続後はFirestoreに保存されます。'
          : '予定をFirestoreへ保存しました。'

      if (shouldOpenTeams(input)) {
        const teams = await openTeamsNotification(input)
        if (teams.ok) {
          message += teams.copied ? ' Teams通知文をコピーし、通知先を開きました。' : ' Teams通知先を開きました。'
        } else if (teams.reason === 'NO_URL') {
          message += ' Teams通知先リンクが未設定です。'
        } else {
          message += teams.copied ? ' Teams通知文はコピー済みですが、Teamsを開けませんでした。' : ' Teamsを開けませんでした。'
        }
      }
      setNotice(message)
    }catch(err){
      if (err instanceof Error && err.message.startsWith('RESERVATION_CONFLICT')) {
        setEventState('conflict')
        return
      }
      const detail = err instanceof Error ? err.message : String(err)
      setEventError(detail)
      setEventState('error')
      console.error('PJ-029 save failed', err)
    }
  }

  async function submitFeedback(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setFeedbackState('saving')
    const form=new FormData(e.currentTarget)
    try{
      const result=await saveFeedback({
        type:String(form.get('type')) as 'improvement'|'bug'|'other',
        message:String(form.get('message')||''),
        screen:viewMode==='month'?'月カレンダー':viewMode==='day'?'日カレンダー':'週カレンダー',
      })
      setFeedbackState('sent')
      setNotice(result.demo?'Firebase設定前のためデモ送信として処理しました。':'フィードバックをFirestoreへ保存しました。')
    }catch{ setFeedbackState('error') }
  }

  return <main className="app-shell">
    <header className="topbar">
      <div><div className="eyebrow">PJ-029 / Ver.0.4.1</div><h1>会社スケジュール・予約管理</h1></div>
      <div className="top-actions">
        <span className={`status-chip ${firebaseConfigured?'ok':''}`}>{connectionText}</span>
        <button className="btn secondary" type="button" onClick={()=>setNotice('会社カレンダーはPJ-029内で全社予定として管理します。Googleカレンダー連携は行いません。')}>会社カレンダー</button>
        <button className="btn secondary" type="button" onClick={()=>setEmployeeMasterOpen(true)}>社員マスタ</button>
        <button className="btn secondary" type="button" onClick={()=>setMasterOpen(true)}>各種マスタ</button>
        <button className="btn secondary" type="button" onClick={()=>setNotice('設備・リソース予約は通常の予定登録画面から行います。')}>設備・リソース</button>
        <button className="btn primary" type="button" onClick={()=>openNewEvent()}>＋ 予定を作成</button>
      </div>
    </header>

    {notice&&<div className="notice" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="閉じる">×</button></div>}

    <div className="toolbar">
      <div className="nav-group">
        <button className="icon-btn" type="button" onClick={()=>move(-1)}>‹</button>
        <button className="btn secondary" type="button" onClick={()=>setSelectedDate(todayKey())}>今日</button>
        <button className="icon-btn" type="button" onClick={()=>move(1)}>›</button>
        <strong>{viewMode==='month'?`${selected.getFullYear()}年${selected.getMonth()+1}月`:viewMode==='week'?`${weekDays[0].getMonth()+1}/${weekDays[0].getDate()}〜${weekDays[6].getMonth()+1}/${weekDays[6].getDate()}`:`${selected.getFullYear()}年${selected.getMonth()+1}月${selected.getDate()}日`}</strong>
      </div>
      <div className="view-tabs">
        {(['month','week','day'] as ViewMode[]).map(v=><button key={v} type="button" className={viewMode===v?'active':''} onClick={()=>setViewMode(v)}>{v==='month'?'月':v==='week'?'週':'日'}</button>)}
      </div>
    </div>

    <div className="workspace">
      <aside className="sidebar">
        <section>
          <h2>表示カレンダー</h2>
          <label><input type="checkbox" checked={showCompany} onChange={e=>setShowCompany(e.target.checked)}/> 会社カレンダー</label>
          <label><input type="checkbox" checked={showPersonal} onChange={e=>setShowPersonal(e.target.checked)}/> 個人予定</label>
          <label><input type="checkbox" checked={showDepartment} onChange={e=>setShowDepartment(e.target.checked)}/> 部署予定</label>
        </section>
        <section>
          <h2>予定種別</h2>
          <div className="legend-list">
            {categoryOptions.map((row)=><span key={row.id}><i className="legend-color" style={{background:row.color}}/>{row.name}</span>)}
          </div>
        </section>
        <section>
          <h2>設備は必要時のみ</h2>
          <div className="sidebar-note">会議室・社用車は予定の主役ではなく、必要な予定に追加して予約します。</div>
        </section>
      </aside>

      {viewMode==='week'&&<section className="calendar-card" aria-label="週カレンダー">
        <div className="calendar-grid header-row"><div className="time-head"/>{weekDays.map(d=>{const key=toDateKey(d);return <button className={`day-head day-button ${isCompanyHoliday(key)?'company-holiday':''}`} type="button" key={key} onClick={()=>{setSelectedDate(key);setViewMode('day')}}>{jpDays[d.getDay()]} {d.getDate()}{isCompanyHoliday(key)&&<span className="holiday-badge">休業日</span>}</button>})}</div>
        {times.map(time=><div className="calendar-grid time-row" key={time}>
          <div className="time-label">{time}</div>
          {weekDays.map(d=>{
            const date=toDateKey(d)
            const items=visibleEvents.filter(x=>occursOn(x,date) && (x.allDay || x.startTime.startsWith(time.slice(0,2))))
            return <div
              className={`slot clickable ${isTimeInDragRange(date,time)?'time-selecting':''} ${isCompanyHoliday(date)?'company-holiday':''}`}
              key={date+time}
              onMouseDown={(e)=>{if(e.button===0){e.preventDefault();beginTimeSelection(date,time)}}}
              onMouseEnter={()=>extendTimeSelection(date,time)}
              onMouseUp={()=>finishTimeSelection(date,time)}
            >{items.map(item=><button className={`event-card ${categoryClass(item.category)}`} style={{...categoryStyleFor(item.category),...eventPersonalStyle(item)}} type="button" key={item.id} onMouseDown={(e)=>e.stopPropagation()} onClick={()=>openEventDetail(item)}><strong>{item.title}</strong><span>{item.allDay?'終日':`${item.startTime}〜${item.endTime}`}・{categoryLabelFor(item.category)}</span><span>{item.location||item.participants||scopeLabels[item.scope]}</span></button>)}</div>
          })}
        </div>)}
      </section>}

      {viewMode==='day'&&<section className={`calendar-card day-view ${isCompanyHoliday(selectedDate)?'company-holiday':''}`} aria-label="日カレンダー">
        <div className="day-view-head"><strong>{jpDays[selected.getDay()]} {selected.getMonth()+1}/{selected.getDate()} {isCompanyHoliday(selectedDate)&&<span className="holiday-badge">休業日</span>}</strong><span>{visibleEvents.filter(e=>occursOn(e,selectedDate)).length}件</span></div>
        <div className="all-day-row">
          <div className="time-label">終日</div>
          <div className="slot">{visibleEvents.filter(e=>occursOn(e,selectedDate)&&e.allDay).map(item=><button className={`event-card wide ${categoryClass(item.category)}`} style={{...categoryStyleFor(item.category),...eventPersonalStyle(item)}} type="button" key={item.id} onMouseDown={(e)=>e.stopPropagation()} onClick={()=>openEventDetail(item)}><strong>{item.title}</strong><span>{categoryLabelFor(item.category)}・{scopeLabels[item.scope]}</span></button>)}</div>
        </div>
        {times.map(time=>{
          const items=visibleEvents.filter(e=>occursOn(e,selectedDate)&&!e.allDay&&e.startTime.startsWith(time.slice(0,2)))
          return <div className="day-row" key={time}><div className="time-label">{time}</div><div
            className={`slot clickable ${isTimeInDragRange(selectedDate,time)?'time-selecting':''} ${isCompanyHoliday(selectedDate)?'company-holiday':''}`}
            onMouseDown={(e)=>{if(e.button===0){e.preventDefault();beginTimeSelection(selectedDate,time)}}}
            onMouseEnter={()=>extendTimeSelection(selectedDate,time)}
            onMouseUp={()=>finishTimeSelection(selectedDate,time)}
          >{items.map(item=><button className={`event-card wide ${categoryClass(item.category)}`} style={{...categoryStyleFor(item.category),...eventPersonalStyle(item)}} type="button" key={item.id} onMouseDown={(e)=>e.stopPropagation()} onClick={()=>openEventDetail(item)}><strong>{item.title}</strong><span>{item.startTime}〜{item.endTime}　{categoryLabelFor(item.category)}　{item.location||''}</span></button>)}</div></div>
        })}
      </section>}

      {viewMode==='month'&&<section className="calendar-card month-view" aria-label="月カレンダー">
        <div className="month-weekdays">{['月','火','水','木','金','土','日'].map(d=><div key={d}>{d}</div>)}</div>
        <div className="month-grid">{monthDays.map(date=>{
          const key=toDateKey(date)
          const all=visibleEvents.filter(e=>occursOn(e,key)).sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.startTime.localeCompare(b.startTime))
          return <div
            role="button"
            tabIndex={0}
            className={`month-cell ${date.getMonth()!==selected.getMonth()?'outside':''} ${isDateInDragRange(key)?'range-selecting':''} ${isCompanyHoliday(key)?'company-holiday':''}`}
            key={key}
            onMouseDown={(e)=>{ if(e.button===0){ e.preventDefault(); beginMonthSelection(key) } }}
            onMouseEnter={()=>extendMonthSelection(key)}
            onMouseUp={()=>finishMonthSelection(key)}
            onKeyDown={(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openNewEvent(key) } }}
          >
            <span className="month-day-num">{date.getDate()}{isCompanyHoliday(key)&&<span className="holiday-badge">休業日</span>}</span>
            <span className="month-events">{all.slice(0,5).map(item=><span className={`month-event ${categoryClass(item.category)}`} style={{...categoryStyleFor(item.category),...eventPersonalStyle(item)}} key={item.id} onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();openEventDetail(item)}}>{item.allDay?'':item.startTime+' '}{item.title}</span>)}{all.length>5&&<span className="more">他 {all.length-5}件</span>}</span>
          </div>
        })}</div>
      </section>}
    </div>


    {detailOpen&&selectedEvent&&<div className="modal-backdrop" onMouseDown={()=>setDetailOpen(false)}><div className="modal detail-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">{categoryLabelFor(selectedEvent.category)}・{scopeLabels[selectedEvent.scope]}</div><h2>{selectedEvent.title}</h2></div><button className="icon-btn" type="button" onClick={()=>setDetailOpen(false)}>×</button></div>
      <div className="detail-grid">
        <div><span>日時</span><strong>{selectedEvent.date}{selectedEvent.endDate&&selectedEvent.endDate!==selectedEvent.date?` ～ ${selectedEvent.endDate}`:''}　{selectedEvent.allDay?'終日':`${selectedEvent.startTime}～${selectedEvent.endTime}`}</strong></div>
        <div><span>場所</span><strong>{selectedEvent.location||'未設定'}</strong></div>
        <div><span>社内参加者</span><strong>{selectedEvent.participants||'未設定'}</strong></div>
        <div><span>外部参加者・来訪者</span><strong>{selectedEvent.externalParticipants||'なし'}</strong></div>
        <div><span>予約設備・リソース</span><strong>{selectedEvent.resourceNames?.length?selectedEvent.resourceNames.join('、'):selectedEvent.resource||'なし'}</strong></div>
        <div><span>公開範囲</span><strong>{scopeLabels[selectedEvent.scope]}</strong></div>
      </div>
      {selectedEvent.description&&<div className="detail-description"><span>詳細</span><p>{selectedEvent.description}</p></div>}
      <div className="modal-actions detail-actions">
        <button type="button" className="btn danger" onClick={()=>handleCancelEvent(selectedEvent)}>キャンセル</button>
        <button type="button" className="btn primary" onClick={()=>openEditEvent(selectedEvent)}>編集</button>
      </div>
    </div></div>}

    <button className="feedback-fab" type="button" onClick={()=>{setFeedbackOpen(true);setFeedbackState('idle')}}>フィードバック</button>

    {eventOpen&&<div className="modal-backdrop" onMouseDown={()=>setEventOpen(false)}><div className="modal schedule-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">会社予定・個人予定・設備／リソース予約</div><h2>{editingEvent?'予定を編集':'予定を作成'}</h2></div><button className="icon-btn" type="button" onClick={()=>setEventOpen(false)}>×</button></div>
      {eventState==='sent'?<div className="success">予定を登録しました。<div className="modal-actions"><button type="button" className="btn primary" onClick={()=>setEventOpen(false)}>閉じる</button></div></div>:<form onSubmit={submitEvent}>
        <label className="field">タイトル<input name="title" required placeholder="例：姫路出張、○○工場定修工事、ABC社打合せ" defaultValue={editingEvent?.title||''}/></label>
        <div className="form-grid two"><label className="field">予定種別<select name="category" defaultValue={editingEvent?.category||categoryOptions[0]?.id||"meeting"}>{categoryOptions.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label className="field">公開範囲<select name="scope" defaultValue={editingEvent?.scope||"personal"}><option value="personal">個人</option><option value="department">部署</option><option value="company">全社</option></select></label></div>
        <label className="check-field"><input name="allDay" type="checkbox" defaultChecked={editingEvent?.allDay??draftAllDay}/> 終日予定</label>
        <div className="form-grid four"><label className="field">開始日<input name="date" type="date" required defaultValue={editingEvent?.date||draftStartDate}/></label><label className="field">終了日<input name="endDate" type="date" required defaultValue={editingEvent?.endDate||editingEvent?.date||draftEndDate}/></label><label className="field">開始<input name="startTime" type="time" defaultValue={editingEvent?.startTime||"10:00"}/></label><label className="field">終了<input name="endTime" type="time" defaultValue={editingEvent?.endTime||"11:00"}/></label></div>
        <label className="field">場所<input name="location" placeholder="例：JFE倉敷、東京本社、Web" defaultValue={editingEvent?.location||''}/></label>
        <div className="field">
          <span>社内参加者</span>
          <div className="participant-selector">
            <div className="participant-tags">
              {selectedEmployees.length===0&&<span className="participant-empty">未選択</span>}
              {selectedEmployees.map((employee)=><button type="button" className="participant-tag" key={employee.id} onClick={()=>toggleEmployee(employee.id)}>{employee.name} ×</button>)}
            </div>
            <button type="button" className="btn secondary" onClick={()=>setEmployeePickerOpen(true)}>＋ 社内参加者を選択</button>
          </div>
        </div>
        <label className="field">外部参加者・来訪者<input name="externalParticipants" placeholder="例：ABC社 田中様" defaultValue={editingEvent?.externalParticipants||''}/></label>
        <div className="field">
          <span>設備・リソース予約（必要な場合のみ）</span>
          <div className="resource-picker">
            {resourceTypeOptions.map((type)=>{
              const rows=resourceOptions.filter((row)=>row.typeId===type.id)
              if(!rows.length) return null
              return <div className="resource-group" key={type.id}>
                <strong><i className="employee-color-dot" style={{background:type.color}}/> {type.name}</strong>
                <div className="resource-checks">{rows.map((row)=><label key={row.id}><input type="checkbox" checked={selectedResourceIds.includes(row.id)} onChange={()=>toggleResource(row.id)}/><span>{row.name}</span></label>)}</div>
              </div>
            })}
            {resourceOptions.length===0&&<div className="empty-panel">設備・リソースが未登録です。</div>}
          </div>
        </div>
        <label className="field">詳細<textarea name="description" rows={3} placeholder="目的、工事内容、訪問先、連絡事項など" defaultValue={editingEvent?.description||''}/></label>
        <div className="check-row"><label><input name="notifyEmail" type="checkbox" defaultChecked={editingEvent?.notifyEmail||false}/> 選択した社内参加者へメール通知</label><label><input name="notifyTeams" type="checkbox" defaultChecked={editingEvent?.notifyTeams||false}/> Teams通知（来客会議室予約）</label></div>
        {eventState==='conflict'&&<div className="error">この設備は指定時間帯に既に予約されています。時間または設備を変更してください。</div>}
        {eventState==='error'&&<div className="error">保存に失敗しました。<br/><small>エラー：{eventError || '詳細不明'}</small></div>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setEventOpen(false)}>キャンセル</button><button type="submit" className="btn primary" disabled={eventState==='saving'}>{eventState==='saving'?'保存中…':editingEvent?'更新する':'登録する'}</button></div>
      </form>}
    </div></div>}


    {employeePickerOpen&&<div className="modal-backdrop" onMouseDown={()=>setEmployeePickerOpen(false)}><div className="modal employee-picker-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">社員マスタから複数選択</div><h2>社内参加者を選択</h2></div><button className="icon-btn" type="button" onClick={()=>setEmployeePickerOpen(false)}>×</button></div>
      <input className="employee-search" value={employeeSearch} onChange={e=>setEmployeeSearch(e.target.value)} placeholder="氏名・メール・部署で検索"/>
      <div className="employee-list">
        {filteredEmployees.map((employee)=><label className="employee-row" key={employee.id}>
          <input type="checkbox" checked={selectedEmployeeIds.includes(employee.id)} onChange={()=>toggleEmployee(employee.id)}/>
          <span><strong><i className="employee-color-dot" style={{background:employee.color}}/> {employee.name}</strong><small>{[employee.division,employee.group].filter(Boolean).join(' / ')||employee.department||'所属未設定'}　{employee.email}</small></span>
        </label>)}
        {filteredEmployees.length===0&&<div className="empty-panel">該当する社員がありません。</div>}
      </div>
      <div className="modal-actions"><button type="button" className="btn primary" onClick={()=>setEmployeePickerOpen(false)}>選択完了（{selectedEmployeeIds.length}名）</button></div>
    </div></div>}

    {employeeMasterOpen&&<div className="modal-backdrop" onMouseDown={()=>setEmployeeMasterOpen(false)}><div className="modal employee-master-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">氏名とメールアドレスを管理</div><h2>社員マスタ</h2></div><button className="icon-btn" type="button" onClick={()=>setEmployeeMasterOpen(false)}>×</button></div>
      <form className="employee-master-form" onSubmit={submitEmployee} key={editingEmployee?.id||'new'}>
        <input name="employeeName" required placeholder="氏名" defaultValue={editingEmployee?.name||''}/>
        <input name="employeeEmail" type="email" required placeholder="メールアドレス" defaultValue={editingEmployee?.email||''}/>
        <input name="employeeDivision" placeholder="ディビジョン" defaultValue={editingEmployee?.division||''}/>
        <input name="employeeGroup" placeholder="グループ" defaultValue={editingEmployee?.group||editingEmployee?.department||''}/>
        <label className="employee-color-field"><span>個人色</span><input name="employeeColor" type="color" defaultValue={editingEmployee?.color||'#2463a8'}/></label>
        <button type="submit" className="btn primary" disabled={employeeState==='saving'}>{employeeState==='saving'?'保存中…':editingEmployee?'更新':'社員を追加'}</button>
        {editingEmployee&&<button type="button" className="btn secondary" onClick={()=>setEditingEmployee(null)}>編集取消</button>}
      </form>
      {employeeState==='error'&&<div className="error">社員マスタの保存に失敗しました。<br/><small>エラー：{employeeError||'詳細不明'}</small></div>}
      <div className="employee-list master-list">
        {employees.map((employee)=><div className="employee-row master-row" key={employee.id}>
          <span><strong><i className="employee-color-dot" style={{background:employee.color}}/> {employee.name}</strong><small>{[employee.division,employee.group].filter(Boolean).join(' / ')||employee.department||'所属未設定'}　{employee.email}</small></span>
          <div className="employee-row-actions"><button type="button" className="btn secondary" onClick={()=>startEditEmployee(employee)}>修正</button><button type="button" className="btn danger" onClick={()=>removeEmployee(employee)}>削除</button></div>
        </div>)}
      </div>
    </div></div>}


    {masterOpen&&<div className="modal-backdrop" onMouseDown={()=>setMasterOpen(false)}><div className="modal master-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">予約アプリ方式のマスタ管理</div><h2>各種マスタ</h2></div><button className="icon-btn" type="button" onClick={()=>setMasterOpen(false)}>×</button></div>
      <div className="view-tabs master-tabs">
        <button type="button" className={masterTab==='resources'?'active':''} onClick={()=>setMasterTab('resources')}>設備・リソース</button>
        <button type="button" className={masterTab==='resourceTypes'?'active':''} onClick={()=>setMasterTab('resourceTypes')}>リソース種別</button>
        <button type="button" className={masterTab==='categories'?'active':''} onClick={()=>setMasterTab('categories')}>予定種別</button>
      </div>
      {masterTab==='resources'&&<>
        <form className="master-form" onSubmit={submitResourceMaster} key={editingResource?.id||'new-resource'}>
          <input name="resourceName" required placeholder="名称" defaultValue={editingResource?.name||''}/>
          <select name="resourceTypeId" defaultValue={editingResource?.typeId||resourceTypeOptions[0]?.id||''}>{resourceTypeOptions.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select>
          <input name="resourceSortOrder" type="number" min="0" placeholder="表示順" defaultValue={editingResource?.sortOrder??999}/>
          <input name="resourceColor" type="color" defaultValue={editingResource?.color||'#2463a8'}/>
          <button className="btn primary" type="submit">{editingResource?'更新':'追加'}</button>
          {editingResource&&<button className="btn secondary" type="button" onClick={()=>setEditingResource(null)}>取消</button>}
        </form>
        <div className="master-list">{resourceOptions.map(row=><div className="master-item" key={row.id}><span><i className="employee-color-dot" style={{background:row.color}}/><strong>{row.name}</strong><small>{resourceTypeOptions.find((type)=>type.id===row.typeId)?.name||'種別未設定'} / 表示順 {row.sortOrder}</small></span><div className="employee-row-actions"><button className="btn secondary" type="button" onClick={()=>setEditingResource(row)}>修正</button><button className="btn danger" type="button" onClick={()=>removeResourceMaster(row)}>削除</button></div></div>)}</div>
      </>}
      {masterTab==='resourceTypes'&&<>
        <form className="master-form" onSubmit={submitResourceType} key={editingResourceType?.id||'new-resource-type'}>
          <input name="resourceTypeName" required placeholder="種別名（例：試験機）" defaultValue={editingResourceType?.name||''}/>
          <input name="resourceTypeSortOrder" type="number" min="0" placeholder="表示順" defaultValue={editingResourceType?.sortOrder??999}/>
          <input name="resourceTypeColor" type="color" defaultValue={editingResourceType?.color||'#6b7280'}/>
          <button className="btn primary" type="submit">{editingResourceType?'更新':'追加'}</button>
          {editingResourceType&&<button className="btn secondary" type="button" onClick={()=>setEditingResourceType(null)}>取消</button>}
        </form>
        <div className="master-list">{resourceTypeOptions.map(row=><div className="master-item" key={row.id}><span><i className="employee-color-dot" style={{background:row.color}}/><strong>{row.name}</strong><small>表示順 {row.sortOrder}</small></span><div className="employee-row-actions"><button className="btn secondary" type="button" onClick={()=>setEditingResourceType(row)}>修正</button><button className="btn danger" type="button" onClick={()=>removeResourceType(row)}>削除</button></div></div>)}</div>
      </>}
      {masterTab==='categories'&&<>
        <form className="master-form" onSubmit={submitEventCategory} key={editingCategory?.id||'new-category'}>
          <input name="categoryName" required placeholder="予定種別名" defaultValue={editingCategory?.name||''}/>
          <input name="categorySortOrder" type="number" min="0" placeholder="表示順" defaultValue={editingCategory?.sortOrder??999}/>
          <input name="categoryColor" type="color" defaultValue={editingCategory?.color||'#6b7280'}/>
          <button className="btn primary" type="submit">{editingCategory?'更新':'追加'}</button>
          {editingCategory&&<button className="btn secondary" type="button" onClick={()=>setEditingCategory(null)}>取消</button>}
        </form>
        <div className="master-list">{categoryOptions.map(row=><div className="master-item" key={row.id}><span><i className="employee-color-dot" style={{background:row.color}}/><strong>{row.name}</strong><small>表示順 {row.sortOrder}</small></span><div className="employee-row-actions"><button className="btn secondary" type="button" onClick={()=>setEditingCategory(row)}>修正</button><button className="btn danger" type="button" onClick={()=>removeEventCategory(row)}>削除</button></div></div>)}</div>
      </>}
      {masterState==='error'&&<div className="error">保存に失敗しました。<br/><small>{masterError}</small></div>}
    </div></div>}

    {feedbackOpen&&<div className="modal-backdrop" onMouseDown={()=>setFeedbackOpen(false)}><div className="modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">改善提案・不具合報告</div><h2>フィードバック</h2></div><button className="icon-btn" type="button" onClick={()=>setFeedbackOpen(false)}>×</button></div>
      {feedbackState==='sent'?<div className="success">送信しました。ご意見ありがとうございます。</div>:<form onSubmit={submitFeedback}>
        <label className="field">種類<select name="type" defaultValue="improvement"><option value="improvement">改善提案</option><option value="bug">不具合</option><option value="other">その他</option></select></label>
        <label className="field">内容<textarea name="message" rows={6} placeholder="気になった点や改善案を入力してください" required/></label>
        <div className="auto-info">画面：{viewMode==='month'?'月':viewMode==='day'?'日':'週'}カレンダー ／ バージョン：0.4.1</div>
        {feedbackState==='error'&&<div className="error">送信に失敗しました。</div>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setFeedbackOpen(false)}>キャンセル</button><button type="submit" className="btn primary" disabled={feedbackState==='saving'}>{feedbackState==='saving'?'送信中…':'送信'}</button></div>
      </form>}
    </div></div>}
  </main>
}
