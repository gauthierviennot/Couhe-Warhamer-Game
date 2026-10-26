// Tests anciens : leurs unités sans place prévue restent empilées sur une tuile de dépôt (règle « pas de pile » testée à part dans t_piles.js).
if (process.env.TEST_PILES !== '1') process.env.TEST_ALLOW_PILES = '1';
// Faux socket.io + faux express : teste la logique de server.js sans réseau ni dépendances.
const Module=require('module');
class FakeIO{constructor(){this.sockets={sockets:new Map()};global.__io=this;}
 on(ev,h){if(ev==='connection')this.h=h;} emit(ev,p){for(const s of this.sockets.sockets.values())s.emit(ev,p);}
 to(){return{emit(){}}}}
const app=new Proxy(function(){},{get:(t,k)=>k==='listen'?(p,cb)=>{cb&&cb();return{on(){}}}:()=>app,apply:()=>{}});
const express=Object.assign(()=>app,{static:()=>()=>{},json:()=>()=>{},urlencoded:()=>()=>{},raw:()=>()=>{},text:()=>()=>{},Router:()=>app});
const orig=Module._load;
Module._load=function(req,...a){if(req==='socket.io')return{Server:FakeIO};if(req==='express')return express;return orig.call(this,req,...a);};
// Valide les ordres d'un joueur en donnant d'abord « reste en place » à ses unités sans ordre (règle : toutes les unités ont un ordre).
global.__ready = async (S, L) => {
  const v = L(S), me = S.data.name;
  for (const l of (v.lines || []).filter((x) => x.owner.toLowerCase() === String(me).toLowerCase())) for (let i = 1; i <= l.qty; i++) {
    const id = `${l.owner}|${l.uid}#${i}`, tile = v.b?.pos?.[id] ?? v.placed?.[id];
    if (tile && !v.b?.dead?.[id] && !v.b?.orders?.[id]) await S.call('battle-order', { unit: id, order: { type: 'depl', tile } });
  }
  return S.call('battle-ready', { on: true });
};
