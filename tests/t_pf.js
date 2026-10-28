process.env.GAME_TEST = '1'; process.env.DATA_DIR='/tmp/dd_'+Date.now();process.env.PORT='8862';
const EE=require('events');const http=require('http');
http.createServer=()=>({listen(p,cb){cb&&cb();},on(){},address(){return{port:8862}}});
require('./harness.js');require('../server.js');
setTimeout(async()=>{
 const io=global.__io;
 const mk=(id)=>{const s=new EE();s.id=id;s.data={};s.handshake={address:'1.1.1.1'};s.join=()=>{};s.leave=()=>{};s.broadcast={emit(){}};s.log=[];
  s.call=(ev,p)=>new Promise(r=>{const hs=s.listeners(ev);if(!hs.length)return r({error:'no handler '+ev});Promise.resolve(hs[0](p,(res)=>r(res)));setTimeout(()=>r({timeout:true}),3000);});
  s.emit=(ev,...a)=>{s.log.push([ev,a[0]]);return true;};io.sockets.sockets.set(id,s);io.h(s);return s;};
 const ok=(c,m)=>console.log((c?'OK  ':'FAIL')+' '+m);
 const mj=mk('a'),b=mk('b'),c=mk('c');
 await mj.call('set-username',{name:'mj',password:'mj',clientId:'c1'});await b.call('set-username',{name:'bob',clientId:'c2'});await c.call('set-username',{name:'cat',clientId:'c3'});
 await mj.call('new-map',{cols:20,rows:20});
 mj.listeners('edit-tiles')[0]({ testForce: true, action:'mark',mark:'diamond',keys:['1,5','2,5','3,5','4,5','5,5','6,5','7,5','8,5','9,5','10,5','11,5','12,5','3,15','4,15','10,15','11,15']});
 await mj.call('landing-start',{});
 {const cr=require('crypto'),ri=cr.randomInt;let k=0;cr.randomInt=(a,b2)=>(b2===11?(k++%2===0?10:1):ri(a,b2));} // dés forcés : l'équipe 1 commence toujours
 const L=(s)=>s.log.filter(x=>x[0]==='landing').pop()[1];
 const zs=L(mj).zones.map(z=>z.id);console.log('zones',zs);
 for(const z of zs)await mj.call('landing-group',{zone:z,group:'A'});await mj.call('landing-group',{zone:zs[zs.length-1],group:'B'});
 await mj.call('fiches-team',{op:'assign',name:'bob',team:'t1'});await mj.call('fiches-team',{op:'assign',name:'cat',team:'t2'});
 await mj.call('fiches-pick',{name:'bob',army:'empire',legion:'1'});await mj.call('fiches-pick',{name:'cat',army:'bretonnie',legion:'1'});
 let r=await mj.call('landing-teams',{A:'t1'});
 await b.call('landing-choose',{zone:zs[0]});await c.call('landing-choose',{zone:zs[zs.length-1]});
 r=await mj.call('landing-freeze',{force:true});ok(r.success,'freeze');
 const zb=L(b).zones.find(z=>z.id===zs[0]).tiles, zc=L(c).zones.find(z=>z.id===zs[zs.length-1]).tiles;
 const lb=L(b).lines.filter(l=>l.owner==='bob'),lc=L(c).lines.filter(l=>l.owner==='cat');
 const ub=[],uc=[];lb.forEach(l=>{for(let i=1;i<=l.qty;i++)ub.push(`bob|${l.uid}#${i}`);});lc.forEach(l=>{for(let i=1;i<=l.qty;i++)uc.push(`cat|${l.uid}#${i}`);});
 console.log('unités',ub.length,uc.length);
 let nf=0;for(const u of ub){const x=await b.call('landing-place',{units:[u],tile:zb[0]});if(!x.success){nf++;if(nf<2)console.log('place fail',x.message);}}for(const u of uc){const x=await c.call('landing-place',{units:[u],tile:zc[0]});if(!x.success){nf++;if(nf<3)console.log('place fail',x.message);}}
 r=await mj.call('landing-lock',{force:true});ok(r.success,'lock');

 r=await mj.call('landing-battle',{});ok(r.success,'bataille');
 let v=L(mj);
 // place: bob[0] en (x, 8), cat[0] en (x,11), le reste reste en place
 const hb=zb[0].split(',').map(Number), hc=zc[0].split(',').map(Number);
 const tb=`${hb[0]},${hb[1]+3}`, tc="3,11";
 console.log('home bob',zb[0],'->',tb,'| home cat',zc[0],'->',tc);
 console.log('clusters',JSON.stringify(L(mj).b.clusters.map(c=>({secs:c.secs,active:c.active,roll:c.roll,left:c.left}))));
 let fails={};
 for(let pass=0;pass<600;pass++){v=L(mj);if(v.b.allPlaced)break;let prog=false;
   for(const U of [...ub,...uc]){ if(v.b.done[U])continue; const S=U.startsWith('bob')?b:c;
     const tile=U===ub[0]?tb:(U===uc[0]?tc:undefined);
     const rr=await S.call('battle-place',{unit:U,tile,orient:0}); if(rr.success){prog=true;v=L(mj);} else fails[rr.message]=(fails[rr.message]||0)+1; }
   if(!prog){console.log('bloqué');break;} }
 console.log('refus',JSON.stringify(fails));
 v=L(mj);ok(v.b.allPlaced,'tous placés');
 console.log('pos bob0',v.b.pos[ub[0]],'cat0',v.b.pos[uc[0]]);

 r=await mj.call('landing-orders',{});ok(r.success,'ordres');
 const dep=L(b).lines.find(l=>l.owner==='bob'&&ub[0].includes(l.uid)).dep;console.log('dep bob0',dep);
 await b.call('battle-order',{unit:ub[0],order:{type:'depl',tile:tb}});
 await __ready(b, L);await __ready(c, L);
 const [bc,br]=tb.split(',').map(Number);
 const nb=(c0,r0)=>(r0%2===1?[[1,0],[-1,0],[0,-1],[1,-1],[0,1],[1,1]]:[[1,0],[-1,0],[-1,-1],[0,-1],[-1,1],[0,1]]).map(([a,b2])=>`${c0+a},${r0+b2}`);
 const setT=(keys,terrain)=>mj.listeners('edit-tiles')[0]({ testForce: true, action:'terrain',terrain,keys});
 const hd=(a,b2)=>{const cube=k=>{const [c0,r0]=k.split(',').map(Number);const x=c0-(r0-(r0&1))/2;return [x,-x-r0,r0];};const A=cube(a),B=cube(b2);return Math.max(...A.map((v,i)=>Math.abs(v-B[i])));};
 // 1 plaine
 setT(nb(bc,br).concat(['0,0']),'plain');
 // dé des déplacements forcé : l'équipe 1 (bob) commence
 r=await mj.call('landing-move',{});ok(r.success,'move');
 let al=L(b).m.allow[ub[0]];console.log('plaine: n',al.length,'max dist',Math.max(...al.map(k=>hd(k,tb))));
 ok(Math.max(...al.map(k=>hd(k,tb)))===dep,'portée = dep en plaine');
 await mj.call('landing-goto',{phase:'orders'});
 // 2 entouré de montagnes
 setT(nb(bc,br),'mountain');
 await __ready(b, L);await __ready(c, L);
 r=await mj.call('landing-move',{});
 al=L(b).m.allow[ub[0]];console.log('encerclé de montagnes: allow',JSON.stringify(al));
 ok(al.length===1&&al[0]===tb,'montagnes autour : ne peut pas sortir');
 await mj.call('landing-goto',{phase:'orders'});
 // 3 voisins en marais
 setT(nb(bc,br),'swamp');
 await __ready(b, L);await __ready(c, L);
 r=await mj.call('landing-move',{});
 al=L(b).m.allow[ub[0]];const mx=Math.max(...al.map(k=>hd(k,tb)));console.log('marais voisin: n',al.length,'max',mx);
 ok(mx<=dep-1&&mx>=1,'marais coûte 2 pour la première tuile');
 await mj.call('landing-goto',{phase:'orders'});
 // 4 route à dep+2
 setT(nb(bc,br),'plain');
 // chemin atteint sans bonus (à dep tuiles) puis suivi sur 2 tuiles ; un chemin isolé à dep+2 n'est pas atteignable
 const far=`${bc+dep+2},${br}`; setT([`${bc+dep},${br}`,`${bc+dep+1},${br}`,far],'path');
 const lone=`${bc},${br+dep+2}`; setT([lone],'path');
 await __ready(b, L);await __ready(c, L);
 r=await mj.call('landing-move',{});
 al=L(b).m.allow[ub[0]];console.log('chemin à',hd(far,tb),al.includes(far),'isolé à',hd(lone,tb),al.includes(lone));
 ok(hd(far,tb)===dep+2?al.includes(far):true,'chemin atteint sans bonus puis suivi : +2');
 ok(hd(lone,tb)===dep+2?!al.includes(lone):true,'chemin isolé hors de portée sans bonus : pas atteignable');
 // 5 eau sans pont
 await mj.call('landing-goto',{phase:'orders'});
 setT([far],'plain');setT([`${bc+1},${br}`],'water');
 await __ready(b, L);await __ready(c, L);
 r=await mj.call('landing-move',{});
 al=L(b).m.allow[ub[0]];ok(!al.includes(`${bc+1},${br}`),'ne s’arrête pas dans l’eau');
 console.log('trajet contourne l’eau, max',Math.max(...al.map(k=>hd(k,tb))));
 process.exit(0);
},3000);