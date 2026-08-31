import { useState, useEffect, useRef } from "react";

/* ── Gemini ─────────────────────────────────────────────────────────────── */
async function askGemini(key,ctx,q){
  const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:`${ctx}\n\nQuestion: ${q}`}]}],generationConfig:{temperature:0.3,maxOutputTokens:1200}})});
  if(!res.ok){const e=await res.json();throw new Error(e.error?.message||"Gemini error");}
  const d=await res.json();return d.candidates?.[0]?.content?.parts?.[0]?.text||"";
}
function buildContext(papers,notes,questions){
  let c="PhD student research knowledge base:\n\n";
  if(papers.length){c+="PAPERS:\n";papers.forEach((p,i)=>{c+=`[${i+1}] "${p.title}" – ${p.authors||""} (${p.year||""}) [${p.status}]\n`;if(p.notes)c+=`  Notes: ${p.notes}\n`;if(p.opinion)c+=`  Opinion: ${p.opinion}\n`;if(p.tags)c+=`  Topics: ${p.tags}\n`;});}
  if(notes.length){c+="\nRESEARCH NOTES:\n";notes.forEach((n,i)=>c+=`[${i+1}] ${n.title}: ${n.content}\n`);}
  const open=questions.filter(q=>q.status==="open");
  if(open.length){c+="\nOPEN QUESTIONS:\n";open.forEach(q=>c+=`- ${q.text}\n`);}
  return c+"\nAnswer based only on the above.";
}

/* ── Storage ────────────────────────────────────────────────────────────── */
const SK={papers:"kb6:papers",notes:"kb6:notes",questions:"kb6:questions",settings:"kb6:settings",chat:"kb6:chat"};
const load=async k=>{try{const r=await window.storage.get(k);return r?JSON.parse(r.value):null;}catch{return null;}};
const persist=async(k,v)=>{try{await window.storage.set(k,JSON.stringify(v));}catch{}};

/* ── Date helpers ───────────────────────────────────────────────────────── */
const weekOf=(d=new Date())=>{const x=new Date(d);x.setDate(x.getDate()-x.getDay());x.setHours(0,0,0,0);return x;};
function calcStreak(papers){
  const done=papers.filter(p=>p.doneDate);if(!done.length)return 0;
  const now=Date.now();
  const weeks=Array.from({length:52},(_,i)=>{const ws=weekOf(new Date(now-i*7*86400000));const we=new Date(ws.getTime()+7*86400000);return done.some(p=>{const d=new Date(p.doneDate);return d>=ws&&d<we;});});
  const start=weeks.findIndex(v=>v);if(start===-1)return 0;
  let s=0;for(let i=start;i<weeks.length;i++){if(weeks[i])s++;else break;}return s;
}
function thisWeekCount(papers){const ws=weekOf();return papers.filter(p=>p.doneDate&&new Date(p.doneDate)>=ws).length;}
function activityData(papers,n=12){
  const now=Date.now();
  return Array.from({length:n},(_,i)=>{const idx=n-1-i;const ws=weekOf(new Date(now-idx*7*86400000));const we=new Date(ws.getTime()+7*86400000);const count=papers.filter(p=>p.doneDate&&new Date(p.doneDate)>=ws&&new Date(p.doneDate)<we).length;return{count,label:ws.toLocaleDateString("en-GB",{month:"short",day:"numeric"})};});
}

/* ── Constants ──────────────────────────────────────────────────────────── */
const uid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const fmtDate=iso=>new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short"});
const nameKey=n=>n.toLowerCase().replace(/\s+/g,"_");

const C={
  bg:"#0D1518", card:"#121D21", cardOpen:"#162025",
  border:"rgba(180,220,230,0.08)", borderMid:"rgba(180,220,230,0.15)",
  text:"#D8E8EC", muted:"#547880", faint:"#1E2E32",
  gold:"#DDB96A", goldDim:"rgba(221,185,106,0.1)", goldMid:"rgba(221,185,106,0.18)",
  teal:"#5CB89A", tealDim:"rgba(92,184,154,0.1)",
  coral:"#D47A5A", coralDim:"rgba(212,122,90,0.1)",
  lavender:"#9D85C2", lavenderDim:"rgba(157,133,194,0.1)",
  rose:"#C47A8A", roseDim:"rgba(196,122,138,0.1)",
};

// Two distinct advisor accent colors
const ADVISOR_COLORS=[
  {main:C.lavender, dim:C.lavenderDim, border:"rgba(157,133,194,0.2)"},
  {main:C.rose,     dim:C.roseDim,     border:"rgba(196,122,138,0.2)"},
];

const STATUS_CFG={
  unread:{label:"Unread",color:C.muted,bg:"rgba(84,120,128,0.12)"},
  reading:{label:"Reading",color:C.gold,bg:C.goldDim},
  done:{label:"Done",color:C.teal,bg:C.tealDim},
};
const PRI_CFG={high:{color:C.coral},medium:{color:C.gold},low:{color:C.muted}};
const SERIF="'Palatino Linotype','Palatino','Book Antiqua',Georgia,serif";
const SANS="system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

const inp={width:"100%",boxSizing:"border-box",padding:"9px 12px",border:`1px solid ${C.border}`,borderRadius:7,fontSize:13,color:C.text,background:"rgba(255,255,255,0.03)",outline:"none",fontFamily:SANS};
const fieldLabel={fontSize:12,fontWeight:500,color:C.muted,display:"block",marginBottom:5};
const btnPrimary={padding:"8px 20px",background:C.gold,color:"#1a1000",border:"none",borderRadius:7,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:SANS};
const btnGhost={padding:"8px 20px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:7,fontSize:13,cursor:"pointer",color:C.muted,fontFamily:SANS};

/* ══════════════════════════════════════════════════════════════════════════
   APP
══════════════════════════════════════════════════════════════════════════ */
export default function App(){
  const [currentUser,setCurrentUser]=useState(null); // null = not chosen yet
  const [papers,setPapers]=useState([]);
  const [notes,setNotes]=useState([]);
  const [questions,setQuestions]=useState([]);
  const [chat,setChat]=useState([]);
  const [settings,setSettings]=useState({
    geminiApiKey:import.meta.env.VITE_GEMINI_KEY||"",studentName:"Rahul",
    advisor1Name:"Tony",advisor2Name:"John",weeklyGoal:10
  });
  const [showSettings,setShowSettings]=useState(false);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{(async()=>{
    const[p,n,q,s,c]=await Promise.all([load(SK.papers),load(SK.notes),load(SK.questions),load(SK.settings),load(SK.chat)]);
    if(p)setPapers(p);if(n)setNotes(n);if(q)setQuestions(q);
    if(s)setSettings(x=>({...x,...s}));if(c)setChat(c);
    setLoaded(true);
  })();},[]);

  const sp=v=>{setPapers(v);persist(SK.papers,v)};
  const sn=v=>{setNotes(v);persist(SK.notes,v)};
  const sq=v=>{setQuestions(v);persist(SK.questions,v)};
  const sc=v=>{setChat(v);persist(SK.chat,v)};
  const ss=v=>{setSettings(v);persist(SK.settings,v)};

  if(!loaded)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.muted,fontFamily:SANS,fontSize:14}}>Loading…</div>
  );

  // Who are you screen
  if(!currentUser)return(
    <WhoAreYou
      settings={settings}
      onSelect={setCurrentUser}
      onSettings={()=>setShowSettings(true)}
      showSettings={showSettings}
      onSaveSettings={v=>{ss(v);setShowSettings(false)}}
      onCloseSettings={()=>setShowSettings(false)}
    />
  );

  const isStudent=currentUser===settings.studentName;
  const isAdvisor1=currentUser===settings.advisor1Name;
  const isAdvisor2=currentUser===settings.advisor2Name;
  const isAdvisor=isAdvisor1||isAdvisor2;

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:SANS,color:C.text}}>
      <Header
        currentUser={currentUser}
        onSwitch={()=>setCurrentUser(null)}
        settings={settings}
        onSettings={()=>setShowSettings(true)}
      />
      <div style={{maxWidth:"100%",margin:"0 auto",padding:"32px 24px"}}>
        {isStudent
          ? <StudentView papers={papers} notes={notes} questions={questions} onSavePapers={sp} onSaveNotes={sn} onSaveQuestions={sq} settings={settings}/>
          : <AdvisorView papers={papers} notes={notes} questions={questions} chat={chat} settings={settings} currentUser={currentUser} onSavePapers={sp} onSaveNotes={sn} onSaveQuestions={sq} onSaveChat={sc}/>
        }
      </div>
      {showSettings&&<SettingsModal settings={settings} onSave={v=>{ss(v);setShowSettings(false)}} onClose={()=>setShowSettings(false)}/>}
    </div>
  );
}

/* ── Who Are You ────────────────────────────────────────────────────────── */
function WhoAreYou({settings,onSelect,onSettings,showSettings,onSaveSettings,onCloseSettings}){
  const users=[
    {name:settings.studentName, role:"Student",    icon:"👨‍🎓", color:C.teal,     dim:C.tealDim},
    {name:settings.advisor1Name,role:"Advisor",    icon:"👨‍🏫", color:C.lavender, dim:C.lavenderDim},
    {name:settings.advisor2Name,role:"Advisor",    icon:"👨‍🏫", color:C.rose,     dim:C.roseDim},
  ];
  return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:SANS,padding:24}}>
      <div style={{fontFamily:SERIF,fontStyle:"italic",fontSize:32,color:C.text,marginBottom:8}}>Research KB</div>
      

      <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center",marginBottom:48}}>
        {users.map(u=>(
          <button key={u.name} onClick={()=>onSelect(u.name)} style={{
            width:180,padding:"28px 20px",background:u.dim,
            border:`1px solid ${u.color}33`,borderRadius:14,cursor:"pointer",
            display:"flex",flexDirection:"column",alignItems:"center",gap:12,
            transition:"all 0.15s",fontFamily:SANS,
          }}
            onMouseEnter={e=>{e.currentTarget.style.border=`1px solid ${u.color}88`;e.currentTarget.style.transform="translateY(-2px)";}}
            onMouseLeave={e=>{e.currentTarget.style.border=`1px solid ${u.color}33`;e.currentTarget.style.transform="none";}}>
            <span style={{fontSize:36}}>{u.icon}</span>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:u.color}}>{u.name}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{u.role}</div>
            </div>
          </button>
        ))}
      </div>

      <button onClick={onSettings} style={{...btnGhost,fontSize:12}}>Settings</button>
      {showSettings&&<SettingsModal settings={settings} onSave={onSaveSettings} onClose={onCloseSettings}/>}
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */
function Header({currentUser,onSwitch,settings,onSettings}){
  const isAdv1=currentUser===settings.advisor1Name;
  const isAdv2=currentUser===settings.advisor2Name;
  const accentColor=isAdv1?C.lavender:isAdv2?C.rose:C.teal;
  return(
    <header style={{background:"rgba(13,21,24,0.92)",backdropFilter:"blur(10px)",borderBottom:`1px solid ${C.border}`,padding:"13px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontFamily:SERIF,fontSize:17,fontStyle:"italic",color:C.gold}}>Research KB</span>
        <span style={{width:1,height:14,background:C.faint,display:"inline-block"}}/>
        <span style={{fontSize:13,fontWeight:600,color:accentColor}}>{currentUser}</span>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onSwitch} style={{...btnGhost,fontSize:12,padding:"5px 14px"}}>Switch user</button>
        <button onClick={onSettings} style={{...btnGhost,fontSize:12,padding:"5px 14px"}}>Settings</button>
      </div>
    </header>
  );
}

/* ── Tab bar ─────────────────────────────────────────────────────────────── */
function Tabs({tabs,active,onSelect}){
  return(
    <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,marginBottom:24}}>
      {tabs.map(([k,label])=>(
        <button key={k} onClick={()=>onSelect(k)} style={{padding:"9px 18px",border:"none",borderBottom:`2px solid ${active===k?C.gold:"transparent"}`,background:"none",cursor:"pointer",fontSize:13,fontWeight:active===k?600:400,fontFamily:SANS,color:active===k?C.gold:C.muted,marginBottom:-1}}>
          {label}
        </button>
      ))}
    </div>
  );
}

/* ── Student View ───────────────────────────────────────────────────────── */
function StudentView({papers,notes,questions,onSavePapers,onSaveNotes,onSaveQuestions,settings}){
  const [tab,setTab]=useState("papers");
  const [adding,setAdding]=useState(false);
  const tabs=[["papers",`Papers (${papers.length})`],["notes",`Notes (${notes.length})`],["questions",`Questions (${questions.filter(q=>q.status==="open").length} open)`]];
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <Tabs tabs={tabs} active={tab} onSelect={k=>{setTab(k);setAdding(false)}}/>
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20,marginTop:-44}}>
        {!adding&&tab!=="questions"&&<button onClick={()=>setAdding(true)} style={btnPrimary}>Add {tab==="papers"?"paper":"note"}</button>}
      </div>
      {tab==="papers"&&(adding
        ?<AddPaperForm onSave={p=>{onSavePapers([p,...papers]);setAdding(false)}} onCancel={()=>setAdding(false)}/>
        :<PaperList papers={papers} onUpdate={onSavePapers} currentUser="student" settings={settings}/>)}
      {tab==="notes"&&(adding
        ?<AddNoteForm onSave={n=>{onSaveNotes([n,...notes]);setAdding(false)}} onCancel={()=>setAdding(false)}/>
        :<NoteList notes={notes} onUpdate={onSaveNotes} currentUser="student" settings={settings}/>)}
      {tab==="questions"&&<QuestionsView questions={questions} onUpdate={onSaveQuestions} role="student"/>}
    </div>
  );
}

/* ── Add Paper Form ─────────────────────────────────────────────────────── */
function AddPaperForm({onSave,onCancel}){
  const [f,setF]=useState({title:"",authors:"",year:new Date().getFullYear().toString(),abstract:"",notes:"",opinion:"",tags:"",status:"unread",inQueue:false,queuePriority:"medium"});
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  function parseZotero(text){const lines=text.split("\n").filter(l=>l.trim());const ym=text.match(/\b(19|20)\d{2}\b/);setF(x=>({...x,title:lines[0]?.replace(/^\d+\.\s*/,"").trim()||x.title,year:ym?ym[0]:x.year,abstract:text}));}
  function submit(){
    if(!f.title.trim())return alert("Title required");
    onSave({...f,id:uid(),dateAdded:new Date().toISOString(),doneDate:f.status==="done"?new Date().toISOString():null,advisorFeedback:{}});
  }
  return(
    <Sheet>
      <SheetTitle>Add paper</SheetTitle>
      <div style={{background:C.goldDim,border:`1px solid ${C.goldMid}`,borderRadius:8,padding:14,marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:500,color:C.gold,marginBottom:7}}>Paste from Zotero to auto-fill</div>
        <textarea style={{...inp,minHeight:56,resize:"vertical"}} placeholder="Paste a citation here…" onChange={e=>parseZotero(e.target.value)}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{gridColumn:"1/-1"}}><label style={fieldLabel}>Title</label><input style={inp} value={f.title} onChange={e=>set("title",e.target.value)} placeholder="Full paper title"/></div>
        <div><label style={fieldLabel}>Authors</label><input style={inp} value={f.authors} onChange={e=>set("authors",e.target.value)} placeholder="e.g. Endsley, M. R."/></div>
        <div><label style={fieldLabel}>Year</label><input style={inp} value={f.year} onChange={e=>set("year",e.target.value)}/></div>
        <div style={{gridColumn:"1/-1"}}><label style={fieldLabel}>Abstract or key content</label><textarea style={{...inp,minHeight:70,resize:"vertical"}} value={f.abstract} onChange={e=>set("abstract",e.target.value)} placeholder="Paste abstract or key points"/></div>
        <div style={{gridColumn:"1/-1"}}><label style={fieldLabel}>My notes</label><textarea style={{...inp,minHeight:70,resize:"vertical"}} value={f.notes} onChange={e=>set("notes",e.target.value)} placeholder="What did I take from this paper?"/></div>
        <div style={{gridColumn:"1/-1"}}><label style={fieldLabel}>My opinion</label><textarea style={{...inp,minHeight:52,resize:"vertical"}} value={f.opinion} onChange={e=>set("opinion",e.target.value)} placeholder="Strengths, weaknesses, how it fits my research…"/></div>
        <div><label style={fieldLabel}>Topics</label><input style={inp} value={f.tags} onChange={e=>set("tags",e.target.value)} placeholder="e.g. situation awareness, HCI"/></div>
        <div><label style={fieldLabel}>Status</label>
          <select style={{...inp,cursor:"pointer"}} value={f.status} onChange={e=>set("status",e.target.value)}>
            <option value="unread">Unread</option><option value="reading">Reading</option><option value="done">Done</option>
          </select>
        </div>
        <div style={{gridColumn:"1/-1",display:"flex",alignItems:"center",gap:14}}>
          <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontSize:13,color:C.text}}>
            <input type="checkbox" checked={f.inQueue} onChange={e=>set("inQueue",e.target.checked)} style={{accentColor:C.gold}}/>
            Add to this week's reading queue
          </label>
          {f.inQueue&&<select style={{...inp,width:"auto"}} value={f.queuePriority} onChange={e=>set("queuePriority",e.target.value)}>
            <option value="high">High priority</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>}
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:20}}>
        <button onClick={onCancel} style={btnGhost}>Cancel</button>
        <button onClick={submit} style={btnPrimary}>Save paper</button>
      </div>
    </Sheet>
  );
}

/* ── Advisor Feedback Side by Side ──────────────────────────────────────── */
function AdvisorFeedbackPanel({item,onUpdate,currentUser,settings,allItems}){
  const advisors=[
    {name:settings.advisor1Name, ...ADVISOR_COLORS[0]},
    {name:settings.advisor2Name, ...ADVISOR_COLORS[1]},
  ];
  const [drafts,setDrafts]=useState({});

  function saveFeedback(advisorName){
    const key=nameKey(advisorName);
    const updated={...(item.advisorFeedback||{}),[key]:drafts[advisorName]??item.advisorFeedback?.[key]??""};
    onUpdate(allItems.map(x=>x.id===item.id?{...x,advisorFeedback:updated}:x));
  }

  const isStudent=currentUser===settings.studentName;

  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
      {advisors.map(adv=>{
        const key=nameKey(adv.name);
        const value=item.advisorFeedback?.[key]||"";
        const canEdit=currentUser===adv.name;
        const draft=drafts[adv.name]??value;
        return(
          <div key={adv.name} style={{background:adv.dim,border:`1px solid ${adv.border}`,borderRadius:8,padding:12}}>
            <div style={{fontSize:12,fontWeight:600,color:adv.main,marginBottom:8}}>{adv.name}</div>
            {canEdit?(
              <>
                <textarea
                  style={{...inp,minHeight:70,resize:"vertical"}}
                  value={draft}
                  onChange={e=>setDrafts(d=>({...d,[adv.name]:e.target.value}))}
                  placeholder={`${adv.name}'s feedback…`}
                />
                <button onClick={()=>saveFeedback(adv.name)} style={{marginTop:8,padding:"5px 14px",background:adv.main,color:"#fff",border:"none",borderRadius:6,fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:SANS}}>Save</button>
              </>
            ):(
              value
                ?<p style={{fontSize:13,color:C.text,margin:0,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{value}</p>
                :<p style={{fontSize:12,color:C.muted,margin:0,fontStyle:"italic"}}>No feedback yet</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Paper List ─────────────────────────────────────────────────────────── */
function PaperList({papers,onUpdate,currentUser,settings}){
  const [open,setOpen]=useState(null);
  if(!papers.length)return <Empty icon="📄" text="No papers logged yet."/>;

  function updatePaper(id,changes){
    onUpdate(papers.map(p=>{
      if(p.id!==id)return p;
      const u={...p,...changes};
      if(changes.status==="done"&&!p.doneDate)u.doneDate=new Date().toISOString();
      if(changes.status&&changes.status!=="done")u.doneDate=null;
      return u;
    }));
  }

  const isStudent=currentUser===settings.studentName;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      {papers.map(p=>{
        const sc=STATUS_CFG[p.status]||STATUS_CFG.unread;
        const isOpen=open===p.id;
        return(
          <div key={p.id} style={{background:isOpen?C.cardOpen:C.card,border:`1px solid ${isOpen?C.borderMid:C.border}`,borderRadius:9,overflow:"hidden"}}>
            <div style={{padding:"13px 16px",display:"flex",alignItems:"flex-start",gap:10}}>
              {isStudent&&(
                <select value={p.status} onChange={e=>updatePaper(p.id,{status:e.target.value})} onClick={e=>e.stopPropagation()}
                  style={{padding:"3px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11,fontWeight:600,color:sc.color,background:sc.bg,cursor:"pointer",flexShrink:0,marginTop:1,fontFamily:SANS}}>
                  <option value="unread">Unread</option><option value="reading">Reading</option><option value="done">Done</option>
                </select>
              )}
              {!isStudent&&(
                <span style={{padding:"3px 8px",borderRadius:5,fontSize:11,fontWeight:600,color:sc.color,background:sc.bg,flexShrink:0,marginTop:1}}>{sc.label}</span>
              )}
              <div style={{flex:1,cursor:"pointer",minWidth:0}} onClick={()=>setOpen(isOpen?null:p.id)}>
                <div style={{fontWeight:600,fontSize:13,lineHeight:1.4,color:C.text}}>{p.title}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{[p.authors,p.year].filter(Boolean).join(", ")}</div>
                {p.tags&&<div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>{p.tags.split(",").map(t=>t.trim()).filter(Boolean).map(t=><Chip key={t}>{t}</Chip>)}</div>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                {isStudent&&(
                  <button onClick={()=>updatePaper(p.id,{inQueue:!p.inQueue})}
                    style={{padding:"3px 10px",borderRadius:5,border:`1px solid ${p.inQueue?C.gold:C.border}`,background:p.inQueue?C.goldDim:"transparent",color:p.inQueue?C.gold:C.muted,fontSize:11,cursor:"pointer",fontWeight:500,fontFamily:SANS}}>
                    {p.inQueue?"In queue":"Queue"}
                  </button>
                )}
                <span style={{color:C.faint,fontSize:11,cursor:"pointer",userSelect:"none"}} onClick={()=>setOpen(isOpen?null:p.id)}>{isOpen?"▲":"▼"}</span>
              </div>
            </div>
            {isOpen&&(
              <div style={{padding:"14px 16px 16px",borderTop:`1px solid ${C.border}`}}>
                {isStudent&&p.inQueue&&(
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                    <span style={{fontSize:12,color:C.muted,fontWeight:500}}>Priority</span>
                    {["high","medium","low"].map(pr=>(
                      <button key={pr} onClick={()=>updatePaper(p.id,{queuePriority:pr})}
                        style={{padding:"2px 10px",borderRadius:4,border:`1px solid ${(p.queuePriority||"medium")===pr?PRI_CFG[pr].color:C.border}`,background:"transparent",color:(p.queuePriority||"medium")===pr?PRI_CFG[pr].color:C.muted,fontSize:11,cursor:"pointer",fontWeight:600,fontFamily:SANS,textTransform:"capitalize"}}>
                        {pr}
                      </button>
                    ))}
                  </div>
                )}
                {[["Abstract",p.abstract],["My notes",p.notes],["My opinion",p.opinion]].map(([l,v])=>v?<Field key={l} label={l} text={v}/>:null)}
                <AdvisorFeedbackPanel item={p} onUpdate={onUpdate} currentUser={currentUser} settings={settings} allItems={papers}/>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Add Note Form ──────────────────────────────────────────────────────── */
function AddNoteForm({onSave,onCancel}){
  const [title,setTitle]=useState("");const [content,setContent]=useState("");const [tags,setTags]=useState("");
  return(
    <Sheet>
      <SheetTitle>Add research note</SheetTitle>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div><label style={fieldLabel}>Title</label><input style={inp} value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Gap analysis — situation awareness models"/></div>
        <div><label style={fieldLabel}>Content</label><textarea style={{...inp,minHeight:130,resize:"vertical",lineHeight:1.7}} value={content} onChange={e=>setContent(e.target.value)} placeholder="Thoughts, questions, findings…"/></div>
        <div><label style={fieldLabel}>Topics</label><input style={inp} value={tags} onChange={e=>setTags(e.target.value)} placeholder="e.g. methodology, literature gap"/></div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:20}}>
        <button onClick={onCancel} style={btnGhost}>Cancel</button>
        <button onClick={()=>{if(!title.trim())return alert("Title required");onSave({id:uid(),title,content,tags,dateAdded:new Date().toISOString(),advisorFeedback:{}})}} style={btnPrimary}>Save note</button>
      </div>
    </Sheet>
  );
}

/* ── Note List ──────────────────────────────────────────────────────────── */
function NoteList({notes,onUpdate,currentUser,settings}){
  const [open,setOpen]=useState(null);
  if(!notes.length)return <Empty icon="📝" text="No notes yet."/>;
  return(
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      {notes.map(n=>{
        const isOpen=open===n.id;
        return(
          <div key={n.id} style={{background:isOpen?C.cardOpen:C.card,border:`1px solid ${isOpen?C.borderMid:C.border}`,borderRadius:9,overflow:"hidden"}}>
            <div style={{padding:"13px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}} onClick={()=>setOpen(isOpen?null:n.id)}>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:C.text}}>{n.title}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{fmtDate(n.dateAdded)}</div>
                {n.tags&&<div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>{n.tags.split(",").map(t=>t.trim()).filter(Boolean).map(t=><Chip key={t}>{t}</Chip>)}</div>}
              </div>
              <span style={{color:C.faint,fontSize:11,userSelect:"none"}}>{isOpen?"▲":"▼"}</span>
            </div>
            {isOpen&&(
              <div style={{padding:"14px 16px 16px",borderTop:`1px solid ${C.border}`}}>
                <p style={{fontSize:13,color:C.text,margin:"0 0 12px",whiteSpace:"pre-wrap",lineHeight:1.75}}>{n.content}</p>
                <AdvisorFeedbackPanel item={n} onUpdate={onUpdate} currentUser={currentUser} settings={settings} allItems={notes}/>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Questions View ─────────────────────────────────────────────────────── */
function QuestionsView({questions,onUpdate,role}){
  const [newQ,setNewQ]=useState("");
  function addQ(){if(!newQ.trim())return;onUpdate([{id:uid(),text:newQ.trim(),status:"open",dateAdded:new Date().toISOString(),dateResolved:null},...questions]);setNewQ("");}
  function toggle(id){onUpdate(questions.map(q=>q.id===id?{...q,status:q.status==="open"?"resolved":"open",dateResolved:q.status==="open"?new Date().toISOString():null}:q));}
  const openQs=questions.filter(q=>q.status==="open");
  const resolvedQs=questions.filter(q=>q.status==="resolved");
  return(
    <div>
      {role==="student"&&(
        <div style={{display:"flex",gap:8,marginBottom:24}}>
          <input value={newQ} onChange={e=>setNewQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addQ()} placeholder="Log a new research question…" style={{...inp,flex:1}}/>
          <button onClick={addQ} style={btnPrimary}>Add</button>
        </div>
      )}
      {!questions.length&&<Empty icon="❓" text="No questions logged yet."/>}
      {openQs.length>0&&(
        <div style={{marginBottom:24}}>
          <div style={{fontSize:12,fontWeight:500,color:C.muted,marginBottom:10}}>Open ({openQs.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {openQs.map(q=>(
              <div key={q.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"11px 14px",display:"flex",alignItems:"flex-start",gap:10}}>
                <button onClick={()=>toggle(q.id)} title="Mark resolved" style={{width:16,height:16,borderRadius:"50%",border:`1.5px solid ${C.muted}`,background:"none",cursor:"pointer",flexShrink:0,marginTop:2,padding:0}}/>
                <span style={{fontSize:13,color:C.text,lineHeight:1.6,flex:1}}>{q.text}</span>
                <span style={{fontSize:11,color:C.muted,flexShrink:0,whiteSpace:"nowrap"}}>{fmtDate(q.dateAdded)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {resolvedQs.length>0&&(
        <div>
          <div style={{fontSize:12,fontWeight:500,color:C.muted,marginBottom:10}}>Resolved ({resolvedQs.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {resolvedQs.map(q=>(
              <div key={q.id} style={{background:"rgba(92,184,154,0.04)",border:`1px solid rgba(92,184,154,0.12)`,borderRadius:8,padding:"11px 14px",display:"flex",alignItems:"flex-start",gap:10}}>
                <div onClick={()=>toggle(q.id)} style={{width:16,height:16,borderRadius:"50%",background:C.teal,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2,cursor:"pointer"}}>
                  <span style={{color:"#fff",fontSize:9,fontWeight:900,lineHeight:1}}>✓</span>
                </div>
                <span style={{fontSize:13,color:C.muted,lineHeight:1.6,textDecoration:"line-through"}}>{q.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Advisor View ───────────────────────────────────────────────────────── */
function AdvisorView({papers,notes,questions,chat,settings,currentUser,onSavePapers,onSaveNotes,onSaveQuestions,onSaveChat}){
  const [tab,setTab]=useState("dashboard");
  const tabs=[["dashboard","Dashboard"],["papers",`Papers (${papers.length})`],["notes",`Notes (${notes.length})`],["questions","Questions"],["chat","Ask AI"]];
  return(
    <div>
      <Tabs tabs={tabs} active={tab} onSelect={setTab}/>
      {tab==="dashboard"&&<Dashboard papers={papers} notes={notes} questions={questions} settings={settings} onSavePapers={onSavePapers}/>}
      {tab==="papers"&&<PaperList papers={papers} onUpdate={onSavePapers} currentUser={currentUser} settings={settings}/>}
      {tab==="notes"&&<NoteList notes={notes} onUpdate={onSaveNotes} currentUser={currentUser} settings={settings}/>}
      {tab==="questions"&&<QuestionsView questions={questions} onUpdate={onSaveQuestions} role="advisor"/>}
      {tab==="chat"&&<ChatView papers={papers} notes={notes} questions={questions} settings={settings} chat={chat} onSaveChat={onSaveChat}/>}
    </div>
  );
}

/* ── Dashboard ──────────────────────────────────────────────────────────── */
function Dashboard({papers,notes,questions,settings,onSavePapers}){
  const streak=calcStreak(papers);
  const doneCount=papers.filter(p=>p.status==="done").length;
  const inProgress=papers.filter(p=>p.status==="reading").length;
  const thisWeek=thisWeekCount(papers);
  const goal=settings.weeklyGoal||2;
  const pct=Math.min(1,thisWeek/goal);
  const queue=papers.filter(p=>p.inQueue&&p.status!=="done").sort((a,b)=>({high:0,medium:1,low:2}[a.queuePriority||"medium"])-({high:0,medium:1,low:2}[b.queuePriority||"medium"]));
  const allTags=papers.flatMap(p=>(p.tags||"").split(",").map(t=>t.trim()).filter(Boolean));
  const tagCounts=allTags.reduce((a,t)=>({...a,[t]:(a[t]||0)+1}),{});
  const topTopics=Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const maxTag=topTopics[0]?.[1]||1;
  const activity=activityData(papers,12);
  const maxAct=Math.max(1,...activity.map(w=>w.count));
  const openQs=questions.filter(q=>q.status==="open");
  const resolvedQs=questions.filter(q=>q.status==="resolved");

  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"28px 32px 32px"}}>
        <div style={{fontSize:12,fontWeight:500,color:C.muted,marginBottom:4}}>
          {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
        </div>
        <div style={{fontFamily:SERIF,fontSize:28,fontStyle:"italic",fontWeight:400,color:C.text,marginBottom:28}}>
          {settings.studentName}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:0}}>
          {[{n:doneCount,label:"papers read",color:C.text},{n:inProgress,label:"in progress",color:C.gold},{n:notes.length,label:"research notes",color:C.text},{n:openQs.length,label:"open questions",color:C.text}].map((s,i)=>(
            <div key={i} style={{paddingLeft:i>0?24:0,borderLeft:i>0?`1px solid ${C.border}`:"none"}}>
              <div style={{fontFamily:SERIF,fontSize:48,fontWeight:400,fontStyle:"italic",color:s.color,lineHeight:1,letterSpacing:"-1px"}}>{s.n}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:6}}>{s.label}</div>
            </div>
          ))}
        </div>
        {streak>0&&<div style={{marginTop:22,paddingTop:18,borderTop:`1px solid ${C.border}`,fontSize:13,color:C.gold,fontWeight:500}}>{streak}-week reading streak</div>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Panel title="This week's queue">
          {queue.length===0
            ?<p style={{fontSize:13,color:C.muted,margin:0,lineHeight:1.7}}>No papers queued.</p>
            :<div style={{display:"flex",flexDirection:"column",gap:10}}>
              {queue.map(p=>{
                const pc=PRI_CFG[p.queuePriority||"medium"];
                return(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:9}}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:pc.color,flexShrink:0}}/>
                    <span style={{fontSize:13,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.title}</span>
                    <span style={{fontSize:11,color:STATUS_CFG[p.status].color,background:STATUS_CFG[p.status].bg,padding:"2px 7px",borderRadius:4}}>{STATUS_CFG[p.status].label}</span>
                  </div>
                );
              })}
            </div>}
        </Panel>
        <Panel title="Weekly goal">
          <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:14}}>
            <span style={{fontFamily:SERIF,fontSize:48,fontStyle:"italic",color:pct>=1?C.teal:C.text,lineHeight:1,letterSpacing:"-1px"}}>{thisWeek}</span>
            <span style={{fontFamily:SERIF,fontSize:24,fontStyle:"italic",color:C.muted}}>/ {goal}</span>
          </div>
          <div style={{display:"flex",gap:3,marginBottom:8}}>
            {Array.from({length:Math.max(goal,8)},(_,i)=>(
              <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<thisWeek?C.teal:C.faint}}/>
            ))}
          </div>
          <div style={{fontSize:12,color:C.muted}}>{pct>=1?"Goal reached this week":"Papers finished this week"}</div>
        </Panel>
      </div>

      {topTopics.length>0&&(
        <Panel title="Topic coverage">
          <div style={{display:"flex",flexDirection:"column",gap:9}}>
            {topTopics.map(([tag,count])=>(
              <div key={tag} style={{display:"flex",alignItems:"center",gap:14}}>
                <span style={{fontSize:13,color:C.text,width:160,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tag}</span>
                <div style={{flex:1,height:3,background:C.faint,borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${(count/maxTag)*100}%`,background:C.gold,borderRadius:2}}/>
                </div>
                <span style={{fontSize:12,color:C.muted,width:24,textAlign:"right",flexShrink:0}}>{count}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Reading activity — last 12 weeks">
        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:48}}>
          {activity.map((w,i)=>{
            const h=w.count===0?3:Math.max(8,44*(w.count/maxAct));
            return(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5,height:"100%",justifyContent:"flex-end"}}>
                <div title={`${w.count} paper${w.count!==1?"s":""} done`} style={{width:"100%",minWidth:14,height:h,borderRadius:2,background:w.count>0?C.gold:C.faint,opacity:w.count>0?0.3+0.7*(w.count/maxAct):1}}/>
                {(i===0||i===5||i===11)&&<span style={{fontSize:9,color:C.muted,whiteSpace:"nowrap"}}>{w.label}</span>}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Open questions" right={resolvedQs.length>0?<span style={{fontSize:12,color:C.teal,fontWeight:500}}>{resolvedQs.length} resolved</span>:null}>
        {!questions.length&&<p style={{fontSize:13,color:C.muted,margin:0}}>No questions logged yet.</p>}
        {!openQs.length&&questions.length>0&&<p style={{fontSize:13,color:C.teal,margin:0}}>All questions resolved.</p>}
        <div style={{display:"flex",flexDirection:"column"}}>
          {openQs.map(q=>(
            <div key={q.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{color:C.muted,fontSize:12,marginTop:2,flexShrink:0}}>–</span>
              <span style={{fontSize:13,color:C.text,flex:1,lineHeight:1.65}}>{q.text}</span>
              <span style={{fontSize:11,color:C.muted,flexShrink:0,whiteSpace:"nowrap"}}>{fmtDate(q.dateAdded)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ── Chat View ──────────────────────────────────────────────────────────── */
function ChatView({papers,notes,questions,settings,chat,onSaveChat}){
  const [input,setInput]=useState("");const [thinking,setThinking]=useState(false);const bottomRef=useRef(null);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"})},[chat,thinking]);
  async function send(){
    const q=input.trim();if(!q||thinking)return;
    if(!settings.geminiApiKey)return alert("Add your Gemini API key in Settings");
    if(!papers.length&&!notes.length)return alert("No knowledge base content yet.");
    const userMsg={role:"user",text:q,ts:Date.now()};
    const next=[...chat,userMsg];onSaveChat(next);setInput("");setThinking(true);
    try{const ctx=buildContext(papers,notes,questions);const ans=await askGemini(settings.geminiApiKey,ctx,q);onSaveChat([...next,{role:"ai",text:ans,ts:Date.now()}]);}
    catch(e){onSaveChat([...next,{role:"ai",text:`Error: ${e.message}`,ts:Date.now(),error:true}]);}
    setThinking(false);
  }
  const prompts=["What does the student know about situation awareness?","Which papers have they read and what's their opinion?","What open questions are they still working through?","Summarise their overall research progress."];
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,display:"flex",flexDirection:"column",height:"60vh"}}>
      <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.border}`,fontSize:12,color:C.muted}}>Answers come from the student's actual notes and papers</div>
      <div style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:10}}>
        {!chat.length&&(
          <div style={{textAlign:"center",paddingTop:28}}>
            <div style={{color:C.muted,fontSize:13,marginBottom:12}}>Try asking:</div>
            <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"center"}}>
              {prompts.map(p=><button key={p} onClick={()=>setInput(p)} style={{padding:"7px 16px",border:`1px solid ${C.border}`,borderRadius:7,background:"transparent",fontSize:12,color:C.muted,cursor:"pointer",fontFamily:SANS}}>{p}</button>)}
            </div>
          </div>
        )}
        {chat.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            <div style={{maxWidth:"72%",padding:"10px 14px",borderRadius:10,fontSize:13,lineHeight:1.7,background:m.role==="user"?C.goldDim:m.error?"rgba(212,122,90,0.1)":C.cardOpen,color:m.role==="user"?C.gold:m.error?C.coral:C.text,border:`1px solid ${m.role==="user"?C.goldMid:C.border}`,whiteSpace:"pre-wrap"}}>
              {m.text}
            </div>
          </div>
        ))}
        {thinking&&<div style={{display:"flex"}}><div style={{padding:"10px 14px",borderRadius:10,fontSize:13,background:C.cardOpen,color:C.muted,border:`1px solid ${C.border}`}}>Thinking…</div></div>}
        <div ref={bottomRef}/>
      </div>
      <div style={{padding:"11px 14px",borderTop:`1px solid ${C.border}`,display:"flex",gap:8}}>
        <input style={{...inp,flex:1}} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} placeholder="Ask about the student's research…"/>
        <button onClick={send} disabled={thinking} style={{...btnPrimary,opacity:thinking?0.5:1,cursor:thinking?"not-allowed":"pointer"}}>Ask</button>
      </div>
    </div>
  );
}

/* ── Settings Modal ─────────────────────────────────────────────────────── */
function SettingsModal({settings,onSave,onClose}){
  const [f,setF]=useState(settings);const set=(k,v)=>setF(x=>({...x,[k]:v}));
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:20,backdropFilter:"blur(6px)"}}>
      <div style={{background:"#0F1B1F",border:`1px solid ${C.borderMid}`,borderRadius:12,padding:28,width:"100%",maxWidth:420,boxShadow:"0 32px 80px rgba(0,0,0,0.6)"}}>
        <div style={{fontFamily:SERIF,fontStyle:"italic",fontSize:20,marginBottom:22,color:C.text}}>Settings</div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div><label style={fieldLabel}>Student name</label><input style={inp} value={f.studentName} onChange={e=>set("studentName",e.target.value)}/></div>
          <div><label style={fieldLabel}>Advisor 1 name</label><input style={inp} value={f.advisor1Name} onChange={e=>set("advisor1Name",e.target.value)}/></div>
          <div><label style={fieldLabel}>Advisor 2 name</label><input style={inp} value={f.advisor2Name} onChange={e=>set("advisor2Name",e.target.value)}/></div>
          <div><label style={fieldLabel}>Gemini API key</label><input style={inp} type="password" value={f.geminiApiKey} onChange={e=>set("geminiApiKey",e.target.value)} placeholder="AIza…"/></div>
          <div><label style={fieldLabel}>Weekly reading goal</label><input style={{...inp,width:72}} type="number" min={1} max={20} value={f.weeklyGoal||2} onChange={e=>set("weeklyGoal",parseInt(e.target.value)||2)}/></div>
          <div style={{fontSize:11,color:C.muted}}>Free Gemini key at aistudio.google.com</div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:22}}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={()=>onSave(f)} style={btnPrimary}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ── Utility ────────────────────────────────────────────────────────────── */
function Sheet({children}){return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:24}}>{children}</div>;}
function SheetTitle({children}){return <div style={{fontFamily:SERIF,fontStyle:"italic",fontSize:18,fontWeight:400,color:C.text,marginBottom:20}}>{children}</div>;}
function Panel({title,children,right}){
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:600,color:C.muted}}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}
function Chip({children}){return <span style={{display:"inline-block",fontSize:11,background:"rgba(255,255,255,0.05)",color:C.muted,borderRadius:4,padding:"2px 8px",border:`1px solid ${C.border}`}}>{children}</span>;}
function Field({label,text}){return <div style={{marginBottom:12}}><div style={{fontSize:11,fontWeight:500,color:C.muted,marginBottom:4}}>{label}</div><p style={{fontSize:13,color:C.text,margin:0,lineHeight:1.75}}>{text}</p></div>;}
function Empty({icon,text}){return <div style={{textAlign:"center",padding:"52px 20px",color:C.muted,fontSize:13}}><div style={{fontSize:30,marginBottom:10,opacity:0.5}}>{icon}</div>{text}</div>;}