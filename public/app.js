(()=>{
'use strict';
const $=id=>document.getElementById(id);
let token=localStorage.getItem('jarvis_remote_token')||'';
let verified=true, liveTimer=null, recognition=null, alwaysListening=false, recognitionStarting=false;
let visionStream=null, visionFacing='environment';
let followupUntil=0, wakeArmedUntil=0, lastEventId=0, deferredInstall=null, speakingNow=false, restartTimer=null, currentLanguage='english', lastSpokenText='';
const secureEls=['secureShell','composer'];

function toast(t){const e=$('toast');e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',2800)}
function auth(){return token?{'Authorization':'Bearer '+token}:{}}
async function api(path,opt={}){opt.headers={...(opt.headers||{}),...auth()};const r=await fetch(path,opt);let j={};try{j=await r.json()}catch{}if(!r.ok)throw Object.assign(new Error(j.error||('HTTP '+r.status)),{data:j,status:r.status});return j}
function setVoiceState(text,live=false){$('voiceState').textContent=text;$('voiceDot').classList.toggle('live',live)}
function showPaired(on){$('pairCard').classList.toggle('hidden',on);secureEls.forEach(id=>$(id).classList.toggle('hidden',!on));const f=$('faceCard');if(f)f.classList.add('hidden')}
function addBubble(who,text,meta=''){if(!text)return;const d=document.createElement('div');d.className='bubble '+(who==='me'?'me':'jarvis');d.textContent=text;if(meta){const m=document.createElement('div');m.className='meta';m.textContent=meta;d.appendChild(m)}$('chat').appendChild(d);$('chat').scrollTop=$('chat').scrollHeight}

function pauseRecognitionForSpeech(){if(recognition){try{recognition.stop()}catch{}}}
function speak(text){if(!$('speakReplies').checked||!('speechSynthesis'in window)||!text)return;speakingNow=true;pauseRecognitionForSpeech();speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=/[\u0D80-\u0DFF]/.test(text)?'si-LK':'en-GB';u.rate=1.0;u.onend=u.onerror=()=>{speakingNow=false;if(alwaysListening)scheduleRecognition(320)};speechSynthesis.speak(u)}

async function status(){try{const j=await api('/api/status');verified=true;currentLanguage=String(j.language||'english').toLowerCase();const room=j.room||{};const pc=j.pc||{};const pcText=pc.online?'<span class="ok">PC ONLINE</span>':'<span class="warn">PC STATUS SYNCING</span>';$('status').innerHTML=`${pcText} · CLOUD OWNER AUTHENTICATED`;showPaired(true);renderRoom(room);return j}catch(e){if(e.status===401){token='';localStorage.removeItem('jarvis_remote_token');verified=true;showPaired(false);$('status').textContent='LOGIN REQUIRED';stopAlwaysListen();return null}$('status').innerHTML='<span class="bad">CLOUD CONNECTION ERROR</span>';return null}}

async function globalLogin(){const password=$('globalPassword').value,device=$('deviceName').value.trim()||'Browser';if(!password)return toast('Enter your Global JARVIS password');try{const j=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,device})});token=j.token;localStorage.setItem('jarvis_remote_token',token);$('globalPassword').value='';verified=true;showPaired(true);toast('Owner login accepted. JARVIS unlocked.');addBubble('jarvis','Welcome back. Cloud JARVIS is unlocked.');await refreshRoom(false)}catch(e){toast(e.message)}}

async function pair(){const code=$('pairCode').value.trim(),device=$('deviceName').value.trim()||'Device';if(!/^\d{6}$/.test(code))return toast('Enter the 6-digit pair code');try{const j=await api('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,device})});token=j.token;localStorage.setItem('jarvis_remote_token',token);verified=true;showPaired(true);toast('Paired. JARVIS unlocked.');await refreshRoom(false)}catch(e){toast(e.message)}}

function capture(video,quality=.82){if(!video.videoWidth)throw new Error('Camera is not ready');const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);return c.toDataURL('image/jpeg',quality)}

async function sendCommand(text=null,source='text'){const raw=(text===null?$('commandText').value:text).trim();if(!raw)return;if(text===null)$('commandText').value='';addBubble('me',raw,source==='voice'?'voice':'text');try{const j=await api('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw,source})});const answer=j.response||j.reply||'Done.';addBubble('jarvis',answer,j.route||'remote');speak(answer);followupUntil=Date.now()+45000;wakeArmedUntil=followupUntil;await refreshRoom(false)}catch(e){addBubble('jarvis','Error: '+e.message);toast(e.message)}}

function speechCtor(){return window.SpeechRecognition||window.webkitSpeechRecognition||null}
function setupRecognition(){const SR=speechCtor();if(!SR){$('alwaysListen').disabled=true;$('voiceHelp').textContent='This browser does not expose continuous speech recognition. Text chat still works. On iPhone, keep Safari/PWA updated and use the text box if voice is unavailable.';return false}recognition=new SR();recognition.lang='en-US';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;recognition.onstart=()=>{recognitionStarting=false;setVoiceState('Listening for “Jarvis…”',true)};recognition.onerror=e=>{recognitionStarting=false;if(e.error==='not-allowed'||e.error==='service-not-allowed'){alwaysListening=false;$('alwaysListen').checked=false;setVoiceState('Microphone permission blocked',false);toast('Allow microphone access in browser settings');return}if(e.error!=='no-speech'&&e.error!=='aborted')toast('Voice: '+e.error)};recognition.onend=()=>{recognitionStarting=false;if(alwaysListening&&!speakingNow)scheduleRecognition(450)};recognition.onresult=e=>{let finalText='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript.trim();if(e.results[i].isFinal)finalText+=(finalText?' ':'')+t;else setVoiceState('Hearing: '+t,true)}if(finalText)handleRecognized(finalText)};return true}
function scheduleRecognition(ms=0){clearTimeout(restartTimer);restartTimer=setTimeout(()=>startRecognition(),ms)}
function startRecognition(){if(!alwaysListening||recognitionStarting)return;if(!recognition&&!setupRecognition())return;try{recognition.lang=currentLanguage==='sinhala'?'si-LK':'en-US';recognitionStarting=true;recognition.start()}catch{recognitionStarting=false}}
function stopAlwaysListen(){alwaysListening=false;if($('alwaysListen'))$('alwaysListen').checked=false;clearTimeout(restartTimer);if(recognition){try{recognition.stop()}catch{}}setVoiceState('Voice standby',false)}
function handleRecognized(transcript){
  const t=transcript.trim();
  const lower=t.toLowerCase();
  const wakes=['jarvis','javis','jarves','jervis','charvis','ජාර්විස්','ජාවිස්','ජවිස්','යාවිස්'];
  const stops=['enough','stop','stop talking','wait','hold on','හරි ඇති','ඇති','නවත්තන්න'];
  let idx=-1,wake='';
  for(const w of wakes){const i=lower.indexOf(w.toLowerCase());if(i>=0&&(idx<0||i<idx)){idx=i;wake=w}}

  if(speakingNow){
    const isStop=stops.some(x=>lower.includes(x));
    const hasWake=idx>=0;
    const echo=lastSpokenText&&lastSpokenText.includes(lower)&&lower.split(/\s+/).length<9;
    if((isStop||hasWake||(!echo&&lower.split(/\s+/).length>=2))&&'speechSynthesis'in window){
      speechSynthesis.cancel(); speakingNow=false; lastSpokenText='';
      followupUntil=Date.now()+45000; wakeArmedUntil=followupUntil;
      if(isStop&&!hasWake){setVoiceState('Interrupted — listening',true);return}
    } else if(echo){return}
  }

  let cmd='';
  if(idx>=0){
    cmd=t.slice(idx+wake.length).replace(/^[,\s.:;-]+/,'').trim();
    followupUntil=Date.now()+45000;
    wakeArmedUntil=Date.now()+15000;

    if(!cmd){
      setVoiceState('Yes? Listening…',true);
      if($('speakReplies').checked && 'speechSynthesis' in window){
        speakingNow=true;
        pauseRecognitionForSpeech();
        speechSynthesis.cancel();
        const u=new SpeechSynthesisUtterance('Yes?');
        u.lang='en-GB'; u.rate=1.0;
        u.onend=u.onerror=()=>{speakingNow=false;if(alwaysListening)scheduleRecognition(120)};
        speechSynthesis.speak(u);
      } else {
        try{recognition.stop()}catch{}
        if(alwaysListening)scheduleRecognition(120);
      }
      return;
    }
  } else if(Date.now()<wakeArmedUntil || Date.now()<followupUntil){
    cmd=t;
  } else {
    return;
  }

  if(cmd){
    wakeArmedUntil=Date.now()+15000;
    setVoiceState('Sending: '+cmd,true);
    sendCommand(cmd,'voice');
  }
}

function renderRoom(r){if(!r)return;const online=!!r.online;$('roomOnline').textContent=online?'ONLINE':'OFFLINE';$('roomOnline').style.color=online?'var(--ok)':'var(--bad)';$('lightState').textContent=(r.light||'unknown').toUpperCase()+(r.light_mode?' · MODE '+r.light_mode:'');const sp=Number(r.fan_speed||0);$('fanState').textContent=sp?'SPEED '+sp:'OFF'}
async function refreshRoom(showToast=false){try{const j=await api('/api/room/status');renderRoom(j);if(showToast)toast(j.online?'Room ESP32 online':'Room ESP32 offline')}catch(e){if(showToast)toast(e.message)}}
async function roomAction(action,value=null){const prev={light:$('lightState').textContent,fan:$('fanState').textContent};if(action==='light_on')$('lightState').textContent='ON';if(action==='light_off')$('lightState').textContent='OFF';if(action==='light_mode')$('lightState').textContent='ON · MODE '+value;if(action==='fan_off')$('fanState').textContent='OFF';if(action==='fan_speed')$('fanState').textContent='SPEED '+value;try{const j=await api('/api/room/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,value}),cache:'no-store'});renderRoom(j);const label=action==='fan_speed'?`Fan speed ${value}`:action==='light_mode'?`Light mode ${value}`:action.replaceAll('_',' ');addBubble('jarvis','✓ '+label);if($('speakReplies').checked)speak(label)}catch(e){$('lightState').textContent=prev.light;$('fanState').textContent=prev.fan;toast(e.message)}}

async function refreshScreen(){try{const r=await fetch('/api/screen',{headers:auth(),cache:'no-store'});if(!r.ok){let j={};try{j=await r.json()}catch{}throw Object.assign(new Error(j.error||'Screen request failed'),{status:r.status,data:j})}const b=await r.blob();const old=$('screenImg').dataset.url;if(old)URL.revokeObjectURL(old);const u=URL.createObjectURL(b);$('screenImg').src=u;$('screenImg').dataset.url=u;$('screenTime').textContent='Updated '+new Date().toLocaleTimeString()}catch(e){toast(e.message)}}
function toggleLive(){if(liveTimer){clearInterval(liveTimer);liveTimer=null;$('liveScreenBtn').textContent='Live: Off';return}refreshScreen();liveTimer=setInterval(refreshScreen,2200);$('liveScreenBtn').textContent='Live: On'}

async function openVisionCamera(f='environment'){if(visionStream)visionStream.getTracks().forEach(t=>t.stop());visionFacing=f;try{visionStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:f}},audio:false});$('visionCamera').srcObject=visionStream;$('visionBadge').textContent=f==='user'?'FRONT CAMERA':'BACK CAMERA'}catch(e){toast('Camera: '+e.message)}}
async function visionTask(task){try{if(!visionStream)await openVisionCamera('environment');const image=capture($('visionCamera'));$('visionResult').textContent='Analyzing…';const j=await api('/api/camera/vision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image,task})});$('visionResult').textContent=j.response||'';addBubble('jarvis',j.response||'');speak(j.response||'')}catch(e){$('visionResult').textContent=e.message;toast(e.message)}}

async function roots(){try{const j=await api('/api/files');$('roots').innerHTML='';(j.roots||[]).forEach(r=>{const b=document.createElement('button');b.textContent=r.name;b.onclick=()=>listFiles(r.name,'');$('roots').appendChild(b)})}catch(e){toast(e.message)}}
async function listFiles(root,path){try{const j=await api('/api/files?root='+encodeURIComponent(root)+'&path='+encodeURIComponent(path));$('fileList').innerHTML='';if(path){const up=path.split('/').slice(0,-1).join('/');const d=document.createElement('div');d.className='file';d.textContent='⬅ ..';d.onclick=()=>listFiles(root,up);$('fileList').appendChild(d)}(j.items||[]).forEach(it=>{const rel=(path?path+'/':'')+it.name;const d=document.createElement('div');d.className='file';const n=document.createElement('span');n.textContent=(it.is_dir?'📁 ':'📄 ')+it.name;d.appendChild(n);const b=document.createElement('button');b.textContent=it.is_dir?'Open':'Download';b.onclick=()=>{if(it.is_dir)return listFiles(root,rel);fetch('/api/download?root='+encodeURIComponent(root)+'&path='+encodeURIComponent(rel),{headers:auth()}).then(async r=>{if(!r.ok)throw new Error('Download failed');return r.blob()}).then(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=it.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000)}).catch(e=>toast(e.message))};d.appendChild(b);$('fileList').appendChild(d)})}catch(e){toast(e.message)}}
async function upload(){const f=$('uploadFile').files[0];if(!f)return toast('Choose a file');if(f.size>20*1024*1024)return toast('20 MB max');const rd=new FileReader();rd.onload=async()=>{try{const j=await api('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,data:rd.result})});toast('Uploaded: '+j.saved_as)}catch(e){toast(e.message)}};rd.readAsDataURL(f)}
async function pollEvents(){if(!token)return;try{const j=await api('/api/events?since='+lastEventId);lastEventId=j.last_id||lastEventId;(j.events||[]).forEach(ev=>{if(document.hidden&&Notification.permission==='granted')new Notification('JARVIS',{body:ev.text});else if(ev.text)addBubble('jarvis',ev.text,'notification')})}catch{}}
async function enableAlerts(){if(!('Notification'in window))return toast('Notifications are not supported here');const p=await Notification.requestPermission();toast(p==='granted'?'Alerts enabled':'Notification permission not granted')}


function setupTabs(){document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('[data-page]').forEach(p=>p.classList.toggle('active',p.dataset.page===b.dataset.tab));});}
function syncMicQuick(){const b=$('micQuickBtn');if(!b)return;b.classList.toggle('listening',!!alwaysListening);b.textContent=alwaysListening?'◉':'◎';b.title=alwaysListening?'Always listening: ON':'Always listening: OFF';}
if($('pairBtn'))$('pairBtn').onclick=pair;$('globalLoginBtn').onclick=globalLogin;
$('sendBtn').onclick=()=>sendCommand();$('commandText').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendCommand()}});
$('alwaysListen').onchange=e=>{alwaysListening=e.target.checked;if(alwaysListening){if(!recognition&&!setupRecognition()){e.target.checked=false;alwaysListening=false;syncMicQuick();return}followupUntil=0;startRecognition()}else stopAlwaysListen();syncMicQuick()};
$('micQuickBtn').onclick=()=>{const c=$('alwaysListen');c.checked=!c.checked;c.dispatchEvent(new Event('change'));};setupTabs();syncMicQuick();
$('speakReplies').onchange=()=>{if(!$('speakReplies').checked&&'speechSynthesis'in window)speechSynthesis.cancel()};$('stopVoiceBtn').onclick=()=>{if('speechSynthesis'in window)speechSynthesis.cancel();speakingNow=false;if(alwaysListening)scheduleRecognition(250)};
document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>sendCommand(b.dataset.cmd,'quick'));
document.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>roomAction(b.dataset.room,b.dataset.value?Number(b.dataset.value):null));$('refreshRoomBtn').onclick=()=>refreshRoom(true);
$('refreshScreenBtn').onclick=refreshScreen;$('liveScreenBtn').onclick=toggleLive;
$('openVisionCamBtn').onclick=()=>openVisionCamera('environment');$('switchVisionCamBtn').onclick=()=>openVisionCamera(visionFacing==='user'?'environment':'user');$('closeVisionCamBtn').onclick=()=>{if(visionStream)visionStream.getTracks().forEach(t=>t.stop());visionStream=null;$('visionCamera').srcObject=null};document.querySelectorAll('[data-vision]').forEach(b=>b.onclick=()=>visionTask(b.dataset.vision));
$('loadRootsBtn').onclick=roots;$('uploadBtn').onclick=upload;$('alertsBtn').onclick=enableAlerts;$('forgetDeviceBtn').onclick=()=>{localStorage.removeItem('jarvis_remote_token');token='';verified=false;showPaired(false);stopAlwaysListen();toast('Device token removed locally. Reset pairing on the PC to replace the paired device.')};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installBtn').classList.remove('hidden')});$('installBtn').onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installBtn').classList.add('hidden')};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&recognition){try{recognition.stop()}catch{}}else if(!document.hidden&&alwaysListening)scheduleRecognition(300)});
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
status().then(()=>refreshRoom(false));setInterval(status,8000);setInterval(pollEvents,4000);
})();
