'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { saveCalendarEvent, saveFeedback, subscribeCalendarEvents, type CalendarEventRecord } from '../lib/data'
import { getRuntimeConfig, isFirebaseConfigValid } from '../lib/firebase'
import { openTeamsNotification, shouldOpenTeams } from '../lib/teams'

type ViewMode = 'month' | 'week' | 'day'
type UiEvent = CalendarEventRecord & { demo?: boolean }

const demoEvents: UiEvent[] = [
  { id: 'e1', date: '2026-09-21', startTime: '10:00', endTime: '11:00', title: 'ABC社 打合せ', participants: '坂下・岩井', resource: '第1会議室', externalParticipants: 'ABC社 田中様', notifyEmail: true, notifyTeams: true, demo: true },
  { id: 'e2', date: '2026-09-22', startTime: '13:00', endTime: '14:00', title: 'XYZ社 訪問', participants: '坂下', resource: '社用車A', externalParticipants: '', notifyEmail: true, notifyTeams: false, demo: true },
  { id: 'e3', date: '2026-09-24', startTime: '10:00', endTime: '11:00', title: 'RD定例', participants: '末盛・坂下', resource: '第2会議室', externalParticipants: '', notifyEmail: false, notifyTeams: true, demo: true },
]
const resources = ['', '第1会議室', '第2会議室', '社用車A']
const times = ['9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00']
const jpDays = ['日','月','火','水','木','金','土']

function pad(n:number){ return String(n).padStart(2,'0') }
function toDateKey(d:Date){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
function dateFromKey(k:string){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d) }
function addDays(d:Date,n:number){ const x=new Date(d); x.setDate(x.getDate()+n); return x }
function startOfWeek(d:Date){ const x=new Date(d); const day=x.getDay(); return addDays(x,day===0?-6:1-day) }

export default function Home(){
  const [events,setEvents]=useState<UiEvent[]>(demoEvents)
  const [viewMode,setViewMode]=useState<ViewMode>('week')
  const [selectedDate,setSelectedDate]=useState('2026-09-24')
  const [eventOpen,setEventOpen]=useState(false)
  const [feedbackOpen,setFeedbackOpen]=useState(false)
  const [eventState,setEventState]=useState<'idle'|'saving'|'sent'|'error'|'conflict'>('idle')
  const [eventError,setEventError]=useState('')
  const [feedbackState,setFeedbackState]=useState<'idle'|'saving'|'sent'|'error'>('idle')
  const [notice,setNotice]=useState('')
  const [loadState,setLoadState]=useState<'確認中'|'同期中'|'デモ'>('確認中')
  const [firebaseConfigured,setFirebaseConfigured]=useState(false)

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
          setEvents([])
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

  function move(step:number){
    if(viewMode==='month'){
      const d=new Date(selected); d.setMonth(d.getMonth()+step); setSelectedDate(toDateKey(d)); return
    }
    setSelectedDate(toDateKey(addDays(selected,step*(viewMode==='week'?7:1))))
  }

  function openNewEvent(date=selectedDate,time='10:00'){
    setSelectedDate(date); setEventState('idle'); setEventOpen(true)
    requestAnimationFrame(()=>{
      const dateInput=document.querySelector<HTMLInputElement>('input[name="date"]')
      const timeInput=document.querySelector<HTMLInputElement>('input[name="startTime"]')
      if(dateInput) dateInput.value=date
      if(timeInput) timeInput.value=time
    })
  }

  async function submitEvent(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setEventState('saving'); setEventError('')
    const form=new FormData(e.currentTarget)
    const input={
      title:String(form.get('title')||''),
      date:String(form.get('date')||selectedDate),
      startTime:String(form.get('startTime')||'10:00'),
      endTime:String(form.get('endTime')||'11:00'),
      participants:String(form.get('participants')||''),
      externalParticipants:String(form.get('externalParticipants')||''),
      resource:String(form.get('resource')||''),
      notifyEmail:form.get('notifyEmail')==='on',
      notifyTeams:form.get('notifyTeams')==='on',
    }
    if(!firebaseConfigured && input.resource){
      const conflict=events.some(x=>x.resource===input.resource&&x.date===input.date&&x.startTime<input.endTime&&input.startTime<x.endTime)
      if(conflict){ setEventState('conflict'); return }
    }
    try{
      const result=await saveCalendarEvent(input)
      if(result.demo) setEvents(prev=>[...prev,{...input,id:result.id,demo:true}])
      setSelectedDate(input.date); setEventState('sent')
      let message = result.demo
        ? '予定を画面へ追加しました。Firebase接続後はFirestoreに保存されます。'
        : '予定・設備予約をFirestoreへ保存しました。'

      if (shouldOpenTeams(input)) {
        const teams = await openTeamsNotification(input)
        if (teams.ok) {
          message += teams.copied
            ? ' Teams通知文をコピーし、通知先を開きました。'
            : ' Teams通知先を開きました。'
        } else if (teams.reason === 'NO_URL') {
          message += ' Teams通知先リンクが未設定です。'
        } else {
          message += teams.copied
            ? ' Teams通知文はコピー済みですが、Teamsを開けませんでした。'
            : ' Teamsを開けませんでした。'
        }
      }

      setNotice(message)
    }catch(err){
      if (err instanceof Error && err.message==='RESERVATION_CONFLICT') {
        setEventState('conflict')
        return
      }
      const detail =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'code' in err
            ? String((err as { code?: unknown }).code ?? 'UNKNOWN_ERROR')
            : String(err)
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
      <div><div className="eyebrow">PJ-029 / Ver.0.1.3</div><h1>統合スケジュール・予約管理</h1></div>
      <div className="top-actions">
        <span className={`status-chip ${firebaseConfigured?'ok':''}`}>{connectionText}</span>
        <button className="btn secondary" type="button" onClick={()=>setNotice('設備予約専用画面は次フェーズでPJ-020資産を統合します。')}>設備予約</button>
        <button className="btn primary" type="button" onClick={()=>openNewEvent()}>＋ 予定を作成</button>
      </div>
    </header>

    {notice&&<div className="notice" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="閉じる">×</button></div>}

    <div className="toolbar">
      <div className="nav-group">
        <button className="icon-btn" type="button" onClick={()=>move(-1)}>‹</button>
        <button className="btn secondary" type="button" onClick={()=>setSelectedDate('2026-09-18')}>今日</button>
        <button className="icon-btn" type="button" onClick={()=>move(1)}>›</button>
        <strong>{viewMode==='month'?`${selected.getFullYear()}年${selected.getMonth()+1}月`:viewMode==='week'?`${weekDays[0].getMonth()+1}/${weekDays[0].getDate()}〜${weekDays[4].getMonth()+1}/${weekDays[4].getDate()}`:`${selected.getFullYear()}年${selected.getMonth()+1}月${selected.getDate()}日`}</strong>
      </div>
      <div className="view-tabs">
        {(['month','week','day'] as ViewMode[]).map(v=><button key={v} type="button" className={viewMode===v?'active':''} onClick={()=>setViewMode(v)}>{v==='month'?'月':v==='week'?'週':'日'}</button>)}
      </div>
    </div>

    <div className="workspace">
      <aside className="sidebar">
        <section><h2>表示対象</h2><label><input type="checkbox" defaultChecked/> 自分</label><label><input type="checkbox" defaultChecked/> AE</label><label><input type="checkbox"/> RD</label></section>
        <section><h2>設備</h2><label><input type="checkbox"/> 第1会議室</label><label><input type="checkbox"/> 第2会議室</label><label><input type="checkbox"/> 社用車A</label></section>
        <section className="legend"><h2>通知</h2><div>メール：Ver.0.1対象</div><div>Teams：PJ-020方式を継承</div></section>
      </aside>

      {viewMode==='week'&&<section className="calendar-card" aria-label="週カレンダー">
        <div className="calendar-grid header-row"><div className="time-head"/>{weekDays.map(d=><button className="day-head day-button" type="button" key={toDateKey(d)} onClick={()=>{setSelectedDate(toDateKey(d));setViewMode('day')}}>{jpDays[d.getDay()]} {d.getDate()}</button>)}</div>
        {times.map(time=><div className="calendar-grid time-row" key={time}>
          <div className="time-label">{time}</div>
          {weekDays.map(d=>{
            const date=toDateKey(d)
            const items=events.filter(x=>x.date===date&&x.startTime.startsWith(time.slice(0,2)))
            return <div className="slot clickable" key={date+time} onDoubleClick={()=>openNewEvent(date,time)}>{items.map(item=><button className="event-card" type="button" key={item.id}><strong>{item.title}</strong><span>{item.startTime}〜{item.endTime}</span><span>{item.participants||'参加者未設定'}</span><span>{item.resource||'設備予約なし'}</span></button>)}</div>
          })}
        </div>)}
      </section>}

      {viewMode==='day'&&<section className="calendar-card day-view" aria-label="日カレンダー">
        <div className="day-view-head"><strong>{jpDays[selected.getDay()]} {selected.getMonth()+1}/{selected.getDate()}</strong><span>{events.filter(e=>e.date===selectedDate).length}件</span></div>
        {times.map(time=>{
          const items=events.filter(e=>e.date===selectedDate&&e.startTime.startsWith(time.slice(0,2)))
          return <div className="day-row" key={time}><div className="time-label">{time}</div><div className="slot clickable" onDoubleClick={()=>openNewEvent(selectedDate,time)}>{items.map(item=><button className="event-card wide" type="button" key={item.id}><strong>{item.title}</strong><span>{item.startTime}〜{item.endTime}　{item.participants||'参加者未設定'}　{item.resource||'設備予約なし'}</span></button>)}</div></div>
        })}
      </section>}

      {viewMode==='month'&&<section className="calendar-card month-view" aria-label="月カレンダー">
        <div className="month-weekdays">{['月','火','水','木','金','土','日'].map(d=><div key={d}>{d}</div>)}</div>
        <div className="month-grid">{monthDays.map(date=>{
          const key=toDateKey(date)
          const all=events.filter(e=>e.date===key)
          return <button type="button" className={`month-cell ${date.getMonth()!==selected.getMonth()?'outside':''}`} key={key} onClick={()=>{setSelectedDate(key);setViewMode('day')}}>
            <span className="month-day-num">{date.getDate()}</span>
            <span className="month-events">{all.slice(0,3).map(item=><span className="month-event" key={item.id}>{item.startTime} {item.title}</span>)}{all.length>3&&<span className="more">他 {all.length-3}件</span>}</span>
          </button>
        })}</div>
      </section>}
    </div>

    <button className="feedback-fab" type="button" onClick={()=>{setFeedbackOpen(true);setFeedbackState('idle')}}>フィードバック</button>

    {eventOpen&&<div className="modal-backdrop" onMouseDown={()=>setEventOpen(false)}><div className="modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">予定＋設備予約</div><h2>予定を作成</h2></div><button className="icon-btn" type="button" onClick={()=>setEventOpen(false)}>×</button></div>
      {eventState==='sent'?<div className="success">予定を登録しました。<div className="modal-actions"><button type="button" className="btn primary" onClick={()=>setEventOpen(false)}>閉じる</button></div></div>:<form onSubmit={submitEvent}>
        <label className="field">タイトル<input name="title" required defaultValue="ABC社 打合せ"/></label>
        <div className="form-grid"><label className="field">日付<input name="date" type="date" required defaultValue={selectedDate}/></label><label className="field">開始<input name="startTime" type="time" required defaultValue="10:00"/></label><label className="field">終了<input name="endTime" type="time" required defaultValue="11:00"/></label></div>
        <label className="field">社内参加者<input name="participants" defaultValue="坂下・岩井"/></label>
        <label className="field">外部参加者・来訪者<input name="externalParticipants" placeholder="例：ABC社 田中様"/></label>
        <label className="field">会議室・社用車<select name="resource" defaultValue="第1会議室">{resources.map(r=><option value={r} key={r||'none'}>{r||'使用しない'}</option>)}</select></label>
        <div className="check-row"><label><input name="notifyEmail" type="checkbox" defaultChecked/> メール通知</label><label><input name="notifyTeams" type="checkbox" defaultChecked/> Teams通知（来客会議室予約）</label></div><div className="auto-info">Teams通知はPJ-020と同じく、通知文をコピーして指定Teamsチャットを開く方式です。</div>
        {eventState==='conflict'&&<div className="error">この設備は指定時間帯に既に予約されています。時間または設備を変更してください。</div>}
        {eventState==='error'&&<div className="error">保存に失敗しました。<br/><small>エラー：{eventError || '詳細不明'}</small></div>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setEventOpen(false)}>キャンセル</button><button type="submit" className="btn primary" disabled={eventState==='saving'}>{eventState==='saving'?'保存中…':'登録する'}</button></div>
      </form>}
    </div></div>}

    {feedbackOpen&&<div className="modal-backdrop" onMouseDown={()=>setFeedbackOpen(false)}><div className="modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">改善提案・不具合報告</div><h2>フィードバック</h2></div><button className="icon-btn" type="button" onClick={()=>setFeedbackOpen(false)}>×</button></div>
      {feedbackState==='sent'?<div className="success">送信しました。ご意見ありがとうございます。</div>:<form onSubmit={submitFeedback}>
        <label className="field">種類<select name="type" defaultValue="improvement"><option value="improvement">改善提案</option><option value="bug">不具合</option><option value="other">その他</option></select></label>
        <label className="field">内容<textarea name="message" rows={6} placeholder="気になった点や改善案を入力してください" required/></label>
        <div className="auto-info">画面：{viewMode==='month'?'月':viewMode==='day'?'日':'週'}カレンダー ／ バージョン：0.1.3</div>
        {feedbackState==='error'&&<div className="error">送信に失敗しました。</div>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setFeedbackOpen(false)}>キャンセル</button><button type="submit" className="btn primary" disabled={feedbackState==='saving'}>{feedbackState==='saving'?'送信中…':'送信'}</button></div>
      </form>}
    </div></div>}
  </main>
}
