/* Standalone multiplayer transport (replaces the claude.ai "room" capability).
   Works from any static web host, no server of your own:
   - Same browser: BroadcastChannel (tabs/windows).
   - Different computers: WebRTC peer-to-peer via PeerJS. First player in a room becomes the hub
     (PeerJS id "wormsrm-<room>"), others connect to it. If the hub leaves, someone takes over.
   - Optional: ?relay=wss://host:8787 uses the bundled WebSocket relay instead.
   - Optional: ?peerhost=&peerport=&peerpath=&peersecure=0|1 points PeerJS at your own PeerServer. */
window.WORMS_RELAY=window.WORMS_RELAY||''; // set at build time (see README)
(function(){
 if(window.claude)return;
 var qs=new URLSearchParams(location.search);
 var relay=qs.get('relay')||window.WORMS_RELAY||'';
 var PeerC=window.Peer||(window.peerjs&&window.peerjs.Peer);
 var useP2P=!relay&&PeerC&&qs.get('p2p')!=='0'&&typeof RTCPeerConnection!=='undefined';
 window.__transport=relay?'relay':(useP2P?'p2p':'tabs');
 var statEl=null,statTxt='';
 function setStat(t){statTxt=t;if(statEl)statEl.textContent=t}
 function peerOpts(){
  var o={debug:+qs.get('peerdebug')||0};
  if(qs.get('peerhost')){o.host=qs.get('peerhost');if(qs.get('peerport'))o.port=+qs.get('peerport');if(qs.get('peerpath'))o.path=qs.get('peerpath');o.secure=qs.get('peersecure')==='1'||(qs.get('peersecure')==null&&location.protocol==='https:')}
  return o;
 }
 function mkRoom(name){
  var me=Math.random().toString(36).slice(2,10),H={},cbs=[],pres={},peers={},ws=null,bc=null,q=[],dead=false,seq=0,seen={},seenQ=[];
  peers[me]={peer:me,presence:pres,seen:1e15};
  var role='',pp=null,conns=[],up=null,pq=[],pTimer=0,openTimer=0;
  var slug=(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'x').slice(0,40);
  var hubId='wormsrm-'+slug;
  function sendTo(c,o){try{if(c&&c.open)c.send(o)}catch(e){}}
  function raw(o){
   o.room=name;o.q=++seq;
   if(relay){var s=JSON.stringify(o);if(ws&&ws.readyState===1)ws.send(s);else if(q.length<200)q.push(s);return}
   if(bc)try{bc.postMessage(o)}catch(e){}
   if(useP2P){
    if(role==='hub')conns.forEach(function(c){sendTo(c,o)});
    else if(role==='client'&&up&&up.open)sendTo(up,o);
    else if(pq.length<100)pq.push(o);
   }
  }
  function list(){return Object.keys(peers).map(function(k){return{peer:k,kind:'viewer',presence:peers[k].presence,isMe:k===me,sameTab:k===me}})}
  function notify(left){cbs.forEach(function(f){try{f({peers:list(),left:left||[]})}catch(e){console.error(e)}})}
  function hi(){raw({k:'hi',p:me,pr:pres})}
  function recv(o){
   if(!o||o.room!==name||o.p===me)return;
   if(o.q!=null){var key=o.p+':'+o.q;if(seen[key])return;seen[key]=1;seenQ.push(key);if(seenQ.length>600){var d=seenQ.splice(0,200);d.forEach(function(k){delete seen[k]})}}
   if(o.k==='hi'){var n=!peers[o.p];peers[o.p]={peer:o.p,presence:o.pr||{},seen:Date.now()};if(n){hi();notify()}else notify()}
   else if(o.k==='bye'){if(peers[o.p]){var l=[peers[o.p]];delete peers[o.p];notify(l.map(function(x){return{peer:x.peer}}))}}
   else if(o.k==='m'&&H[o.t])H[o.t]({sameTab:false,peer:o.p,data:o.d});
  }
  function connect(){
   if(dead)return;ws=new WebSocket(relay);
   ws.onopen=function(){var nmEl=document.getElementById('nm');ws.send(JSON.stringify({k:'join',room:name,name:nmEl?String(nmEl.value).slice(0,24):'',testntfy:/[?&]testntfy\b/.test(location.search)}));q.splice(0).forEach(function(s){ws.send(s)});hi()};
   ws.onmessage=function(e){try{recv(JSON.parse(e.data))}catch(x){}};
   ws.onclose=function(){if(!dead)setTimeout(connect,1500)};
  }
  /* ---- WebRTC hub/client ---- */
  function killPeer(){clearTimeout(openTimer);role='';up=null;conns=[];if(pp){try{pp.destroy()}catch(e){}pp=null}}
  function retry(ms){if(dead)return;killPeer();clearTimeout(pTimer);pTimer=setTimeout(p2pStart,ms==null?500+Math.random()*1500:ms)}
  function stat(){if(role==='hub')setStat('Online – you are hosting this room ('+conns.length+' connected)');else if(role==='client')setStat('Online – connected to room host');else setStat('Connecting to other players…')}
  function p2pStart(){
   if(dead)return;
   var P;try{P=new PeerC(hubId,peerOpts())}catch(e){setStat('Online mode failed to start – same-browser tabs only');retry(5000);return}
   pp=P;var mine=P,opened=false;
   openTimer=setTimeout(function(){if(!opened)setStat('Cannot reach the PeerJS broker – same-browser tabs only (retrying…)')},7000);
   P.on('open',function(){opened=true;clearTimeout(openTimer);role='hub';stat();
    pq.splice(0);hi();
    P.on('connection',function(c){
     c.on('open',function(){conns.push(c);stat();hi()});
     c.on('data',function(d){conns.forEach(function(x){if(x!==c)sendTo(x,d)});recv(d)});
     var gone=function(){var i=conns.indexOf(c);if(i>=0){conns.splice(i,1);stat()}};
     c.on('close',gone);c.on('error',gone);
    });
   });
   P.on('disconnected',function(){if(mine===pp&&role==='hub'&&!dead){try{P.reconnect()}catch(e){}}});
   P.on('error',function(err){
    if(mine!==pp)return;
    if(err&&err.type==='unavailable-id'){clearTimeout(openTimer);killPeer();asClient()}
    else if(role!=='hub'){retry(3000)}
   });
  }
  function asClient(){
   if(dead)return;
   var P;try{P=new PeerC(peerOpts())}catch(e){retry(5000);return}
   pp=P;var mine=P,opened=false;
   setStat('Connecting to other players…');
   openTimer=setTimeout(function(){if(!opened)setStat('Cannot reach the PeerJS broker – same-browser tabs only (retrying…)')},7000);
   P.on('open',function(){
    opened=true;clearTimeout(openTimer);
    var c=P.connect(hubId,{reliable:true});
    var cto=setTimeout(function(){if(!c.open&&mine===pp)retry()},9000);
    c.on('open',function(){clearTimeout(cto);up=c;role='client';stat();pq.splice(0).forEach(function(o){sendTo(c,o)});hi()});
    c.on('data',recv);
    var lost=function(){if(mine===pp&&role!==''){retry()}else if(mine===pp&&!c.open){retry()}};
    c.on('close',function(){if(mine===pp)retry()});
    c.on('error',function(){if(mine===pp)retry()});
   });
   P.on('error',function(err){if(mine!==pp)return;retry(err&&err.type==='peer-unavailable'?300+Math.random()*1200:3000)});
   P.on('disconnected',function(){if(mine===pp&&role!=='client')retry()});
  }
  if(relay){connect()}
  else{
   try{bc=new BroadcastChannel('worms-'+name);bc.onmessage=function(e){recv(e.data)}}catch(e){}
   if(useP2P){setStat('Connecting to other players…');p2pStart()}
   else setStat('Local mode: players join from other tabs of this same browser.');
  }
  if(relay)setStat('Online mode (relay server).');
  setInterval(function(){if(dead)return;hi();var now=Date.now(),left=[];Object.keys(peers).forEach(function(k){if(k!==me&&now-peers[k].seen>10000){left.push({peer:k});delete peers[k]}});if(left.length)notify(left)},1500);
  addEventListener('pagehide',function(){raw({k:'bye',p:me});if(pp)try{pp.destroy()}catch(e){}});
  setTimeout(hi,50);
  return{
   on:function(t,f){H[t]=f},
   emit:function(t,d){raw({k:'m',p:me,t:t,d:d})},
   presence:function(p){pres=Object.assign({},pres,p);peers[me].presence=pres;hi();notify()},
   peers:list,
   pub:function(i){if(relay)raw({k:'pub',i:i})},
   onPeers:function(f){cbs.push(f);f({peers:list(),left:[]})},
   leave:function(){dead=true;raw({k:'bye',p:me});clearTimeout(pTimer);killPeer();if(ws)ws.close();if(bc)bc.close()}
  };
 }
 window.claude={use:function(n){return Promise.resolve(n==='room'?{join:function(name){return Promise.resolve(mkRoom(name))}}:null)}};
 addEventListener('DOMContentLoaded',function(){var el=document.getElementById('pls');if(!el)return;var t=document.createElement('small');t.style.cssText='display:block;margin-top:6px;opacity:.7';t.textContent=statTxt;statEl=t;el.parentNode.insertBefore(t,el.nextSibling)});
})();
