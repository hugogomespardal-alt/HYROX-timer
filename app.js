/* ============================================================================
   HYROX Simulation Timer — CrossFit Viseu
   App completa, offline-first (localStorage), sem dependências externas.
   ========================================================================== */
'use strict';

/* ------------------------------------------------------------------ *
 * 1. CONSTANTES / DOMÍNIO
 * ------------------------------------------------------------------ */
const STORE_KEY = 'hyrox_state_v1';
const BACKUP_KEY = 'hyrox_backups_v1';
const SCHEMA_VERSION = 1;

const STATIONS = [
  { key: 'skierg',   name: 'SkiErg' },
  { key: 'sledpush', name: 'Sled Push' },
  { key: 'sledpull', name: 'Sled Pull' },
  { key: 'burpees',  name: 'Burpee Broad Jumps' },
  { key: 'row',      name: 'Row' },
  { key: 'farmers',  name: 'Farmers Carry' },
  { key: 'sandbag',  name: 'Sandbag Lunges' },
  { key: 'wallballs',name: 'Wall Balls' },
];
const STATION_NAME = Object.fromEntries(STATIONS.map(s => [s.key, s.name]));
const DEFAULT_STATION_ORDER = STATIONS.map(s => s.key);

const STATES = {
  nao_iniciado:'Não iniciado', em_corrida:'Em corrida', em_estacao:'Numa estação',
  terminado:'Terminado', aguardar_validacao:'A aguardar validação',
  validado:'Resultado validado', DNS:'DNS', DNF:'DNF', desclassificado:'Desclassificado'
};

const DEFAULT_PENALTY_TYPES = [
  { id:'p_run',    label:'Erro no percurso da corrida', seconds:120, per:'ocorrência' },
  { id:'p_sled',   label:'Sled não ultrapassar a linha', seconds:30, per:'ocorrência' },
  { id:'p_burpee', label:'Burpee Broad Jump inválido', seconds:30, per:'repetição' },
  { id:'p_custom', label:'Penalização personalizada', seconds:0, per:'segundos definidos' },
];

const PROVA_DEFS = [
  { id:'pf_pro',  name:'Individual Feminino PRO',  genero:'F', categoria:'PRO'  },
  { id:'pf_half', name:'Individual Feminino HALF', genero:'F', categoria:'HALF' },
  { id:'pm_pro',  name:'Individual Masculino PRO', genero:'M', categoria:'PRO'  },
  { id:'pm_half', name:'Individual Masculino HALF',genero:'M', categoria:'HALF' },
];

/* ------------------------------------------------------------------ *
 * 2. ESTADO / PERSISTÊNCIA
 * ------------------------------------------------------------------ */
function uid(p){ return (p||'id')+'_'+Math.random().toString(36).slice(2,9); }
function now(){ return Date.now(); }               // fonte única de tempo
function deviceId(){
  let d = localStorage.getItem('hyrox_device');
  if(!d){ d = 'dev_'+Math.random().toString(36).slice(2,8); localStorage.setItem('hyrox_device', d); }
  return d;
}

let state = load();

function blankState(){
  return {
    schema: SCHEMA_VERSION,
    provas: PROVA_DEFS.map(p => ({ ...p, stations:[...DEFAULT_STATION_ORDER] })),
    penaltyTypes: DEFAULT_PENALTY_TYPES.map(x => ({...x})),
    atletas: [],
    vagas: [],
    penalties: [],
    audit: [],
    config: {
      theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      tie: 'sec',                 // sec | dec | ms
      operador: 'Juiz',
      adminPass: 'admin',
      sound: true, haptics: true,
      // sincronização opcional (Supabase) — desligada por defeito
      syncEnabled:false, syncUrl:'', syncKey:'', syncSession:'', syncRole:'writer', // writer | viewer
    },
    ui: { view:'central', rankSub:'final', prova:'', vaga:'', estado:'', station:'', reportAthlete:'', stationScreen:'skierg' },
  };
}

function load(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return blankState();
    const s = JSON.parse(raw);
    const base = blankState();
    return { ...base, ...s, config:{...base.config, ...(s.config||{})}, ui:{...base.ui, ...(s.ui||{})} };
  }catch(e){ console.warn('load falhou', e); return blankState(); }
}

let saveTimer = null;
function save(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch(e){ toast('Erro a guardar (armazenamento cheio?)','err'); }
}
function persist(){ save(); SYNC.dirty=true; clearTimeout(saveTimer); saveTimer = setTimeout(autoBackup, 1500); }

function autoBackup(){
  try{
    const arr = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
    arr.push({ ts: now(), data: JSON.stringify(state) });
    while(arr.length > 12) arr.shift();
    localStorage.setItem(BACKUP_KEY, JSON.stringify(arr));
  }catch(e){}
}

function logAudit(entry){
  state.audit.unshift({ id:uid('au'), ts:now(), operador:state.config.operador, device:deviceId(), ...entry });
  if(state.audit.length > 4000) state.audit.length = 4000;
}

/* ------------------------------------------------------------------ *
 * 2b. SINCRONIZAÇÃO OPCIONAL (Supabase, por sondagem REST)
 *     Modelo simples e robusto: um documento de sessão (JSON) partilhado.
 *     1 dispositivo a cronometrar (writer) + N ecrãs (viewer) = tempo real.
 * ------------------------------------------------------------------ */
const SYNC = { timer:null, dirty:false, pushing:false, pending:false,
  lastKnownRev:0, lastAppliedRev:0, status:'off', lastOk:0 };

function syncActive(){ const c=state.config; return !!(c.syncEnabled && c.syncUrl && c.syncKey && c.syncSession); }
function isViewer(){ return state.config.syncRole==='viewer'; }
function syncHeaders(){ const k=state.config.syncKey; return { 'apikey':k, 'Authorization':'Bearer '+k, 'Content-Type':'application/json' }; }
function syncBase(){ return state.config.syncUrl.replace(/\/+$/,'') + '/rest/v1/sessions'; }
function setSyncStatus(s){ SYNC.status=s; if(s==='ok') SYNC.lastOk=now(); updateSyncBadge(); }

/* estado local a enviar — sem credenciais nem navegação */
function syncPayload(){
  const c=state.config;
  const cfg={...c}; cfg.syncKey=''; cfg.syncUrl=''; cfg.syncEnabled=false; cfg.syncSession=''; cfg.syncRole='writer';
  return {...state, config:cfg, ui:undefined};
}

/* adota o estado vindo de outro dispositivo, preservando credenciais/nav locais */
function adoptRemoteState(remote){
  if(!remote || typeof remote!=='object' || !Array.isArray(remote.atletas)) return;
  const c=state.config, ui=state.ui;
  const merged={...blankState(), ...remote};
  merged.config={...blankState().config, ...(remote.config||{}),
    syncEnabled:c.syncEnabled, syncUrl:c.syncUrl, syncKey:c.syncKey, syncSession:c.syncSession, syncRole:c.syncRole,
    adminPass:c.adminPass, operador:c.operador, theme:c.theme };
  merged.ui=ui;
  state=merged; save();
  if(placarMode) refreshPlacarNow(); else render();
}

async function syncPush(){
  if(!syncActive() || isViewer()) return;
  if(SYNC.pushing){ SYNC.pending=true; return; }
  SYNC.pushing=true;
  try{
    const rev=(SYNC.lastKnownRev||0)+1;
    const body=[{ id:state.config.syncSession, data:syncPayload(), rev, device:deviceId(), updated_at:new Date().toISOString() }];
    const res=await fetch(syncBase()+'?on_conflict=id', {
      method:'POST',
      headers:{...syncHeaders(),'Prefer':'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify(body) });
    if(res.ok){ SYNC.lastKnownRev=rev; SYNC.lastAppliedRev=rev; setSyncStatus('ok'); }
    else { setSyncStatus('err'); }
  }catch(e){ setSyncStatus('offline'); }
  finally{ SYNC.pushing=false; if(SYNC.pending){ SYNC.pending=false; syncPush(); } }
}

async function syncPull(){
  if(!syncActive()) return;
  try{
    const url=syncBase()+'?id=eq.'+encodeURIComponent(state.config.syncSession)+'&select=data,rev,device,updated_at';
    const res=await fetch(url,{ headers:syncHeaders() });
    if(!res.ok){ setSyncStatus('err'); return; }
    const arr=await res.json();
    if(arr && arr.length){
      const row=arr[0];
      SYNC.lastKnownRev=Math.max(SYNC.lastKnownRev||0, row.rev||0);
      if(row.device!==deviceId() && (row.rev||0) > (SYNC.lastAppliedRev||0)){
        SYNC.lastAppliedRev=row.rev||0;
        adoptRemoteState(row.data);
      }
      setSyncStatus('ok');
    } else if(!isViewer()){
      await syncPush();   // sessão ainda não existe: cria com o estado local
    } else { setSyncStatus('wait'); }
  }catch(e){ setSyncStatus('offline'); }
}

function syncLoop(){
  if(!syncActive()){ setSyncStatus('off'); return; }
  if(!isViewer() && SYNC.dirty){ SYNC.dirty=false; syncPush(); }
  syncPull();
}
function startSync(){ if(SYNC.timer) clearInterval(SYNC.timer); SYNC.timer=setInterval(syncLoop, 1500); syncLoop(); }

async function syncTest(){
  if(!syncActive()){ toast('Preenche URL, chave e sessão primeiro','err'); return; }
  setSyncStatus('...');
  try{
    const res=await fetch(syncBase()+'?select=id&limit=1',{ headers:syncHeaders() });
    if(res.ok){ toast('Ligação Supabase OK','ok'); setSyncStatus('ok'); }
    else if(res.status===404){ toast('Ligou, mas falta a tabela "sessions" (corre o supabase_sync.sql)','err'); setSyncStatus('err'); }
    else { toast('Erro '+res.status+' — verifica URL/chave','err'); setSyncStatus('err'); }
  }catch(e){ toast('Sem ligação — verifica o URL e a internet','err'); setSyncStatus('offline'); }
}

/* link para o ecrã (TV) já com a ligação embutida, em modo viewer + placar */
function syncViewerLink(){
  const c=state.config;
  const token=btoa(unescape(encodeURIComponent(JSON.stringify({u:c.syncUrl,k:c.syncKey,s:c.syncSession}))));
  return location.href.split('#')[0].split('?')[0]+'?sync='+token+'#placar';
}
function applySyncTokenFromURL(){
  try{
    const q=new URLSearchParams(location.search); const t=q.get('sync');
    if(!t) return false;
    const o=JSON.parse(decodeURIComponent(escape(atob(t))));
    if(o && o.u && o.k && o.s){
      state.config.syncUrl=o.u; state.config.syncKey=o.k; state.config.syncSession=o.s;
      state.config.syncRole='viewer'; state.config.syncEnabled=true; save();
      return true;
    }
  }catch(e){}
  return false;
}

function updateSyncBadge(){
  const b=document.getElementById('syncBadge'); if(!b) return;
  const map={ ok:['●','Sincronizado','var(--ok)'], offline:['●','Sem ligação','var(--danger)'],
    err:['●','Erro de ligação','var(--danger)'], wait:['○','À espera de dados','var(--muted)'],
    off:['','',''], '...':['◌','A testar…','var(--muted)'] };
  const [dot,txt,col]=map[SYNC.status]||['','',''];
  if(!dot){ b.style.display='none'; return; }
  b.style.display=''; b.style.color=col; b.textContent=dot+' '+txt;
}

/* ------------------------------------------------------------------ *
 * 3. HELPERS DE TEMPO / FORMATO
 * ------------------------------------------------------------------ */
function pad(n,l=2){ return String(n).padStart(l,'0'); }
function fmtDur(ms, tenths=false){
  if(ms==null || isNaN(ms)) return '—';
  const neg = ms<0; ms = Math.abs(ms);
  const totalS = Math.floor(ms/1000);
  const h = Math.floor(totalS/3600), m = Math.floor((totalS%3600)/60), s = totalS%60;
  const t = Math.floor((ms%1000)/100);
  let out = h>0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if(tenths) out += '.'+t;
  return (neg?'-':'')+out;
}
function fmtSigned(ms, tenths=false){
  if(ms==null||isNaN(ms)) return '—';
  if(ms===0) return '±0';
  return (ms>0?'+':'-')+fmtDur(Math.abs(ms), tenths);
}
function fmtPace(ms){ return fmtDur(ms)+' /km'; }
function fmtClockTime(ts){
  if(ts==null) return '—';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function tieUnit(){ return state.config.tie==='ms'?1 : state.config.tie==='dec'?100 : 1000; }
function tieKey(ms){ const u=tieUnit(); return Math.round(ms/u); }
function esc(str){ return String(str==null?'':str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ------------------------------------------------------------------ *
 * 4. LOOKUPS
 * ------------------------------------------------------------------ */
const prova = id => state.provas.find(p=>p.id===id);
const atleta = id => state.atletas.find(a=>a.id===id);
const vaga = id => state.vagas.find(v=>v.id===id);
function stationsOf(pid){ const p=prova(pid); return (p&&p.stations)?p.stations:DEFAULT_STATION_ORDER; }

/* Registration points para uma prova (sequência de cliques). */
function regPoints(pid){
  const st = stationsOf(pid);
  const pts = [{ type:'start', label:'INICIAR PROVA', kind:'start' }];
  st.forEach((k,i)=>{
    pts.push({ type:'entrada', station:i, key:k, label:'ENTRADA '+STATION_NAME[k].toUpperCase() });
    if(i < st.length-1) pts.push({ type:'saida', station:i, key:k, label:'SAÍDA '+STATION_NAME[k].toUpperCase() });
    else pts.push({ type:'finish', station:i, key:k, label:'FINALIZAR PROVA' });
  });
  return pts;
}
function totalPoints(pid){ return regPoints(pid).length; } // 2N+1

/* ------------------------------------------------------------------ *
 * 5. MOTOR DE CÁLCULO
 * ------------------------------------------------------------------ */
function ensureMarks(a){ if(!a.marks) a.marks=[]; return a.marks; }
function progressOf(a){ return ensureMarks(a).length; }

function nextPoint(a){
  const pts = regPoints(a.provaId);
  const p = progressOf(a);
  return p < pts.length ? pts[p] : null;
}

function deriveState(a){
  if(['DNS','DNF','desclassificado','validado'].includes(a.status)) return a.status;
  const p = progressOf(a);
  const total = totalPoints(a.provaId);
  if(p===0) return 'nao_iniciado';
  if(p>=total) return 'aguardar_validacao';
  const np = regPoints(a.provaId)[p];
  return (np && np.type==='entrada') ? 'em_corrida' : 'em_estacao';
}

/* Devolve tempos das corridas (array N) e estações (array N) em ms. */
function computeSplits(a){
  const st = stationsOf(a.provaId);
  const N = st.length;
  const m = ensureMarks(a);
  const runs = new Array(N).fill(null);
  const stations = new Array(N).fill(null);
  for(let i=0;i<N;i++){
    const ei = 1+2*i;       // índice ENTRADA i
    const xi = 2+2*i;       // índice SAÍDA/FINISH i
    const prevEnd = i===0 ? 0 : 2*i; // START ou SAÍDA anterior
    if(m[ei]!=null && m[prevEnd]!=null) runs[i] = m[ei]-m[prevEnd];
    if(m[xi]!=null && m[ei]!=null) stations[i] = m[xi]-m[ei];
  }
  const complete = m.length >= (2*N+1);
  const bruto = (complete && m[0]!=null) ? m[2*N]-m[0] : null;
  return { N, st, runs, stations, bruto, complete, marks:m };
}

function penaltiesOf(aid){ return state.penalties.filter(p=>p.athleteId===aid); }
function penaltyTotal(aid){ return penaltiesOf(aid).reduce((s,p)=>s+(p.total||0),0)*1000; } // ms

function officialMs(a){
  const sp = computeSplits(a);
  if(sp.bruto==null) return null;
  return sp.bruto + penaltyTotal(a.id);
}
function brutoMs(a){ return computeSplits(a).bruto; }

/* soma corridas / estações */
function runsSum(sp){ return sp.runs.reduce((s,v)=> v!=null? s+v : s, 0); }
function runsCount(sp){ return sp.runs.filter(v=>v!=null).length; }
function stationsSum(sp){ return sp.stations.reduce((s,v)=> v!=null? s+v : s, 0); }

/* ------------------------------------------------------------------ *
 * 6. CLASSIFICAÇÕES (posições desportivas com empates)
 * ------------------------------------------------------------------ */
function assignPositions(items){ // items: [{value(ms)}] já ordenados asc
  let pos=0, prevKey=null;
  items.forEach((it,idx)=>{
    const k = tieKey(it.value);
    if(k!==prevKey){ pos = idx+1; prevKey=k; }
    it.pos = pos;
  });
  return items;
}
function athletesInProva(pid){ return state.atletas.filter(a=>a.provaId===pid); }

function finalRanking(pid){
  const rows = [];
  for(const a of athletesInProva(pid)){
    if(a.status==='DNS'||a.status==='DNF'||a.status==='desclassificado'){
      rows.push({ a, dnf:true, value:Infinity }); continue;
    }
    const off = officialMs(a);
    if(off!=null) rows.push({ a, value:off, bruto:brutoMs(a), pen:penaltyTotal(a.id) });
  }
  const ranked = rows.filter(r=>!r.dnf).sort((x,y)=> x.value-y.value);
  assignPositions(ranked);
  const dnfs = rows.filter(r=>r.dnf);
  const provisional = ranked.some(r=> r.a.status!=='validado');
  return { ranked, dnfs, provisional, total: athletesInProva(pid).length, classified: ranked.length };
}

function runRanking(pid, i){
  const rows=[];
  for(const a of athletesInProva(pid)){
    const sp = computeSplits(a);
    if(sp.runs[i]!=null) rows.push({ a, value:sp.runs[i] });
  }
  rows.sort((x,y)=>x.value-y.value); assignPositions(rows);
  const best = rows.length?rows[0].value:null;
  const avg = rows.length? rows.reduce((s,r)=>s+r.value,0)/rows.length : null;
  return { rows, best, avg, total:rows.length };
}
function stationRanking(pid, i){
  const rows=[];
  for(const a of athletesInProva(pid)){
    const sp = computeSplits(a);
    if(sp.stations[i]!=null) rows.push({ a, value:sp.stations[i] });
  }
  rows.sort((x,y)=>x.value-y.value); assignPositions(rows);
  const best = rows.length?rows[0].value:null;
  const avg = rows.length? rows.reduce((s,r)=>s+r.value,0)/rows.length : null;
  return { rows, best, avg, total:rows.length };
}
function posOf(rows, aid){ const r=rows.find(x=>x.a.id===aid); return r? r.pos : null; }

/* ------------------------------------------------------------------ *
 * 7. AÇÃO DE CRONOMETRAGEM
 * ------------------------------------------------------------------ */
let lastTapAt = 0;
function registerNext(aid, ts){
  const a = atleta(aid); if(!a) return;
  if(['DNS','DNF','desclassificado'].includes(a.status)){ toast('Atleta com estado '+a.status,'err'); return; }
  const t = now();
  if(t - lastTapAt < 350){ return; }         // anti duplo-clique
  lastTapAt = t;
  const pts = regPoints(a.provaId);
  const p = progressOf(a);
  if(p >= pts.length){ toast('Sequência já completa','info'); return; }
  const mark = ts!=null ? ts : t;
  ensureMarks(a).push(mark);
  a.status = deriveState(a);
  const pt = pts[p];
  logAudit({ type:'registo', athleteId:a.id, point:p, pointLabel:pt.label, value:mark });
  persist();
  feedbackTap();
  render();
}

function startAthlete(aid, ts){
  const a = atleta(aid); if(!a) return;
  if(progressOf(a)>0){ toast('Atleta já iniciado','info'); return; }
  registerNext(aid, ts!=null?ts:now());
}
function startVaga(vid){
  const v = vaga(vid); if(!v) return;
  const t = now();
  let n=0;
  v.athletes.forEach(aid=>{ const a=atleta(aid); if(a && progressOf(a)===0 && !['DNS','DNF','desclassificado'].includes(a.status)){ ensureMarks(a).push(t); a.status=deriveState(a); logAudit({type:'registo',athleteId:a.id,point:0,pointLabel:'INICIAR PROVA (vaga)',value:t}); n++; } });
  persist(); feedbackTap();
  toast(`${n} atleta(s) iniciados`,'ok'); render();
}

/* Descreve o estado para onde o atleta regressa após anular a última marca. */
function backTargetLabel(a){
  const pts = regPoints(a.provaId);
  const np = progressOf(a) - 1;                 // progresso após remover a última marca
  if(np <= 0) return { txt:'linha de partida (por iniciar)', verb:'Voltar ao início' };
  const back = pts[np];                          // próxima ação nesse estado
  if(back.type==='entrada') return { txt:'Corrida '+(back.station+1), verb:'Voltar à corrida' };
  return { txt:STATION_NAME[back.key], verb:'Voltar à estação' };
}

function undoLast(aid){
  const a = atleta(aid); if(!a) return;
  const m = ensureMarks(a);
  if(m.length===0){ toast('Sem registos para anular','info'); return; }
  const pts = regPoints(a.provaId);
  const lastIdx = m.length-1;
  const lastLabel = (pts[lastIdx]||{}).label || ('registo #'+lastIdx);
  const removedTs = m[lastIdx];
  const back = backTargetLabel(a);
  const body = `Anular <b>“${esc(lastLabel)}”</b> de <b>${esc(a.nome)}</b>?<br><br>
    O atleta regressa a: <b>${esc(back.txt)}</b>.<br>
    O cronómetro <b>continua</b> desde a hora de partida (${fmtClockTime(m[0])}) — não reinicia.<br>
    <span style="color:var(--muted)">Registo anulado: ${esc(lastLabel)} às ${fmtClockTime(removedTs)}. Fica guardado no histórico para auditoria.</span>`;
  confirmModal('Voltar atrás', body, ()=>{
    const removed = m.pop();
    a.status = deriveState(a);           // recalcula estado; tudo o resto (tempos, rankings) deriva das marcas
    logAudit({ type:'undo', athleteId:a.id, point:m.length, pointLabel:lastLabel, removedValue:removed, note:'Registo anulado — regresso a '+back.txt });
    persist(); render(); toast('Voltou atrás — '+back.txt,'ok');
  }, back.verb);
}

/* Correção manual de qualquer marca (admin) */
function correctMark(aid, idx, newTs, motivo, operador){
  const a = atleta(aid); if(!a) return;
  const m = ensureMarks(a);
  const original = m[idx];
  m[idx] = newTs;
  logAudit({ type:'correcao', athleteId:a.id, point:idx,
    pointLabel:(regPoints(a.provaId)[idx]||{}).label||('#'+idx),
    from:original, to:newTs, motivo, operador });
  a.status = deriveState(a);
  persist(); render();
  toast('Correção registada','ok');
}

/* ------------------------------------------------------------------ *
 * 8. SEED / DEMO
 * ------------------------------------------------------------------ */
function loadDemo(){
  const s = blankState();
  s.config = {...state.config};
  const P = s.provas;
  const A = (nome,dorsal,pid,genero,categoria,vagaId,hora,pista,obs)=>({
    id:uid('atl'), nome, dorsal:String(dorsal), provaId:pid, genero, categoria,
    vagaId, horaPrevista:hora, pista, obs:obs||'', status:'nao_iniciado', marks:[], history:[]
  });
  const v1 = { id:uid('vaga'), nome:'Vaga 1 — 09:00', horaPrevista:'09:00', athletes:[] };
  const v2 = { id:uid('vaga'), nome:'Vaga 2 — 09:20', horaPrevista:'09:20', athletes:[] };
  const list = [
    A('Ana Marques', 101, 'pf_pro','F','PRO', v1.id,'09:00','1'),
    A('Rita Sousa',  102, 'pf_pro','F','PRO', v1.id,'09:00','2'),
    A('Sofia Nunes', 111, 'pf_half','F','HALF', v1.id,'09:00','3'),
    A('Carla Dias',  112, 'pf_half','F','HALF', v2.id,'09:20','1'),
    A('Bruno Lima',  201, 'pm_pro','M','PRO', v1.id,'09:00','4'),
    A('João Guerra', 202, 'pm_pro','M','PRO', v2.id,'09:20','2'),
    A('Rafael Costa',211, 'pm_half','M','HALF', v2.id,'09:20','3'),
    A('Filipe Cruz', 212, 'pm_half','M','HALF', v2.id,'09:20','4'),
  ];
  list.forEach(a=>{ (a.vagaId===v1.id?v1:v2).athletes.push(a.id); });
  s.atletas = list; s.vagas = [v1,v2];
  state = s; persist(); render();
  toast('Dados de teste carregados','ok');
}

/* Cria uma prova fictícia de teste de stress com N atletas (por defeito 20). */
const FIRST=['Ana','Rita','Sofia','Carla','Inês','Beatriz','Marta','Joana','Bruno','João','Rafael','Filipe','Miguel','Pedro','Tiago','André','Diogo','Nuno','Ricardo','Hugo','Luís','Gonçalo','Daniel','Rui'];
const LAST=['Marques','Sousa','Nunes','Dias','Costa','Guerra','Cruz','Lima','Santos','Ferreira','Oliveira','Pinto','Rocha','Gomes','Lopes','Carvalho','Teixeira','Moreira','Antunes','Ramos'];
function loadStressTest(n){
  n=n||20;
  const s=blankState(); s.config={...state.config};
  const v1={id:uid('vaga'),nome:'Vaga 1 — 09:00',horaPrevista:'09:00',athletes:[]};
  const v2={id:uid('vaga'),nome:'Vaga 2 — 09:20',horaPrevista:'09:20',athletes:[]};
  const provaCycle=['pf_pro','pf_half','pm_pro','pm_half'];
  for(let i=0;i<n;i++){
    const pid=provaCycle[i%4]; const p=s.provas.find(x=>x.id===pid);
    const nome=FIRST[i%FIRST.length]+' '+LAST[(i*7)%LAST.length];
    const v=(i%2===0)?v1:v2;
    const a={ id:uid('atl'), nome, dorsal:String(100+i), provaId:pid, genero:p.genero, categoria:p.categoria,
      vagaId:v.id, horaPrevista:v.horaPrevista, pista:String((i%8)+1), obs:'', status:'nao_iniciado', marks:[], history:[] };
    s.atletas.push(a); v.athletes.push(a.id);
  }
  s.vagas=[v1,v2];
  state=s; persist(); render();
  toast(n+' atletas de teste criados','ok');
}

/* Preenche marcas realistas para todos os atletas por iniciar/em prova (sem tocar nos validados). */
function simulateFullProva(opts){
  opts=opts||{}; const validateSome=opts.validate!==false;
  let count=0;
  const rnd=(a,b)=>a+Math.random()*(b-a);
  for(const a of state.atletas){
    if(['DNS','DNF','desclassificado','validado'].includes(a.status)) continue;
    const st=stationsOf(a.provaId); const N=st.length;
    // hora de partida base (respeita a vaga)
    const start = a.marks[0]!=null ? a.marks[0] : now() - Math.round(rnd(3000,3600)*1000);
    const marks=[start]; let t=start;
    for(let i=0;i<N;i++){
      // corrida ~3:30 a 5:30, a abrandar ligeiramente na 2.ª metade
      const runMs=Math.round(rnd(210, 300+ i*8))*1000; t+=runMs; marks.push(t);
      // estação ~0:50 a 3:30 conforme a estação
      const base=[70,150,150,120,90,80,150,180][i]||120;
      const stMs=Math.round(rnd(base*0.8, base*1.4))*1000; t+=stMs; marks.push(t);
    }
    a.marks=marks; a.status=deriveState(a);
    logAudit({type:'import',athleteId:a.id,note:'Simulação automática de prova'});
    count++;
  }
  // algumas penalizações de exemplo
  if(state.atletas.length){
    const sample=state.atletas.filter((_,i)=>i%5===0).slice(0,4);
    sample.forEach(a=>{ const pt=state.penaltyTypes[0];
      state.penalties.push({id:uid('pen'),athleteId:a.id,target:'Corrida 3',typeId:pt.id,typeLabel:pt.label,count:1,seconds:pt.seconds,total:pt.seconds,juiz:state.config.operador,obs:'simulação',ts:now()}); });
  }
  // validar uma parte para testar bloqueio + provisório/final
  if(validateSome){
    state.atletas.forEach((a,i)=>{ if(deriveState(a)==='aguardar_validacao' && i%3===0){ a.status='validado'; logAudit({type:'estado',athleteId:a.id,note:'Validado (simulação)'}); } });
  }
  persist(); render();
  toast('Prova simulada: '+count+' atletas preenchidos','ok');
}

/* ------------------------------------------------------------------ *
 * 9. IMPORT / EXPORT CSV + EXCEL + PARTILHA
 * ------------------------------------------------------------------ */
function download(filename, content, mime){
  const blob = content instanceof Blob ? content : new Blob([content], {type:mime||'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 500);
}
function csvCell(v){ v=String(v==null?'':v); return /[",;\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function toCSV(rows){ return rows.map(r=>r.map(csvCell).join(';')).join('\r\n'); }

function parseCSV(text){
  const rows=[]; let i=0, field='', row=[], inQ=false;
  const delim = (text.indexOf(';')>-1 && (text.indexOf(';')<text.indexOf(',')||text.indexOf(',')<0))?';':',';
  while(i<text.length){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){field+='"';i+=2;continue;} inQ=false;i++;continue; }
      field+=c;i++;continue;
    }
    if(c==='"'){ inQ=true;i++;continue; }
    if(c===delim){ row.push(field);field='';i++;continue; }
    if(c==='\r'){ i++;continue; }
    if(c==='\n'){ row.push(field);rows.push(row);row=[];field='';i++;continue; }
    field+=c;i++;
  }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  return rows.filter(r=> r.some(x=>String(x).trim()!==''));
}

function importAthletesCSV(text){
  const rows = parseCSV(text);
  if(rows.length<2){ toast('CSV sem dados','err'); return; }
  const head = rows[0].map(h=>h.trim().toLowerCase());
  const idx = name => head.findIndex(h=> h===name || h.includes(name));
  const col = { nome:idx('nome'), dorsal:idx('dorsal'), prova:idx('prova'), genero:idx('gén')>-1?idx('gén'):idx('gen'),
    categoria:idx('categoria'), vaga:idx('vaga'), hora:idx('hora'), pista:idx('pista'), obs:idx('observ') };
  let added=0;
  const provaByName = txt=>{ txt=(txt||'').trim().toLowerCase();
    return state.provas.find(p=> p.name.toLowerCase()===txt || p.name.toLowerCase().includes(txt) || p.id===txt) || null; };
  const vagaByName = txt=>{ txt=(txt||'').trim();
    let v = state.vagas.find(x=> x.nome===txt || x.nome.toLowerCase().includes(txt.toLowerCase()));
    if(!v && txt){ v={id:uid('vaga'),nome:txt,horaPrevista:'',athletes:[]}; state.vagas.push(v); }
    return v; };
  for(let r=1;r<rows.length;r++){
    const row=rows[r]; const g=(row[col.nome]||'').trim(); if(!g) continue;
    const p = provaByName(row[col.prova]) || state.provas[0];
    const v = col.vaga>-1 ? vagaByName(row[col.vaga]) : null;
    const a = { id:uid('atl'), nome:g, dorsal:(row[col.dorsal]||'').trim(),
      provaId:p.id, genero:(row[col.genero]||p.genero||'').trim().toUpperCase().slice(0,1),
      categoria:(row[col.categoria]||p.categoria||'').trim(),
      vagaId: v?v.id:'', horaPrevista:(row[col.hora]||'').trim(),
      pista:(row[col.pista]||'').trim(), obs:(row[col.obs]||'').trim(),
      status:'nao_iniciado', marks:[], history:[] };
    state.atletas.push(a); if(v) v.athletes.push(a.id); added++;
  }
  logAudit({ type:'import', note:`Importados ${added} atletas via CSV` });
  persist(); render(); toast(`${added} atletas importados`,'ok');
}

/* ---------- Excel (SpreadsheetML 2003, multi-folha, sem libs) ---------- */
function xmlEsc(v){ return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function ssCell(v){
  if(v===''||v==null) return '<Cell><Data ss:Type="String"></Data></Cell>';
  if(typeof v==='number' && isFinite(v)) return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  return `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
}
function ssSheet(name, rows){
  const body = rows.map(r=>`<Row>${r.map(ssCell).join('')}</Row>`).join('');
  const safe = name.replace(/[\\/?*\[\]:]/g,' ').slice(0,31);
  return `<Worksheet ss:Name="${xmlEsc(safe)}"><Table>${body}</Table></Worksheet>`;
}
function buildWorkbook(sheets){
  const head = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n`+
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`;
  return head + sheets.map(s=>ssSheet(s.name, s.rows)).join('') + `</Workbook>`;
}

function exportAllExcel(){
  const sheets=[];
  // Atletas
  sheets.push({ name:'Lista de Atletas', rows:[
    ['Dorsal','Nome','Prova','Género','Categoria','Vaga','Hora prevista','Pista','Estado','Observações'],
    ...state.atletas.map(a=>[a.dorsal,a.nome,(prova(a.provaId)||{}).name||'',a.genero,a.categoria,(vaga(a.vagaId)||{}).nome||'',a.horaPrevista||'',a.pista||'',STATES[deriveState(a)]||a.status,a.obs||''])
  ]});
  // por prova: final, corridas, ritmos, posições corridas, estações, posições estações
  const finalRows=[['Prova','Pos','Dorsal','Nome','Tempo bruto','Penalizações','Tempo final oficial','Estado']];
  const runRows=[['Prova','Dorsal','Nome','C1','C2','C3','C4','C5','C6','C7','C8','Soma','Média']];
  const paceRows=[['Prova','Dorsal','Nome','R1','R2','R3','R4','R5','R6','R7','R8','Ritmo médio']];
  const runPos=[['Prova','Dorsal','Nome','P1','P2','P3','P4','P5','P6','P7','P8']];
  const stRows=[['Prova','Dorsal','Nome',...STATIONS.map(s=>s.name)]];
  const stPos=[['Prova','Dorsal','Nome',...STATIONS.map(s=>s.name)]];
  for(const p of state.provas){
    const fr=finalRanking(p.id);
    fr.ranked.forEach(r=>finalRows.push([p.name,r.pos,r.a.dorsal,r.a.nome,fmtDur(r.bruto),fmtDur(r.pen),fmtDur(r.value),STATES[deriveState(r.a)]]));
    fr.dnfs.forEach(r=>finalRows.push([p.name,'—',r.a.dorsal,r.a.nome,'—','—','—',STATES[deriveState(r.a)]]));
    const runRk = p.stations.map((_,i)=>runRanking(p.id,i));
    for(const a of athletesInProva(p.id)){
      const sp=computeSplits(a);
      runRows.push([p.name,a.dorsal,a.nome,...sp.runs.map(v=>v!=null?fmtDur(v):'—'),fmtDur(runsSum(sp)),runsCount(sp)?fmtDur(runsSum(sp)/runsCount(sp)):'—']);
      paceRows.push([p.name,a.dorsal,a.nome,...sp.runs.map(v=>v!=null?fmtPace(v):'—'),runsCount(sp)?fmtPace(runsSum(sp)/runsCount(sp)):'—']);
      runPos.push([p.name,a.dorsal,a.nome,...sp.runs.map((_,i)=> posOf(runRk[i].rows,a.id)||'—')]);
      const stRk = STATIONS.map((_,i)=>stationRanking(p.id,i));
      stRows.push([p.name,a.dorsal,a.nome,...sp.stations.map(v=>v!=null?fmtDur(v):'—')]);
      stPos.push([p.name,a.dorsal,a.nome,...sp.stations.map((_,i)=> posOf(stRk[i].rows,a.id)||'—')]);
    }
  }
  sheets.push({name:'Classificação Final',rows:finalRows});
  sheets.push({name:'Corridas',rows:runRows});
  sheets.push({name:'Ritmos por km',rows:paceRows});
  sheets.push({name:'Posições Corridas',rows:runPos});
  sheets.push({name:'Estações',rows:stRows});
  sheets.push({name:'Posições Estações',rows:stPos});
  // Penalizações
  sheets.push({name:'Penalizações',rows:[
    ['Dorsal','Atleta','Prova','Alvo','Tipo','Ocorrências','Seg/ocorrência','Total (s)','Juiz','Observação'],
    ...state.penalties.map(pn=>{const a=atleta(pn.athleteId)||{};return [a.dorsal,a.nome,(prova(a.provaId)||{}).name||'',pn.target,pn.typeLabel,pn.count,pn.seconds,pn.total,pn.juiz,pn.obs||''];})
  ]});
  // Relatórios individuais (resumo)
  const repRows=[['Dorsal','Nome','Prova','Bruto','Penal.','Oficial','Pos final','T. corrida','T. estações','Ritmo médio','Melhor corrida','Corrida + lenta']];
  for(const a of state.atletas){
    const sp=computeSplits(a); if(sp.bruto==null) continue;
    const fr=finalRanking(a.provaId); const pos=(fr.ranked.find(r=>r.a.id===a.id)||{}).pos||'—';
    const runsV=sp.runs.filter(v=>v!=null); const bestR=runsV.length?Math.min(...runsV):null; const worstR=runsV.length?Math.max(...runsV):null;
    repRows.push([a.dorsal,a.nome,(prova(a.provaId)||{}).name,fmtDur(sp.bruto),fmtDur(penaltyTotal(a.id)),fmtDur(officialMs(a)),pos,fmtDur(runsSum(sp)),fmtDur(stationsSum(sp)),runsCount(sp)?fmtPace(runsSum(sp)/runsCount(sp)):'—',bestR!=null?fmtDur(bestR):'—',worstR!=null?fmtDur(worstR):'—']);
  }
  sheets.push({name:'Relatórios',rows:repRows});
  // Auditoria
  sheets.push({name:'Histórico',rows:[
    ['Data/Hora','Tipo','Atleta','Detalhe','Operador','Dispositivo'],
    ...state.audit.slice(0,2000).map(e=>{const a=atleta(e.athleteId)||{};return [new Date(e.ts).toLocaleString('pt-PT'),e.type,a.nome||'',auditDetail(e),e.operador||'',e.device||''];})
  ]});
  download('HYROX_resultados.xls', buildWorkbook(sheets), 'application/vnd.ms-excel');
  toast('Excel exportado','ok');
}

function exportFinalCSV(pid){
  const p=prova(pid); const fr=finalRanking(pid);
  const rows=[['Pos','Dorsal','Nome','Tempo bruto','Penalizações','Tempo final oficial','Estado']];
  fr.ranked.forEach(r=>rows.push([r.pos,r.a.dorsal,r.a.nome,fmtDur(r.bruto),fmtDur(r.pen),fmtDur(r.value),STATES[deriveState(r.a)]]));
  fr.dnfs.forEach(r=>rows.push(['—',r.a.dorsal,r.a.nome,'—','—','—',STATES[deriveState(r.a)]]));
  download(`classificacao_${p.name.replace(/\s+/g,'_')}.csv`, '\ufeff'+toCSV(rows), 'text/csv;charset=utf-8');
  toast('CSV exportado','ok');
}

function exportAthleteExcel(aid){
  const a=atleta(aid); const sp=computeSplits(a);
  const fr=finalRanking(a.provaId); const pos=(fr.ranked.find(r=>r.a.id===aid)||{}).pos||'—';
  const runRk=sp.st.map((_,i)=>runRanking(a.provaId,i));
  const stRk=sp.st.map((_,i)=>stationRanking(a.provaId,i));
  const ident=[['Campo','Valor'],['Nome',a.nome],['Dorsal',a.dorsal],['Prova',(prova(a.provaId)||{}).name],
    ['Vaga',(vaga(a.vagaId)||{}).nome||''],['Tempo bruto',fmtDur(sp.bruto)],['Penalizações',fmtDur(penaltyTotal(aid))],
    ['Tempo final oficial',fmtDur(officialMs(a))],['Classificação',pos]];
  const runs=[['Corrida','Tempo','Ritmo/km','Posição','Melhor','Média','Dif. melhor']];
  sp.runs.forEach((v,i)=>{ if(v==null)return; const rk=runRk[i]; runs.push(['Corrida '+(i+1),fmtDur(v),fmtPace(v),posOf(rk.rows,aid)+'/'+rk.total,fmtDur(rk.best),fmtDur(rk.avg),fmtSigned(v-rk.best)]); });
  const sts=[['Estação','Tempo','Posição','Melhor','Média','Dif. melhor','Penalização']];
  sp.stations.forEach((v,i)=>{ if(v==null)return; const rk=stRk[i]; const penS=penaltiesOf(aid).filter(pn=>pn.target===STATION_NAME[sp.st[i]]).reduce((s,pn)=>s+pn.total,0); sts.push([STATION_NAME[sp.st[i]],fmtDur(v),posOf(rk.rows,aid)+'/'+rk.total,fmtDur(rk.best),fmtDur(rk.avg),fmtSigned(v-rk.best),penS?penS+'s':'—']); });
  const wb=buildWorkbook([{name:'Identificação',rows:ident},{name:'Corridas',rows:runs},{name:'Estações',rows:sts}]);
  download(`relatorio_${a.dorsal}_${a.nome.replace(/\s+/g,'_')}.xls`, wb, 'application/vnd.ms-excel');
  toast('Relatório Excel exportado','ok');
}

/* ---------- Resumo WhatsApp ---------- */
function whatsappSummary(aid){
  const a=atleta(aid); const sp=computeSplits(a);
  const fr=finalRanking(a.provaId); const pos=(fr.ranked.find(r=>r.a.id===aid)||{}).pos||'—';
  const runsV=sp.runs.map((v,i)=>({v,i})).filter(x=>x.v!=null);
  const best=runsV.length?runsV.reduce((m,x)=>x.v<m.v?x:m):null;
  const stRk=sp.st.map((_,i)=>stationRanking(a.provaId,i));
  const bestSt=(()=>{let b=null;sp.stations.forEach((v,i)=>{if(v==null)return;const pp=posOf(stRk[i].rows,aid);if(b==null||pp<b.pos)b={i,pos:pp,v};});return b;})();
  const lines=[];
  lines.push(`🏁 *HYROX Simulation — CrossFit Viseu*`);
  lines.push(`👤 ${a.nome}  |  Dorsal ${a.dorsal}`);
  lines.push(`🏷️ ${(prova(a.provaId)||{}).name}`);
  lines.push(`⏱️ Tempo final: *${fmtDur(officialMs(a))}*  (bruto ${fmtDur(sp.bruto)})`);
  if(penaltyTotal(aid)) lines.push(`⚠️ Penalizações: ${fmtDur(penaltyTotal(aid))}`);
  lines.push(`🏆 Classificação: ${pos}º de ${fr.classified}`);
  if(best) lines.push(`⚡ Melhor corrida: C${best.i+1} — ${fmtDur(best.v)} (${fmtPace(best.v)})`);
  if(runsCount(sp)) lines.push(`📊 Ritmo médio: ${fmtPace(runsSum(sp)/runsCount(sp))}`);
  if(bestSt) lines.push(`💪 Melhor estação: ${STATION_NAME[sp.st[bestSt.i]]} (${bestSt.pos}º)`);
  lines.push('');
  lines.push('📍 *Posições por estação:*');
  sp.stations.forEach((v,i)=>{ if(v==null)return; lines.push(`• ${STATION_NAME[sp.st[i]]}: ${fmtDur(v)} — ${posOf(stRk[i].rows,aid)}º`); });
  return lines.join('\n');
}

/* ---------- Imagem de partilha (canvas) ---------- */
function shareImage(aid){
  const a=atleta(aid); const sp=computeSplits(a);
  const fr=finalRanking(a.provaId); const pos=(fr.ranked.find(r=>r.a.id===aid)||{}).pos||'—';
  const W=1080,H=1350; const c=document.createElement('canvas'); c.width=W;c.height=H;
  const g=c.getContext('2d');
  g.fillStyle='#1D1D1B'; g.fillRect(0,0,W,H);
  g.fillStyle='#E9501D'; g.fillRect(0,0,W,14);
  g.fillStyle='#E9501D'; g.font='800 34px system-ui'; g.fillText('CROSSFIT VISEU · HYROX SIMULATION', 60, 100);
  g.fillStyle='#fff'; g.font='800 92px system-ui'; g.fillText(a.nome.slice(0,18), 60, 210);
  g.fillStyle='#c9a99b'; g.font='700 40px system-ui'; g.fillText(`Dorsal ${a.dorsal}  ·  ${(prova(a.provaId)||{}).name}`, 60, 270);
  // tempo grande
  g.fillStyle='#E9501D'; g.fillRect(60,330,W-120,220);
  g.fillStyle='#fff'; g.font='800 46px system-ui'; g.fillText('TEMPO FINAL OFICIAL', 90, 400);
  g.font='800 150px ui-monospace, monospace'; g.fillText(fmtDur(officialMs(a)), 90, 520);
  // kpis
  const kpi=(x,y,lbl,val)=>{ g.fillStyle='#201F1D'; g.fillRect(x,y,440,150); g.fillStyle='#98938a'; g.font='700 28px system-ui'; g.fillText(lbl,x+30,y+55); g.fillStyle='#fff'; g.font='800 58px ui-monospace,monospace'; g.fillText(val,x+30,y+120); };
  kpi(60,600,'CLASSIFICAÇÃO', pos+'º de '+fr.classified);
  kpi(580,600,'PENALIZAÇÕES', fmtDur(penaltyTotal(aid)));
  kpi(60,780,'TEMPO A CORRER', fmtDur(runsSum(sp)));
  kpi(580,780,'TEMPO ESTAÇÕES', fmtDur(stationsSum(sp)));
  kpi(60,960,'RITMO MÉDIO', runsCount(sp)?fmtDur(runsSum(sp)/runsCount(sp)):'—');
  const runsV=sp.runs.filter(v=>v!=null); kpi(580,960,'MELHOR CORRIDA', runsV.length?fmtDur(Math.min(...runsV)):'—');
  g.fillStyle='#98938a'; g.font='600 28px system-ui';
  g.fillText('Resultado '+(fr.provisional?'provisório':'final')+'  ·  '+new Date().toLocaleDateString('pt-PT'), 60, 1230);
  g.fillStyle='#E9501D'; g.fillRect(0,H-14,W,14);
  c.toBlob(b=>{ download(`partilha_${a.dorsal}_${a.nome.replace(/\s+/g,'_')}.png`, b, 'image/png'); toast('Imagem gerada','ok'); }, 'image/png');
}

/* ------------------------------------------------------------------ *
 * 10. UI: TOAST / MODAL / FEEDBACK
 * ------------------------------------------------------------------ */
function toast(msg, kind){
  let w=document.querySelector('.toast-wrap'); if(!w){ w=document.createElement('div'); w.className='toast-wrap'; document.body.appendChild(w); }
  const t=document.createElement('div'); t.className='toast '+(kind||''); t.innerHTML=esc(msg);
  w.appendChild(t); setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 2200);
}
let beepCtx=null;
function feedbackTap(){
  const f=document.querySelector('.tapflash'); if(f){ f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  if(state.config.haptics && navigator.vibrate) navigator.vibrate(35);
  if(state.config.sound){
    try{ beepCtx=beepCtx||new (window.AudioContext||window.webkitAudioContext)();
      const o=beepCtx.createOscillator(), gg=beepCtx.createGain();
      o.frequency.value=880; o.connect(gg); gg.connect(beepCtx.destination);
      gg.gain.setValueAtTime(.12, beepCtx.currentTime); gg.gain.exponentialRampToValueAtTime(.0001, beepCtx.currentTime+.12);
      o.start(); o.stop(beepCtx.currentTime+.12);
    }catch(e){}
  }
}
function closeModal(){ document.querySelectorAll('.modal-back').forEach(m=>m.remove()); }
function openModal(html, wide){
  closeModal();
  const back=document.createElement('div'); back.className='modal-back';
  back.innerHTML=`<div class="modal ${wide?'wide':''}">${html}</div>`;
  back.addEventListener('click', e=>{ if(e.target===back) closeModal(); });
  document.body.appendChild(back);
  return back;
}
function confirmModal(title, body, onYes, yesLabel){
  const back=openModal(`
    <div class="mhead"><h3>${esc(title)}</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody">${body}</div>
    <div class="mfoot"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-yes>${esc(yesLabel||'Confirmar')}</button></div>`);
  back.querySelector('[data-yes]').addEventListener('click', ()=>{ closeModal(); onYes(); });
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', closeModal));
  return back;
}

/* ------------------------------------------------------------------ *
 * 11. VIEWS
 * ------------------------------------------------------------------ */
function auditDetail(e){
  if(e.type==='registo') return `${e.pointLabel} @ ${fmtClockTime(e.value)}`;
  if(e.type==='undo') return `Removido: ${fmtClockTime(e.removedValue)}`;
  if(e.type==='correcao') return `${e.pointLabel}: ${fmtClockTime(e.from)} → ${fmtClockTime(e.to)} (${e.motivo||''})`;
  if(e.type==='penalizacao') return e.note||'';
  if(e.type==='estado') return e.note||'';
  return e.note||'';
}

/* ---- Modo Central ---- */
function viewCentral(){
  const f = state.ui;
  const provaOpts = `<option value="">Todas as provas</option>`+state.provas.map(p=>`<option value="${p.id}" ${f.prova===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
  const vagaOpts = `<option value="">Todas as vagas</option>`+state.vagas.map(v=>`<option value="${v.id}" ${f.vaga===v.id?'selected':''}>${esc(v.nome)}</option>`).join('');
  const estadoOpts = `<option value="">Todos os estados</option>`+Object.entries(STATES).map(([k,v])=>`<option value="${k}" ${f.estado===k?'selected':''}>${esc(v)}</option>`).join('');

  let list = state.atletas.slice();
  if(f.prova) list=list.filter(a=>a.provaId===f.prova);
  if(f.vaga) list=list.filter(a=>a.vagaId===f.vaga);
  if(f.estado) list=list.filter(a=>deriveState(a)===f.estado);
  list.sort((a,b)=>(a.dorsal||'').localeCompare(b.dorsal||'', 'pt', {numeric:true}));

  const cards = list.map(cardHTML).join('') || `<div class="empty">Sem atletas para os filtros escolhidos. Carrega dados de teste no separador <b>Admin</b> ou adiciona atletas em <b>Vagas e Atletas</b>.</div>`;
  return `
    <div class="rotate-hint"><span class="rot">🔄</span> Durante a cronometragem, roda o telemóvel para <b>horizontal</b> — vês mais atletas e os botões ficam maiores.</div>
    <div class="toolbar">
      <div class="filters">
        <select data-f="prova">${provaOpts}</select>
        <select data-f="vaga">${vagaOpts}</select>
        <select data-f="estado">${estadoOpts}</select>
      </div>
      <div class="spacer"></div>
      <span class="prova-pill">${list.length} atleta(s)</span>
    </div>
    <div class="cards">${cards}</div>`;
}

function cardHTML(a){
  const stt = deriveState(a);
  const sp = computeSplits(a);
  const np = nextPoint(a);
  const p = progressOf(a);
  const total = totalPoints(a.provaId);
  const last = p>0 ? sp.marks[p-1] : null;
  let btnCls='start', btnLabel='INICIAR PROVA';
  if(np){ btnCls = np.type==='start'?'start': np.type==='entrada'?'run': np.type==='finish'?'finish':'station'; btnLabel=np.label; }
  const accHtml = p>0 ? `<span class="js-livetimer tnum" data-since="${last}" data-base="${sp.marks[0]}">${fmtDur(now()-sp.marks[0])}</span>` : '0:00';
  const segHtml = (stt==='em_corrida'||stt==='em_estacao') ? `<span class="js-livetimer tnum" data-since="${last}">${fmtDur(now()-last)}</span>` : (last?fmtClockTime(last):'—');

  let action='';
  if(stt==='aguardar_validacao'){
    action=`<div class="act">
      <button class="btn ok block" data-validate="${a.id}" style="font-size:17px;padding:16px">✔ VALIDAR RESULTADO</button>
    </div>
    <div class="row2">
      <button class="btn sm ghost" data-undo="${a.id}">↶ Voltar atrás</button>
      <button class="btn sm ghost" data-report="${a.id}">Relatório</button>
    </div>`;
  } else if(stt==='validado'){
    action=`<div class="act">
      <button class="btn dark block" data-report="${a.id}">Ver relatório</button>
    </div>`;
  } else if(['DNS','DNF','desclassificado'].includes(stt)){
    action=`<div class="act"><div class="empty" style="padding:14px">${STATES[stt]}</div></div>`;
  } else {
    action=`<div class="act"><button class="bigbtn ${btnCls}" data-next="${a.id}">${esc(btnLabel)}</button></div>
      <div class="row2">
        ${p>0?`<button class="btn sm ghost undo-btn" data-undo="${a.id}">↶ Voltar atrás</button>`:''}
        <button class="btn sm ghost" data-report="${a.id}">Relatório</button>
      </div>`;
  }
  return `
  <div class="acard ${stt}">
    <div class="statusbar ${stt}"></div>
    <div class="top">
      <div class="dorsal">${esc(a.dorsal)}</div>
      <div class="who"><b>${esc(a.nome)}</b><small>${esc((prova(a.provaId)||{}).name||'')}</small></div>
      <span class="badge ${stt}">${esc(STATES[stt])}</span>
    </div>
    <div class="meta">
      <div><span class="k">Acumulado</span><span class="v">${accHtml}</span></div>
      <div><span class="k">${stt==='em_corrida'||stt==='em_estacao'?'Segmento atual':'Último registo'}</span><span class="v">${segHtml}</span></div>
      <div><span class="k">Penalizações</span><span class="v">${penaltyTotal(a.id)?fmtDur(penaltyTotal(a.id)):'—'}</span></div>
      <div><span class="k">Progresso</span><span class="v">${p}/${total}</span></div>
    </div>
    ${np?`<div class="next">Próxima ação: ${esc(np.label)}</div>`:`<div class="next">Sequência completa</div>`}
    ${action}
  </div>`;
}

/* ---- Modo Estação ---- */
function viewStation(){
  const screen = state.ui.stationScreen || 'skierg';
  const pick = STATIONS.map(s=>`<button class="${screen===s.key?'active':''}" data-station="${s.key}">${esc(s.name)}</button>`).join('');
  // atletas cuja próxima ação é ENTRADA nesta estação -> a entrar; SAÍDA/FINISH -> a sair
  const entering=[], exiting=[];
  for(const a of state.atletas){
    const np=nextPoint(a); if(!np) continue;
    if(np.key!==screen) continue;
    if(['DNS','DNF','desclassificado','validado'].includes(a.status)) continue;
    if(np.type==='entrada') entering.push(a);
    else if(np.type==='saida'||np.type==='finish') exiting.push(a);
  }
  const sortD=(x,y)=>(x.dorsal||'').localeCompare(y.dorsal||'','pt',{numeric:true});
  entering.sort(sortD); exiting.sort(sortD);
  const jrow=(a,cls,arrow)=>{
    const last=progressOf(a)>0?computeSplits(a).marks[progressOf(a)-1]:null;
    return `<div class="jrow-wrap">
      <button class="jrow ${cls}" data-next="${a.id}">
        <div class="dorsal">${esc(a.dorsal)}</div>
        <div class="who"><b>${esc(a.nome)}</b><small>${esc((prova(a.provaId)||{}).name)} · ${last?('desde '+fmtClockTime(last)):''}</small></div>
        <div class="arrow">${arrow}</div></button>
      ${progressOf(a)>0?`<button class="undo-mini" data-undo="${a.id}" title="Voltar atrás">↶</button>`:''}
    </div>`;
  };

  // Últimos registos (para anular um toque errado, mesmo que o atleta já tenha saído da lista)
  const recent = state.audit.filter(e=>e.type==='registo' && e.athleteId).slice(0,6);
  const recentHtml = recent.map(e=>{
    const a=atleta(e.athleteId); if(!a) return '';
    const canUndo = progressOf(a)>0 && !['validado','DNS','DNF','desclassificado'].includes(a.status);
    return `<div class="recent-row">
      <div class="who"><b>${esc(a.dorsal||'—')} ${esc(a.nome)}</b><small>${esc(e.pointLabel||'')} · ${fmtClockTime(e.value)}</small></div>
      ${canUndo?`<button class="btn sm ghost" data-undo="${a.id}">↶ Voltar atrás</button>`:'<span class="sub" style="color:var(--faint)">—</span>'}
    </div>`;
  }).join('') || '<div class="empty">Ainda sem registos nesta sessão</div>';

  return `
    <div class="section-head"><h2>Modo Estação</h2><span class="sub">Toca no atleta para registar entrada ou saída. Carregaste mal? Usa o ↶ ou os “Últimos registos”.</span></div>
    <div class="station-pick">${pick}</div>
    <div class="split">
      <div class="col"><h3>A ENTRAR <span>${entering.length}</span></h3>
        ${entering.map(a=>jrow(a,'enter','↓')).join('')||'<div class="empty">Ninguém a entrar</div>'}</div>
      <div class="col"><h3>A SAIR <span>${exiting.length}</span></h3>
        ${exiting.map(a=>jrow(a,'exit','↑')).join('')||'<div class="empty">Ninguém a sair</div>'}</div>
    </div>
    <div class="panel" style="margin-top:16px"><h3>Últimos registos <span class="sub" style="font-weight:600;color:var(--muted)">— anula um toque errado</span></h3>
      <div class="recent-list">${recentHtml}</div></div>`;
}

/* ---- Vagas e Atletas ---- */
function athleteRow(a){
  const started=progressOf(a)>0;
  const moveOpts = state.vagas.map(vv=>`<option value="${vv.id}" ${a.vagaId===vv.id?'selected':''}>${esc(vv.nome)}</option>`).join('')
    + `<option value="">— sem vaga —</option>`;
  return `<div class="arow">
    <div class="dorsal">${esc(a.dorsal||'—')}</div>
    <div class="who"><b>${esc(a.nome)}</b><small>${esc((prova(a.provaId)||{}).name)} · ${esc(a.genero||'')} ${esc(a.categoria||'')}</small></div>
    <div class="arow-actions">
      ${started
        ? `<span class="badge ${deriveState(a)}">Iniciado ${fmtClockTime(computeSplits(a).marks[0])}</span>`
        : `<select class="move-sel" data-moveatl="${a.id}" title="Mover de vaga">${moveOpts}</select>
           <button class="btn sm primary" data-startatl="${a.id}">Iniciar</button>`}
      <button class="btn sm" data-editatl="${a.id}">Editar atleta</button>
    </div>
  </div>`;
}

function viewVagas(){
  const vagas=state.vagas.map(v=>{
    const ath=v.athletes.map(atleta).filter(Boolean).sort((a,b)=>(a.dorsal||'').localeCompare(b.dorsal||'','pt',{numeric:true}));
    const started=ath.filter(a=>progressOf(a)>0).length;
    const rows=ath.map(athleteRow).join('')||'<div class="empty">Sem atletas nesta vaga</div>';
    return `<div class="panel vaga-panel">
      <div class="vaga-head">
        <div><h3 class="vaga-title">${esc(v.nome)}</h3>
          <span class="badge nao_iniciado">${started}/${ath.length} iniciados · prev. ${esc(v.horaPrevista||'—')}</span></div>
        <div class="spacer" style="flex:1"></div>
        <button class="btn primary sm" data-startvaga="${v.id}">▶ Iniciar todos</button>
        <button class="btn sm" data-addtovaga="${v.id}">+ Adicionar atleta</button>
        <button class="btn sm" data-editvaga="${v.id}">Editar vaga</button>
        <button class="btn sm ghost" data-delvaga="${v.id}">Eliminar vaga</button>
      </div>
      <div class="arows">${rows}</div></div>`;
  }).join('')||'<div class="empty">Ainda não há vagas. Cria a primeira.</div>';

  // atletas sem vaga
  const semVaga=state.atletas.filter(a=>!a.vagaId || !vaga(a.vagaId)).sort((a,b)=>(a.dorsal||'').localeCompare(b.dorsal||'','pt',{numeric:true}));
  const semVagaPanel = semVaga.length ? `<div class="panel vaga-panel">
      <div class="vaga-head"><div><h3 class="vaga-title">Sem vaga atribuída</h3>
        <span class="badge nao_iniciado">${semVaga.length} atleta(s)</span></div></div>
      <div class="arows">${semVaga.map(athleteRow).join('')}</div></div>` : '';

  return `
    <div class="toolbar"><div class="section-head" style="margin:0"><h2>Vagas e Atletas</h2><span class="sub">Gerir vagas de partida e editar atletas</span></div><div class="spacer"></div>
      <button class="btn primary" data-newvaga>+ Nova vaga</button>
      <button class="btn" data-newatleta>+ Novo atleta</button>
    </div>${vagas}${semVagaPanel}`;
}

/* ---- Classificações ---- */
function viewRankings(){
  const sub=state.ui.rankSub||'final';
  const pid=state.ui.prova||state.provas[0].id;
  const provaTabs=state.provas.map(p=>`<button class="chip-toggle ${pid===p.id?'on':''}" data-prova="${p.id}">${esc(p.name)}</button>`).join('');
  const subTabs=[['final','Classificação final'],['corridas','Corridas'],['estacoes','Estações']]
    .map(([k,l])=>`<button class="chip-toggle ${sub===k?'on':''}" data-ranksub="${k}">${esc(l)}</button>`).join('');
  let body='';
  if(sub==='final') body=finalTable(pid);
  else if(sub==='corridas') body=runsTables(pid);
  else body=stationsTables(pid);
  return `
    <div class="section-head"><h2>Classificações</h2><span class="sub">Sempre separadas por prova</span></div>
    <div class="pill-select" style="margin-bottom:10px">${provaTabs}</div>
    <div class="pill-select" style="margin-bottom:16px">${subTabs}</div>
    ${body}`;
}
function finalTable(pid){
  const fr=finalRanking(pid);
  const rows=fr.ranked.map(r=>`<tr>
    <td class="pos ${r.pos<=3?'p'+r.pos:''}">${r.pos}º</td>
    <td class="num">${esc(r.a.dorsal)}</td><td>${esc(r.a.nome)}</td>
    <td class="num">${fmtDur(r.bruto, state.config.tie!=='sec')}</td>
    <td class="num">${r.pen?fmtDur(r.pen):'—'}</td>
    <td class="num"><b>${fmtDur(r.value, state.config.tie!=='sec')}</b></td>
    <td><span class="badge ${deriveState(r.a)}">${esc(STATES[deriveState(r.a)])}</span></td>
    <td><button class="btn sm ghost" data-report="${r.a.id}">Relatório</button></td></tr>`).join('');
  const dnf=fr.dnfs.map(r=>`<tr style="opacity:.6"><td>—</td><td class="num">${esc(r.a.dorsal)}</td><td>${esc(r.a.nome)}</td><td colspan="3" class="num">—</td><td><span class="badge ${deriveState(r.a)}">${esc(STATES[deriveState(r.a)])}</span></td><td></td></tr>`).join('');
  const flag=fr.provisional?`<span class="prov-flag">● Classificação provisória</span>`:`<span class="prov-flag final-flag">● Classificação final</span>`;
  return `<div class="toolbar" style="margin-bottom:10px">${flag}<span class="sub" style="color:var(--muted)">${fr.classified} de ${fr.total} atletas classificados</span><div class="spacer"></div>
    <button class="btn sm" data-expfinalcsv="${pid}">Exportar CSV</button></div>
    <div class="tablewrap"><table class="grid">
    <thead><tr><th>Pos</th><th class="num">Dorsal</th><th>Nome</th><th class="num">Bruto</th><th class="num">Penal.</th><th class="num">Oficial</th><th>Estado</th><th></th></tr></thead>
    <tbody>${rows||'<tr><td colspan="8"><div class="empty">Ainda sem resultados nesta prova</div></td></tr>'}${dnf}</tbody></table></div>`;
}
function runsTables(pid){
  const st=stationsOf(pid);
  return st.map((_,i)=>{
    const rk=runRanking(pid,i); if(!rk.rows.length) return '';
    const rows=rk.rows.map((r,ix)=>{
      const diffBest=r.value-rk.best; const prev=ix>0?rk.rows[ix-1].value:null;
      return `<tr><td class="pos ${r.pos<=3?'p'+r.pos:''}">${r.pos}º</td><td class="num">${esc(r.a.dorsal)}</td><td>${esc(r.a.nome)}</td>
        <td class="num">${fmtDur(r.value)}</td><td class="num">${fmtPace(r.value)}</td>
        <td class="num">${fmtSigned(diffBest)}</td><td class="num">${prev!=null?fmtSigned(r.value-prev):'—'}</td></tr>`;
    }).join('');
    return `<h3 style="margin:18px 0 8px">Corrida ${i+1} <span class="sub" style="font-weight:600;color:var(--muted)">— melhor ${fmtDur(rk.best)} · média ${fmtDur(rk.avg)} · ${rk.total} atletas</span></h3>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Pos</th><th class="num">Dorsal</th><th>Nome</th><th class="num">Tempo</th><th class="num">Ritmo</th><th class="num">Dif. melhor</th><th class="num">Dif. anterior</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('')||'<div class="empty">Ainda sem corridas registadas nesta prova</div>';
}
function stationsTables(pid){
  const st=stationsOf(pid);
  return st.map((k,i)=>{
    const rk=stationRanking(pid,i); if(!rk.rows.length) return '';
    const rows=rk.rows.map((r,ix)=>{
      const diffBest=r.value-rk.best, diffAvg=r.value-rk.avg, prev=ix>0?rk.rows[ix-1].value:null;
      const pen=penaltiesOf(r.a.id).filter(pn=>pn.target===STATION_NAME[k]).reduce((s,pn)=>s+pn.total,0);
      return `<tr><td class="pos ${r.pos<=3?'p'+r.pos:''}">${r.pos}º</td><td class="num">${esc(r.a.dorsal)}</td><td>${esc(r.a.nome)}</td>
        <td class="num">${fmtDur(r.value)}</td><td class="num">${fmtSigned(diffBest)}</td><td class="num">${fmtSigned(diffAvg)}</td>
        <td class="num">${prev!=null?fmtSigned(r.value-prev):'—'}</td><td class="num">${pen?pen+'s':'—'}</td></tr>`;
    }).join('');
    return `<h3 style="margin:18px 0 8px">${esc(STATION_NAME[k])} <span class="sub" style="font-weight:600;color:var(--muted)">— melhor ${fmtDur(rk.best)} · média ${fmtDur(rk.avg)} · ${rk.total} atletas</span></h3>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Pos</th><th class="num">Dorsal</th><th>Nome</th><th class="num">Tempo</th><th class="num">Dif. melhor</th><th class="num">Dif. média</th><th class="num">Dif. anterior</th><th class="num">Penal.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('')||'<div class="empty">Ainda sem estações registadas nesta prova</div>';
}

/* ---- Penalizações ---- */
function viewPenalties(){
  const rows=state.penalties.slice().reverse().map(pn=>{
    const a=atleta(pn.athleteId)||{};
    return `<tr><td class="num">${esc(a.dorsal||'')}</td><td>${esc(a.nome||'')}</td><td>${esc(pn.target)}</td><td>${esc(pn.typeLabel)}</td>
      <td class="num">${pn.count}×${pn.seconds}s</td><td class="num"><b>${pn.total}s</b></td><td>${esc(pn.juiz||'')}</td>
      <td><button class="btn sm ghost" data-delpen="${pn.id}">Remover</button></td></tr>`;
  }).join('')||'<tr><td colspan="8"><div class="empty">Sem penalizações registadas</div></td></tr>';
  return `<div class="toolbar"><div class="section-head" style="margin:0"><h2>Penalizações</h2></div><div class="spacer"></div>
    <button class="btn primary" data-newpen>+ Adicionar penalização</button></div>
    <div class="tablewrap"><table class="grid"><thead><tr><th class="num">Dorsal</th><th>Atleta</th><th>Alvo</th><th>Tipo</th><th class="num">Cálculo</th><th class="num">Total</th><th>Juiz</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---- Relatórios ---- */
function viewReports(){
  const aid=state.ui.reportAthlete;
  const opts=state.atletas.slice().sort((a,b)=>(a.dorsal||'').localeCompare(b.dorsal||'','pt',{numeric:true}))
    .map(a=>`<option value="${a.id}" ${aid===a.id?'selected':''}>${esc(a.dorsal)} — ${esc(a.nome)}</option>`).join('');
  const body = aid && atleta(aid) ? reportHTML(aid) : '<div class="empty">Escolhe um atleta para ver o relatório individual.</div>';
  return `<div class="toolbar no-print"><label class="field" style="min-width:280px"><span>Atleta</span><select data-f="reportAthlete"><option value="">— escolher —</option>${opts}</select></label></div>${body}`;
}

function reportHTML(aid){
  const a=atleta(aid); const sp=computeSplits(a);
  if(sp.bruto==null && progressOf(a)===0) return '<div class="empty">Este atleta ainda não iniciou a prova.</div>';
  const fr=finalRanking(a.provaId); const frRow=fr.ranked.find(r=>r.a.id===aid);
  const pos=frRow?frRow.pos:'—';
  const runRk=sp.st.map((_,i)=>runRanking(a.provaId,i));
  const stRk=sp.st.map((_,i)=>stationRanking(a.provaId,i));
  const runsV=sp.runs.map((v,i)=>({v,i})).filter(x=>x.v!=null);
  const best=runsV.length?runsV.reduce((m,x)=>x.v<m.v?x:m):null;
  const worst=runsV.length?runsV.reduce((m,x)=>x.v>m.v?x:m):null;
  const first4=sp.runs.slice(0,4).filter(v=>v!=null), last4=sp.runs.slice(4,8).filter(v=>v!=null);
  const avg=arr=>arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:null;
  const avgAll=runsCount(sp)?runsSum(sp)/runsCount(sp):null;
  const drop=(avg(last4)!=null&&avg(first4)!=null)?avg(last4)-avg(first4):null;

  // pontos fortes / a melhorar
  const runPos=sp.runs.map((v,i)=> v!=null? {i,pos:posOf(runRk[i].rows,aid),tot:runRk[i].total,type:'Corrida '+(i+1),v}:null).filter(Boolean);
  const stPos=sp.stations.map((v,i)=> v!=null? {i,pos:posOf(stRk[i].rows,aid),tot:stRk[i].total,type:STATION_NAME[sp.st[i]],v}:null).filter(Boolean);
  const allPos=[...runPos,...stPos];
  const strong=allPos.slice().sort((x,y)=> x.pos/x.tot - y.pos/y.tot).slice(0,3);
  const weak=allPos.slice().sort((x,y)=> y.pos/y.tot - x.pos/x.tot).slice(0,3);
  const aboveRuns=runPos.filter(r=> sp.runs[r.i] < runRk[r.i].avg);
  const belowRuns=runPos.filter(r=> sp.runs[r.i] > runRk[r.i].avg);

  const bestSt=stPos.length?stPos.reduce((m,x)=>x.pos<m.pos?x:m):null;
  const worstSt=stPos.length?stPos.reduce((m,x)=>x.pos>m.pos?x:m):null;

  const runRows=sp.runs.map((v,i)=>{ if(v==null)return''; const rk=runRk[i];
    return `<tr><td>Corrida ${i+1}</td><td class="num">${fmtDur(v)}</td><td class="num">${fmtPace(v)}</td><td class="num">${posOf(rk.rows,aid)}/${rk.total}</td><td class="num">${fmtDur(rk.best)}</td><td class="num">${fmtDur(rk.avg)}</td><td class="num">${fmtSigned(v-rk.best)}</td></tr>`;}).join('');
  const stRows=sp.stations.map((v,i)=>{ if(v==null)return''; const rk=stRk[i]; const pen=penaltiesOf(aid).filter(pn=>pn.target===STATION_NAME[sp.st[i]]).reduce((s,pn)=>s+pn.total,0);
    return `<tr><td>${esc(STATION_NAME[sp.st[i]])}</td><td class="num">${fmtDur(v)}</td><td class="num">${posOf(rk.rows,aid)}/${rk.total}</td><td class="num">${fmtDur(rk.best)}</td><td class="num">${fmtDur(rk.avg)}</td><td class="num">${fmtSigned(v-rk.best)}</td><td class="num">${pen?pen+'s':'—'}</td></tr>`;}).join('');

  const strongList=strong.map(s=>`<li><span class="dot"></span>${esc(s.type)} — ${s.pos}º de ${s.tot} (${fmtDur(s.v)})</li>`).join('');
  const weakList=weak.map(s=>`<li><span class="dot"></span>${esc(s.type)} — ${s.pos}º de ${s.tot} (${fmtDur(s.v)})</li>`).join('');
  const penList=penaltiesOf(aid).map(pn=>`<li><span class="dot"></span>${esc(pn.typeLabel)} · ${esc(pn.target)} — ${pn.total}s</li>`).join('');

  return `<div class="report" id="report-print">
    <div class="rp-hero">
      <div class="dorsal">${esc(a.dorsal)}</div>
      <div><div class="lbl">Atleta</div><div style="font-size:26px;font-weight:800">${esc(a.nome)}</div>
        <div style="color:#c9a99b;font-weight:600">${esc((prova(a.provaId)||{}).name)} · ${esc((vaga(a.vagaId)||{}).nome||'sem vaga')}</div></div>
      <div style="flex:1"></div>
      <div style="text-align:right"><div class="lbl">Tempo final oficial</div><div class="big">${fmtDur(officialMs(a))}</div>
        <div style="color:#c9a99b;font-weight:600">bruto ${fmtDur(sp.bruto)} · penal. ${fmtDur(penaltyTotal(aid))} · ${pos}º de ${fr.classified}</div></div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="k">Tempo a correr</div><div class="v">${fmtDur(runsSum(sp))}</div><div class="s">8 corridas</div></div>
      <div class="kpi"><div class="k">Tempo estações</div><div class="v">${fmtDur(stationsSum(sp))}</div><div class="s">8 estações</div></div>
      <div class="kpi"><div class="k">Ritmo médio</div><div class="v">${avgAll!=null?fmtDur(avgAll):'—'}</div><div class="s">min/km</div></div>
      <div class="kpi"><div class="k">Melhor corrida</div><div class="v">${best?fmtDur(best.v):'—'}</div><div class="s">${best?'Corrida '+(best.i+1):''}</div></div>
      <div class="kpi"><div class="k">Corrida + lenta</div><div class="v">${worst?fmtDur(worst.v):'—'}</div><div class="s">${worst?'Corrida '+(worst.i+1):''}</div></div>
      <div class="kpi"><div class="k">1.ª metade</div><div class="v">${avg(first4)!=null?fmtDur(avg(first4)):'—'}</div><div class="s">média C1–C4</div></div>
      <div class="kpi"><div class="k">2.ª metade</div><div class="v">${avg(last4)!=null?fmtDur(avg(last4)):'—'}</div><div class="s">média C5–C8</div></div>
      <div class="kpi"><div class="k">Quebra 2.ª metade</div><div class="v">${drop!=null?fmtSigned(drop):'—'}</div><div class="s">por corrida</div></div>
    </div>

    <div class="two-col">
      <div class="panel"><h3>Tabela das corridas</h3><div class="tablewrap" style="box-shadow:none;border:0">
        <table class="grid"><thead><tr><th>Corrida</th><th class="num">Tempo</th><th class="num">Ritmo</th><th class="num">Pos</th><th class="num">Melhor</th><th class="num">Média</th><th class="num">Dif.</th></tr></thead><tbody>${runRows||'<tr><td colspan="7">—</td></tr>'}</tbody></table></div></div>
      <div class="panel"><h3>Tabela das estações</h3><div class="tablewrap" style="box-shadow:none;border:0">
        <table class="grid"><thead><tr><th>Estação</th><th class="num">Tempo</th><th class="num">Pos</th><th class="num">Melhor</th><th class="num">Média</th><th class="num">Dif.</th><th class="num">Penal.</th></tr></thead><tbody>${stRows||'<tr><td colspan="7">—</td></tr>'}</tbody></table></div></div>
    </div>

    <div class="two-col">
      <div class="panel"><h3>Pontos fortes</h3><ul class="bullets strong">${strongList||'<li>—</li>'}
        ${best?`<li><span class="dot"></span>Melhor corrida: Corrida ${best.i+1} (${fmtDur(best.v)})</li>`:''}
        ${aboveRuns.length?`<li><span class="dot"></span>Acima da média em ${aboveRuns.length} corrida(s)</li>`:''}</ul></div>
      <div class="panel"><h3>Pontos a melhorar</h3><ul class="bullets weak">${weakList||'<li>—</li>'}
        ${drop!=null&&drop>0?`<li><span class="dot"></span>Maior quebra de ritmo na 2.ª metade (${fmtSigned(drop)}/corrida)</li>`:''}
        ${belowRuns.length?`<li><span class="dot"></span>Abaixo da média em ${belowRuns.length} corrida(s)</li>`:''}
        ${penList}</ul></div>
    </div>

    ${chartBars('Tempo das 8 corridas (mais baixo = melhor)', sp.runs.map((v,i)=>({label:'C'+(i+1), value:v})), true)}
    ${chartCompare('Atleta vs média da prova — corridas', sp.runs.map((v,i)=>({label:'C'+(i+1), value:v, avg:runRk[i].avg})))}
    ${chartCompare('Atleta vs média da prova — estações', sp.stations.map((v,i)=>({label:STATION_NAME[sp.st[i]].split(' ')[0], value:v, avg:stRk[i].avg})))}
    ${chartDistribution(runsSum(sp), stationsSum(sp), penaltyTotal(aid))}

    <div class="toolbar no-print" style="margin-top:6px">
      <button class="btn primary" data-pdf="${aid}">Exportar PDF</button>
      <button class="btn" data-repexcel="${aid}">Exportar Excel</button>
      <button class="btn" data-shareimg="${aid}">Imagem de partilha</button>
      <button class="btn dark" data-whats="${aid}">Resumo WhatsApp</button>
    </div>
  </div>`;
}

/* ---- Gráficos SVG ---- */
function chartBars(title, data, lowerBetter){
  const vals=data.filter(d=>d.value!=null); if(!vals.length) return '';
  const max=Math.max(...vals.map(d=>d.value));
  const W=680,H=220,pad=30,bw=(W-pad*2)/data.length;
  const bars=data.map((d,i)=>{ if(d.value==null)return''; const h=(d.value/max)*(H-60);
    return `<g><rect x="${pad+i*bw+6}" y="${H-30-h}" width="${bw-12}" height="${h}" rx="4" fill="var(--brand)"></rect>
      <text x="${pad+i*bw+bw/2}" y="${H-34-h}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)" font-family="ui-monospace,monospace">${fmtDur(d.value)}</text>
      <text x="${pad+i*bw+bw/2}" y="${H-12}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(d.label)}</text></g>`;}).join('');
  return `<div class="chart"><h3>${esc(title)}</h3><div class="hint">${lowerBetter?'Tempos mais baixos representam melhor desempenho.':''}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%">${bars}</svg></div>`;
}
function chartCompare(title, data){
  const vals=data.filter(d=>d.value!=null); if(!vals.length) return '';
  const max=Math.max(...vals.map(d=>Math.max(d.value,d.avg||0)));
  const W=680,H=230,pad=30,bw=(W-pad*2)/data.length;
  const g=data.map((d,i)=>{ if(d.value==null)return''; const x=pad+i*bw;
    const hv=(d.value/max)*(H-60), ha=d.avg?(d.avg/max)*(H-60):0;
    const better=d.avg&&d.value<d.avg;
    return `<g>
      <rect x="${x+6}" y="${H-30-hv}" width="${(bw-16)/2}" height="${hv}" rx="3" fill="${better?'var(--ok)':'var(--brand)'}"></rect>
      <rect x="${x+6+(bw-16)/2+2}" y="${H-30-ha}" width="${(bw-16)/2}" height="${ha}" rx="3" fill="var(--faint)"></rect>
      <text x="${x+bw/2}" y="${H-12}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(d.label)}</text></g>`;}).join('');
  return `<div class="chart"><h3>${esc(title)}</h3><div class="hint">Barra colorida = atleta · barra cinza = média da prova. Mais baixo = melhor.</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg></div>`;
}
function chartDistribution(run, station, pen){
  const total=run+station+pen; if(!total) return '';
  const seg=[['A correr',run,'var(--run)'],['Nas estações',station,'var(--brand)'],['Penalizações',pen,'var(--dsq)']];
  const W=680,H=90; let x=20; const barW=W-40;
  const rects=seg.map(([l,v,c])=>{ const w=(v/total)*barW; const r=`<rect x="${x}" y="30" width="${w}" height="34" fill="${c}"></rect>`; x+=w; return r;}).join('');
  const legend=seg.map(([l,v,c])=>`<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:12px"><span style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></span>${l}: ${fmtDur(v)} (${Math.round(v/total*100)}%)</span>`).join('');
  return `<div class="chart"><h3>Distribuição do tempo</h3><svg viewBox="0 0 ${W} ${H}" width="100%">${rects}</svg><div style="margin-top:8px">${legend}</div></div>`;
}

/* ---- Admin ---- */
let adminUnlocked=false;
function viewAdmin(){
  if(!adminUnlocked){
    return `<div class="section-head"><h2>Administração</h2><span class="sub">Bastidores da prova — protegido por palavra-passe</span></div>
      <div class="callout" style="max-width:560px;margin-bottom:14px">O <b>Admin</b> é a área de bastidores da prova. Aqui geres tudo o que não faz parte da cronometragem no momento: <b>dados e cópias de segurança</b> (guardar/restaurar, importar/exportar), <b>simulação e testes</b> antes do dia da prova, <b>definições</b> (operador, empates, som), <b>provas e ordem das estações</b>, <b>tipos de penalização</b>, <b>correções manuais</b> (acertar horas, DNS/DNF, reabrir resultados) e o <b>histórico de auditoria</b>. Está protegido por palavra-passe para evitar alterações acidentais durante a prova.</div>
      <div class="panel" style="max-width:420px">
        <label class="field"><span>Palavra-passe de administrador</span><input type="password" id="adminpw" placeholder="por defeito: admin"></label>
        <button class="btn primary block" data-adminlogin style="margin-top:12px">Entrar</button>
      </div>`;
  }
  const c=state.config;
  return `<div class="section-head"><h2>Administração</h2><span class="sub">Bastidores da prova · Operador: ${esc(c.operador)} · dispositivo ${esc(deviceId())}</span></div>
    <div class="callout" style="margin-bottom:14px">Área de gestão fora da cronometragem: dados/cópias, simulação e testes, definições, provas, penalizações, correções e histórico. Nada aqui interfere com os tempos já registados a não ser que uses as correções manuais (que ficam sempre auditadas).</div>
    <div class="two-col">
      <div class="panel"><h3>Dados & cópias de segurança</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button class="btn" data-loaddemo>Carregar dados de teste</button>
          <button class="btn" data-expall>Exportar Excel geral</button>
          <button class="btn" data-backup>Cópia de segurança (JSON)</button>
          <label class="btn" style="cursor:pointer">Restaurar JSON<input type="file" accept=".json" data-restore hidden></label>
          <button class="btn" data-importcsv-btn>Importar atletas CSV</button>
          <input type="file" accept=".csv" data-importcsv hidden>
          <button class="btn danger" data-reset>Apagar tudo</button>
        </div>
        <div class="callout" style="margin-top:12px">Cada clique é guardado automaticamente. São criadas cópias automáticas durante a prova (mantidas as 12 mais recentes).</div>
      </div>
      <div class="panel"><h3>Simulação & testes</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button class="btn" data-stress>Criar prova de teste (20 atletas)</button>
          <button class="btn" data-simulate>Simular prova completa</button>
          <button class="btn" data-runtests>▶ Correr testes internos</button>
        </div>
        <div class="callout" style="margin-top:12px">Usa isto <b>antes</b> da prova real: cria atletas fictícios, preenche todos os tempos automaticamente (corridas, estações e algumas penalizações) e valida uma parte, para percorreres classificações e relatórios num instante. Os testes internos verificam cronometragem, penalizações, empates, classificações e exportações.</div>
      </div>
      <div class="panel"><h3>Definições</h3>
        <div class="form-grid">
          <label class="field"><span>Operador / juiz</span><input type="text" data-cfg="operador" value="${esc(c.operador)}"></label>
          <label class="field"><span>Empates ao</span><select data-cfg="tie">
            <option value="sec" ${c.tie==='sec'?'selected':''}>Segundo</option>
            <option value="dec" ${c.tie==='dec'?'selected':''}>Décimo de segundo</option>
            <option value="ms" ${c.tie==='ms'?'selected':''}>Milissegundo</option></select></label>
          <label class="field"><span>Som</span><select data-cfg="sound"><option value="true" ${c.sound?'selected':''}>Ligado</option><option value="false" ${!c.sound?'selected':''}>Desligado</option></select></label>
          <label class="field"><span>Vibração</span><select data-cfg="haptics"><option value="true" ${c.haptics?'selected':''}>Ligada</option><option value="false" ${!c.haptics?'selected':''}>Desligada</option></select></label>
          <label class="field full"><span>Nova palavra-passe admin</span><input type="text" data-cfg="adminPass" value="${esc(c.adminPass)}"></label>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px"><h3>Sincronização entre dispositivos (opcional)</h3>
      <div class="callout" style="margin-bottom:12px">Liga vários dispositivos à mesma prova através do <b>Supabase</b> (grátis). Necessário só para o <b>Cenário B</b>: um ecrã/TV que é um <b>aparelho separado</b> do que cronometra. Para uma TV ligada por cabo ao mesmo computador não precisas disto — usa o separador <b>Placar</b>. Passos: cria um projeto em supabase.com, corre o ficheiro <code>supabase_sync.sql</code> no SQL Editor, e cola aqui o <b>URL do projeto</b> e a <b>chave publishable</b> (ou anon), em Project Settings → API Keys.</div>
      <div class="form-grid">
        <label class="field full"><span>URL do projeto Supabase</span><input type="text" data-cfg="syncUrl" value="${esc(c.syncUrl||'')}" placeholder="https://xxxx.supabase.co"></label>
        <label class="field full"><span>Chave pública (publishable ou anon)</span><input type="text" data-cfg="syncKey" value="${esc(c.syncKey||'')}" placeholder="sb_publishable_… ou eyJhbGci…"></label>
        <label class="field"><span>Código da sessão</span><input type="text" data-cfg="syncSession" value="${esc(c.syncSession||'')}" placeholder="ex.: cfv-simulacao-2026"></label>
        <label class="field"><span>Papel deste dispositivo</span><select data-cfg="syncRole">
          <option value="writer" ${c.syncRole!=='viewer'?'selected':''}>Escrita (cronometra e envia)</option>
          <option value="viewer" ${c.syncRole==='viewer'?'selected':''}>Visualização (só recebe — ecrãs/TV)</option></select></label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px">
        <button class="btn ${c.syncEnabled?'danger ghost':'primary'}" data-synctoggle>${c.syncEnabled?'Desligar sincronização':'Ligar sincronização'}</button>
        <button class="btn" data-synctest>Testar ligação</button>
        <button class="btn" data-synclink>Copiar link do ecrã (TV)</button>
        <span id="syncBadge" class="sync-badge"></span>
      </div>
      <div class="callout" style="margin-top:10px">Usa o <b>mesmo código de sessão</b> em todos os dispositivos. Recomendação: <b>um único</b> dispositivo em modo <i>Escrita</i> (o que cronometra) e os restantes em <i>Visualização</i>. O botão <b>Copiar link do ecrã</b> gera um endereço que já abre a TV ligada, em visualização e direto no placar.</div>
    </div>

    <div class="panel" style="margin-top:16px"><h3>Provas & ordem das estações</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">${state.provas.map(p=>`<span class="prova-pill">${esc(p.name)} <button class="close-x" style="color:#fff;width:24px;height:24px;font-size:18px" data-editprova="${p.id}">✎</button></span>`).join('')}
        <button class="btn sm" data-newprova>+ Nova prova</button></div>
      <div class="callout">A ordem das estações é editável por prova. Ao editar uma prova podes reordenar as 8 estações.</div>
    </div>

    <div class="panel" style="margin-top:16px"><h3>Tipos de penalização</h3>
      <div class="tablewrap" style="box-shadow:none;border:0"><table class="grid"><thead><tr><th>Descrição</th><th class="num">Segundos</th><th>Por</th><th></th></tr></thead>
      <tbody>${state.penaltyTypes.map((t,i)=>`<tr><td>${esc(t.label)}</td><td class="num">${t.seconds}</td><td>${esc(t.per)}</td><td><button class="btn sm ghost" data-editptype="${i}">Editar</button></td></tr>`).join('')}</tbody></table></div>
      <button class="btn sm" data-newptype style="margin-top:10px">+ Novo tipo</button></div>

    <div class="panel" style="margin-top:16px"><h3>Correções manuais & reabrir resultados</h3>
      <div class="toolbar"><label class="field" style="min-width:260px"><span>Atleta</span><select id="corratl"><option value="">— escolher —</option>${state.atletas.map(a=>`<option value="${a.id}">${esc(a.dorsal)} — ${esc(a.nome)}</option>`).join('')}</select></label>
        <button class="btn" data-corrmark>Corrigir registo</button>
        <button class="btn" data-setstate>Alterar estado (DNS/DNF/DSQ)</button>
        <button class="btn ok" data-reopen>Reabrir resultado validado</button></div></div>

    <div class="panel" style="margin-top:16px"><h3>Histórico de auditoria</h3>
      <div class="audit">${state.audit.slice(0,60).map(e=>{const a=atleta(e.athleteId)||{};return `<div class="a"><span class="t">${new Date(e.ts).toLocaleTimeString('pt-PT')}</span><span><b>${esc(e.type)}</b> ${a.nome?('· '+esc(a.nome)):''} — ${esc(auditDetail(e))} <i style="color:var(--faint)">(${esc(e.operador||'')})</i></span></div>`;}).join('')||'<div class="empty">Sem registos</div>'}</div></div>`;
}

/* ---- Ajuda ---- */
function viewHelp(){
  return `<div class="section-head"><h2>Manual de utilização</h2></div>
  <div class="help">
    <h3>1. Antes da prova</h3>
    <ul><li>Em <b>Admin → Carregar dados de teste</b> tens 8 atletas e 2 vagas de exemplo. Para testar a sério, usa <b>Admin → Criar prova de teste (20 atletas)</b> e depois <b>Simular prova completa</b> — preenche tudo automaticamente para veres classificações e relatórios.</li>
    <li>Cria/importa atletas em <b>Vagas e Atletas</b> (ou <i>Importar atletas CSV</i> no Admin) e distribui-os por vagas de partida.</li>
    <li>Em <b>Vagas e Atletas</b> podes <i>Editar atleta</i> (nome, dorsal, prova, género, categoria, vaga, hora, pista, observações) e mover rapidamente um atleta de vaga na própria linha.</li>
    <li>Define o teu nome de operador em <b>Admin → Definições</b>. Fica registado em cada clique.</li></ul>
    <h3>2. Dar partida</h3>
    <ul><li>No separador <b>Vagas e Atletas</b>, usa <i>Iniciar todos</i> para dar a partida simultânea, ou <i>Iniciar</i> atleta a atleta.</li>
    <li>A hora de partida pode ser corrigida em <b>Admin → Corrigir registo</b>.</li></ul>
    <h3>3. Durante a prova</h3>
    <ul><li><b>Roda o telemóvel para horizontal</b> durante a cronometragem: vês vários atletas ao mesmo tempo e os botões ficam maiores. É o modo recomendado.</li>
    <li><b>Modo Central</b>: cada atleta tem um cartão com um botão grande que muda sozinho para a próxima ação (ENTRADA/SAÍDA de cada estação).</li>
    <li><b>Modo Estação</b>: escolhe a estação; à esquerda quem está a entrar, à direita quem está a sair. Toca no atleta para registar.</li>
    <li>A app impede saídas antes de entradas, registos duplicados e saltar etapas — o botão só permite a ação seguinte.</li>
    <li><b>↶ Voltar atrás</b> anula o último registo em qualquer fase (corrida, entrada, saída ou finalização). Pede confirmação, mostra exatamente o que vai anular, e o cronómetro <b>continua desde a partida</b> — não reinicia. O registo anulado fica na auditoria e todos os tempos e classificações são recalculados.</li></ul>
    <h3>4. Penalizações & validação</h3>
    <ul><li>Adiciona penalizações a qualquer momento em <b>Penalizações</b> ou na validação final.</li>
    <li>Quando o atleta acaba os Wall Balls fica <b>A aguardar validação</b>. No cartão, valida sem penalizações ou revê-as antes de fechar.</li>
    <li>O tempo final oficial = tempo bruto + penalizações. O tempo bruto nunca é alterado.</li></ul>
    <h3>5. Resultados & relatórios</h3>
    <ul><li><b>Classificações</b>: final, por corrida e por estação — sempre separadas por prova, com empates à posição desportiva (1.º, 2.º, 2.º, 4.º).</li>
    <li><b>Relatórios</b>: relatório individual com gráficos, pontos fortes/a melhorar e exportação PDF, Excel, imagem e resumo WhatsApp.</li>
    <li><b>Admin → Exportar Excel geral</b>: livro com todas as folhas (atletas, classificação, corridas, ritmos, posições, estações, penalizações, relatórios, histórico).</li>
    <li><b>Placar</b>: mostra as quatro provas ao vivo num ecrã. Clica em <i>Abrir num ecrã</i>, arrasta a janela para a TV e põe em ecrã inteiro — atualiza sozinho enquanto cronometras. Funciona offline entre janelas do mesmo computador; para uma TV separada, usa a sincronização Supabase.</li></ul>
    <div class="callout">Tudo funciona offline. Os dados ficam guardados neste dispositivo/navegador. Para sincronizar vários dispositivos, consulta o ficheiro <code>supabase_schema.sql</code> e <code>README.md</code>.</div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 12. MODAIS DE FORMULÁRIO
 * ------------------------------------------------------------------ */
function atletaModal(aid, preVaga){
  const a = aid?atleta(aid):null;
  const selVaga = a? a.vagaId : (preVaga||'');
  const provaOpts=state.provas.map(p=>`<option value="${p.id}" ${a&&a.provaId===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
  const vagaOpts=`<option value="">— sem vaga —</option>`+state.vagas.map(v=>`<option value="${v.id}" ${selVaga===v.id?'selected':''}>${esc(v.nome)}</option>`).join('');
  const provaTag=p=>p?`${p.genero||'—'} · ${p.categoria||'—'}`:'—';
  const initialProva = a? prova(a.provaId) : (state.provas[0]);
  const back=openModal(`
    <div class="mhead"><h3>${a?'Editar atleta':'Novo atleta'}</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><div class="form-grid">
      <label class="field full"><span>Nome <span class="req">*</span></span><input type="text" id="m_nome" value="${a?esc(a.nome):''}"></label>
      <label class="field"><span>Dorsal</span><input type="text" id="m_dorsal" value="${a?esc(a.dorsal):''}"></label>
      <label class="field"><span>Prova</span><select id="m_prova">${provaOpts}</select></label>
      <label class="field"><span>Género / Tipo (da prova)</span><input type="text" id="m_provatag" value="${esc(provaTag(initialProva))}" disabled></label>
      <label class="field"><span>Vaga</span><select id="m_vaga">${vagaOpts}</select></label>
      <label class="field"><span>Hora prevista</span><input type="text" id="m_hora" value="${a?esc(a.horaPrevista||''):(vaga(selVaga)||{}).horaPrevista||''}" placeholder="09:00"></label>
      <label class="field"><span>Pista</span><input type="text" id="m_pista" value="${a?esc(a.pista||''):''}"></label>
      <label class="field full"><span>Observações</span><textarea id="m_obs">${a?esc(a.obs||''):''}</textarea></label>
    </div>
    <div class="callout" style="margin-top:6px">O género e o tipo (PRO/HALF/OPEN/…) vêm da prova escolhida. Ao escolher uma vaga, a hora prevista é preenchida automaticamente.</div>
    </div>
    <div class="mfoot">
      ${a?`<button class="btn danger ghost" data-delatl>Eliminar atleta</button>`:''}
      <div style="flex:1"></div>
      <button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Guardar</button></div>`);
  // prova muda -> atualiza etiqueta género/tipo
  back.querySelector('#m_prova').addEventListener('change', e=>{
    back.querySelector('#m_provatag').value = provaTag(prova(e.target.value));
  });
  // vaga muda -> preenche hora automaticamente
  back.querySelector('#m_vaga').addEventListener('change', e=>{
    const v=vaga(e.target.value); if(v && v.horaPrevista) back.querySelector('#m_hora').value=v.horaPrevista;
  });
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  const del=back.querySelector('[data-delatl]');
  if(del) del.addEventListener('click',()=>{
    confirmModal('Eliminar atleta?', `Vais eliminar <b>${esc(a.nome)}</b> (dorsal ${esc(a.dorsal||'—')}) e todos os seus registos e penalizações. Esta ação não pode ser anulada.`, ()=>{
      const ov=vaga(a.vagaId); if(ov) ov.athletes=ov.athletes.filter(x=>x!==a.id);
      state.penalties=state.penalties.filter(p=>p.athleteId!==a.id);
      state.atletas=state.atletas.filter(x=>x.id!==a.id);
      logAudit({type:'edicao',athleteId:a.id,note:'Atleta eliminado: '+a.nome});
      persist(); closeModal(); render(); toast('Atleta eliminado','ok');
    }, 'Eliminar atleta');
  });
  back.querySelector('[data-save]').addEventListener('click',()=>{
    const g=id=>back.querySelector(id).value.trim();
    const nome=g('#m_nome'); if(!nome){ toast('Nome obrigatório','err'); return; }
    const pid=g('#m_prova'); const p=prova(pid)||{};
    const data={ nome, dorsal:g('#m_dorsal'), provaId:pid,
      genero:p.genero||'', categoria:p.categoria||'',      // herdados da prova
      vagaId:g('#m_vaga'), horaPrevista:g('#m_hora'), pista:g('#m_pista'), obs:g('#m_obs') };
    if(a){
      const changes={}; Object.keys(data).forEach(k=>{ if(a[k]!==data[k]) changes[k]={from:a[k],to:data[k]}; });
      if(a.vagaId!==data.vagaId){ const ov=vaga(a.vagaId); if(ov) ov.athletes=ov.athletes.filter(x=>x!==a.id); const nv=vaga(data.vagaId); if(nv&&!nv.athletes.includes(a.id)) nv.athletes.push(a.id); }
      Object.assign(a,data);
      a.history=a.history||[]; if(Object.keys(changes).length){ a.history.push({ts:now(),operador:state.config.operador,changes}); logAudit({type:'edicao',athleteId:a.id,note:'Atleta editado: '+Object.keys(changes).join(', ')}); }
    }else{
      const na={ id:uid('atl'), ...data, status:'nao_iniciado', marks:[], history:[] };
      state.atletas.push(na); const nv=vaga(data.vagaId); if(nv) nv.athletes.push(na.id);
      logAudit({type:'criacao',athleteId:na.id,note:'Atleta criado'});
    }
    persist(); closeModal(); render(); toast('Guardado','ok');
  });
}

function vagaModal(vid){
  const v=vid?vaga(vid):null;
  // seleção local (aplica-se ao Guardar) — funciona para vaga nova e existente
  const selected = new Set(v? v.athletes.slice() : []);
  const chips = state.atletas.length
    ? state.atletas.slice().sort((a,b)=>(a.dorsal||'').localeCompare(b.dorsal||'','pt',{numeric:true}))
        .map(a=>{ const inOther = a.vagaId && a.vagaId!==vid;
          return `<button type="button" class="chip-toggle ${selected.has(a.id)?'on':''}" data-togglea="${a.id}">${esc(a.dorsal||'—')} ${esc(a.nome)}${inOther?' <small style="opacity:.6">(outra vaga)</small>':''}</button>`; }).join('')
    : '<span class="sub">Ainda não há atletas criados. Cria-os primeiro e depois adiciona-os aqui.</span>';
  const back=openModal(`
    <div class="mhead"><h3>${v?'Editar vaga':'Nova vaga'}</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><div class="form-grid">
      <label class="field full"><span>Nome da vaga</span><input type="text" id="v_nome" value="${v?esc(v.nome):''}" placeholder="Vaga 1 — 09:00"></label>
      <label class="field"><span>Hora prevista</span><input type="text" id="v_hora" value="${v?esc(v.horaPrevista||''):''}" placeholder="09:00"></label>
    </div>
    <div style="margin-top:14px"><div class="k" style="font-size:11px;color:var(--faint);text-transform:uppercase;font-weight:800;margin-bottom:8px">Atletas nesta vaga — toca para adicionar/remover</div>
      <div class="pill-select" id="v_chips">${chips}</div>
      <div class="callout" style="margin-top:8px">Podes adicionar aqui atletas já criados. Um atleta selecionado passa a pertencer a esta vaga (sai da anterior). Ao guardar, a hora prevista da vaga é aplicada a esses atletas.</div>
    </div>
    </div>
    <div class="mfoot">${v?`<button class="btn danger ghost" data-delvaga2>Eliminar vaga</button>`:''}<div style="flex:1"></div><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Guardar</button></div>`);
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  back.querySelectorAll('[data-togglea]').forEach(b=>b.addEventListener('click',()=>{
    const aid=b.getAttribute('data-togglea');
    if(selected.has(aid)) selected.delete(aid); else selected.add(aid);
    b.classList.toggle('on');
  }));
  const del2=back.querySelector('[data-delvaga2]');
  if(del2) del2.addEventListener('click',()=>{ confirmModal('Eliminar vaga?','Os atletas não são apagados, apenas ficam sem vaga.',()=>{ v.athletes.forEach(aid=>{ if(atleta(aid)) atleta(aid).vagaId=''; }); state.vagas=state.vagas.filter(x=>x.id!==vid); persist(); closeModal(); render(); toast('Vaga eliminada','ok'); },'Eliminar vaga'); });
  back.querySelector('[data-save]').addEventListener('click',()=>{
    const nome=back.querySelector('#v_nome').value.trim()||'Nova vaga';
    const hora=back.querySelector('#v_hora').value.trim();
    let target=v;
    if(v){ v.nome=nome; v.horaPrevista=hora; }
    else { target={id:uid('vaga'),nome,horaPrevista:hora,athletes:[]}; state.vagas.push(target); }
    // aplica seleção: remove os que saíram, adiciona os novos, atualiza vagaId e hora
    const prev=new Set(target.athletes);
    // remover
    prev.forEach(aid=>{ if(!selected.has(aid)){ const a=atleta(aid); if(a && a.vagaId===target.id) a.vagaId=''; } });
    // adicionar
    selected.forEach(aid=>{ const a=atleta(aid); if(!a) return;
      if(a.vagaId && a.vagaId!==target.id){ const ov=vaga(a.vagaId); if(ov) ov.athletes=ov.athletes.filter(x=>x!==aid); }
      a.vagaId=target.id; if(hora) a.horaPrevista=hora;
    });
    target.athletes=[...selected];
    logAudit({type:'edicao',note:`Vaga guardada: ${nome} (${target.athletes.length} atletas)`});
    persist(); closeModal(); render(); toast('Vaga guardada','ok');
  });
}

function penaltyModal(preAid, preTarget){
  const atlOpts=state.atletas.map(a=>`<option value="${a.id}" ${preAid===a.id?'selected':''}>${esc(a.dorsal)} — ${esc(a.nome)}</option>`).join('');
  const typeOpts=state.penaltyTypes.map(t=>`<option value="${t.id}">${esc(t.label)} (${t.seconds}s)</option>`).join('');
  const targetOpts=`<option value="Geral">Geral</option>`+
    Array.from({length:8},(_,i)=>`<option value="Corrida ${i+1}">Corrida ${i+1}</option>`).join('')+
    STATIONS.map(s=>`<option value="${esc(s.name)}" ${preTarget===s.name?'selected':''}>${esc(s.name)}</option>`).join('');
  const back=openModal(`
    <div class="mhead"><h3>Adicionar penalização</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><div class="form-grid">
      <label class="field full"><span>Atleta</span><select id="p_atl">${atlOpts}</select></label>
      <label class="field"><span>Corrida / estação</span><select id="p_target">${targetOpts}</select></label>
      <label class="field"><span>Tipo</span><select id="p_type">${typeOpts}</select></label>
      <label class="field"><span>Nº de ocorrências</span><input type="number" id="p_count" value="1" min="1"></label>
      <label class="field"><span>Segundos por ocorrência</span><input type="number" id="p_sec" value="${state.penaltyTypes[0].seconds}" min="0"></label>
      <label class="field"><span>Juiz responsável</span><input type="text" id="p_juiz" value="${esc(state.config.operador)}"></label>
      <label class="field full"><span>Observação</span><input type="text" id="p_obs"></label>
      <div class="full" style="background:var(--surface-2);border-radius:10px;padding:12px;font-weight:800">Total: <span id="p_total" class="tnum">${state.penaltyTypes[0].seconds}</span> segundos</div>
    </div></div>
    <div class="mfoot"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Aplicar penalização</button></div>`);
  const upd=()=>{ const c=+back.querySelector('#p_count').value||0; const s=+back.querySelector('#p_sec').value||0; back.querySelector('#p_total').textContent=c*s; };
  back.querySelector('#p_type').addEventListener('change',e=>{ const t=state.penaltyTypes.find(x=>x.id===e.target.value); if(t){ back.querySelector('#p_sec').value=t.seconds; upd(); } });
  back.querySelector('#p_count').addEventListener('input',upd);
  back.querySelector('#p_sec').addEventListener('input',upd);
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  back.querySelector('[data-save]').addEventListener('click',()=>{
    const aid=back.querySelector('#p_atl').value; const type=state.penaltyTypes.find(x=>x.id===back.querySelector('#p_type').value);
    const count=+back.querySelector('#p_count').value||1; const sec=+back.querySelector('#p_sec').value||0;
    const pn={ id:uid('pen'), athleteId:aid, target:back.querySelector('#p_target').value, typeId:type.id, typeLabel:type.label,
      count, seconds:sec, total:count*sec, juiz:back.querySelector('#p_juiz').value.trim(), obs:back.querySelector('#p_obs').value.trim(), ts:now() };
    state.penalties.push(pn);
    logAudit({type:'penalizacao',athleteId:aid,note:`${type.label} · ${pn.target} · ${pn.total}s`});
    persist(); closeModal(); render(); toast('Penalização aplicada','ok');
  });
}

function validateModal(aid){
  const a=atleta(aid); const sp=computeSplits(a);
  const fr=finalRanking(a.provaId); const provPos=(()=>{ const tmp=fr.ranked.find(r=>r.a.id===aid); return tmp?tmp.pos:'—'; })();
  const pens=penaltiesOf(aid);
  const back=openModal(`
    <div class="mhead"><h3>Validação — ${esc(a.nome)} (${esc(a.dorsal)})</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody">
      <div class="kpis" style="margin-bottom:14px">
        <div class="kpi"><div class="k">Tempo bruto</div><div class="v">${fmtDur(sp.bruto)}</div></div>
        <div class="kpi"><div class="k">Penalizações</div><div class="v">${fmtDur(penaltyTotal(aid))}</div></div>
        <div class="kpi"><div class="k">Tempo final oficial</div><div class="v">${fmtDur(officialMs(a))}</div></div>
        <div class="kpi"><div class="k">Posição provisória</div><div class="v">${provPos}º</div></div>
      </div>
      <div class="panel" style="box-shadow:none"><h3>Penalizações</h3>
        ${pens.length?`<ul class="bullets weak">${pens.map(p=>`<li><span class="dot"></span>${esc(p.typeLabel)} · ${esc(p.target)} — ${p.total}s</li>`).join('')}</ul>`:'<div class="sub" style="color:var(--muted)">Sem penalizações registadas.</div>'}
      </div>
    </div>
    <div class="mfoot">
      <button class="btn" data-addpen>Adicionar / rever penalizações</button>
      <button class="btn ghost" data-nopen>Sem penalizações</button>
      <button class="btn ok" data-validate2 style="font-weight:800">✔ Validar resultado</button>
    </div>`);
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  back.querySelector('[data-addpen]').addEventListener('click',()=>{ closeModal(); penaltyModal(aid); });
  const doValidate=()=>{ a.status='validado'; logAudit({type:'estado',athleteId:aid,note:'Resultado validado ('+fmtDur(officialMs(a))+')'}); persist(); closeModal(); render(); toast('Resultado validado e bloqueado','ok'); };
  back.querySelector('[data-nopen]').addEventListener('click',()=>{ confirmModal('Sem penalizações?','Confirmas que o atleta não tem penalizações e queres fechar o resultado?',doValidate,'Confirmar'); });
  back.querySelector('[data-validate2]').addEventListener('click',doValidate);
}

function correctionModal(aid){
  const a=atleta(aid); if(!a){ toast('Escolhe um atleta','err'); return; }
  const pts=regPoints(a.provaId);
  const opts=pts.map((p,i)=>`<option value="${i}" ${i>=a.marks.length?'disabled':''}>${esc(p.label)} — ${a.marks[i]!=null?fmtClockTime(a.marks[i]):'(sem registo)'}</option>`).join('');
  const back=openModal(`
    <div class="mhead"><h3>Correção manual — ${esc(a.nome)}</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><div class="form-grid">
      <label class="field full"><span>Registo a corrigir</span><select id="c_pt">${opts}</select></label>
      <label class="field"><span>Nova hora (HH:MM:SS)</span><input type="text" id="c_time" placeholder="09:14:32"></label>
      <label class="field"><span>Operador</span><input type="text" id="c_op" value="${esc(state.config.operador)}"></label>
      <label class="field full"><span>Motivo da correção</span><input type="text" id="c_reason" placeholder="ex.: clique tardio no juiz de estação"></label>
    </div><div class="callout" style="margin-top:10px">A hora original fica sempre guardada na auditoria — nada é apagado.</div></div>
    <div class="mfoot"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Guardar correção</button></div>`);
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  back.querySelector('[data-save]').addEventListener('click',()=>{
    const idx=+back.querySelector('#c_pt').value; const tstr=back.querySelector('#c_time').value.trim();
    const reason=back.querySelector('#c_reason').value.trim(); const op=back.querySelector('#c_op').value.trim();
    if(!/^\d{1,2}:\d{2}:\d{2}$/.test(tstr)){ toast('Hora inválida (HH:MM:SS)','err'); return; }
    if(!reason){ toast('Indica o motivo','err'); return; }
    const orig=new Date(a.marks[idx]!=null?a.marks[idx]:now()); const [h,m,s]=tstr.split(':').map(Number);
    orig.setHours(h,m,s,0);
    closeModal(); correctMark(aid, idx, orig.getTime(), reason, op);
  });
}

function stateModal(aid){
  const a=atleta(aid); if(!a){ toast('Escolhe um atleta','err'); return; }
  const back=openModal(`
    <div class="mhead"><h3>Alterar estado — ${esc(a.nome)}</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><div class="pill-select">
      ${['DNS','DNF','desclassificado'].map(s=>`<button class="chip-toggle ${a.status===s?'on':''}" data-set="${s}">${esc(STATES[s])}</button>`).join('')}
      <button class="chip-toggle" data-set="reset">Repor (voltar à prova)</button>
    </div></div>
    <div class="mfoot"><button class="btn ghost" data-close>Fechar</button></div>`);
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  back.querySelectorAll('[data-set]').forEach(b=>b.addEventListener('click',()=>{
    const s=b.getAttribute('data-set');
    if(s==='reset'){ a.status=deriveState({...a,status:''}); }
    else { a.status=s; }
    logAudit({type:'estado',athleteId:aid,note:'Estado → '+(STATES[s]||'reposto')});
    persist(); closeModal(); render(); toast('Estado alterado','ok');
  }));
}

function provaModal(pid){
  const p=pid?prova(pid):null;
  const order=p?p.stations.slice():DEFAULT_STATION_ORDER.slice();
  const GEN=[['M','Masculino'],['F','Feminino'],['Misto','Misto']];
  const TIPO=['PRO','HALF','OPEN','Outra'];
  const curGen=p?(p.genero||'M'):'M';
  const curTipo=p? (TIPO.includes(p.categoria)?p.categoria:'Outra') : 'PRO';
  const curOutra=p&&!TIPO.includes(p.categoria)?p.categoria:'';
  const genOpts=GEN.map(([v,l])=>`<option value="${v}" ${curGen===v?'selected':''}>${l}</option>`).join('');
  const tipoOpts=TIPO.map(t=>`<option value="${t}" ${curTipo===t?'selected':''}>${t}</option>`).join('');
  const back=openModal(`
    <div class="mhead"><h3>${p?'Editar prova':'Nova prova'}</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><div class="form-grid">
      <label class="field"><span>Género</span><select id="pr_gen">${genOpts}</select></label>
      <label class="field"><span>Tipo</span><select id="pr_tipo">${tipoOpts}</select></label>
      <label class="field ${curTipo==='Outra'?'':''}" id="pr_outra_wrap" style="${curTipo==='Outra'?'':'display:none'}"><span>Nome do tipo</span><input type="text" id="pr_outra" value="${esc(curOutra)}" placeholder="ex.: RELAY, ELITE…"></label>
      <label class="field full"><span>Nome da prova</span><input type="text" id="pr_name" value="${p?esc(p.name):''}" placeholder="gerado automaticamente"></label>
    </div>
    <div class="callout" style="margin-top:6px">O nome é sugerido a partir do género e do tipo (ex.: “Individual Masculino PRO”). Os atletas herdam este género e tipo — não é preciso repetir por atleta.</div>
    <div style="margin-top:14px"><div class="k" style="font-size:11px;color:var(--faint);text-transform:uppercase;font-weight:800;margin-bottom:8px">Ordem das estações (arrasta para reordenar)</div>
      <div id="pr_order">${order.map(k=>`<div class="jrow" draggable="true" data-key="${k}" style="cursor:grab;min-height:48px;margin-bottom:6px"><span class="arrow">≡</span><div class="who"><b>${esc(STATION_NAME[k])}</b></div></div>`).join('')}</div></div>
    </div>
    <div class="mfoot">${p?`<button class="btn danger ghost" data-delprova>Eliminar prova</button>`:''}<div style="flex:1"></div><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Guardar</button></div>`);

  const genSel=back.querySelector('#pr_gen'), tipoSel=back.querySelector('#pr_tipo'),
        outraWrap=back.querySelector('#pr_outra_wrap'), outraInp=back.querySelector('#pr_outra'), nameInp=back.querySelector('#pr_name');
  let nameEdited = !!(p && p.name);   // se já existe nome, não sobrescrever automaticamente
  nameInp.addEventListener('input',()=>{ nameEdited=true; });
  const genLabel=v=> v==='M'?'Masculino': v==='F'?'Feminino':'Misto';
  const tipoVal=()=> tipoSel.value==='Outra' ? (outraInp.value.trim()||'Outra') : tipoSel.value;
  const suggestName=()=>{ if(nameEdited) return; nameInp.value = `Individual ${genLabel(genSel.value)} ${tipoVal()}`.trim(); };
  const syncOutra=()=>{ outraWrap.style.display = tipoSel.value==='Outra' ? '' : 'none'; };
  genSel.addEventListener('change',suggestName);
  tipoSel.addEventListener('change',()=>{ syncOutra(); suggestName(); });
  outraInp.addEventListener('input',suggestName);
  if(!p) suggestName();

  const cont=back.querySelector('#pr_order'); let dragEl=null;
  cont.querySelectorAll('.jrow').forEach(row=>{
    row.addEventListener('dragstart',()=>{ dragEl=row; row.style.opacity='.4'; });
    row.addEventListener('dragend',()=>{ row.style.opacity='1'; });
    row.addEventListener('dragover',e=>{ e.preventDefault(); const after=[...cont.children].find(c=>{ const r=c.getBoundingClientRect(); return e.clientY < r.top+r.height/2 && c!==dragEl; }); if(after) cont.insertBefore(dragEl,after); else cont.appendChild(dragEl); });
  });
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  const del=back.querySelector('[data-delprova]');
  if(del) del.addEventListener('click',()=>{ if(athletesInProva(pid).length){ toast('Prova tem atletas — não pode ser eliminada','err'); return; } confirmModal('Eliminar prova?','',()=>{ state.provas=state.provas.filter(x=>x.id!==pid); persist(); closeModal(); render(); }); });
  back.querySelector('[data-save]').addEventListener('click',()=>{
    const name=nameInp.value.trim()|| `Individual ${genLabel(genSel.value)} ${tipoVal()}`;
    const genero=genSel.value, categoria=tipoVal();
    const newOrder=[...cont.querySelectorAll('.jrow')].map(r=>r.getAttribute('data-key'));
    if(p){
      p.name=name; p.genero=genero; p.categoria=categoria; p.stations=newOrder;
      // propaga género/tipo aos atletas desta prova
      athletesInProva(p.id).forEach(a=>{ a.genero=genero; a.categoria=categoria; });
    }
    else state.provas.push({id:uid('prova'),name,genero,categoria,stations:newOrder});
    persist(); closeModal(); render(); toast('Prova guardada','ok');
  });
}

function ptypeModal(i){
  const t=i>-1?state.penaltyTypes[i]:{label:'',seconds:0,per:'ocorrência'};
  const back=openModal(`
    <div class="mhead"><h3>${i>-1?'Editar':'Novo'} tipo de penalização</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><div class="form-grid">
      <label class="field full"><span>Descrição</span><input type="text" id="t_label" value="${esc(t.label)}"></label>
      <label class="field"><span>Segundos</span><input type="number" id="t_sec" value="${t.seconds}"></label>
      <label class="field"><span>Por</span><input type="text" id="t_per" value="${esc(t.per)}"></label>
    </div></div>
    <div class="mfoot"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Guardar</button></div>`);
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  back.querySelector('[data-save]').addEventListener('click',()=>{
    const nt={ id:i>-1?state.penaltyTypes[i].id:uid('pt'), label:back.querySelector('#t_label').value.trim()||'Penalização', seconds:+back.querySelector('#t_sec').value||0, per:back.querySelector('#t_per').value.trim()||'ocorrência' };
    if(i>-1) state.penaltyTypes[i]=nt; else state.penaltyTypes.push(nt);
    persist(); closeModal(); render();
  });
}

function whatsappModal(aid){
  const txt=whatsappSummary(aid);
  const back=openModal(`
    <div class="mhead"><h3>Resumo para WhatsApp</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><textarea id="wa_txt" style="min-height:320px;font-family:var(--mono);font-size:13px">${esc(txt)}</textarea></div>
    <div class="mfoot"><button class="btn ghost" data-close>Fechar</button><button class="btn primary" data-copy>Copiar</button>
      <a class="btn dark" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Abrir WhatsApp</a></div>`);
  back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
  back.querySelector('[data-copy]').addEventListener('click',()=>{ const ta=back.querySelector('#wa_txt'); ta.select(); try{ navigator.clipboard.writeText(ta.value); }catch(e){ document.execCommand('copy'); } toast('Copiado','ok'); });
}

/* ------------------------------------------------------------------ *
 * 13. TESTES INTERNOS (lógica)
 * ------------------------------------------------------------------ */
/* Preenche as marcas de um atleta a partir de arrays de tempos (segundos). */
function fillMarks(a, startTs, runsSec, stationsSec){
  const marks=[startTs]; let t=startTs;
  for(let i=0;i<runsSec.length;i++){ t+=runsSec[i]*1000; marks.push(t); t+=stationsSec[i]*1000; marks.push(t); }
  a.marks=marks; a.status=deriveState(a); return a;
}

function runSelfTests(){
  const res=[]; const groups={};
  const ok=(g,n,c)=>{ (groups[g]=groups[g]||[]).push({n,c:!!c}); res.push({c:!!c}); };
  const backup = state;                          // guarda o estado real

  try{
    // ---- estado isolado (sandbox) ----
    const s = blankState(); s.config={...backup.config};
    const pidA='pf_pro', pidB='pm_pro';
    const mk=(id,nome,dorsal,pid)=>({id,nome,dorsal:String(dorsal),provaId:pid,genero:'F',categoria:'PRO',vagaId:'v1',horaPrevista:'09:00',pista:'1',obs:'',status:'nao_iniciado',marks:[],history:[]});
    s.vagas=[{id:'v1',nome:'Vaga T',horaPrevista:'09:00',athletes:['t1','t2','t3','tb1']}];
    const t1=mk('t1','Atleta Um',1,pidA), t2=mk('t2','Atleta Dois',2,pidA), t3=mk('t3','Atleta Três',3,pidA), tb1=mk('tb1','Atleta B',9,pidB);
    s.atletas=[t1,t2,t3,tb1];
    state=s;                                      // ativa sandbox

    const T0=1600000000000;
    // t1: corridas 60s, estações 120s (referência)
    fillMarks(t1,T0, Array(8).fill(60), Array(8).fill(120));
    // t2: corridas 65s, estações 110s
    fillMarks(t2,T0, Array(8).fill(65), Array(8).fill(110));
    // t3: corridas 55s, estações 130s
    fillMarks(t3,T0, Array(8).fill(55), Array(8).fill(130));
    // tb1 (outra prova): 50s / 100s
    fillMarks(tb1,T0, Array(8).fill(50), Array(8).fill(100));

    const sp1=computeSplits(t1);

    // 10. Fluxo principal + índices de tempo/estado
    ok('Fluxo','17 pontos de registo (2N+1)', totalPoints(pidA)===17);
    ok('Fluxo','8 corridas calculadas', sp1.runs.filter(v=>v!=null).length===8);
    ok('Fluxo','8 estações calculadas', sp1.stations.filter(v=>v!=null).length===8);
    ok('Fluxo','cada corrida = 60s', sp1.runs.every(v=>v===60000));
    ok('Fluxo','cada estação = 120s', sp1.stations.every(v=>v===120000));
    ok('Fluxo','tempo bruto = 1440s', sp1.bruto===(8*60+8*120)*1000);
    ok('Fluxo','tempo acumulado = fim − partida', (t1.marks[16]-t1.marks[0])===sp1.bruto);

    // Transições de estado passo a passo (num atleta limpo)
    const tf=mk('tf','Fluxo',99,pidA); state.atletas.push(tf);
    let seqOK=true, stateOK=true; const pts=regPoints(pidA);
    if(deriveState(tf)!=='nao_iniciado') stateOK=false;
    if(nextPoint(tf).label!=='INICIAR PROVA') seqOK=false;
    let cur=T0; tf.marks=[cur];
    for(let i=1;i<pts.length;i++){
      const st = deriveState(tf);
      const expl = (nextPoint(tf)||{}).type;                 // próxima ação esperada
      if(pts[i].type==='entrada' && st!=='em_corrida') stateOK=false;   // antes de entrar numa estação está a correr
      if((pts[i].type==='saida'||pts[i].type==='finish') && st!=='em_estacao') stateOK=false;
      if(expl!==pts[i].type) seqOK=false;
      cur += (pts[i].type==='entrada'?60000:120000); tf.marks.push(cur);
    }
    ok('Fluxo','estados corretos em cada passo', stateOK);
    ok('Fluxo','botão seguinte sempre correto', seqOK);
    ok('Fluxo','estado final = aguardar validação', deriveState(tf)==='aguardar_validacao');
    // remove tf do sandbox
    state.atletas=state.atletas.filter(a=>a.id!=='tf');

    // 11. Vários atletas em simultâneo — sem troca de timestamps
    ok('Simultâneos','t1/t2/t3 mantêm marcas independentes',
      t1.marks[16]!==t2.marks[16] && t2.marks[16]!==t3.marks[16] && computeSplits(t2).runs[0]===65000 && computeSplits(t3).stations[0]===130000);

    // 12. Cliques rápidos/duplicados — não ultrapassa o ponto final
    const td=mk('td','Duplo',98,pidA); fillMarks(td,T0,Array(8).fill(60),Array(8).fill(120));
    const beforeLen=td.marks.length; const guarded = progressOf(td)>=totalPoints(pidA);
    ok('Cliques','sequência completa bloqueia novos registos', guarded===true);
    ok('Cliques','anti-duplo-clique definido (350ms)', typeof lastTapAt==='number');

    // 13. Voltar atrás intensivo
    const tv=mk('tv','Undo',97,pidA); state.atletas.push(tv);
    fillMarks(tv,T0,[60,60,60,60,60,60,60,60],[120,120,120,120,120,120,120,120]);
    const startMark=tv.marks[0];
    // finalizar → voltar atrás
    tv.marks.pop(); tv.status=deriveState(tv);
    ok('Voltar atrás','após anular final volta a "numa estação"', deriveState(tv)==='em_estacao');
    ok('Voltar atrás','hora de partida intacta', tv.marks[0]===startMark);
    // estação → corrida → voltar (remove entrada da última estação → volta à corrida)
    tv.marks.pop(); tv.status=deriveState(tv);
    ok('Voltar atrás','anular entrada volta a "em corrida"', deriveState(tv)==='em_corrida');
    // re-registar corretamente reconstrói tudo
    let t=tv.marks[tv.marks.length-1]; t+=60000; tv.marks.push(t); t+=120000; tv.marks.push(t);
    tv.status=deriveState(tv);
    const spv=computeSplits(tv);
    ok('Voltar atrás','recálculo correto após re-registo', spv.bruto===(8*60+8*120)*1000 && spv.runs.every(v=>v===60000));
    state.atletas=state.atletas.filter(a=>a.id!=='tv');

    // 14/15. Penalizações
    state.penalties=[
      {id:'p1',athleteId:'t1',target:'Corrida 1',total:120},
      {id:'p2',athleteId:'t1',target:'Sled Push',total:30},
      {id:'p3',athleteId:'t1',target:'Burpee Broad Jumps',count:2,seconds:30,total:60},
    ];
    ok('Penalizações','2:00 + 0:30 + 2×0:30 = 3:30', penaltyTotal('t1')===210000);
    ok('Penalizações','oficial = bruto + 3:30', officialMs(t1)===sp1.bruto+210000);
    ok('Penalizações','sem penalizações: oficial = bruto', officialMs(t2)===computeSplits(t2).bruto);

    // 16. Validação bloqueia e reabrir recalcula
    t2.status='validado';
    ok('Validação','atleta validado entra na classificação', finalRanking(pidA).ranked.some(r=>r.a.id==='t2'));
    ok('Validação','validado preserva-se (bloqueado)', deriveState(t2)==='validado');
    t2.status='aguardar_validacao';                     // reabrir, como faz o Admin
    ok('Validação','reabrir repõe "aguardar validação"', deriveState(t2)==='aguardar_validacao');

    // 17. Quatro provas nunca se misturam
    ok('Classificações','classificação só inclui a própria prova', finalRanking(pidA).ranked.every(r=>r.a.provaId===pidA));
    ok('Classificações','atleta de outra prova não aparece', !finalRanking(pidA).ranked.some(r=>r.a.id==='tb1'));

    // Empates desportivos
    const tie=[{value:100000},{value:100000},{value:105000},{value:110000}]; assignPositions(tie);
    ok('Classificações','empate 1,1,3,4', tie.map(r=>r.pos).join(',')==='1,1,3,4');

    // 18/19. Ranking de estação e de corrida (menor tempo = 1.º, só a prova)
    const stRk=stationRanking(pidA,0);            // estação 0: t3=130 é o mais lento, t2=110 o mais rápido
    ok('Rankings','estação: menor tempo é 1.º', stRk.rows[0].a.id==='t2' && stRk.best===110000);
    ok('Rankings','estação compara só a mesma prova', stRk.rows.every(r=>r.a.provaId===pidA));
    const runRk=runRanking(pidA,0);               // corrida 0: t3=55 mais rápido
    ok('Rankings','corrida: menor tempo é 1.º', runRk.rows[0].a.id==='t3' && runRk.best===55000);
    ok('Rankings','posições atribuídas 1..n', runRk.rows.map(r=>r.pos).join(',')==='1,2,3');

    // 20. Médias / melhor / pior / ritmo
    const spm=computeSplits(t2);
    const runsV=spm.runs; const media=runsV.reduce((a,b)=>a+b,0)/8;
    ok('Médias','média das 8 corridas correta', media===65000);
    ok('Médias','melhor e pior corrida', Math.min(...runsV)===65000 && Math.max(...runsV)===65000);
    ok('Médias','ritmo médio = 1:05 /km (corrida de 1 km)', fmtPace(media)==='1:05 /km');

    // 21. Relatório individual gera sem erro e com dados
    let repOK=true; try{ const h=reportHTML('t1'); repOK = typeof h==='string' && h.indexOf('Tempo final')>-1; }catch(e){ repOK=false; }
    ok('Relatório','relatório individual gera com dados', repOK);

    // 25. Invariantes de integridade (stress)
    let noNeg=true, monot=true, seqLen=true;
    for(const a of [t1,t2,t3,tb1]){
      const sp=computeSplits(a);
      if(sp.runs.some(v=>v!=null&&v<0)||sp.stations.some(v=>v!=null&&v<0)) noNeg=false;
      for(let i=1;i<a.marks.length;i++) if(a.marks[i]<a.marks[i-1]) monot=false;
      if(a.marks.length!==17) seqLen=false;
    }
    ok('Integridade','sem tempos negativos', noNeg);
    ok('Integridade','marcas sempre crescentes', monot);
    ok('Integridade','sequência completa = 17 marcas', seqLen);

    // Exportações não lançam
    let expOK=true; try{ buildWorkbook([{name:'x',rows:[['a',1]]}]); toCSV([['a','b'],[1,2]]); whatsappSummary('t1'); }catch(e){ expOK=false; }
    ok('Exportações','Excel / CSV / WhatsApp geram sem erro', expOK);

  }catch(err){
    ok('Erro','execução dos testes sem exceção', false);
    console.error(err);
  }finally{
    state = backup;                                // repõe SEMPRE o estado real
  }

  const pass=res.filter(r=>r.c).length, total=res.length;
  const allGood = pass===total;
  const body = Object.entries(groups).map(([g,items])=>{
    const gp=items.filter(i=>i.c).length;
    return `<div style="margin:10px 0 4px;font-weight:800;color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.04em">${esc(g)} — ${gp}/${items.length}</div>`+
      items.map(i=>`<div class="a"><span class="t" style="color:${i.c?'var(--ok)':'var(--danger)'}">${i.c?'✔':'✗'}</span><span>${esc(i.n)}</span></div>`).join('');
  }).join('');
  const html=`<div class="mhead"><h3>Testes internos — ${pass}/${total} ${allGood?'✔':'⚠'}</h3><button class="close-x" data-close>×</button></div>
    <div class="mbody"><div class="callout" style="margin-bottom:10px;border-color:${allGood?'var(--ok)':'var(--danger)'}">${allGood?'Todos os testes passaram. A lógica de cronometragem, penalizações, classificações e exportações está consistente.':'Há testes falhados — ver abaixo.'}</div><div class="audit">${body}</div></div>
    <div class="mfoot"><button class="btn primary" data-close>Fechar</button></div>`;
  const back=openModal(html, true); back.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal));
}

/* ------------------------------------------------------------------ *
 * 14. ROUTER / RENDER
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * 13b. PLACAR (ecrã público — todas as provas ao vivo)
 * ------------------------------------------------------------------ */
let placarCfg = { cols:'auto', rotate:false, rotateIdx:0 };
let placarMode = false;      // true quando a janela abriu em #placar (ecrã dedicado)
let placarTimer = null;
let placarTick = 0;

function provaLeaderboard(p, topN){
  const fr=finalRanking(p.id);
  const inProva=athletesInProva(p.id);
  const finishedIds=new Set(fr.ranked.map(r=>r.a.id));
  const started=inProva.filter(a=>progressOf(a)>0 && !finishedIds.has(a.id) && !['DNS','DNF','desclassificado'].includes(a.status)).length;
  const rows=fr.ranked.slice(0, topN||8).map(r=>`
    <tr>
      <td class="pl-pos ${r.pos<=3?'m'+r.pos:''}">${r.pos}</td>
      <td class="pl-dor">${esc(r.a.dorsal||'')}</td>
      <td class="pl-name">${esc(r.a.nome)}</td>
      <td class="pl-time">${fmtDur(r.value)}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="pl-empty">Sem resultados ainda</td></tr>`;
  const flag = fr.classified ? (fr.provisional?`<span class="pl-flag prov">● PROVISÓRIO</span>`:`<span class="pl-flag final">● FINAL</span>`)
                             : `<span class="pl-flag wait">A aguardar</span>`;
  return `<div class="pl-card">
    <div class="pl-cardhead"><span class="pl-title">${esc(p.name)}</span>${flag}</div>
    <table class="pl-table"><thead><tr><th>#</th><th>Dorsal</th><th>Atleta</th><th>Tempo oficial</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="pl-cardfoot">${fr.classified} classificados${started?` · ${started} em prova`:''} · ${inProva.length} inscritos</div>
  </div>`;
}

function placarBodyHTML(display){
  const list = state.provas.slice();     // todas as provas, sempre
  let grid;
  if(display && placarCfg.rotate && list.length){
    const p=list[placarCfg.rotateIdx % list.length];
    grid=`<div class="pl-grid cols-1">${provaLeaderboard(p, 14)}</div>`;
  }else{
    const n=list.length;
    const cols = placarCfg.cols!=='auto' ? +placarCfg.cols : (n<=1?1:n<=4?2:3);
    const topN = display ? (cols>=3?7:9) : 6;
    grid=`<div class="pl-grid cols-${cols}">${list.map(p=>provaLeaderboard(p, topN)).join('')}</div>`;
  }
  return `
    <div class="pl-topbar">
      <div class="pl-brand"><svg class="pl-mark" viewBox="0 0 48 48" role="img" aria-label="CrossFit Viseu"><path d="M4 11 H15 L24 30 L33 11 H44 L29 41 H19 Z" fill="#E9501D"/></svg><div><b>HYROX SIMULATION</b><span>CrossFit Viseu · Resultados ao vivo</span></div></div>
      <span class="pl-clock tnum" id="pl-clock">${fmtClockTime(now())}</span>
    </div>
    ${grid}`;
}

function viewPlacar(){
  return `
    <div class="section-head"><h2>Placar (ecrã público)</h2><span class="sub">Todas as provas ao vivo — para TV ou projetor</span></div>
    <div class="toolbar no-print">
      <button class="btn primary" data-placar-open>⛶ Abrir num ecrã (nova janela)</button>
      <button class="btn" data-placar-full>Ecrã inteiro aqui</button>
      <span class="sub" style="color:var(--muted)">Colunas:</span>
      <button class="btn sm" data-placar-cols="auto">Auto</button>
      <button class="btn sm" data-placar-cols="1">1</button>
      <button class="btn sm" data-placar-cols="2">2</button>
      <button class="btn sm" data-placar-cols="3">3</button>
      <button class="btn sm" data-placar-rotate>Rodar provas: ${placarCfg.rotate?'ON':'OFF'}</button>
    </div>
    <div class="callout">Para uma TV ligada por cabo (HDMI): clica em <b>Abrir num ecrã</b>, arrasta a janela para a TV e carrega em <b>ecrã inteiro</b>. Atualiza sozinho em tempo real enquanto cronometras na janela principal. Para um dispositivo <b>separado</b> (outra TV com o seu próprio browser), é preciso a sincronização Supabase — ver <code>README.md</code>.</div>
    <div class="placar-preview" id="placar-preview">${placarBodyHTML(false)}</div>`;
}

function refreshPlacarNow(){
  if(placarMode){ const r=document.getElementById('placar-root'); if(r) r.innerHTML=placarBodyHTML(true); }
  else { const el=document.getElementById('placar-preview'); if(el) el.innerHTML=placarBodyHTML(false); }
}
function startPlacarLoop(){
  if(placarTimer) return;
  placarTimer=setInterval(()=>{
    const active = placarMode || state.ui.view==='placar';
    if(!active) return;
    if(placarMode){ try{ state=load(); }catch(_){} }   // ecrã dedicado apanha alterações de outra janela
    if(placarCfg.rotate){ placarTick++; if(placarTick%10===0) placarCfg.rotateIdx++; }
    refreshPlacarNow();
  }, 1000);
}
function openPlacarWindow(){
  const url=location.href.split('#')[0]+'#placar';
  window.open(url,'hyrox_placar');
}
function toggleFullscreen(){
  try{
    if(!document.fullscreenElement){ const el=document.documentElement; (el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el); }
    else { (document.exitFullscreen||document.webkitExitFullscreen||function(){}).call(document); }
  }catch(e){}
}
function enterPlacarMode(){
  placarMode=true;
  document.documentElement.setAttribute('data-theme','dark');
  document.body.classList.add('placar-mode');
  const root=document.createElement('div'); root.id='placar-root'; root.className='placar-root';
  root.innerHTML=placarBodyHTML(true);
  document.body.appendChild(root);
  const ctl=document.createElement('div'); ctl.className='placar-ctl no-print';
  ctl.innerHTML=`<button class="btn sm" data-placar-full>⛶ Ecrã inteiro</button>
    <button class="btn sm" data-placar-cols="auto">Auto</button>
    <button class="btn sm" data-placar-cols="2">2</button>
    <button class="btn sm" data-placar-cols="3">3</button>
    <button class="btn sm" data-placar-rotate>Rodar: ${placarCfg.rotate?'ON':'OFF'}</button>
    <button class="btn sm ghost" data-placar-exit>Sair</button>`;
  document.body.appendChild(ctl);
}



const NAV=[['central','Central'],['station','Estação'],['vagas','Vagas e Atletas'],['rankings','Classificações'],['placar','Placar'],['reports','Relatórios'],['penalties','Penalizações'],['admin','Admin'],['help','Ajuda']];

function render(){
  document.documentElement.setAttribute('data-theme', state.config.theme);
  const nav=document.getElementById('nav');
  nav.innerHTML=NAV.map(([k,l])=>`<button class="${state.ui.view===k?'active':''}" data-view="${k}">${l}</button>`).join('');
  let html='';
  switch(state.ui.view){
    case 'central': html=viewCentral(); break;
    case 'station': html=viewStation(); break;
    case 'vagas': html=viewVagas(); break;
    case 'rankings': html=viewRankings(); break;
    case 'placar': html=viewPlacar(); break;
    case 'reports': html=viewReports(); break;
    case 'penalties': html=viewPenalties(); break;
    case 'admin': html=viewAdmin(); break;
    case 'help': html=viewHelp(); break;
  }
  document.getElementById('main').innerHTML=html;
}

/* clock + live timers */
function tick(){
  const c=document.getElementById('clock');
  if(c){ const d=new Date(); c.firstChild.nodeValue=`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  document.querySelectorAll('.js-livetimer').forEach(el=>{
    const base=el.getAttribute('data-base'); const since=el.getAttribute('data-since');
    const ref = base!=null && base!=='null' ? +base : +since;
    if(!isNaN(ref)) el.textContent=fmtDur(now()-ref);
  });
}

/* ------------------------------------------------------------------ *
 * 15. EVENTOS (delegação)
 * ------------------------------------------------------------------ */
function on(sel, ev, fn){ document.addEventListener(ev, e=>{ const t=e.target.closest(sel); if(t) fn(t,e); }); }

document.addEventListener('click', e=>{
  const el=e.target.closest('[data-view],[data-next],[data-undo],[data-report],[data-validate],[data-station],[data-prova],[data-ranksub],[data-startatl],[data-startvaga],[data-newvaga],[data-editvaga],[data-delvaga],[data-newatleta],[data-editatl],[data-addtovaga],[data-newpen],[data-delpen],[data-pdf],[data-repexcel],[data-shareimg],[data-whats],[data-adminlogin],[data-loaddemo],[data-stress],[data-simulate],[data-expall],[data-backup],[data-reset],[data-importcsv-btn],[data-newprova],[data-editprova],[data-newptype],[data-editptype],[data-corrmark],[data-setstate],[data-reopen],[data-runtests],[data-expfinalcsv],[data-theme-toggle],[data-op],[data-placar-open],[data-placar-full],[data-placar-cols],[data-placar-rotate],[data-placar-exit],[data-synctoggle],[data-synctest],[data-synclink]');
  if(!el) return;
  const A=n=>el.getAttribute(n);
  if(A('data-view')!=null){ state.ui.view=A('data-view'); adminUnlocked = adminUnlocked; persist(); render(); return; }
  if(A('data-next')!=null){ registerNext(A('data-next')); return; }
  if(A('data-undo')!=null){ undoLast(A('data-undo')); return; }
  if(A('data-report')!=null){ state.ui.view='reports'; state.ui.reportAthlete=A('data-report'); persist(); render(); return; }
  if(A('data-validate')!=null){ validateModal(A('data-validate')); return; }
  if(A('data-station')!=null){ state.ui.stationScreen=A('data-station'); persist(); render(); return; }
  if(A('data-prova')!=null){ state.ui.prova=A('data-prova'); persist(); render(); return; }
  if(A('data-ranksub')!=null){ state.ui.rankSub=A('data-ranksub'); persist(); render(); return; }
  if(A('data-startatl')!=null){ startAthlete(A('data-startatl')); return; }
  if(A('data-startvaga')!=null){ confirmModal('Iniciar toda a vaga?','Vais dar partida simultânea a todos os atletas ainda não iniciados desta vaga.',()=>startVaga(A('data-startvaga')),'Iniciar'); return; }
  if(A('data-newvaga')!=null){ vagaModal(null); return; }
  if(A('data-editvaga')!=null){ vagaModal(A('data-editvaga')); return; }
  if(A('data-delvaga')!=null){ const v=A('data-delvaga'); confirmModal('Eliminar vaga?','Os atletas não são apagados, apenas ficam sem vaga.',()=>{ vaga(v).athletes.forEach(aid=>{ if(atleta(aid)) atleta(aid).vagaId=''; }); state.vagas=state.vagas.filter(x=>x.id!==v); persist(); render(); }); return; }
  if(A('data-newatleta')!=null){ atletaModal(null); return; }
  if(A('data-editatl')!=null){ atletaModal(A('data-editatl')); return; }
  if(A('data-addtovaga')!=null){ atletaModal(null, A('data-addtovaga')); return; }
  if(A('data-newpen')!=null){ penaltyModal(); return; }
  if(A('data-delpen')!=null){ const id=A('data-delpen'); state.penalties=state.penalties.filter(x=>x.id!==id); persist(); render(); toast('Penalização removida','ok'); return; }
  if(A('data-pdf')!=null){ toast('A preparar impressão/PDF…','info'); setTimeout(()=>window.print(),150); return; }
  if(A('data-repexcel')!=null){ exportAthleteExcel(A('data-repexcel')); return; }
  if(A('data-shareimg')!=null){ shareImage(A('data-shareimg')); return; }
  if(A('data-whats')!=null){ whatsappModal(A('data-whats')); return; }
  if(A('data-expfinalcsv')!=null){ exportFinalCSV(A('data-expfinalcsv')); return; }
  if(A('data-adminlogin')!=null){ const pw=document.getElementById('adminpw').value; if(pw===state.config.adminPass){ adminUnlocked=true; render(); } else toast('Palavra-passe incorreta','err'); return; }
  if(A('data-loaddemo')!=null){ confirmModal('Carregar dados de teste?','Isto substitui os dados atuais por 8 atletas e 2 vagas de exemplo.',loadDemo,'Carregar'); return; }
  if(A('data-stress')!=null){ confirmModal('Criar prova de teste?','Substitui os dados atuais por 20 atletas fictícios distribuídos pelas 4 provas e 2 vagas.',()=>loadStressTest(20),'Criar'); return; }
  if(A('data-simulate')!=null){ confirmModal('Simular prova completa?','Preenche automaticamente todos os tempos (corridas, estações, algumas penalizações) dos atletas ainda não terminados e valida uma parte. Ideal para testar classificações e relatórios.',()=>simulateFullProva(),'Simular'); return; }
  if(A('data-expall')!=null){ exportAllExcel(); return; }
  if(A('data-backup')!=null){ download('hyrox_backup_'+Date.now()+'.json', JSON.stringify(state,null,2), 'application/json'); toast('Cópia de segurança criada','ok'); return; }
  if(A('data-reset')!=null){ confirmModal('Apagar tudo?','Esta ação limpa todos os atletas, registos e resultados deste dispositivo. Faz uma cópia de segurança antes.',()=>{ state=blankState(); adminUnlocked=false; persist(); render(); toast('Tudo apagado','ok'); },'Apagar tudo'); return; }
  if(A('data-importcsv-btn')!=null){ document.querySelector('[data-importcsv]').click(); return; }
  if(A('data-newprova')!=null){ provaModal(null); return; }
  if(A('data-editprova')!=null){ provaModal(A('data-editprova')); return; }
  if(A('data-newptype')!=null){ ptypeModal(-1); return; }
  if(A('data-editptype')!=null){ ptypeModal(+A('data-editptype')); return; }
  if(A('data-corrmark')!=null){ correctionModal(document.getElementById('corratl').value); return; }
  if(A('data-setstate')!=null){ stateModal(document.getElementById('corratl').value); return; }
  if(A('data-reopen')!=null){ const aid=document.getElementById('corratl').value; const a=atleta(aid); if(!a){toast('Escolhe um atleta','err');return;} if(a.status!=='validado'){toast('Resultado não está validado','info');return;} confirmModal('Reabrir resultado?','O resultado volta a "A aguardar validação".',()=>{ a.status='aguardar_validacao'; logAudit({type:'estado',athleteId:aid,note:'Resultado reaberto'}); persist(); render(); toast('Resultado reaberto','ok'); }); return; }
  if(A('data-runtests')!=null){ runSelfTests(); return; }
  if(A('data-theme-toggle')!=null){ state.config.theme=state.config.theme==='dark'?'light':'dark'; persist(); render(); return; }
  if(A('data-placar-open')!=null){ openPlacarWindow(); return; }
  if(A('data-placar-full')!=null){ toggleFullscreen(); return; }
  if(A('data-placar-cols')!=null){ placarCfg.cols=A('data-placar-cols'); refreshPlacarNow(); return; }
  if(A('data-placar-rotate')!=null){ placarCfg.rotate=!placarCfg.rotate; placarCfg.rotateIdx=0; placarTick=0;
    if(placarMode){ const b=document.querySelector('.placar-ctl [data-placar-rotate]'); if(b) b.textContent='Rodar: '+(placarCfg.rotate?'ON':'OFF'); refreshPlacarNow(); }
    else render();
    return; }
  if(A('data-placar-exit')!=null){ location.hash=''; location.reload(); return; }
  if(A('data-synctoggle')!=null){
    state.config.syncEnabled=!state.config.syncEnabled;
    if(state.config.syncEnabled && !syncActive()){ toast('Preenche URL, chave e código de sessão','err'); state.config.syncEnabled=false; }
    persist();
    if(state.config.syncEnabled){ SYNC.lastAppliedRev=0; SYNC.lastKnownRev=0; startSync(); toast('Sincronização ligada','ok'); }
    else { if(SYNC.timer) clearInterval(SYNC.timer); SYNC.timer=null; setSyncStatus('off'); toast('Sincronização desligada','info'); }
    render(); return;
  }
  if(A('data-synctest')!=null){ syncTest(); return; }
  if(A('data-synclink')!=null){
    if(!syncActive()){ toast('Liga a sincronização primeiro','err'); return; }
    const link=syncViewerLink();
    try{ navigator.clipboard.writeText(link); toast('Link do ecrã copiado','ok'); }
    catch(e){ openModal(`<div class="mhead"><h3>Link do ecrã (TV)</h3><button class="close-x" data-close>×</button></div><div class="mbody"><p class="sub">Copia este endereço e abre-o no dispositivo/TV:</p><textarea style="min-height:120px">${esc(link)}</textarea></div><div class="mfoot"><button class="btn primary" data-close>Fechar</button></div>`).querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeModal)); }
    return;
  }
});

/* selects / inputs de filtro e config */
document.addEventListener('change', e=>{
  const t=e.target;
  if(t.matches('[data-f]')){ const k=t.getAttribute('data-f'); state.ui[k]=t.value; persist(); render(); return; }
  if(t.matches('[data-cfg]')){ const k=t.getAttribute('data-cfg'); let v=t.value; if(v==='true')v=true; if(v==='false')v=false; state.config[k]=v; persist(); if(k==='tie'||k==='operador') render(); toast('Definição guardada','ok'); return; }
  if(t.matches('[data-importcsv]')){ const f=t.files[0]; if(f){ const r=new FileReader(); r.onload=()=>importAthletesCSV(r.result); r.readAsText(f,'utf-8'); } t.value=''; return; }
  if(t.matches('[data-restore]')){ const f=t.files[0]; if(f){ const r=new FileReader(); r.onload=()=>{ try{ const s=JSON.parse(r.result); state={...blankState(),...s}; persist(); render(); toast('Dados restaurados','ok'); }catch(err){ toast('Ficheiro inválido','err'); } }; r.readAsText(f); } t.value=''; return; }
  if(t.matches('[data-moveatl]')){ const aid=t.getAttribute('data-moveatl'); moveAthleteToVaga(aid, t.value); return; }
});

function moveAthleteToVaga(aid, newVagaId){
  const a=atleta(aid); if(!a) return;
  const oldV=vaga(a.vagaId); if(oldV) oldV.athletes=oldV.athletes.filter(x=>x!==aid);
  a.vagaId=newVagaId||'';
  const nv=vaga(newVagaId); if(nv && !nv.athletes.includes(aid)) nv.athletes.push(aid);
  logAudit({type:'edicao',athleteId:aid,note:'Movido para '+(nv?nv.nome:'sem vaga')});
  persist(); render(); toast('Atleta movido para '+(nv?nv.nome:'sem vaga'),'ok');
}

/* Sincronização entre janelas do mesmo computador (ex.: TV noutra janela) */
window.addEventListener('storage', e=>{
  if(e.key!==STORE_KEY) return;
  if(placarMode){ try{ state=load(); }catch(_){}
    const r=document.getElementById('placar-root'); if(r) r.innerHTML=placarBodyHTML(true); }
  else if(state.ui.view==='placar'){ try{ state=load(); }catch(_){}
    const el=document.getElementById('placar-preview'); if(el) el.innerHTML=placarBodyHTML(false); }
});

/* ------------------------------------------------------------------ *
 * 16. ARRANQUE
 * ------------------------------------------------------------------ */
function boot(){
  const hadToken = applySyncTokenFromURL();   // ?sync=… → configura como viewer
  // Modo ecrã público dedicado (#placar) — não corre a app de cronometragem
  if(location.hash==='#placar'){
    enterPlacarMode();
    startPlacarLoop();
    if(syncActive()) startSync();             // ecrã liga-se ao Supabase (Cenário B)
    if('serviceWorker' in navigator && location.protocol.startsWith('http')){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
    return;
  }
  render();
  setInterval(tick, 250);
  startPlacarLoop();
  if(syncActive()) startSync();
  if(hadToken) toast('Ligado à sessão em modo visualização','ok');
  // service worker (só quando servido por http/https)
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
  // botão tema no topo
  document.getElementById('themeBtn').addEventListener('click',()=>{ state.config.theme=state.config.theme==='dark'?'light':'dark'; persist(); render(); });
}
document.addEventListener('DOMContentLoaded', boot);
