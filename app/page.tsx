'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { cancelCalendarEvent, saveCalendarEvent, saveFeedback, subscribeCalendarEvents, updateCalendarEvent, type CalendarEventInput, type CalendarEventRecord } from '../lib/data'
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

const meetingRooms = ['', '第1会議室', '第2会議室']
const vehicles = ['', '社用車A']
const times = ['9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00']
const jpDays = ['日','月','火','水','木','金','土']

function pad(n:number){ return String(n).padStart(2,'0') }
function toDateKey(d:Date){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
function dateFromKey(k:string){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d) }
function addDays(d:Date,n:number){ const x=new Date(d); x.setDate(x.getDate()+n); return x }
function startOfWeek(d:Date){ const x=new Date(d); const day=x.getDay(); return addDays(x,day===0?-6:1-day) }
function todayKey(){ return toDateKey(new Date()) }

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

    return ()=>{
      active = false
      stop()
    }
  },[])

  const selected=dateFromKey(selectedDate)
  const weekStart=startOfWeek(selected)
  const weekDays=Array.from({length:5},(_,i)=>addDays(weekStart,i))
  const monthGridStart=startOfWeek(new Date(selected.getFullYear(),selected.getMonth(),1))
  const monthDays=Array.from({length:42},(_,i)=>addDays(monthGridStart,i))
  const connectionText=useMemo(()=>firebaseConfigured?`Firestore ${loadState}`:loadState==='確認中'?'接続確認中':'デモモード：Firebase設定待ち',[firebaseConfigured,loadState])

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

  function openNewEvent(date=selectedDate,time='10:00'){
    setSelectedDate(date)
    setEventState('idle')
    setEventError('')
    setEditingEvent(null)
    setEventOpen(true)
    requestAnimationFrame(()=>{
      const dateInput=document.querySelector<HTMLInputElement>('input[name="date"]')
      const endDateInput=document.querySelector<HTMLInputElement>('input[name="endDate"]')
      const timeInput=document.querySelector<HTMLInputElement>('input[name="startTime"]')
      if(dateInput) dateInput.value=date
      if(endDateInput) endDateInput.value=date
      if(timeInput) timeInput.value=time
    })
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
      participants:String(form.get('participants')||''),
      externalParticipants:String(form.get('externalParticipants')||''),
      location:String(form.get('location')||''),
      description:String(form.get('description')||''),
      resource:String(form.get('meetingRoom')||form.get('vehicle')||''),
      meetingRoom:String(form.get('meetingRoom')||''),
      vehicle:String(form.get('vehicle')||''),
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
      <div><div className="eyebrow">PJ-029 / Ver.0.2.2</div><h1>会社スケジュール・予約管理</h1></div>
      <div className="top-actions">
        <span className={`status-chip ${firebaseConfigured?'ok':''}`}>{connectionText}</span>
        <button className="btn secondary" type="button" onClick={()=>setNotice('会社カレンダーはPJ-029内で全社予定として管理します。Googleカレンダー連携は行いません。')}>会社カレンダー</button>
        <button className="btn secondary" type="button" onClick={()=>setNotice('設備予約専用画面はPJ-020の予約機能を統合予定です。')}>設備予約</button>
        <button className="btn primary" type="button" onClick={()=>openNewEvent()}>＋ 予定を作成</button>
      </div>
    </header>

    {notice&&<div className="notice" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="閉じる">×</button></div>}

    <div className="toolbar">
      <div className="nav-group">
        <button className="icon-btn" type="button" onClick={()=>move(-1)}>‹</button>
        <button className="btn secondary" type="button" onClick={()=>setSelectedDate(todayKey())}>今日</button>
        <button className="icon-btn" type="button" onClick={()=>move(1)}>›</button>
        <strong>{viewMode==='month'?`${selected.getFullYear()}年${selected.getMonth()+1}月`:viewMode==='week'?`${weekDays[0].getMonth()+1}/${weekDays[0].getDate()}〜${weekDays[4].getMonth()+1}/${weekDays[4].getDate()}`:`${selected.getFullYear()}年${selected.getMonth()+1}月${selected.getDate()}日`}</strong>
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
            {Object.entries(categoryLabels).map(([key,label])=><span key={key}><i className={`legend-color ${categoryClass(key as CalendarEventInput['category'])}`}/>{label}</span>)}
          </div>
        </section>
        <section>
          <h2>設備は必要時のみ</h2>
          <div className="sidebar-note">会議室・社用車は予定の主役ではなく、必要な予定に追加して予約します。</div>
        </section>
      </aside>

      {viewMode==='week'&&<section className="calendar-card" aria-label="週カレンダー">
        <div className="calendar-grid header-row"><div className="time-head"/>{weekDays.map(d=><button className="day-head day-button" type="button" key={toDateKey(d)} onClick={()=>{setSelectedDate(toDateKey(d));setViewMode('day')}}>{jpDays[d.getDay()]} {d.getDate()}</button>)}</div>
        {times.map(time=><div className="calendar-grid time-row" key={time}>
          <div className="time-label">{time}</div>
          {weekDays.map(d=>{
            const date=toDateKey(d)
            const items=visibleEvents.filter(x=>occursOn(x,date) && (x.allDay || x.startTime.startsWith(time.slice(0,2))))
            return <div className="slot clickable" key={date+time} onDoubleClick={()=>openNewEvent(date,time)}>{items.map(item=><button className={`event-card ${categoryClass(item.category)}`} type="button" key={item.id} onClick={()=>openEventDetail(item)}><strong>{item.title}</strong><span>{item.allDay?'終日':`${item.startTime}〜${item.endTime}`}・{categoryLabels[item.category]}</span><span>{item.location||item.participants||scopeLabels[item.scope]}</span></button>)}</div>
          })}
        </div>)}
      </section>}

      {viewMode==='day'&&<section className="calendar-card day-view" aria-label="日カレンダー">
        <div className="day-view-head"><strong>{jpDays[selected.getDay()]} {selected.getMonth()+1}/{selected.getDate()}</strong><span>{visibleEvents.filter(e=>occursOn(e,selectedDate)).length}件</span></div>
        <div className="all-day-row">
          <div className="time-label">終日</div>
          <div className="slot">{visibleEvents.filter(e=>occursOn(e,selectedDate)&&e.allDay).map(item=><button className={`event-card wide ${categoryClass(item.category)}`} type="button" key={item.id} onClick={()=>openEventDetail(item)}><strong>{item.title}</strong><span>{categoryLabels[item.category]}・{scopeLabels[item.scope]}</span></button>)}</div>
        </div>
        {times.map(time=>{
          const items=visibleEvents.filter(e=>occursOn(e,selectedDate)&&!e.allDay&&e.startTime.startsWith(time.slice(0,2)))
          return <div className="day-row" key={time}><div className="time-label">{time}</div><div className="slot clickable" onDoubleClick={()=>openNewEvent(selectedDate,time)}>{items.map(item=><button className={`event-card wide ${categoryClass(item.category)}`} type="button" key={item.id} onClick={()=>openEventDetail(item)}><strong>{item.title}</strong><span>{item.startTime}〜{item.endTime}　{categoryLabels[item.category]}　{item.location||''}</span></button>)}</div></div>
        })}
      </section>}

      {viewMode==='month'&&<section className="calendar-card month-view" aria-label="月カレンダー">
        <div className="month-weekdays">{['月','火','水','木','金','土','日'].map(d=><div key={d}>{d}</div>)}</div>
        <div className="month-grid">{monthDays.map(date=>{
          const key=toDateKey(date)
          const all=visibleEvents.filter(e=>occursOn(e,key)).sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.startTime.localeCompare(b.startTime))
          return <button type="button" className={`month-cell ${date.getMonth()!==selected.getMonth()?'outside':''}`} key={key} onClick={()=>{setSelectedDate(key);setViewMode('day')}}>
            <span className="month-day-num">{date.getDate()}</span>
            <span className="month-events">{all.slice(0,5).map(item=><span className={`month-event ${categoryClass(item.category)}`} key={item.id} onClick={(e)=>{e.stopPropagation();openEventDetail(item)}}>{item.allDay?'':item.startTime+' '}{item.title}</span>)}{all.length>5&&<span className="more">他 {all.length-5}件</span>}</span>
          </button>
        })}</div>
      </section>}
    </div>


    {detailOpen&&selectedEvent&&<div className="modal-backdrop" onMouseDown={()=>setDetailOpen(false)}><div className="modal detail-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">{categoryLabels[selectedEvent.category]}・{scopeLabels[selectedEvent.scope]}</div><h2>{selectedEvent.title}</h2></div><button className="icon-btn" type="button" onClick={()=>setDetailOpen(false)}>×</button></div>
      <div className="detail-grid">
        <div><span>日時</span><strong>{selectedEvent.date}{selectedEvent.endDate&&selectedEvent.endDate!==selectedEvent.date?` ～ ${selectedEvent.endDate}`:''}　{selectedEvent.allDay?'終日':`${selectedEvent.startTime}～${selectedEvent.endTime}`}</strong></div>
        <div><span>場所</span><strong>{selectedEvent.location||'未設定'}</strong></div>
        <div><span>社内参加者</span><strong>{selectedEvent.participants||'未設定'}</strong></div>
        <div><span>外部参加者・来訪者</span><strong>{selectedEvent.externalParticipants||'なし'}</strong></div>
        <div><span>会議室</span><strong>{selectedEvent.meetingRoom||((selectedEvent.resource||'').includes('会議室')?selectedEvent.resource:'なし')}</strong></div><div><span>社用車</span><strong>{selectedEvent.vehicle||((selectedEvent.resource||'').includes('社用車')?selectedEvent.resource:'なし')}</strong></div>
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
      <div className="modal-head"><div><div className="eyebrow">会社予定・個人予定・設備予約</div><h2>{editingEvent?'予定を編集':'予定を作成'}</h2></div><button className="icon-btn" type="button" onClick={()=>setEventOpen(false)}>×</button></div>
      {eventState==='sent'?<div className="success">予定を登録しました。<div className="modal-actions"><button type="button" className="btn primary" onClick={()=>setEventOpen(false)}>閉じる</button></div></div>:<form onSubmit={submitEvent}>
        <label className="field">タイトル<input name="title" required placeholder="例：姫路出張、○○工場定修工事、ABC社打合せ" defaultValue={editingEvent?.title||''}/></label>
        <div className="form-grid two"><label className="field">予定種別<select name="category" defaultValue={editingEvent?.category||"meeting"}><option value="meeting">会議</option><option value="visitor">来客</option><option value="business_trip">出張</option><option value="construction">工事</option><option value="outing">外出</option><option value="leave">休暇</option><option value="company_event">会社行事</option><option value="other">その他</option></select></label><label className="field">公開範囲<select name="scope" defaultValue={editingEvent?.scope||"personal"}><option value="personal">個人</option><option value="department">部署</option><option value="company">全社</option></select></label></div>
        <label className="check-field"><input name="allDay" type="checkbox" defaultChecked={editingEvent?.allDay||false}/> 終日予定</label>
        <div className="form-grid four"><label className="field">開始日<input name="date" type="date" required defaultValue={editingEvent?.date||selectedDate}/></label><label className="field">終了日<input name="endDate" type="date" required defaultValue={editingEvent?.endDate||editingEvent?.date||selectedDate}/></label><label className="field">開始<input name="startTime" type="time" defaultValue={editingEvent?.startTime||"10:00"}/></label><label className="field">終了<input name="endTime" type="time" defaultValue={editingEvent?.endTime||"11:00"}/></label></div>
        <label className="field">場所<input name="location" placeholder="例：JFE倉敷、東京本社、Web" defaultValue={editingEvent?.location||''}/></label>
        <label className="field">社内参加者<input name="participants" placeholder="例：坂下・岩井" defaultValue={editingEvent?.participants||''}/></label>
        <label className="field">外部参加者・来訪者<input name="externalParticipants" placeholder="例：ABC社 田中様" defaultValue={editingEvent?.externalParticipants||''}/></label>
        <div className="form-grid two">
          <label className="field">会議室（必要な場合のみ）
            <select name="meetingRoom" defaultValue={editingEvent?.meetingRoom||((editingEvent?.resource||'').includes('会議室')?editingEvent?.resource:'')}>
              {meetingRooms.map(r=><option value={r} key={r||'none'}>{r||'使用しない'}</option>)}
            </select>
          </label>
          <label className="field">社用車（必要な場合のみ）
            <select name="vehicle" defaultValue={editingEvent?.vehicle||((editingEvent?.resource||'').includes('社用車')?editingEvent?.resource:'')}>
              {vehicles.map(r=><option value={r} key={r||'none'}>{r||'使用しない'}</option>)}
            </select>
          </label>
        </div>
        <label className="field">詳細<textarea name="description" rows={3} placeholder="目的、工事内容、訪問先、連絡事項など" defaultValue={editingEvent?.description||''}/></label>
        <div className="check-row"><label><input name="notifyEmail" type="checkbox" defaultChecked={editingEvent?.notifyEmail||false}/> メール通知</label><label><input name="notifyTeams" type="checkbox" defaultChecked={editingEvent?.notifyTeams||false}/> Teams通知（来客会議室予約）</label></div>
        {eventState==='conflict'&&<div className="error">この設備は指定時間帯に既に予約されています。時間または設備を変更してください。</div>}
        {eventState==='error'&&<div className="error">保存に失敗しました。<br/><small>エラー：{eventError || '詳細不明'}</small></div>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setEventOpen(false)}>キャンセル</button><button type="submit" className="btn primary" disabled={eventState==='saving'}>{eventState==='saving'?'保存中…':editingEvent?'更新する':'登録する'}</button></div>
      </form>}
    </div></div>}

    {feedbackOpen&&<div className="modal-backdrop" onMouseDown={()=>setFeedbackOpen(false)}><div className="modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">改善提案・不具合報告</div><h2>フィードバック</h2></div><button className="icon-btn" type="button" onClick={()=>setFeedbackOpen(false)}>×</button></div>
      {feedbackState==='sent'?<div className="success">送信しました。ご意見ありがとうございます。</div>:<form onSubmit={submitFeedback}>
        <label className="field">種類<select name="type" defaultValue="improvement"><option value="improvement">改善提案</option><option value="bug">不具合</option><option value="other">その他</option></select></label>
        <label className="field">内容<textarea name="message" rows={6} placeholder="気になった点や改善案を入力してください" required/></label>
        <div className="auto-info">画面：{viewMode==='month'?'月':viewMode==='day'?'日':'週'}カレンダー ／ バージョン：0.2.2</div>
        {feedbackState==='error'&&<div className="error">送信に失敗しました。</div>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setFeedbackOpen(false)}>キャンセル</button><button type="submit" className="btn primary" disabled={feedbackState==='saving'}>{feedbackState==='saving'?'送信中…':'送信'}</button></div>
      </form>}
    </div></div>}
  </main>
}
