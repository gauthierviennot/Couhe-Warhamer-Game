'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { Server } = require('socket.io');

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Dossier local : utilisé seulement si Supabase n'est pas configuré (et pour le mot de passe admin de secours).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAPS_DIR = path.join(DATA_DIR, 'maps');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LEGACY_FILE = path.join(__dirname, 'data.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const BACKGROUND_FILE = path.join(DATA_DIR, 'background.json');
const BACKGROUND_MAX_BYTES = 3 * 1024 * 1024; // image de fond de la page de connexion
const HISTORY_MAX_BATCHES = 100; // annuler / rétablir : 100 actions par joueur
const HISTORY_MAX_ENTRIES = 30000;

const LIMITS = {
    minSize: 2,
    maxSize: 300,
    maxTerrains: 30,
    maxLabel: 40,
    maxName: 15,
    maxMapName: 60,
    maxAutoBackups: 5
};
const SAVE_DELAY_MS = 2000;
const SAVE_RETRY_MS = 5000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // une session reste valable 30 jours
const SESSION_TOUCH_MS = 60 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_BLOCK_MS = 60 * 1000;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAP_ID = /^[a-z0-9-]{1,64}$/;
const MARKS = new Set(['square', 'triangle', 'diamond', 'cross', 'disc', 'x']);
const EDIT_ACTIONS = new Set(['terrain', 'object', 'remove', 'restore', 'mark', 'unmark']);
const ADMIN_NAME = 'mj';

// Fiches d'armée : données d'origine dans fiches-seed.json ; les modifications du MJ sont enregistrées dans le stockage.
const FICHES_SEED_FILE = path.join(__dirname, 'fiches-seed.json');
const DOCS_DIR = path.join(DATA_DIR, 'docs');
const FICHES_MAX_BYTES = 800 * 1024;
const FICHES_MAX_UNITS = 600;
const DOC_ID = /^[a-z0-9_]{1,64}$/;
const LEG_ID = /^[A-Za-z0-9_-]{1,12}$/;
const FAM_ID = /^[a-z0-9_]{1,24}$/;
const FAM_COLS = new Set(['S', 'F', 'J', 'L', 'M', 'Q', 'R', 'W', 'X', 'val']);

// Terrains : liste fixe, seules les couleurs sont modifiables par l'admin. La plaine est le terrain par défaut.
const DEFAULT_TERRAINS = [
    { id: 'plain', color: '#8fd16b' },
    { id: 'hill', color: '#d9b44a' },
    { id: 'mountain', color: '#8a6d54' },
    { id: 'path', color: '#e2cfa3' },
    { id: 'water', color: '#4aa3df' },
    { id: 'swamp', color: '#6f9070' }
];
const TERRAIN_IDS = DEFAULT_TERRAINS.map((t) => t.id);
// Anciennes couleurs des versions précédentes, rattachées au terrain le plus proche.
const LEGACY_TERRAINS = { '#2ecc71': 'plain', '#f1c40f': 'hill', '#783f04': 'mountain', '#3498db': 'water' };

// Objets posés à la place du petit hexagone central.
// turns = nombre d'orientations : 1 = aucune, 3 = bidirectionnel (pont, muret), 6 = une seule direction.
const GROUND = ['plain', 'hill', 'swamp']; // le marécage reçoit les mêmes objets que la plaine et la colline (sauf les ponts, réservés à l'eau)
const OBJECT_RULES = {
    forest: { turns: 1, on: GROUND },
    bridge: { turns: 3, on: ['water'] },
    fortress: { turns: 6, on: GROUND }, // fortification une entrée
    'fortress-half': { turns: 3, on: GROUND }, // fortification deux entrées (faces opposées)
    village: { turns: 1, on: GROUND },
    'village-flat': { turns: 1, on: GROUND },
    wall: { turns: 3, on: GROUND }
};
const isObjectId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(OBJECT_RULES, id);
const objectAllowed = (object, terrain) => isObjectId(object) && OBJECT_RULES[object].on.includes(terrain);

try {
    fs.mkdirSync(MAPS_DIR, { recursive: true });
} catch (err) {
    console.warn(`⚠️ Dossier local indisponible (${err.message}).`);
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

const isHex = (value) => typeof value === 'string' && HEX_COLOR.test(value);
const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };
const cleanText = (value, max) =>
    String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const logError = (context) => (err) => console.error(`⚠️ ${context} :`, err.message);

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') console.error(`⚠️ Lecture impossible : ${file} (${err.message})`);
        return null;
    }
}

// Écriture atomique : fichier temporaire puis renommage, pour ne jamais laisser un fichier à moitié écrit.
function writeJsonAtomic(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
}

/* ------------------------------------------------------------------ */
/* Validation / nettoyage des données                                  */
/* ------------------------------------------------------------------ */

function sanitizeConfig(config) {
    const cols = Number.parseInt(config?.cols, 10);
    const rows = Number.parseInt(config?.rows, 10);
    const valid = (n) => Number.isInteger(n) && n >= LIMITS.minSize && n <= LIMITS.maxSize;
    return valid(cols) && valid(rows) ? { cols, rows } : null;
}

// Terrains : liste fixe ; seules les couleurs sont conservées.
function sanitizeTerrains(list) {
    const byId = new Map();
    if (Array.isArray(list)) {
        for (const t of list) {
            if (t && typeof t.id === 'string') byId.set(t.id, t);
        }
    }
    return DEFAULT_TERRAINS.map((d) => {
        const color = byId.get(d.id)?.color;
        return { id: d.id, color: isHex(color) ? color.toLowerCase() : d.color };
    });
}

function isValidKey(key, config) {
    const match = /^(\d{1,3}),(\d{1,3})$/.exec(key);
    return Boolean(match) && Number(match[1]) < config.cols && Number(match[2]) < config.rows;
}

const hasContent = (tile) => Boolean(tile.terrain) || Boolean(tile.object) || Boolean(tile.mark);
const keepOrNull = (tile) => (hasContent(tile) ? tile : null);

// Une case absente = plaine. Sinon : { terrain?, object?, dir?, mark?, author, objectAuthor? } ou { removed: true }.
function sanitizeTile(tile) {
    if (!tile || typeof tile !== 'object') return null;
    const author = typeof tile.author === 'string' ? tile.author.slice(0, LIMITS.maxName) : '';
    if (tile.removed === true) return { removed: true, author };

    const clean = { author };
    const terrain = TERRAIN_IDS.includes(tile.terrain)
        ? tile.terrain
        : LEGACY_TERRAINS[String(tile.color ?? '').toLowerCase()];
    if (terrain) clean.terrain = terrain;

    if (objectAllowed(tile.object, clean.terrain ?? 'plain')) {
        clean.object = tile.object;
        const { turns } = OBJECT_RULES[tile.object];
        if (turns > 1) clean.dir = Number.isInteger(tile.dir) && tile.dir >= 0 && tile.dir < turns ? tile.dir : 0;
        if (typeof tile.objectAuthor === 'string') clean.objectAuthor = tile.objectAuthor.slice(0, LIMITS.maxName);
    }
    if (MARKS.has(tile.mark)) clean.mark = tile.mark;
    // Dates des dernières modifications : elles servent à la protection des tuiles (voir « libérer mes modifications »).
    if (Number.isFinite(tile.at)) clean.at = tile.at;
    if (clean.object && Number.isFinite(tile.oat)) clean.oat = tile.oat;
    return keepOrNull(clean);
}

function sanitizeGrid(grid, config) {
    const clean = {};
    if (!grid || typeof grid !== 'object') return clean;
    for (const [key, tile] of Object.entries(grid)) {
        if (!isValidKey(key, config)) continue;
        const safe = sanitizeTile(tile);
        if (safe) clean[key] = safe;
    }
    return clean;
}

// Retourne la nouvelle case, null pour la ramener à l'état vierge (plaine), ou undefined si rien ne change.
function editTile(tile, action, options, author) {
    const removed = Boolean(tile?.removed);
    switch (action) {
        case 'terrain': {
            const { terrain } = options;
            if (removed) return undefined; // une case supprimée ne peut pas être coloriée
            // Poser une tuile de terrain remplace la tuile : l'objet éventuel disparaît, même si le terrain est identique.
            if ((tile?.terrain ?? 'plain') === terrain && !tile?.object) return undefined;
            const next = { ...tile, terrain, author, at: Date.now() };
            delete next.object;
            delete next.dir;
            delete next.objectAuthor;
            delete next.oat;
            return next;
        }
        case 'object': {
            const { object } = options;
            if (removed || !objectAllowed(object, tile?.terrain ?? 'plain') || tile?.object === object) return undefined;
            const next = { ...tile, author: tile?.author ?? '', object, objectAuthor: author, oat: Date.now() };
            if (OBJECT_RULES[object].turns > 1) next.dir = 0;
            else delete next.dir;
            return next;
        }
        case 'rotate': {
            const turns = isObjectId(tile?.object) ? OBJECT_RULES[tile.object].turns : 1;
            if (removed || turns <= 1) return undefined;
            return { ...tile, dir: ((tile.dir ?? 0) + 1) % turns };
        }
        case 'remove':
            return removed ? undefined : { removed: true, author };
        case 'restore':
            return removed ? null : undefined;
        case 'mark':
            if (removed || tile?.mark === options.mark) return undefined;
            return { ...tile, author: tile?.author ?? '', mark: options.mark };
        case 'unmark': {
            if (removed || !tile?.mark) return undefined;
            const { mark, ...rest } = tile;
            return keepOrNull(rest);
        }
        default:
            return undefined;
    }
}

// Protection : par joueur, « on » (les autres confirment avant de modifier ses tuiles) et « clearedAt »
// (les modifications antérieures à cette date sont définitivement libérées).
function sanitizeProtection(raw) {
    const clean = Object.create(null);
    if (!raw || typeof raw !== 'object') return clean;
    for (const [name, rule] of Object.entries(raw).slice(0, 500)) {
        if (name.length > LIMITS.maxName || !rule || typeof rule !== 'object') continue;
        clean[name] = { on: rule.on !== false, clearedAt: Number.isFinite(rule.clearedAt) ? rule.clearedAt : 0 };
    }
    return clean;
}

// Équipes gérées par le MJ : noms, appartenance de chaque pseudo, liste des pseudos connus.
function sanitizeTeams(raw) {
    const out = { names: { t1: 'Équipe 1', t2: 'Équipe 2' }, members: Object.create(null), roster: [], mercs: Object.create(null) };
    if (!raw || typeof raw !== 'object') return out;
    for (const key of ['t1', 't2']) {
        const label = raw.names?.[key];
        if (typeof label === 'string' && label.trim()) out.names[key] = label.trim().slice(0, 30);
    }
    if (raw.members && typeof raw.members === 'object') {
        for (const [name, team] of Object.entries(raw.members).slice(0, 500)) {
            if (name.length <= LIMITS.maxName && (team === 't1' || team === 't2')) out.members[name] = team;
        }
    }
    if (Array.isArray(raw.roster)) {
        for (const name of raw.roster.slice(0, 300)) {
            if (typeof name === 'string' && name && name.length <= LIMITS.maxName && !out.roster.includes(name)) out.roster.push(name);
        }
    }
    // Mercenaires (infanterie légère ajoutée par le MJ à un joueur) : pseudo -> liste de lignes, sans bonus d'armée.
    if (raw.mercs && typeof raw.mercs === 'object') {
        for (const [name, list] of Object.entries(raw.mercs).slice(0, 500)) {
            if (name.length > LIMITS.maxName || !Array.isArray(list)) continue;
            const clean = list.slice(0, 30).map(sanitizeMerc).filter(Boolean);
            if (clean.length) out.mercs[name] = clean;
        }
    }
    return out;
}

const MERC_ROW_KEYS = ['C', 'D', 'E', 'G', 'H', 'I', 'K', 'P', 'S', 'V', 'W'];
function sanitizeMerc(m) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !/^[\w-]{1,24}$/.test(m.id)) return null;
    const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null; };
    const units = num(m.units, 1, 400);
    const figsPerUnit = num(m.figsPerUnit, 1, 5000);
    const ptsUnit = num(m.ptsUnit, 0, 1e6);
    if (units === null || figsPerUnit === null || ptsUnit === null) return null;
    const row = {};
    for (const k of MERC_ROW_KEYS) {
        const v = m.row?.[k];
        if (typeof v === 'number' && Number.isFinite(v)) row[k] = Math.round(v * 1000) / 1000;
        else if (typeof v === 'string' && v.length <= 20) row[k] = v;
    }
    return {
        id: m.id, army: String(m.army || '').slice(0, 40), legion: String(m.legion || '').slice(0, 12), uid: String(m.uid || '').slice(0, 100),
        name: String(m.name || 'inf legere').slice(0, 60), units: Math.floor(units), figsPerUnit: Math.floor(figsPerUnit), ptsUnit,
        type: String(m.type || '').slice(0, 12), dep: Math.max(0, Math.min(30, Math.floor(Number(m.dep) || 0))), row
    };
}

// Légion choisie par chaque joueur : pseudo -> { army, legion }.
function sanitizePicks(raw) {
    const clean = Object.create(null);
    if (!raw || typeof raw !== 'object') return clean;
    for (const [name, pick] of Object.entries(raw).slice(0, 500)) {
        if (name.length > LIMITS.maxName || !pick || typeof pick !== 'object') continue;
        if (typeof pick.army !== 'string' || !DOC_ID.test(pick.army)) continue;
        if (typeof pick.legion !== 'string' || !LEG_ID.test(pick.legion)) continue;
        clean[name] = { army: pick.army, legion: pick.legion };
    }
    return clean;
}

/* ------------------------------------------------------------------ */
/* Débarquement : état persistant                                      */
/* ------------------------------------------------------------------ */

const LANDING_PHASES = ['off', 'zones', 'choose', 'place', 'locked', 'bplace', 'orders', 'move', 'fire'];
const BOARD_PHASES = ['place', 'locked', 'bplace', 'orders', 'move', 'fire']; // phases où les unités sont sur la carte
const ORDER_TYPES = ['charge', 'tir', 'depl', 'marche', 'tirailleur'];
const GEN_ORDERS = ['att', 'mvt', 'charge'];
const ZONE_ID = /^[a-z]$/;
const DEFAULT_BONUS = 2; // tuiles de déplacement supplémentaires par défaut, réglables par le MJ pour chaque section
const TEAM_IDS = ['t1', 't2'];

function defaultLanding() {
    return { phase: 'off', zones: [], groups: {}, bonus: {}, teamEntry: null, choices: {}, roster: {}, placed: {}, std: {}, gen: {}, chev: {}, sim: {}, b: null };
}

// Reconstruit l'état depuis le disque en ne gardant que des valeurs bien formées.
function normalizeLanding(raw) {
    const out = defaultLanding();
    if (!raw || typeof raw !== 'object') return out;
    if (LANDING_PHASES.includes(raw.phase)) out.phase = raw.phase;
    if (Array.isArray(raw.zones)) {
        out.zones = raw.zones.slice(0, 26).filter((z) => z && ZONE_ID.test(z.id) && Array.isArray(z.tiles))
            .map((z) => ({ id: z.id, tiles: z.tiles.filter((t) => /^\d{1,3},\d{1,3}$/.test(t)).slice(0, 400) }));
    }
    const ids = new Set(out.zones.map((z) => z.id));
    for (const [z, g] of Object.entries(raw.groups || {})) if (ids.has(z) && (g === 'A' || g === 'B')) out.groups[z] = g;
    // Bonus de déplacement par section : { mid: centre, ends: { "col,ligne": extrémité } } (2 par défaut, 0 à 9).
    for (const [z, b] of Object.entries(raw.bonus || {})) {
        if (!ids.has(z) || !b || typeof b !== 'object') continue;
        const ok = (x) => Number.isInteger(x) && x >= 0 && x <= 9;
        const entry = { ends: {} };
        if (ok(b.mid)) entry.mid = b.mid;
        for (const [tile, v] of Object.entries(b.ends || {})) if (/^\d{1,3},\d{1,3}$/.test(tile) && ok(v)) entry.ends[tile] = v;
        out.bonus[z] = entry;
    }
    if (raw.teamEntry && TEAM_IDS.every((t) => raw.teamEntry[t] === 'A' || raw.teamEntry[t] === 'B')) out.teamEntry = { t1: raw.teamEntry.t1, t2: raw.teamEntry.t2 };
    for (const [name, z] of Object.entries(raw.choices || {})) if (name.length <= LIMITS.maxName && ids.has(z)) out.choices[name] = z;
    // roster : pour chaque joueur, ses lignes de légion (une ligne = nb unités individuelles).
    for (const [name, list] of Object.entries(raw.roster || {}).slice(0, 200)) {
        if (name.length > LIMITS.maxName || !Array.isArray(list)) continue;
        out.roster[name] = list.slice(0, 120).filter((u) => u && typeof u.uid === 'string' && u.uid.length <= 100).map((u) => ({
            uid: u.uid, name: String(u.name || '').slice(0, 60), qty: Math.max(1, Math.min(400, Math.floor(Number(u.qty) || 1))),
            figs: Math.max(0, Math.min(5000, Math.floor(Number(u.figs) || 0))), type: String(u.type || '').slice(0, 12),
            dep: Number.isFinite(u.dep) ? u.dep : 0, army: String(u.army || '').slice(0, 40), legion: String(u.legion || '').slice(0, 12),
            stdMax: Math.max(0, Math.min(400, Math.floor(Number(u.stdMax) || 0))), ...(u.merc === true ? { merc: true } : {}),
            ...(typeof u.kin === 'string' && u.kin ? { kin: u.kin.slice(0, 3) } : {}), ...(Number(u.pv) > 0 ? { pv: Math.round(Math.min(100000, Number(u.pv)) * 10) / 10 } : {}), ...(Number(u.pf) > 0 ? { pf: Math.round(Math.min(100000, Number(u.pf)) * 100) / 100 } : {}),
            ...(Array.isArray(u.comp) ? { comp: u.comp.slice(0, 4).map((c) => ({ name: String(c?.name || '').slice(0, 60), figs: Math.max(0, Math.min(5000, Math.floor(Number(c?.figs) || 0))), uid: String(c?.uid || '').slice(0, 100) })) } : {})
        }));
    }
    for (const [id, tile] of Object.entries(raw.placed || {}).slice(0, 12000)) if (typeof tile === 'string' && /^\d{1,3},\d{1,3}$/.test(tile)) out.placed[id] = tile;
    for (const [id, v] of Object.entries(raw.std || {}).slice(0, 12000)) if (v === true && id in out.placed) out.std[id] = true;
    // Général : une unité par joueur le porte (gen) ; une unité proche (6 hexagones) peut recevoir le chevron actif (chev).
    for (const [n, id] of Object.entries(raw.gen || {}).slice(0, 200)) if (n.length <= LIMITS.maxName && typeof id === 'string' && id in out.placed) out.gen[n] = id;
    for (const [n, id] of Object.entries(raw.chev || {}).slice(0, 200)) if (n.length <= LIMITS.maxName && typeof id === 'string' && id in out.placed) out.chev[n] = id;
    // Simulation : positions virtuelles { tile, from (tuile de dépôt au moment de la simulation), bonus (général ou chevron actif) }.
    for (const [id, v] of Object.entries(raw.sim || {}).slice(0, 12000)) {
        if (v && typeof v.tile === 'string' && /^\d{1,3},\d{1,3}$/.test(v.tile) && typeof v.from === 'string' && out.placed[id] === v.from) out.sim[id] = { tile: v.tile, from: v.from, bonus: v.bonus === true };
    }
    // Bataille : positions réelles, orientations, ordres, journal.
    if (['bplace', 'orders', 'move', 'fire'].includes(out.phase) && raw.b && typeof raw.b === 'object') {
        const rb = raw.b;
        const tileOk = (t) => typeof t === 'string' && /^\d{1,3},\d{1,3}$/.test(t);
        const b = { first: TEAM_IDS.includes(rb.first) ? rb.first : 't1', active: TEAM_IDS.includes(rb.active) ? rb.active : 't1', turn: Math.max(1, Math.min(999, Math.floor(Number(rb.turn) || 1))),
            roll: rb.roll && Number.isInteger(rb.roll.t1) && Number.isInteger(rb.roll.t2) ? { t1: rb.roll.t1, t2: rb.roll.t2 } : null,
            pos: {}, orient: {}, done: {}, orders: {}, gorders: {}, ready: {}, revealed: rb.revealed === true, stack: [], log: [] };
        for (const [id, t] of Object.entries(rb.pos || {}).slice(0, 12000)) if (id in out.placed && tileOk(t)) b.pos[id] = t;
        for (const [id, o] of Object.entries(rb.orient || {}).slice(0, 12000)) if (id in out.placed && Number.isInteger(o) && o >= 0 && o <= 5) b.orient[id] = o;
        for (const [id, v] of Object.entries(rb.done || {}).slice(0, 12000)) if (id in out.placed && v === true) b.done[id] = true;
        for (const [id, o] of Object.entries(rb.orders || {}).slice(0, 12000)) {
            if (!(id in out.placed) || !o || !ORDER_TYPES.includes(o.type)) continue;
            b.orders[id] = { type: o.type, ...(typeof o.target === 'string' && o.target.length <= 140 ? { target: o.target } : {}), ...(tileOk(o.tile) ? { tile: o.tile } : {}), ...(['court', 'long', 'art'].includes(o.range) ? { range: o.range } : {}), ...(o.air === false ? { air: false } : (o.air === true ? { air: true } : {})), ...(o.rear === true ? { rear: true } : {}), ...(o.seen === false ? { seen: false, why: String(o.why || '').slice(0, 20) } : (o.seen === true ? { seen: true } : {})), ...(o.failed === true ? { failed: true } : {}), ...(o.second === true ? { second: true } : {}), ...(typeof o.screened === 'string' && o.screened.length <= 140 ? { screened: o.screened } : {}), ...(Array.isArray(o.save) ? { save: o.save.filter((k) => ['hill', 'forest', 'build', 'bridge', 'vs'].includes(k)) } : {}), ...(typeof o.cav === 'boolean' ? { cav: o.cav } : {}) };
        }
        for (const [n, g] of Object.entries(rb.gorders || {}).slice(0, 200)) if (n.length <= LIMITS.maxName && GEN_ORDERS.includes(g)) b.gorders[n] = g;
        if (Array.isArray(rb.swaps)) b.swaps = rb.swaps.slice(0, 200).filter((x) => x && [x.t, x.p, x.foe].every((v) => typeof v === 'string' && v.length <= 140)).map((x) => ({ t: x.t, p: x.p, foe: x.foe, ...(x.done === true ? { done: true } : {}) }));
        for (const [n, v] of Object.entries(rb.ready || {}).slice(0, 200)) if (n.length <= LIMITS.maxName && v === true) b.ready[n] = true;
        b.stack = (Array.isArray(rb.stack) ? rb.stack : []).filter((x) => typeof x === 'string' && x in out.placed).slice(-12000);
        b.log = (Array.isArray(rb.log) ? rb.log : []).slice(-40).filter((x) => x && typeof x.text === 'string').map((x) => ({ t: Number(x.t) || 0, text: x.text.slice(0, 200) }));
        // Placement en parallèle : secteurs (groupes de sections qui se touchent), chacun avec sa propre équipe active.
        b.ucl = {};
        for (const [id, c] of Object.entries(rb.ucl || {}).slice(0, 12000)) if (id in out.placed && Number.isInteger(c) && c >= 0 && c < 400) b.ucl[id] = c;
        b.clusters = (Array.isArray(rb.clusters) ? rb.clusters : []).slice(0, 400).map((c) => ({
            active: TEAM_IDS.includes(c?.active) ? c.active : 't1', first: TEAM_IDS.includes(c?.first) ? c.first : 't1',
            roll: c?.roll && Number.isInteger(c.roll.t1) && Number.isInteger(c.roll.t2) ? { t1: c.roll.t1, t2: c.roll.t2 } : null,
            secs: (Array.isArray(c?.secs) ? c.secs : []).slice(0, 60).map((x) => String(x).slice(0, 40)), ...(c?.global === true ? { global: true } : {}) }));
        // Pertes : PV restants de chaque figurine, unités détruites.
        b.hp = {}; b.dead = {};
        for (const [id, arr] of Object.entries(rb.hp || {}).slice(0, 12000)) if (id in out.placed && Array.isArray(arr) && arr.length <= 2000) b.hp[id] = arr.map((x) => Math.max(0, Math.min(100000, Number(x) || 0)));
        for (const [id, v] of Object.entries(rb.dead || {}).slice(0, 12000)) if (id in out.placed && v === true) b.dead[id] = true;
        out.b = b;
        // Déplacements : file des charges, tour de rôle, sauvegarde pour revenir en arrière.
        if ((out.phase === 'move' || out.phase === 'fire') && raw.m && typeof raw.m === 'object') {
            const rm = raw.m;
            const okId = (x) => typeof x === 'string' && x in out.placed;
            const mm = { step: ['charge', 'move', 'done'].includes(rm.step) ? rm.step : 'move', qi: Math.max(0, Math.min(5000, Math.floor(Number(rm.qi) || 0))), active: TEAM_IDS.includes(rm.active) ? rm.active : null,
                queue: (Array.isArray(rm.queue) ? rm.queue : []).slice(0, 2000).filter((x) => x && okId(x.id) && typeof x.target === 'string').map((x) => ({ id: x.id, target: x.target.slice(0, 140), dist: Math.max(0, Math.floor(Number(x.dist) || 0)), tie: Math.max(0, Math.floor(Number(x.tie) || 0)), ...(x.failed === true ? { failed: true } : {}), ...(x.res && typeof x.res === 'object' && JSON.stringify(x.res).length < 8000 ? { res: JSON.parse(JSON.stringify(x.res)) } : {}),
                    ...(x.mutual === true ? { mutual: true, ...(x.plan && typeof x.plan === 'object' && JSON.stringify(x.plan).length < 20000 && (x.plan.none || Array.isArray(x.plan.path)) ? { plan: JSON.parse(JSON.stringify(x.plan)) } : {}) } : {}) })),
                moved: {}, stack: [], snap: { pos: {}, orient: {} },
                ...(rm.roll && Number.isInteger(rm.roll.t1) && Number.isInteger(rm.roll.t2) && TEAM_IDS.includes(rm.first) ? { roll: { t1: rm.roll.t1, t2: rm.roll.t2 }, first: rm.first } : {}) };
            for (const [id, v] of Object.entries(rm.moved || {}).slice(0, 12000)) if (okId(id) && v === true) mm.moved[id] = true;
            for (const [id, t] of Object.entries(rm.snap?.pos || {}).slice(0, 12000)) if (okId(id) && /^\d{1,3},\d{1,3}$/.test(String(t))) mm.snap.pos[id] = t;
            for (const [id, o] of Object.entries(rm.snap?.orient || {}).slice(0, 12000)) if (okId(id) && Number.isInteger(o) && o >= 0 && o <= 5) mm.snap.orient[id] = o;
            mm.stack = (Array.isArray(rm.stack) ? rm.stack : []).slice(-300).filter((x) => x && okId(x.id)).map((x) => ({ id: x.id, pos: x.pos ?? null, orient: Number.isInteger(x.orient) ? x.orient : null, tid: typeof x.tid === 'string' ? x.tid : null, torient: Number.isInteger(x.torient) ? x.torient : null, step: x.step, qi: Math.floor(Number(x.qi) || 0), active: x.active ?? null, moved: x.moved === true, ...(x.sight && typeof x.sight === 'object' ? { sight: { seen: x.sight.seen === true, why: typeof x.sight.why === 'string' ? x.sight.why.slice(0, 30) : null } } : {}), ...(typeof x.tpos === 'string' ? { tpos: x.tpos } : {}), ...(x.mutual === true ? { mutual: true } : {}) }));
            out.m = mm;
        }
        // Tirs : étape, équipe active, dés, tir en préparation, dernier résultat, jets de fuite, pile d'annulation.
        if (out.phase === 'fire' && raw.f && typeof raw.f === 'object') {
            const rf = raw.f;
            const okId = (x) => typeof x === 'string' && x in out.placed;
            const flags = (o) => { const r = {}; for (const [id, v] of Object.entries(o || {}).slice(0, 12000)) if (okId(id) && v === true) r[id] = true; return r; };
            const roll = (r) => (r && Number.isInteger(r.t1) && Number.isInteger(r.t2) ? { t1: r.t1, t2: r.t2 } : null);
            const ff = { step: ['art', 'tir', 'flee', 'done'].includes(rf.step) ? rf.step : 'done', active: TEAM_IDS.includes(rf.active) ? rf.active : null,
                rolls: { art: roll(rf.rolls?.art), tir: roll(rf.rolls?.tir) }, shot: flags(rf.shot), moved: flags(rf.moved), start: {}, flee: {}, pending: null, last: null, stack: [], snap: { hp: {}, dead: {} } };
            for (const [id, n] of Object.entries(rf.start || {}).slice(0, 12000)) if (okId(id) && Number.isInteger(n) && n >= 0) ff.start[id] = n;
            for (const [id, v] of Object.entries(rf.flee || {}).slice(0, 2000)) if (okId(id)) ff.flee[id] = v && typeof v === 'object' ? { r: Math.floor(Number(v.r) || 0), thr: Math.floor(Number(v.thr) || 0), out: v.out === true, skip: v.skip === true } : null;
            const p = rf.pending;
            const okTile = (k) => typeof k === 'string' && /^\d{1,3},\d{1,3}$/.test(k);
            if (p && okId(p.id) && (okId(p.tid) || (p.mode === 'art' && okTile(p.tile))) && ['art', 'tir'].includes(p.mode) && Array.isArray(p.mods)) {
                ff.pending = { id: p.id, tid: okId(p.tid) ? p.tid : null, ...(okTile(p.tile) ? { tile: p.tile, three: (Array.isArray(p.three) ? p.three : []).slice(0, 3).map((k) => (okTile(k) ? k : null)) } : {}), mode: p.mode, d: Math.floor(Number(p.d) || 0), adj: Math.max(-9, Math.min(9, Math.floor(Number(p.adj) || 0))), los: { ok: p.los?.ok === true, reason: String(p.los?.reason || '').slice(0, 80) },
                    mods: p.mods.slice(0, 20).map((m) => ({ k: String(m.k || '').slice(0, 12), label: String(m.label || '').slice(0, 120), v: Math.max(-9, Math.min(9, Math.floor(Number(m.v) || 0))), ...(m.arm ? { arm: 1 } : {}), on: m.on === true })) };
            }
            try { ff.last = rf.last && typeof rf.last === 'object' ? JSON.parse(JSON.stringify(rf.last).slice(0, 20000)) : null; } catch { ff.last = null; }
            ff.stack = (Array.isArray(rf.stack) ? rf.stack : []).slice(-60).filter((x) => x && typeof x.f === 'string' && x.f.length < 200000).map((x) => ({ f: x.f, tid: okId(x.tid) ? x.tid : null, hp: Array.isArray(x.hp) ? x.hp.map((v) => Number(v) || 0) : null, dead: x.dead === true, extra: (Array.isArray(x.extra) ? x.extra : []).slice(0, 12).filter((e) => e && okId(e.tid)).map((e) => ({ tid: e.tid, hp: Array.isArray(e.hp) ? e.hp.map((v) => Number(v) || 0) : null, dead: e.dead === true })) }));
            for (const [id, arr] of Object.entries(rf.snap?.hp || {}).slice(0, 12000)) if (okId(id) && Array.isArray(arr)) ff.snap.hp[id] = arr.map((v) => Number(v) || 0);
            ff.snap.dead = flags(rf.snap?.dead);
            out.f = ff;
        }
    }
    if (out.phase === 'fire' && (!out.b || !out.f)) out.phase = out.b ? 'orders' : 'locked';
    return out;
}

function normalizeState(raw) {
    const config = sanitizeConfig(raw?.config) || { cols: 150, rows: 100 };
    return {
        config,
        gridData: sanitizeGrid(raw?.gridData, config),
        terrainsList: sanitizeTerrains(raw?.terrainsList ?? raw?.terrains),
        isLocked: Boolean(raw?.isLocked),
        protection: sanitizeProtection(raw?.protection),
        fichesAccess: raw?.fichesAccess !== false, // les joueurs peuvent consulter toutes les fiches d'armée (le MJ peut le refuser)
        fichesFrozen: raw?.fichesFrozen === true, // légions choisies figées : les joueurs ne peuvent plus en changer
        fichesPicks: sanitizePicks(raw?.fichesPicks),
        fichesTeams: sanitizeTeams(raw?.fichesTeams),
        landing: normalizeLanding(raw?.landing)
    };
}

const metaOf = (map) => ({
    id: map.id,
    name: map.name,
    auto: Boolean(map.auto),
    author: map.author || '',
    savedAt: map.savedAt || 0,
    cols: map.config.cols,
    rows: map.config.rows,
    tiles: Object.keys(map.gridData || {}).length
});

/* ------------------------------------------------------------------ */
/* Stockage : Supabase si configuré, sinon fichiers locaux             */
/* ------------------------------------------------------------------ */

const mapFile = (id) => path.join(MAPS_DIR, `${id}.json`);

const fileStorage = {
    label: 'fichiers locaux (data/) : ils sont effacés à chaque redéploiement sur Render gratuit',

    async loadState() {
        if (fs.existsSync(STATE_FILE)) {
            const raw = readJson(STATE_FILE);
            if (raw) return raw;
            const backup = `${STATE_FILE}.corrompu-${Date.now()}`;
            fs.renameSync(STATE_FILE, backup);
            console.error(`⚠️ state.json illisible, copie conservée dans ${backup}`);
        }
        if (fs.existsSync(LEGACY_FILE)) {
            const raw = readJson(LEGACY_FILE);
            if (raw) console.log('✅ Ancien data.json trouvé : il sert de point de départ.');
            return raw;
        }
        return null;
    },
    async saveState(state) {
        writeJsonAtomic(STATE_FILE, state);
    },

    async listMaps() {
        const metas = [];
        for (const file of fs.readdirSync(MAPS_DIR)) {
            if (!file.endsWith('.json')) continue;
            const id = file.slice(0, -5);
            if (!MAP_ID.test(id)) continue;
            const map = readJson(path.join(MAPS_DIR, file));
            if (map && sanitizeConfig(map.config)) metas.push(metaOf({ ...map, id }));
        }
        return metas;
    },
    async getMap(id) {
        return readJson(mapFile(id));
    },
    async putMap(map) {
        writeJsonAtomic(mapFile(map.id), map);
    },
    async renameMap(id, name) {
        const map = readJson(mapFile(id));
        if (!map) throw new Error('Carte introuvable');
        map.name = name;
        map.auto = false; // une carte renommée n'est plus supprimée automatiquement
        writeJsonAtomic(mapFile(id), map);
    },
    async deleteMap(id) {
        try {
            fs.unlinkSync(mapFile(id));
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
    },

    async loadBackground() {
        const raw = readJson(BACKGROUND_FILE);
        if (!raw?.image) return null;
        return { buffer: Buffer.from(raw.image, 'base64'), version: raw.version || 1 };
    },
    async saveBackground(bg) {
        if (!bg) {
            try {
                fs.unlinkSync(BACKGROUND_FILE);
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }
            return;
        }
        writeJsonAtomic(BACKGROUND_FILE, { version: bg.version, image: bg.buffer.toString('base64') });
    },

    async loadDoc(id) {
        if (!DOC_ID.test(id)) throw new Error('Identifiant de document invalide');
        return readJson(path.join(DOCS_DIR, `${id}.json`));
    },
    async saveDoc(id, data) {
        if (!DOC_ID.test(id)) throw new Error('Identifiant de document invalide');
        fs.mkdirSync(DOCS_DIR, { recursive: true });
        writeJsonAtomic(path.join(DOCS_DIR, `${id}.json`), data);
    },

    sessionsCache: null,
    async loadSessions() {
        this.sessionsCache = readJson(SESSIONS_FILE) || {};
        return this.sessionsCache;
    },
    async saveSession(token, session) {
        this.sessionsCache = this.sessionsCache || {};
        this.sessionsCache[token] = session;
        writeJsonAtomic(SESSIONS_FILE, this.sessionsCache);
    },
    async deleteSession(token) {
        this.sessionsCache = this.sessionsCache || {};
        delete this.sessionsCache[token];
        writeJsonAtomic(SESSIONS_FILE, this.sessionsCache);
    }
};

function createSupabaseStorage() {
    const { createClient } = require('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const check = ({ error }) => {
        if (error) throw new Error(error.message);
    };

    return {
        label: 'Supabase (base de données)',

        async loadState() {
            const res = await db.from('app_state').select('data').eq('id', 'main').maybeSingle();
            check(res);
            return res.data?.data ?? null;
        },
        async saveState(state) {
            check(await db.from('app_state').upsert({ id: 'main', data: state, updated_at: new Date().toISOString() }));
        },

        async listMaps() {
            const res = await db.from('saved_maps').select('id,name,auto,author,saved_at,cols,rows,tiles');
            check(res);
            return res.data.map((row) => ({
                id: row.id,
                name: row.name,
                auto: row.auto,
                author: row.author,
                savedAt: Number(row.saved_at),
                cols: row.cols,
                rows: row.rows,
                tiles: row.tiles
            }));
        },
        async getMap(id) {
            const res = await db.from('saved_maps').select('*').eq('id', id).maybeSingle();
            check(res);
            const row = res.data;
            if (!row) return null;
            return {
                id: row.id,
                name: row.name,
                auto: row.auto,
                author: row.author,
                savedAt: Number(row.saved_at),
                config: { cols: row.cols, rows: row.rows },
                // Sans changement de schéma : le débarquement est rangé avec les terrains ({ list, landing }).
                terrainsList: Array.isArray(row.terrains) ? row.terrains : row.terrains?.list,
                landing: Array.isArray(row.terrains) ? null : (row.terrains?.landing ?? null),
                gridData: row.grid
            };
        },
        async putMap(map) {
            check(await db.from('saved_maps').upsert({
                id: map.id,
                name: map.name,
                auto: map.auto,
                author: map.author,
                saved_at: map.savedAt,
                cols: map.config.cols,
                rows: map.config.rows,
                tiles: Object.keys(map.gridData).length,
                terrains: map.landing ? { list: map.terrainsList, landing: map.landing } : map.terrainsList,
                grid: map.gridData
            }));
        },
        async renameMap(id, name) {
            check(await db.from('saved_maps').update({ name, auto: false }).eq('id', id));
        },
        async deleteMap(id) {
            check(await db.from('saved_maps').delete().eq('id', id));
        },

        // Documents divers (fiches d'armée) : même table app_state, un identifiant par document.
        async loadDoc(id) {
            if (!DOC_ID.test(id)) throw new Error('Identifiant de document invalide');
            const res = await db.from('app_state').select('data').eq('id', id).maybeSingle();
            check(res);
            return res.data?.data ?? null;
        },
        async saveDoc(id, data) {
            if (!DOC_ID.test(id)) throw new Error('Identifiant de document invalide');
            check(await db.from('app_state').upsert({ id, data, updated_at: new Date().toISOString() }));
        },

        async loadBackground() {
            const res = await db.from('app_state').select('data').eq('id', 'background').maybeSingle();
            check(res);
            const data = res.data?.data;
            if (!data?.image) return null;
            return { buffer: Buffer.from(data.image, 'base64'), version: data.version || 1 };
        },
        async saveBackground(bg) {
            if (!bg) {
                check(await db.from('app_state').delete().eq('id', 'background'));
                return;
            }
            check(await db.from('app_state').upsert({
                id: 'background',
                data: { version: bg.version, image: bg.buffer.toString('base64') },
                updated_at: new Date().toISOString()
            }));
        },

        async loadSessions() {
            check(await db.from('sessions').delete().lt('last_seen', Date.now() - SESSION_TTL_MS));
            const res = await db.from('sessions').select('*');
            check(res);
            return Object.fromEntries(res.data.map((row) => [row.token, {
                name: row.name,
                isAdmin: row.is_admin,
                fp: row.fp,
                lastSeen: Number(row.last_seen)
            }]));
        },
        async saveSession(token, session) {
            check(await db.from('sessions').upsert({
                token,
                name: session.name,
                is_admin: session.isAdmin,
                fp: session.fp,
                last_seen: session.lastSeen
            }));
        },
        async deleteSession(token) {
            check(await db.from('sessions').delete().eq('token', token));
        }
    };
}

const storage = SUPABASE_URL && SUPABASE_KEY ? createSupabaseStorage() : fileStorage;

/* ------------------------------------------------------------------ */
/* État courant du plateau                                             */
/* ------------------------------------------------------------------ */

let state = null; // chargé au démarrage
let background = null; // { buffer, version } : image de fond de la page de connexion
let saveTimer = null;
let saveChain = Promise.resolve();

// Les peintures arrivent en rafale : on regroupe les écritures et on les sérialise.
function saveNow() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    saveChain = saveChain
        .then(() => storage.saveState(state))
        .catch((err) => {
            console.error('⚠️ Sauvegarde du plateau impossible, nouvel essai bientôt :', err.message);
            scheduleSave(SAVE_RETRY_MS);
        });
    return saveChain;
}

function scheduleSave(delay = SAVE_DELAY_MS) {
    if (!saveTimer) saveTimer = setTimeout(saveNow, delay);
}

/* ------------------------------------------------------------------ */
/* Cartes enregistrées                                                 */
/* ------------------------------------------------------------------ */

const mapsIndex = new Map(); // id -> métadonnées (sans la grille, pour rester léger)

const listMaps = () => [...mapsIndex.values()].sort((a, b) => b.savedAt - a.savedAt);

async function saveMap({ id, name, auto = false }, author) {
    const mapId = id && mapsIndex.has(id) ? id : crypto.randomUUID();
    const map = {
        id: mapId,
        name,
        auto,
        author,
        savedAt: Date.now(),
        config: { ...state.config },
        terrainsList: state.terrainsList.map((t) => ({ ...t })),
        gridData: state.gridData,
        // Débarquement en cours (zones, groupes, bonus, choix, unités posées, étendards) : tout est conservé ;
        // chacun ne voit ensuite que ce que les règles de visibilité de son équipe lui montrent.
        landing: state.landing.phase === 'off' ? null : JSON.parse(JSON.stringify(state.landing))
    };
    await storage.putMap(map);
    const meta = metaOf(map);
    mapsIndex.set(mapId, meta);
    return meta;
}

async function deleteMap(id) {
    await storage.deleteMap(id);
    mapsIndex.delete(id);
}

// Filet de sécurité avant toute action qui écrase le plateau.
async function createAutoBackup(reason, author) {
    if (Object.keys(state.gridData).length === 0) return;

    const stamp = new Date().toLocaleString('fr-FR');
    await saveMap({ name: `Sauvegarde auto (${reason}) ${stamp}`, auto: true }, author);

    const autos = [...mapsIndex.values()].filter((m) => m.auto).sort((a, b) => a.savedAt - b.savedAt);
    while (autos.length > LIMITS.maxAutoBackups) await deleteMap(autos.shift().id);
}

/* ------------------------------------------------------------------ */
/* Authentification admin et sessions                                  */
/* ------------------------------------------------------------------ */

// Code secret de l'administrateur (pseudo MJ) : « mj » par défaut, ou la variable ADMIN_PASSWORD si elle est définie.
function loadAdminPassword() {
    return process.env.ADMIN_PASSWORD || 'mj';
}

const ADMIN_PASSWORD = loadAdminPassword();
const ADMIN_FINGERPRINT = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex').slice(0, 16);

function passwordMatches(input) {
    const hash = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest();
    return crypto.timingSafeEqual(hash(input), hash(ADMIN_PASSWORD));
}

const loginFailures = new Map(); // ip -> { count, blockedUntil }

function isBlocked(ip) {
    const entry = loginFailures.get(ip);
    return Boolean(entry && entry.blockedUntil > Date.now());
}

function registerFailure(ip) {
    const entry = loginFailures.get(ip) || { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_FAILURES) {
        entry.count = 0;
        entry.blockedUntil = Date.now() + LOGIN_BLOCK_MS;
    }
    loginFailures.set(ip, entry);
}

const sessions = new Map(); // jeton -> { name, isAdmin, fp, lastSeen }

function createSession(name, isAdmin) {
    const token = crypto.randomBytes(24).toString('base64url');
    const session = { name, isAdmin, fp: isAdmin ? ADMIN_FINGERPRINT : '', lastSeen: Date.now() };
    sessions.set(token, session);
    storage.saveSession(token, session).catch(logError('Enregistrement de la session'));
    return token;
}

function dropSession(token) {
    if (sessions.delete(token)) storage.deleteSession(token).catch(logError('Suppression de la session'));
}

/* ------------------------------------------------------------------ */
/* Fiches d'armée                                                      */
/* ------------------------------------------------------------------ */

const fiches = {
    ready: false,
    version: '',
    families: [], // formules d'origine
    seedArmies: new Map(), // id -> armée d'origine
    armies: new Map(), // id -> armée modifiée par le MJ
    customStale: [], // armées créées avec une ancienne version des fiches
    custom: new Set(), // ids des armées créées par le MJ (absentes du fichier d'origine)
    famTexts: {}, // id d'une formule d'origine -> texte modifié par le MJ
    famCustom: {} // id -> { col, text } : formules créées par le MJ
};

function loadFichesSeed() {
    const raw = readJson(FICHES_SEED_FILE);
    if (!raw || !Array.isArray(raw.armies)) {
        console.warn('⚠️ fiches-seed.json introuvable : les fiches d’armée sont désactivées.');
        return;
    }
    fiches.version = String(raw.version || 'v1').slice(0, 40);
    fiches.families = Array.isArray(raw.families) ? raw.families : [];
    for (const army of raw.armies) {
        if (army && DOC_ID.test(army.id)) fiches.seedArmies.set(army.id, army);
    }
    fiches.ready = fiches.seedArmies.size > 0;
    console.log(`📜 Fiches d'armée : ${fiches.seedArmies.size} armées (version ${fiches.version}).`);
}

// Les modifications du MJ ne s'appliquent que si elles correspondent à la version du fichier d'origine.
async function loadFichesOverrides() {
    try { landingBackupAt = (await storage.loadDoc('landing_backup'))?.at || 0; } catch { /* sans sauvegarde */ }
    if (!fiches.ready) return;
    const cdoc = await storage.loadDoc('fiches_custom');
    for (const id of Array.isArray(cdoc?.ids) ? cdoc.ids.slice(0, MAX_CUSTOM_ARMIES) : []) {
        if (typeof id === 'string' && DOC_ID.test(id) && !fiches.seedArmies.has(id)) fiches.custom.add(id);
    }
    for (const id of allArmyIds()) {
        const doc = await storage.loadDoc(`fiches_a_${id}`);
        if (doc?.army?.id === id && Array.isArray(doc.army.units) && (doc.version === fiches.version || fiches.custom.has(id))) {
            fiches.armies.set(id, doc.army);
            // Armée créée avec une autre version des fiches : elle est conservée, mais ses formules sont à vérifier.
            if (fiches.custom.has(id) && doc.version !== fiches.version) fiches.customStale.push({ id, name: String(doc.army.name || id).slice(0, 40), version: String(doc.version || '?').slice(0, 20) });
        } else if (fiches.custom.has(id)) fiches.custom.delete(id); // armée créée dont le contenu est introuvable
    }
    const famDoc = await storage.loadDoc('fiches_fams');
    if (famDoc?.version === fiches.version) {
        if (famDoc.texts && typeof famDoc.texts === 'object') fiches.famTexts = famDoc.texts;
        if (famDoc.custom && typeof famDoc.custom === 'object') fiches.famCustom = famDoc.custom;
    }
    console.log(`📜 ${fiches.armies.size} armée(s) modifiée(s) par le MJ, ${Object.keys(fiches.famCustom).length} formule(s) créée(s).`);
}

let landingBackupAt = 0; // dernier instantané du débarquement pris juste avant le verrouillage des placements
const allArmyIds = () => [...fiches.seedArmies.keys(), ...fiches.custom];
const MAX_CUSTOM_ARMIES = 20;
async function saveCustomIds() { await storage.saveDoc('fiches_custom', { ids: [...fiches.custom] }); }
const fichesArmy = (id) => fiches.armies.get(id) || fiches.seedArmies.get(id);

// Formules envoyées au client : celles d'origine puis celles créées par le MJ.
function fichesFamilies() {
    const list = fiches.families.map((f) => ({ id: f.id, col: f.col, rel: f.rel }));
    for (const [id, f] of Object.entries(fiches.famCustom)) list.push({ id, col: f.col, rel: f.text, custom: true });
    return list;
}

function legionFigs(army, lid) {
    let total = 0;
    for (const unit of army.units || []) {
        const q = unit.q?.[lid];
        if (Array.isArray(q) && Number.isFinite(q[0])) total += q[0];
    }
    return total;
}

function legionLabel(army, legion) {
    if (legion?.name) return String(legion.name);
    const id = legion?.id ?? '';
    if (id === 'renfort') return 'Renfort';
    return `Légion ${id}`;
}

const validPick = (armyId, lid) => {
    const army = typeof armyId === 'string' ? fichesArmy(armyId) : null;
    return Boolean(army) && typeof lid === 'string' && lid !== 'ni'
        && (army.legions || []).some((l) => l.id === lid) && legionFigs(army, lid) > 0;
};

// Joueur qui a déjà choisi cette légion (hors lui-même), sinon null.
// Une légion formée de deux armées compte pour une seule : choisir l'une des deux moitiés prend les deux.
function legionGroup(armyId, lid) {
    const l = fichesArmy(armyId)?.legions?.find((x) => x.id === lid);
    const group = [`${armyId}:${lid}`];
    if (l?.partner) group.push(`${l.partner.army}:${l.partner.legion}`);
    return group;
}
function pickTakenBy(armyId, lid, exceptName) {
    const mine = legionGroup(armyId, lid);
    for (const [name, pick] of Object.entries(state.fichesPicks)) {
        if (name !== exceptName && legionGroup(pick.army, pick.legion).some((k) => mine.includes(k))) return name;
    }
    return null;
}

// Supprime les choix qui ne correspondent plus à une légion existante. Renvoie true si quelque chose a changé.
function pruneFichesPicks() {
    let changed = false;
    for (const [name, pick] of Object.entries(state.fichesPicks)) {
        if (!validPick(pick.army, pick.legion)) { delete state.fichesPicks[name]; changed = true; }
    }
    return changed;
}

// Pseudos connus : liste du MJ, choix de légion, équipes et joueurs connectés (hors MJ).
function onlineNames() {
    const names = [];
    for (const sock of io.sockets.sockets.values()) {
        if (sock.data?.name && !sock.data.isAdmin && !names.includes(sock.data.name)) names.push(sock.data.name);
    }
    return names;
}
function knownNames() {
    const set = new Set(state.fichesTeams.roster);
    for (const n of Object.keys(state.fichesPicks)) set.add(n);
    for (const n of Object.keys(state.fichesTeams.members)) set.add(n);
    for (const n of onlineNames()) set.add(n);
    return [...set];
}
// Orthographe officielle d'un pseudo (sans tenir compte des majuscules), ou null s'il est inconnu.
function findName(name) {
    const low = String(name || '').toLowerCase();
    return knownNames().find((n) => n.toLowerCase() === low) || null;
}
const teamLabelOf = (name) => {
    const team = state.fichesTeams.members[name];
    return team ? state.fichesTeams.names[team] : null;
};
function renamePseudo(from, to) {
    const t = state.fichesTeams;
    t.roster = t.roster.map((n) => (n === from ? to : n));
    if (!t.roster.includes(to)) t.roster.push(to);
    if (t.members[from]) { t.members[to] = t.members[from]; delete t.members[from]; }
    if (state.fichesPicks[from]) { state.fichesPicks[to] = state.fichesPicks[from]; delete state.fichesPicks[from]; }
    if (t.mercs[from]) { t.mercs[to] = t.mercs[from]; delete t.mercs[from]; }
}

// Nom de la légion choisie par chaque joueur : public, c'est ce que voient les joueurs en survolant un pseudo.
function fichesPickLabels() {
    const labels = {};
    for (const [name, pick] of Object.entries(state.fichesPicks)) {
        const army = fichesArmy(pick.army);
        const legion = army?.legions?.find((l) => l.id === pick.legion);
        if (army && legion) {
            const team = teamLabelOf(name);
            labels[name] = { army: pick.army, legion: pick.legion, team, text: `${army.name} · ${legionLabel(army, legion)}${team ? ` · ${team}` : ''}` };
        }
    }
    // Joueurs d'une équipe sans légion choisie : l'info-bulle indique seulement l'équipe.
    for (const name of Object.keys(state.fichesTeams.members)) {
        const team = teamLabelOf(name);
        if (team && !labels[name]) labels[name] = { army: null, legion: null, team, text: team };
    }
    return labels;
}

// Catalogue sommaire (sans unités) pour choisir une légion quand les fiches sont fermées.
function fichesCatalog() {
    return allArmyIds().map((id) => {
        const army = fichesArmy(id);
        const legions = (army.legions || [])
            .filter((l) => l.id !== 'ni')
            .map((l) => ({ id: l.id, name: l.name || null, figs: legionFigs(army, l.id), comp: l.comp || null, takenBy: pickTakenBy(id, l.id, null) }))
            .filter((l) => l.figs > 0);
        return { id, name: army.name, legions };
    });
}

// Armées réduites aux seules légions choisies par les joueurs : tout ce que reçoit un joueur quand l'accès est fermé.
function fichesPickedArmies() {
    const byArmy = new Map();
    const add = (armyId, lid) => {
        if (!fichesArmy(armyId)) return;
        if (!byArmy.has(armyId)) byArmy.set(armyId, new Set());
        byArmy.get(armyId).add(lid);
    };
    for (const pick of Object.values(state.fichesPicks)) {
        if (!validPick(pick.army, pick.legion)) continue;
        add(pick.army, pick.legion);
        const partner = fichesArmy(pick.army).legions.find((l) => l.id === pick.legion)?.partner;
        if (partner) add(partner.army, partner.legion);
    }
    return [...byArmy.entries()].map(([armyId, lids]) => {
        const army = fichesArmy(armyId);
        const units = (army.units || [])
            .filter((u) => Object.keys(u.q || {}).some((k) => lids.has(k)))
            .map((u) => ({ ...u, q: Object.fromEntries(Object.entries(u.q).filter(([k]) => lids.has(k))) }));
        return { ...army, legions: army.legions.filter((l) => lids.has(l.id)), units };
    });
}

// Vérifie une fiche envoyée par le MJ avant de l'enregistrer.
function checkFichesArmy(id, army) {
    if (!army || army.id !== id || !(fiches.seedArmies.has(id) || fiches.custom.has(id) || (DOC_ID.test(id) && army.custom === true))) return 'armée inconnue';
    if (army.custom != null && army.custom !== true) return 'armée invalide';
    if (typeof army.name !== 'string' || !army.name.trim() || army.name.length > 40) return 'nom d’armée invalide';
    if (!Array.isArray(army.units) || army.units.length > FICHES_MAX_UNITS) return 'liste d’unités invalide';
    if (!Array.isArray(army.legions) || army.legions.length > 60) return 'liste de légions invalide';
    const ids = new Set();
    for (const l of army.legions) {
        if (!l || typeof l.id !== 'string' || !(LEG_ID.test(l.id)) || ids.has(l.id)) return 'identifiant de légion invalide';
        ids.add(l.id);
        if (l.name != null && (typeof l.name !== 'string' || l.name.length > 40)) return 'nom de légion invalide';
        if (l.comp != null && (typeof l.comp !== 'string' || l.comp.length > 200)) return 'composition invalide';
        if (l.sup != null && !Number.isFinite(l.sup)) return 'supplément invalide';
    }
    for (const u of army.units) {
        if (!u || typeof u !== 'object' || typeof u.in_ !== 'object' || typeof u.q !== 'object') return 'unité invalide';
        for (const k of Object.keys(u.q)) if (!ids.has(k)) return `l’unité référence une légion inexistante (${k.slice(0, 12)})`;
    }
    if (army.bonuses != null && (!Array.isArray(army.bonuses) || army.bonuses.length > 30
        || army.bonuses.some((b) => !b || typeof b.key !== 'string' || !/^[A-Z]{1,2}\d{0,2}$/.test(b.key)
            || typeof b.label !== 'string' || b.label.length > 40))) return 'bonus invalides';
    if (army.params != null && (typeof army.params !== 'object' || Array.isArray(army.params)
        || Object.entries(army.params).some(([k, v]) => !/^[A-Z]{1,2}\d{0,2}$/.test(k)
            || !(v == null || typeof v === 'number' || (typeof v === 'string' && v.length <= 20))))) return 'paramètres de bonus invalides';
    if (army.composites != null && (!Array.isArray(army.composites) || army.composites.length > 60
        || army.composites.some((c) => !c || typeof c.id !== 'string' || !/^[\w-]{1,16}$/.test(c.id) || !ids.has(c.legion)
            || typeof c.base !== 'string' || typeof c.extra !== 'string' || c.base.length > 100 || c.extra.length > 100 || c.base === c.extra
            || (c.std != null && !(Number.isInteger(c.std) && c.std >= 0 && c.std <= 20))
            || (c.per != null ? !(Number.isInteger(c.per) && c.per >= 1 && c.per <= 20) : !(Number.isInteger(c.size) && c.size >= 2 && c.size <= 40))))) return 'unités composées invalides';
    if (army.sections != null && (!Array.isArray(army.sections) || army.sections.length > 60
        || army.sections.some((x) => typeof x !== 'string' || x.length > 80))) return 'sections invalides';
    if (JSON.stringify(army).length > FICHES_MAX_BYTES) return 'fiche trop volumineuse';
    return null;
}


/* ---- Sauvegardes nommées des fiches d'armée (analogue aux cartes) ---- */

const SNAP_ID = /^s[a-z0-9]{3,40}$/;
const SNAPS_INDEX = 'fiches_snaps';
const MAX_SNAPS = 30;
const MAX_AUTO_SNAPS = 5;

async function loadSnapIndex() {
    const doc = await storage.loadDoc(SNAPS_INDEX);
    return Array.isArray(doc?.list) ? doc.list.filter((m) => m && SNAP_ID.test(m.id)) : [];
}
async function saveSnapIndex(list) {
    await storage.saveDoc(SNAPS_INDEX, { list });
}

// État actuel des fiches : uniquement ce que le MJ a modifié (le reste vient de fiches-seed.json).
function currentFichesFile(name) {
    const armies = {};
    for (const [id, army] of fiches.armies) armies[id] = army;
    return {
        kind: 'fiches-armees',
        format: 1,
        version: fiches.version,
        name,
        savedAt: Date.now(),
        armies,
        fams: { texts: fiches.famTexts, custom: fiches.famCustom }
    };
}

// Vérifie un fichier de fiches (sauvegarde ou fichier importé) ; renvoie un message d'erreur ou null.
function checkFichesFile(file) {
    if (!file || typeof file !== 'object' || file.kind !== 'fiches-armees') return 'ce fichier n’est pas une sauvegarde de fiches d’armée';
    if (file.version !== fiches.version) return `version incompatible (fichier ${String(file.version).slice(0, 20)}, serveur ${fiches.version})`;
    if (!file.armies || typeof file.armies !== 'object') return 'armées manquantes';
    const entries = Object.entries(file.armies);
    if (entries.length > 40) return 'trop d’armées';
    for (const [id, army] of entries) {
        const problem = checkFichesArmy(id, army);
        if (problem) return `armée ${String(id).slice(0, 20)} : ${problem}`;
    }
    const f = file.fams;
    if (f != null) {
        if (typeof f !== 'object') return 'formules invalides';
        const seed = new Map(fiches.families.map((x) => [x.id, x]));
        for (const [id, text] of Object.entries(f.texts || {})) if (!seed.has(id) || typeof text !== 'string' || text.length > 2000) return 'formule invalide';
        for (const [id, c] of Object.entries(f.custom || {})) {
            if (!FAM_ID.test(id) || !c || typeof c.text !== 'string' || c.text.length > 2000 || !FAM_COLS.has(c.col)) return 'formule créée invalide';
        }
    }
    return null;
}

async function putSnapshot(id, file, author, auto = false) {
    await storage.saveDoc(`fiches_snap_${id}`, file);
    const list = await loadSnapIndex();
    const meta = { id, name: file.name, savedAt: file.savedAt || Date.now(), author, auto, armies: Object.keys(file.armies).length, customFams: Object.keys(file.fams?.custom || {}).length };
    const i = list.findIndex((m) => m.id === id);
    if (i >= 0) list[i] = meta; else list.push(meta);
    const autos = list.filter((m) => m.auto).sort((a, b) => a.savedAt - b.savedAt);
    while (autos.length > MAX_AUTO_SNAPS) { const old = autos.shift(); list.splice(list.findIndex((m) => m.id === old.id), 1); }
    await saveSnapIndex(list);
    return meta;
}

// Remplace l'état courant des fiches par celui d'un fichier déjà vérifié.
async function applyFichesFile(file) {
    for (const id of [...fiches.custom]) {
        if (!file.armies[id]) { await storage.saveDoc(`fiches_a_${id}`, { version: fiches.version, army: null }); fiches.armies.delete(id); fiches.custom.delete(id); }
    }
    for (const [id, army] of Object.entries(file.armies)) {
        if (!fiches.seedArmies.has(id) && army?.custom === true && DOC_ID.test(id) && fiches.custom.size < MAX_CUSTOM_ARMIES) fiches.custom.add(id);
    }
    await saveCustomIds();
    for (const id of allArmyIds()) {
        const army = file.armies[id];
        if (army) {
            await storage.saveDoc(`fiches_a_${id}`, { version: fiches.version, army });
            fiches.armies.set(id, army);
        } else if (fiches.armies.has(id)) {
            await storage.saveDoc(`fiches_a_${id}`, { version: fiches.version, army: null }); // retour à la version d'origine
            fiches.armies.delete(id);
        }
    }
    fiches.famTexts = { ...(file.fams?.texts || {}) };
    fiches.famCustom = { ...(file.fams?.custom || {}) };
    await storage.saveDoc('fiches_fams', { version: fiches.version, texts: fiches.famTexts, custom: fiches.famCustom });
    pruneFichesPicks();
}

/* ------------------------------------------------------------------ */
/* Débarquement                                                        */
/* ------------------------------------------------------------------ */

const ci = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const keyOf = (obj, name) => Object.keys(obj).find((k) => ci(k, name)) ?? null;

// Voisins d'une case (lignes impaires décalées vers la droite, comme le dessin de la carte).
function hexNeighbors(col, row) {
    const odd = row % 2 === 1;
    const dirs = odd
        ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
        : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
    return dirs.map(([dc, dr]) => [col + dc, row + dr]);
}

// Zones de débarquement : groupes d'au moins 2 cases voisines portant un losange ou un triangle.
function computeZones() {
    const marked = new Set();
    for (const [key, tile] of Object.entries(state.gridData)) {
        if (!tile?.removed && (tile?.mark === 'diamond' || tile?.mark === 'triangle')) marked.add(key);
    }
    const seen = new Set();
    const comps = [];
    for (const start of marked) {
        if (seen.has(start)) continue;
        const comp = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
            const key = stack.pop();
            comp.push(key);
            const [c, r] = key.split(',').map(Number);
            for (const [nc, nr] of hexNeighbors(c, r)) {
                const nk = `${nc},${nr}`;
                if (marked.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
            }
        }
        if (comp.length >= 2) comps.push(comp);
    }
    const minOf = (comp) => comp.map((k) => k.split(',').map(Number)).reduce((m, [c, r]) => (r < m[1] || (r === m[1] && c < m[0]) ? [c, r] : m), [1e9, 1e9]);
    comps.sort((a, b) => { const x = minOf(a); const y = minOf(b); return x[1] - y[1] || x[0] - y[0]; });
    return comps.slice(0, 26).map((tiles, i) => ({ id: String.fromCharCode(97 + i), tiles: tiles.sort() }));
}

// Une case existe si elle est dans la carte et n'a pas été retirée.
function mapHas(col, row) {
    const { cols, rows } = state.config;
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    return !state.gridData[`${col},${row}`]?.removed;
}

// Angle fermé de la carte : une case dont les deux voisines du haut (ou du bas) manquent, ainsi qu'une voisine de côté.
function isClosedCorner(col, row) {
    const odd = row % 2 === 1;
    const has = (dc, dr) => mapHas(col + dc, row + dr);
    const E = has(1, 0);
    const W = has(-1, 0);
    const NW = odd ? has(0, -1) : has(-1, -1);
    const NE = odd ? has(1, -1) : has(0, -1);
    const SW = odd ? has(0, 1) : has(-1, 1);
    const SE = odd ? has(1, 1) : has(0, 1);
    return (!NW && !NE && (!E || !W)) || (!SW && !SE && (!E || !W));
}

// Section 1 d'une zone : les cases d'extrémité (une seule voisine dans la zone) qui ne sont pas dans un angle fermé de la carte.
// Toutes les autres cases (et une extrémité située dans un angle fermé) forment la section 2.
function zoneEnds(zone) {
    const set = new Set(zone.tiles);
    return zone.tiles.filter((key) => {
        const [c, r] = key.split(',').map(Number);
        const inside = hexNeighbors(c, r).filter(([nc, nr]) => set.has(`${nc},${nr}`)).length;
        return inside <= 1 && !isClosedCorner(c, r);
    });
}

// Bonus de chaque section d'une zone : le centre et chaque extrémité (hors angle fermé) ont leur propre valeur.
function sectionBonus(zone) {
    const b = state.landing.bonus[zone.id] || {};
    const ends = {};
    for (const e of zoneEnds(zone)) ends[e] = b.ends?.[e] ?? DEFAULT_BONUS;
    return { mid: b.mid ?? DEFAULT_BONUS, ends };
}

// Recalcule les zones en conservant le groupe et les bonus des zones qui se recouvrent.
function refreshZones() {
    const L = state.landing;
    const old = L.zones;
    const next = computeZones();
    const groups = {};
    const bonus = {};
    for (const z of next) {
        const best = old.map((o) => ({ o, n: o.tiles.filter((t) => z.tiles.includes(t)).length })).sort((a, b) => b.n - a.n)[0];
        if (best && best.n > 0 && L.groups[best.o.id]) groups[z.id] = L.groups[best.o.id];
        if (best && best.n > 0 && L.bonus[best.o.id]) bonus[z.id] = { mid: L.bonus[best.o.id].mid, ends: { ...(L.bonus[best.o.id].ends || {}) } };
    }
    L.zones = next;
    L.groups = groups;
    L.bonus = bonus;
    const ids = new Set(next.map((z) => z.id));
    for (const [n, z] of Object.entries(L.choices)) if (!ids.has(z)) delete L.choices[n];
}

const unitKey = (armyId, u) => u.uid || `${armyId}-r${u.row}`;

// Lignes d'une légion. Pour chaque ligne : nb = nombre total de figurines, U = nombre d'unités (avec leur type),
// E = nombre d'unités portant un étendard. La colonne c des fiches Excel ne sert pas.
// Unités composées : le reste d'une ligne (nombre de figurines non multiple de la taille habituelle) se complète avec une figurine seule.
// size = taille habituelle d'une unité de la ligne de base.
const DEFAULT_COMPOSITES = [
    // Reste d'une ligne complété par une figurine seule (size = taille habituelle d'une unité).
    { army: 'nains', legion: '1', base: 'inf lourde', extra: 'champion sur bouclier', size: 8 },
    { army: 'orcs', legion: '1', base: 'caval lourde (C)', extra: 'champion sur sanglier (C)', size: 4 },
    { army: 'hauts_elfes', legion: '1', base: 'caval lourde (C)', extra: 'commandeur à cheval (C)', size: 4 },
    { army: 'thyranides', legion: '1', base: 'fusiller leger', extra: 'chef', size: 8 },
    { army: 'elfes_noirs', legion: '1', base: 'mage (mag,spe)', extra: 'médusa (mag,spe)', size: 8 },
    // Une unité de 12 archers montée sur l'oliphant (une seule unité : l'oliphant + ses 12 archers).
    { army: 'empire', legion: '3', base: 'oliphant (B)', extra: 'archer (T)', per: 12 },
    // Servants : chaque figurine de machine reçoit 2 servants (extra '@srv' = la ligne de servants de la légion).
    ...[
        ['alliance', '1', ['mitrailleuse (aL)']], ['bretonnie', '1', ['catapulte (art)']],
        ['chaos', '1', ['canon (art)']], ['chaos', '3', ['canon (art)']], ['chaos', '4', ['canon (art)']],
        ['empire', '1', ['canon (art)']], ['empire', '3', ['autel de guerre (aL,mag)', 'canon (art)']], ['empire', '4', ['canon (art)']],
        ['federation', '4', ['arme lourde (aL)']], ['federation', '5', ['arme lourde (aL)']],
        ['gobelins', '1', ['autel de guerre (aL,mag)', 'catapulte (art)']], ['hauts_elfes', '2', ['baliste (aL)']],
        ['ispanie', '1', ['catapulte (art)']], ['morts_vivants', '1', ['autel de guerre (aL,BA,mag)']],
        ['nains', '2', ['canon (art,spe)', 'arme lourde  (aL)']],
        ['orcs', '1', ['catapulte / baliste geante (art)']], ['orcs', '2', ['catapulte / baliste geante (art)', 'baliste (aL)']], ['orcs', '3', ['catapulte / baliste geante (art)']],
        ['saurus', '1', ['baliste (aL,BA)']]
    ].flatMap(([army, legion, machines]) => machines.map((base) => ({ army, legion, base, extra: '@srv', per: 2 })))
];
// Les unités composées d'une armée : celles enregistrées par le MJ (army.composites) ou, à défaut, les associations d'origine.
function compositesOf(army) {
    if (Array.isArray(army.composites)) return army.composites;
    const out = [];
    DEFAULT_COMPOSITES.forEach((c, i) => {
        if (c.army !== army.id) return;
        const b = (army.units || []).find((u) => u.in_?.B === c.base && u.q?.[c.legion]);
        const e = (army.units || []).find((u) => (c.extra === '@srv' ? u.q?.[c.legion]?.[7] === 'srv' : u.in_?.B === c.extra) && u.q?.[c.legion]);
        if (b && e) out.push({ id: `d${i}`, legion: c.legion, base: unitKey(army.id, b), extra: unitKey(army.id, e), ...(c.per ? { per: c.per } : { size: c.size }) });
    });
    return out;
}
function applyComposites(army, lid, lines) {
    for (const c of compositesOf(army)) {
        if (c.legion !== lid) continue;
        const bi = lines.findIndex((l) => l.uid === c.base);
        const ei = lines.findIndex((l) => l.uid === c.extra);
        if (bi < 0 || ei < 0) continue;
        const b = lines[bi], e = lines[ei];
        if (c.per) {
            // Chaque figurine de la ligne de base (une machine) reçoit `per` figurines de l'autre ligne (les servants) : une unité composée par machine.
            const k = Math.min(b.figs, Math.floor(e.figs / c.per));
            if (k <= 0) continue;
            const comp = {
                uid: `${b.uid}+${e.uid}`, name: `${b.name} + ${e.name}`.slice(0, 60), qty: k, figs: k * (1 + c.per), type: b.type, kin: b.kin, pf: e.pf, pv: (b.pf || 0) + c.per * (e.pf || 0),
                stdMax: 0, dep: Math.min(b.dep, e.dep), army: b.army, legion: b.legion,
                comp: [{ name: b.name, figs: 1, uid: b.uid }, { name: e.name, figs: c.per, uid: e.uid }]
            };
            const left = b.figs - k;
            // Étendards de la ligne de base : d'abord aux unités restées simples, le reste aux unités composées.
            comp.stdMax = Math.min(k, Math.max(0, b.stdMax - left));
            if (c.std != null) comp.stdMax = Math.min(k, c.std); // réglé par le MJ
            const out = [];
            lines.forEach((l, i) => {
                if (i === bi) { out.push(comp); if (left > 0) out.push({ ...b, qty: left, figs: left, stdMax: Math.min(b.stdMax, left) }); }
                else if (i === ei) { const rest = e.figs - k * c.per; if (rest > 0) out.push({ ...e, figs: rest }); }
                else out.push(l);
            });
            lines = out;
            continue;
        }
        const full = Math.floor(b.figs / c.size);
        const rest = b.figs - full * c.size;
        if (rest <= 0) continue;
        const comp = {
            uid: `${b.uid}+${e.uid}`, name: `${b.name} + ${e.name}`.slice(0, 60), qty: 1, figs: rest + e.figs, type: b.type, kin: b.kin, pf: b.pf, pv: rest * (b.pf || 0) + e.figs * (e.pf || 0),
            stdMax: 0, dep: Math.min(b.dep, e.dep), army: b.army, legion: b.legion,
            comp: [{ name: b.name, figs: rest, uid: b.uid }, { name: e.name, figs: e.figs, uid: e.uid }]
        };
        // Étendards de la ligne de base : d'abord aux unités restées simples, le reste (s'il y en a) à l'unité composée.
        comp.stdMax = (e.stdMax > 0 || b.stdMax - full > 0) ? 1 : 0; // la figurine seule portait déjà un étendard : l'unité composée le garde
        if (c.std != null) comp.stdMax = Math.min(1, c.std); // réglé par le MJ
        const out = lines.filter((_, i) => i !== bi && i !== ei);
        const at = Math.min(bi, ei);
        const repl = [];
        if (full > 0) repl.push({ ...b, qty: full, figs: full * c.size, stdMax: Math.min(b.stdMax, full) });
        repl.push(comp);
        out.splice(at, 0, ...repl);
        lines = out;
    }
    return lines;
}
function legionLines(army, lid) {
    return applyComposites(army, lid, legionLinesRaw(army, lid));
}
function legionLinesRaw(army, lid) {
    return (army.units || []).filter((u) => Array.isArray(u.q?.[lid]) && u.q[lid][0] > 0).map((u) => {
        const q = u.q[lid];
        const units = Math.max(1, Math.min(400, Math.floor(Number(q[6]) || 1)));
        return {
            uid: unitKey(army.id, u),
            name: String(u.in_?.B || 'unité').slice(0, 60),
            qty: units,
            figs: Math.max(0, Math.floor(Number(q[0]) || 0)),
            type: String(q[7] || '').slice(0, 12),
            stdMax: Math.max(0, Math.min(units, Math.floor(Number(q[2]) || 0))),
            pv: Number(q[3]) > 0 ? Number(q[3]) / units : 0, // valeur d'une unité (sert au code couleur)
            pf: Number(q[3]) > 0 && Number(q[0]) > 0 ? Number(q[3]) / Number(q[0]) : 0, // valeur d'une figurine
            dep: Number.isFinite(Number(u.in_?.I)) ? Math.floor(Number(u.in_.I)) : 0,
            kin: String(u.in_?.K ?? '').trim().slice(0, 3), // m marche, v vol, vs vol stationnaire, j saut, s nage
            army: army.id,
            legion: lid
        };
    });
}

// Une légion peut être formée de deux armées (Elfes sylvains + Thyranides) : ses lignes viennent des deux fiches.
function rosterFor(name) {
    const pickKey = keyOf(state.fichesPicks, name);
    if (!pickKey) return [];
    const pick = state.fichesPicks[pickKey];
    const army = fichesArmy(pick.army);
    if (!army) return [];
    const lines = legionLines(army, pick.legion);
    const partner = army.legions?.find((l) => l.id === pick.legion)?.partner;
    const partnerArmy = partner ? fichesArmy(partner.army) : null;
    if (partnerArmy) lines.push(...legionLines(partnerArmy, partner.legion));
    // Mercenaires : lignes d'infanterie légère ajoutées par le MJ, sans étendard.
    for (const m of state.fichesTeams.mercs[keyOf(state.fichesTeams.mercs, name) ?? ''] || []) {
        lines.push({ uid: `merc-${m.id}`, name: `${m.name} (merc.)`.slice(0, 60), qty: m.units, figs: m.figsPerUnit * m.units, type: m.type, stdMax: 0, dep: m.dep, army: m.army, legion: m.legion, merc: true, pv: Number(m.ptsUnit) > 0 ? Number(m.ptsUnit) : 0 });
    }
    return lines.slice(0, 120);
}

const unitIdOf = (owner, uid, i) => `${owner}|${uid}#${i}`;
function findLine(owner, id) {
    const ownerKey = keyOf(state.landing.roster, owner);
    if (!ownerKey) return null;
    const m = /^(.*)\|(.*)#(\d+)$/.exec(String(id));
    if (!m || !ci(m[1], ownerKey)) return null;
    const line = state.landing.roster[ownerKey].find((l) => l.uid === m[2]);
    const idx = Number(m[3]);
    return line && idx >= 1 && idx <= line.qty ? { owner: ownerKey, line, idx, id: unitIdOf(ownerKey, line.uid, idx) } : null;
}

const teamOfName = (name) => {
    const k = keyOf(state.fichesTeams.members, name);
    return k ? state.fichesTeams.members[k] : null;
};
const groupOfTeam = (team) => state.landing.teamEntry?.[team] ?? null;
const zoneById = (id) => state.landing.zones.find((z) => z.id === id);

// Ce que chaque personne a le droit de voir. Les zones sont publiques dès qu'elles existent ; les choix et les unités
// de l'autre équipe restent cachés jusqu'au verrouillage, y compris pour le MJ s'il joue dans une équipe.
function landingViewFor(socket) {
    const L = state.landing;
    const admin = Boolean(socket.data.isAdmin);
    // MJ en mode test : il voit le jeu comme le joueur qu'il incarne (ses unités, sa zone, son équipe).
    const testAs = admin && L.test?.on && socket.data.testAs ? socket.data.testAs : null;
    const name = testAs || socket.data.name;
    const base = { phase: L.phase, admin, teamNames: { ...state.fichesTeams.names }, test: { on: Boolean(L.test?.on), ...(admin && L.test?.on ? { players: testPlayers(), as: socket.data.testAs || null } : {}) } };
    if (L.phase === 'off') return base;

    const teamOf = (n) => state.fichesTeams.members[keyOf(state.fichesTeams.members, n) ?? ''] ?? null;
    const players = Object.keys(state.fichesTeams.members).filter((n) => state.fichesTeams.members[n]);
    const myTeam = name && !(admin && L.test?.on && !testAs) ? teamOfName(name) : null; // MJ en mode test sans joueur choisi : il voit tout, comme un arbitre
    const myGroup = myTeam ? groupOfTeam(myTeam) : null;
    const everything = ['locked', 'bplace', 'orders', 'move', 'fire'].includes(L.phase) || (admin && !myTeam); // un MJ sans équipe arbitre et voit tout
    const sees = (n) => everything || (myTeam && teamOf(n) === myTeam);

    const view = { ...base, myTeam, myGroup, teamEntry: (everything || admin) ? L.teamEntry : (myTeam && myGroup ? { [myTeam]: myGroup } : null) };
    view.zones = L.zones.map((z) => ({ id: z.id, tiles: z.tiles, group: L.groups[z.id] ?? null, ends: zoneEnds(z), bonus: sectionBonus(z) }));
    if (L.phase === 'zones') {
        if (admin) view.groupCount = { A: Object.values(L.groups).filter((g) => g === 'A').length, B: Object.values(L.groups).filter((g) => g === 'B').length };
        return view;
    }
    if (admin) view.backupAt = landingBackupAt || null;
    view.choices = {};
    for (const [n, z] of Object.entries(L.choices)) if (sees(n)) view.choices[n] = z;
    view.bound = Boolean(name && keyOf(L.roster, name));
    view.myZone = name && keyOf(L.choices, name) ? L.choices[keyOf(L.choices, name)] : null;
    view.players = players.map((n) => ({
        name: n, team: teamOf(n), pick: Boolean(keyOf(state.fichesPicks, n)), chosen: Boolean(keyOf(L.choices, n)), bound: Boolean(keyOf(L.roster, n)),
        zone: sees(n) ? (L.choices[keyOf(L.choices, n) ?? ''] ?? null) : null
    })).filter((p) => everything || admin || p.team === myTeam);
    if (BOARD_PHASES.includes(L.phase)) {
        view.lines = [];
        view.placed = {};
        view.std = [];
        view.gen = {};
        view.chev = {};
        view.sim = {};
        const simSees = (n) => (admin && !myTeam) || (myTeam && teamOf(n) === myTeam); // chacun ne voit que les simulations de son équipe
        for (const [owner, list] of Object.entries(L.roster)) {
            if (!sees(owner)) continue;
            if (L.gen?.[owner]) view.gen[owner] = L.gen[owner];
            if (L.chev?.[owner]) view.chev[owner] = L.chev[owner];
            if (simSees(owner)) for (const l of list) for (let i = 1; i <= l.qty; i++) { const sid = unitIdOf(owner, l.uid, i); if (L.sim?.[sid]) view.sim[sid] = L.sim[sid].tile; }
            for (const l of list) {
                view.lines.push({ ...l, owner, team: teamOf(owner), caps: lineCaps(l) });
                for (let i = 1; i <= l.qty; i++) {
                    const id = unitIdOf(owner, l.uid, i);
                    if (L.placed[id]) view.placed[id] = L.placed[id];
                    if (L.std[id]) view.std.push(id);
                }
            }
        }
        if (L.b && ['bplace', 'orders', 'move', 'fire'].includes(L.phase)) {
            const b = L.b;
            const mineOrAdmin = (n) => (admin && !myTeam) || (myTeam && teamOf(n) === myTeam) || b.revealed;
            const left = (cid) => { const r = { t1: 0, t2: 0 }; for (const u of allBattleUnits()) if (b.ucl?.[u.id] === cid && !b.done[u.id] && r[u.team] != null) r[u.team]++; return r; };
            view.b = { first: b.first, active: b.active, turn: b.turn,
                clusters: (b.clusters || []).map((c, i) => ({ id: i, secs: c.secs, active: c.active, roll: c.roll, left: left(i) })),
                actors: L.phase === 'bplace' && myTeam ? allBattleUnits().filter((u) => ci(u.owner, name || '') && !b.done[u.id] && b.clusters?.[b.ucl?.[u.id]]?.active === myTeam).map((u) => u.id) : [], roll: b.roll, revealed: b.revealed, pos: { ...b.pos }, orient: { ...b.orient }, done: { ...b.done },
                orders: {}, gorders: {}, ready: {}, log: b.log.slice(-25), allPlaced: allBattleUnits().every((u) => b.done[u.id] || !L.placed[u.id]), stackLen: b.stack.length,
                // Unités jamais déposées au débarquement : elles ne sont pas sur le plateau et ne participent pas à la bataille.
                undeposited: allBattleUnits().filter((u) => !L.placed[u.id]).map((u) => ({ id: u.id, owner: u.owner, team: u.team, name: `${u.line.name} ${u.idx}` })) };
            for (const [id, o] of Object.entries(b.orders)) if (b.revealed || mineOrAdmin(id.slice(0, id.indexOf('|')))) view.b.orders[id] = o; // ordres retournés : visibles de tous
            view.b.given = Object.keys(b.orders); // tout le monde voit qu'une unité a reçu un ordre, sans savoir lequel
            for (const [n, g] of Object.entries(b.gorders)) if (mineOrAdmin(n)) view.b.gorders[n] = g;
            for (const [n, v] of Object.entries(b.ready)) if ((admin && !myTeam) || (myTeam && teamOf(n) === myTeam) || admin) view.b.ready[n] = v;
            // Pertes : figurines restantes / total pour les unités touchées, unités détruites.
            view.b.dead = { ...(b.dead || {}) };
            if (b.anim) view.b.anim = b.anim;
            view.b.alive = {};
            for (const id of Object.keys(b.hp || {})) { const u = findUnitAny(id); if (u) view.b.alive[id] = [aliveCount(u), unitTemplate(u).figs.length]; }
            if (L.phase === 'fire' && L.f) {
                const f = L.f;
                view.f = { step: f.step, active: f.active, rolls: f.rolls, pending: f.pending, last: f.last, flee: f.flee, stackLen: f.stack.length, actors: [], targets: {}, modes: {}, left: { t1: 0, t2: 0 } };
                if (f.step === 'art' || f.step === 'tir') {
                    for (const u of fireShooters(f.step)) {
                        if (view.f.left[u.team] != null) view.f.left[u.team]++;
                        if (u.team !== f.active || !(admin || (name && ci(u.owner, name)))) continue;
                        view.f.actors.push(u.id);
                        view.f.targets[u.id] = fireTargets(u, f.step).slice(0, 25).map(({ t, d }) => ({ id: t.id, d, los: visionCheck(u, t).seen }));
                    }
                }
                if (f.pending) {
                    const su = findUnitAny(f.pending.id), tu = findUnitAny(f.pending.tid);
                    if (su && f.pending.mode === 'art') {
                        const pts = aliveProfiles(su).filter((p) => p.art).length;
                        view.f.pending = { ...f.pending, points: pts, dice: pts };
                    } else if (su && tu) {
                        const pts = aliveProfiles(su).reduce((t, p) => t + (f.pending.mode === 'art' ? (p.art ? 1 : 0) : (p.tir?.att || 0)), 0);
                        view.f.pending = { ...f.pending, thr: fireThreshold(f.pending), points: pts, dice: f.pending.mode === 'art' ? pts : attackDice(pts).length, arm: armourOf(tu, f.pending), melee: inMelee(tu) };
                    }
                }
            }
            if (L.phase === 'move' && L.m) {
                const m = L.m;
                view.m = { step: m.step, qi: m.qi, active: m.active, roll: m.roll || null, moved: { ...m.moved }, stackLen: m.stack.length, snap: m.snap || null,
                    queue: m.queue.map((x) => ({ id: x.id, target: x.target, dist: x.dist, tie: x.tie, ...(x.res ? { res: x.res } : {}), ...(x.failed ? { failed: true } : {}), ...(x.mutual ? { mutual: true, plan: x.plan ? { n: x.plan.n, contact: x.plan.contact, none: x.plan.none || false, roll: x.plan.roll || null, choice: x.plan.choice ? { unit: x.plan.choice.unit, ...(x.plan.choice.cancel ? { cancel: true, tie: x.plan.choice.tie } : {}), ...(x.plan.choice.bridge ? { bridge: true, tie: x.plan.choice.tie } : {}) } : null } : null } : {}) })), actors: [], allow: {}, left: eligibleMovers().length };
                const cur = m.step === 'charge' ? m.queue[m.qi] : null;
                const actors = m.step === 'charge' ? (cur ? allBattleUnits().filter((u) => u.id === (cur.mutual && cur.plan?.choice ? cur.plan.choice.unit : cur.id)) : []) : (m.step === 'move' ? eligibleMovers().filter((u) => u.team === m.active) : []);
                for (const u of actors) {
                    if (!admin && !(name && ci(u.owner, name))) continue;
                    view.m.actors.push(u.id);
                    view.m.allow[u.id] = moveAllowed(u);
                }
            }
        }
        if (admin) {
            view.progress = players.map((n) => {
                const list = L.roster[keyOf(L.roster, n) ?? ''] || [];
                const total = list.reduce((t, l) => t + l.qty, 0);
                const placed = list.reduce((t, l) => { let k = 0; for (let i = 1; i <= l.qty; i++) if (L.placed[unitIdOf(keyOf(L.roster, n), l.uid, i)]) k++; return t + k; }, 0);
                return { name: n, team: teamOf(n), total, placed };
            });
        }
    }
    return view;
}

function releaseLandingPlayer(name) {
    const L = state.landing;
    const rk = keyOf(L.roster, name);
    if (rk) {
        for (const l of L.roster[rk]) for (let i = 1; i <= l.qty; i++) { const id = unitIdOf(rk, l.uid, i); delete L.placed[id]; delete L.std[id]; }
        delete L.roster[rk];
    }
    const ck = keyOf(L.choices, name);
    if (ck) delete L.choices[ck];
}

// Pendant le dépôt, les mercenaires ajoutés ou retirés par le MJ arrivent (ou partent) dans le secteur du joueur.
function syncLandingMercs(name) {
    const L = state.landing;
    if (L.phase !== 'place') return false;
    const rk = keyOf(L.roster, name);
    if (!rk) return false;
    const fresh = rosterFor(rk).filter((l) => l.merc);
    const keep = L.roster[rk].filter((l) => !l.merc || fresh.some((f) => f.uid === l.uid));
    for (const l of L.roster[rk]) {
        if (l.merc && !fresh.some((f) => f.uid === l.uid)) for (let i = 1; i <= l.qty; i++) { const id = unitIdOf(rk, l.uid, i); delete L.placed[id]; delete L.std[id]; }
    }
    for (const f of fresh) if (!keep.some((l) => l.uid === f.uid)) keep.push(f);
    L.roster[rk] = keep;
    purgeLandingHistory();
    return true;
}

// Distance en hexagones (grille en lignes décalées, comme sur la carte).
function hexDistance(a, b) {
    const cube = (key) => { const [c, r] = key.split(',').map(Number); const x = c - (r - (r & 1)) / 2; return [x, -x - r, r]; };
    const [x1, y1, z1] = cube(a);
    const [x2, y2, z2] = cube(b);
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}
const GENERAL_RADIUS = 6;
// Empire (bonus d'armée « général d'exception ») : portée du général 9 hexagones au lieu de 6.
// Pouvoir du général en vigueur pour ce tour : aucun si l'unité du général est détruite (ses pouvoirs disparaissent).
// Modification du terrain interdite dès qu'un joueur a validé ses ordres, puis pendant les déplacements et les tirs du tour.
function battleEditLock() {
    const L = state.landing;
    if (!L.b) return null;
    if (L.phase === 'move' || L.phase === 'fire') return 'Terrain figé : les ordres de ce tour sont révélés. Modifiez la carte au tour suivant, pendant la pose des ordres.';
    if (L.phase === 'orders' && Object.keys(L.b.ready || {}).length) return 'Terrain figé : des ordres ont déjà été validés (une modification pourrait faire échouer des charges). Faites annuler les validations, ou attendez le tour suivant.';
    return null;
}
function genAlive(owner) { const L = state.landing, g = L.gen?.[owner]; return Boolean(g && !L.b?.dead?.[g]); }
function genPower(owner) { return genAlive(owner) ? (state.landing.b?.gorders?.[owner] ?? null) : null; }
function genRadius(owner) {
    const L = state.landing, g = L.gen?.[owner];
    const f = g ? findLine(owner, g) : null;
    return f?.line?.army === 'empire' ? 9 : GENERAL_RADIUS;
}
// Le général et le chevron actif n'ont de sens que si leur unité est posée ; le chevron doit rester à 6 hexagones ou moins du général.
function pruneGeneral() {
    const L = state.landing;
    L.gen = L.gen || {}; L.chev = L.chev || {};
    for (const [n, id] of Object.entries(L.gen)) if (!L.placed[id] || !findLine(n, id)) delete L.gen[n];
    for (const [n, id] of Object.entries(L.chev)) {
        const g = L.gen[n];
        const pg = unitPos(g), pc = unitPos(id); // positions de bataille si elles existent, sinon de dépôt
        if (!g || !pg || !pc || !findLine(n, id) || hexDistance(pg, pc) > genRadius(n)) delete L.chev[n];
    }
}

// Simulation : elle ne vaut que tant que l'unité reste sur sa tuile de dépôt (sinon elle revient à sa position de départ) et, pour une unité qui avait un bonus de général, tant que ce bonus existe.
function pruneSim() {
    const L = state.landing;
    L.sim = L.sim || {};
    for (const [id, v] of Object.entries(L.sim)) {
        const owner = id.slice(0, Math.max(0, id.indexOf('|')));
        if (!L.placed[id] || L.placed[id] !== v.from || !findLine(owner, id) || (v.bonus && L.gen[owner] !== id && L.chev[owner] !== id)) delete L.sim[id];
    }
}

/* ---------- Bataille : placement à tour de rôle, puis ordres ---------- */

function allBattleUnits() {
    const L = state.landing;
    const out = [];
    for (const [owner, list] of Object.entries(L.roster)) {
        const team = teamOfName(owner);
        for (const line of list) for (let i = 1; i <= line.qty; i++) out.push({ id: unitIdOf(owner, line.uid, i), owner, team, line, idx: i });
    }
    return out;
}
const unitPos = (id) => (state.landing.b?.dead?.[id] ? null : (state.landing.b?.pos?.[id] ?? state.landing.placed[id] ?? null)); // une unité détruite quitte le plateau
function findUnitAny(id) {
    const owner = String(id).slice(0, Math.max(0, String(id).indexOf('|')));
    const rk = keyOf(state.landing.roster, owner);
    return rk ? findLine(rk, id) && { ...findLine(rk, id), team: teamOfName(rk) } : null;
}
function battleLog(text) {
    const b = state.landing.b;
    if (!b) return;
    b.log.push({ t: Date.now(), text: String(text).slice(0, 200) });
    if (b.log.length > 40) b.log.shift();
}
const rollD = (n) => crypto.randomInt(1, n + 1);
// Jet visible de tous : le client anime les dés 2 secondes puis affiche le résultat. dice : [{ label, sides, v, ok? }].
// opts.who : joueurs directement concernés (les autres voient le jet en miniature) ; opts.tiles : tuiles du combat (la fenêtre se place loin d'elles).
function announceRoll(title, dice, text, opts = {}) {
    const b = state.landing.b;
    if (!b || !dice.length) return;
    b.anim = { id: crypto.randomUUID().slice(0, 8), title: String(title).slice(0, 80), dice: dice.slice(0, 40), text: String(text || '').slice(0, 200),
        ...(Array.isArray(opts.who) && opts.who.length ? { who: opts.who.filter(Boolean).slice(0, 12) } : {}), ...(Array.isArray(opts.tiles) ? { tiles: opts.tiles.filter(Boolean).slice(0, 12) } : {}) };
}
const tName = (t) => state.fichesTeams.names[t] || (t === 't1' ? 'Équipe 1' : 'Équipe 2');
// Annonce du dé d'initiative et des dés de secteur (placement en parallèle).
function announceInitiative(title) {
    const b = state.landing.b;
    const shared = (b.clusters || []).map((c, i) => ({ c, i })).filter((x) => x.c.roll);
    // Ce dé ne sert qu'au placement ; un nouveau dé désigne à chaque tour l'équipe qui commence les déplacements.
    if (!shared.length) { battleLog('🗺️ Secteurs séparés : les deux équipes placent en même temps (pas de dé).'); return; }
    const dice = [];
    for (const { c, i } of shared) dice.push({ label: `Secteur ${i + 1} · ${tName('t1')}`, sides: 10, v: c.roll.t1, ok: c.first === 't1' }, { label: `Secteur ${i + 1} · ${tName('t2')}`, sides: 10, v: c.roll.t2, ok: c.first === 't2' });
    if (shared.length === 1) dice.forEach((d) => { d.label = d.label.replace(/^Secteur \d+ · /, ''); });
    const text = shared.length === 1 ? `${tName(shared[0].c.first)} place en premier.` : `${shared.map(({ c, i }) => `secteur ${i + 1} : ${tName(c.first)} place en premier`).join(' ; ')}.`;
    announceRoll(title, dice, text);
    battleLog(`🎲 ${title} : ${shared.map(({ c, i }) => `${shared.length > 1 ? `secteur ${i + 1} ` : ''}${tName('t1')} ${c.roll.t1} · ${tName('t2')} ${c.roll.t2}`).join(' ; ')} → ${text}`);
}
// Dé d'initiative : chaque équipe lance un d10, on relance en cas d'égalité.
function rollInitiative() {
    let roll;
    do { roll = { t1: rollD(10), t2: rollD(10) }; } while (roll.t1 === roll.t2); // d10 pour limiter les égalités (tous les tirages au sort)
    return { roll, first: roll.t1 > roll.t2 ? 't1' : 't2' };
}
// Aires des sections (même calcul que l'aire de bonus du client) : régions de la carte délimitées par les frontières (disques, triangles hors zones),
// les marqueurs +, les extrémités de zones et les bords. Deux marqueurs alignés et séparés d'une tuile forment un segment.
const sEdge = (a, b) => `${a}|${b}`;
function gapTilesS(keys) {
    const set = new Set(keys), out = new Set();
    for (const key of keys) { const [c, r] = key.split(',').map(Number); if (set.has(`${c + 2},${r}`)) out.add(`${c + 1},${r}`); }
    return out;
}
function gapEdgesS(keys) {
    const set = new Set(keys), out = new Set();
    for (const key of keys) {
        const [c, r] = key.split(',').map(Number);
        if (!set.has(`${c},${r + 2}`)) continue;
        const lower = new Set(hexNeighbors(c, r + 2).map(([x, y]) => `${x},${y}`));
        const common = hexNeighbors(c, r).map(([x, y]) => `${x},${y}`).filter((k) => lower.has(k));
        if (common.length === 2) { out.add(sEdge(common[0], common[1])); out.add(sEdge(common[1], common[0])); }
    }
    return out;
}
function frontierMarkers() {
    const zoneTiles = new Set(state.landing.zones.flatMap((z) => z.tiles));
    return Object.entries(state.gridData).filter(([k, t]) => !t?.removed && (t?.mark === 'disc' || (t?.mark === 'triangle' && !zoneTiles.has(k)))).map(([k]) => k);
}
function sectionAreas(zone, whole) { // whole : toutes les régions qui touchent la section (regroupement des secteurs)
    const zones = state.landing.zones;
    const endsOf = new Map(zones.map((z) => [z.id, zoneEnds(z)]));
    const myEnds = endsOf.get(zone.id) || [];
    const endTiles = new Set(zones.flatMap((z) => endsOf.get(z.id)));
    const markers = frontierMarkers();
    const crosses = Object.entries(state.gridData).filter(([, t]) => t?.mark === 'cross' && !t.removed).map(([k]) => k);
    const lines = [...markers, ...crosses, ...endTiles];
    const boundary = new Set([...markers, ...crosses, ...gapTilesS(lines), ...endTiles]);
    const edges = gapEdgesS(lines);
    const zoneSet = new Set(zone.tiles);
    const free = (k) => { const [c, r] = k.split(',').map(Number); return mapHas(c, r) && !boundary.has(k) && !zoneSet.has(k); };
    const compOf = new Map(), comps = [];
    const grow = (seed) => {
        const id = comps.length, set = new Set([seed]);
        comps.push(set); compOf.set(seed, id);
        let fr = [seed];
        while (fr.length) {
            const next = [];
            for (const key of fr) {
                const [c0, r0] = key.split(',').map(Number);
                for (const [nc, nr] of hexNeighbors(c0, r0)) {
                    const nk = `${nc},${nr}`;
                    if (compOf.has(nk) || !free(nk) || edges.has(sEdge(key, nk))) continue;
                    compOf.set(nk, id); set.add(nk); next.push(nk);
                }
            }
            fr = next;
        }
        return id;
    };
    const touching = (tile) => {
        const ids = new Set();
        const [c0, r0] = tile.split(',').map(Number);
        for (const [nc, nr] of hexNeighbors(c0, r0)) { const nk = `${nc},${nr}`; if (free(nk)) ids.add(compOf.get(nk) ?? grow(nk)); }
        return ids;
    };
    const endSet = new Set(myEnds);
    const midTiles = zone.tiles.filter((t) => !endSet.has(t));
    const midComps = new Set();
    if (midTiles.length) {
        const count = new Map();
        for (const t of midTiles) for (const id of touching(t)) count.set(id, (count.get(id) || 0) + 1);
        const max = Math.max(0, ...count.values());
        if (max > 0) for (const [id, n] of count) if (n === max) midComps.add(id);
    }
    const out = new Map();
    const collect = (ids) => { const a = new Set(); for (const id of ids) for (const k of comps[id]) a.add(k); return a; };
    if (midTiles.length) out.set(`${zone.id}:mid`, collect(midComps));
    for (const e of myEnds) out.set(`${zone.id}:${e}`, collect([...touching(e)].filter((id) => whole || !midComps.has(id))));
    return out;
}
// Placement en parallèle : un secteur = groupe de sections de débarquement (extrémités et centre de chaque zone) qui se touchent,
// ou dont les aires se touchent ou bordent une même frontière (ligne de disques ou de triangles) : les deux camps se font face.
// Chaque secteur alterne entre équipes (le premier secteur disputé utilise le dé d'initiative, les autres ont leur dé) ; les secteurs séparés jouent en même temps.
function buildClusters() {
    const L = state.landing, b = L.b;
    const tileSec = new Map();
    for (const z of L.zones) {
        const ends = new Set(zoneEnds(z));
        for (const t of z.tiles) tileSec.set(t, `${z.id}:${ends.has(t) ? t : 'mid'}`);
    }
    const units = allBattleUnits();
    const used = new Map();
    for (const u of units) {
        const h = L.placed[u.id];
        const k = h ? tileSec.get(h) : null;
        if (k) used.set(k, [...(used.get(k) || []), u]);
    }
    const parent = new Map([...used.keys()].map((k) => [k, k]));
    const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    for (const [t, k] of tileSec) {
        if (!used.has(k)) continue;
        const [c, r] = t.split(',').map(Number);
        for (const [nc, nr] of hexNeighbors(c, r)) {
            const k2 = tileSec.get(`${nc},${nr}`);
            if (k2 && k2 !== k && used.has(k2)) parent.set(find(k), find(k2));
        }
    }
    // Aires qui se touchent ou bordent la même frontière.
    const areaOf = new Map();
    for (const z of L.zones) for (const [k, a] of sectionAreas(z, true)) if (used.has(k)) areaOf.set(k, a);
    const front = new Set(frontierMarkers());
    for (const t of gapTilesS([...front])) front.add(t);
    const reach = new Map(); // aire + frontières et tuiles voisines de l'aire
    for (const [k, a] of areaOf) {
        const r = new Set(a);
        for (const t of a) { const [c, rr] = t.split(',').map(Number); for (const [nc, nr] of hexNeighbors(c, rr)) { const nk = `${nc},${nr}`; if (front.has(nk) || a.has(nk) === false) r.add(nk); } }
        reach.set(k, r);
    }
    const keys = [...areaOf.keys()];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const A = areaOf.get(keys[i]), RA = reach.get(keys[i]), RB = reach.get(keys[j]), B = areaOf.get(keys[j]);
        let hit = false;
        for (const t of B) if (RA.has(t)) { hit = true; break; } // aires voisines ou communes
        if (!hit) for (const t of RA) if (front.has(t) && RB.has(t)) { hit = true; break; } // même frontière
        if (!hit) for (const t of A) if (RB.has(t)) { hit = true; break; }
        if (hit) parent.set(find(keys[i]), find(keys[j]));
    }
    const groups = new Map();
    for (const k of used.keys()) { const g = find(k); groups.set(g, [...(groups.get(g) || []), k]); }
    b.clusters = []; b.ucl = {};
    let globalUsed = false;
    for (const secs of groups.values()) {
        const id = b.clusters.length;
        const us = secs.flatMap((k) => used.get(k));
        for (const u of us) b.ucl[u.id] = id;
        const teams = new Set(us.map((u) => u.team).filter(Boolean));
        let roll = null, first = [...teams][0] || 't1';
        let global = false;
        if (teams.has('t1') && teams.has('t2')) {
            if (!globalUsed && b.roll) { roll = { ...b.roll }; first = b.first; global = globalUsed = true; } // un seul dé quand il n'y a qu'un front
            else { const r = rollInitiative(); roll = r.roll; first = r.first; }
        }
        b.clusters.push({ active: first, first, roll, secs, ...(global ? { global: true } : {}) });
    }
}
function advanceCluster(unitId, justPlayed) {
    const b = state.landing.b;
    const cid = b.ucl[unitId];
    const cl = b.clusters[cid];
    if (!cl) return;
    const left = allBattleUnits().filter((u) => b.ucl[u.id] === cid && !b.done[u.id]);
    const other = justPlayed === 't1' ? 't2' : 't1';
    if (left.some((u) => u.team === other)) cl.active = other;
    else if (left.some((u) => u.team === justPlayed)) cl.active = justPlayed;
}

// Équipe suivante : l'autre équipe s'il lui reste des unités à placer, sinon la même.
function advanceBattleTurn(justPlayed) {
    const b = state.landing.b;
    const left = allBattleUnits().filter((u) => !b.done[u.id] && state.landing.placed[u.id]);
    const other = justPlayed === 't1' ? 't2' : 't1';
    if (left.some((u) => u.team === other)) b.active = other;
    else if (left.some((u) => u.team === justPlayed)) b.active = justPlayed;
}
// Une unité peut s'arrêter sur : ni montagne, ni eau (sauf pont ou unité saurus BA), ni tuile supprimée.
function stopBlock(tile, unit) {
    const army = unit?.line?.army, ba = hasBA(unit);
    const t = state.gridData[tile];
    if (t?.removed) return 'Cette tuile n’existe plus sur la carte.';
    if ((t?.terrain ?? 'plain') === 'mountain') return 'Les montagnes sont infranchissables.';
    if (t?.object === 'village') return 'On ne s’arrête jamais dans un village simple (seulement à côté ; le village à toit plat est permis).';
    if ((t?.terrain ?? 'plain') === 'water' && t?.object !== 'bridge' && !(army === 'saurus' && ba)) return 'Seules les unités saurus (BA) peuvent se tenir sur l’eau.';
    return null;
}
function pruneBattle() {
    const L = state.landing;
    const b = L.b;
    if (!b) return;
    const ids = new Set(allBattleUnits().map((u) => u.id));
    for (const k of ['pos', 'orient', 'done', 'orders']) for (const id of Object.keys(b[k])) if (!ids.has(id)) delete b[k][id];
    for (const [id, o] of Object.entries(b.orders)) if (o.target && !ids.has(o.target)) delete b.orders[id];
    b.stack = b.stack.filter((id) => ids.has(id));
    if (L.m) {
        L.m.queue = L.m.queue.filter((x) => ids.has(x.id) && ids.has(x.target));
        if (L.m.qi > L.m.queue.length) L.m.qi = L.m.queue.length;
        for (const id of Object.keys(L.m.moved)) if (!ids.has(id)) delete L.m.moved[id];
    }
    for (const k of ['hp', 'dead']) for (const id of Object.keys(b[k] || {})) if (!ids.has(id)) delete b[k][id];
    if (L.f?.pending && (!unitPos(L.f.pending.id) || (L.f.pending.mode !== 'art' && !unitPos(L.f.pending.tid)))) L.f.pending = null;
}

/* ---------- Déplacements : charges (plus proche d'abord) puis déplacements à tour de rôle ---------- */

const SQ3 = Math.sqrt(3);
const hexXY = (key) => { const [c, r] = key.split(',').map(Number); return { x: SQ3 * (c + 0.5 * (r & 1)), y: 1.5 * r }; };
// Orientation (0 = est, puis de 60° en 60° dans le sens des aiguilles d'une montre) de `from` vers `to`.
function facing(from, to) {
    const a = hexXY(from), b = hexXY(to);
    return ((Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 3)) % 6) + 6) % 6;
}
// Tuile voisine dans une direction (0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE).
function tileInDir(tile, dir) {
    const [c, r] = tile.split(',').map(Number);
    for (const [nc, nr] of hexNeighbors(c, r)) { const k = `${nc},${nr}`; if (facing(tile, k) === dir) return k; }
    return null;
}
/* Tirailleurs : une unité de type T avec l'ordre « tirailleur », tournée dans la même direction, posée sur la tuile juste devant (dans l'axe de son orientation) une unité alliée
   de corps à corps ou mixte qui n'est pas au corps à corps. Jamais de tirailleurs seuls. L'unité protégée n'est jamais chargée : la charge va sur
   les tirailleurs ; quand elle charge, elle les traverse sans malus (ils ne gênent pas sa vision) et ils la suivent juste derrière elle. */
function screenedUnit(t, needOrder = true) {
    const b = state.landing.b, pt = unitPos(t.id);
    if (!b || !pt || !/T/.test(String(t.line.type)) || (needOrder && b.orders?.[t.id]?.type !== 'tirailleur')) return null;
    return allBattleUnits().find((x) => x.id !== t.id && x.team && x.team === t.team && !b.dead?.[x.id] && unitPos(x.id) && b.orders?.[x.id]?.type !== 'tirailleur'
        && lineCaps(x.line).cc && Number.isInteger(b.orient?.[x.id]) && tileInDir(unitPos(x.id), b.orient[x.id]) === pt && b.orient?.[t.id] === b.orient[x.id] && !inMelee(x)) || null;
}
function screenOf(p) { return allBattleUnits().find((t) => screenedUnit(t)?.id === p.id) || null; }
// À la pose des ordres (ordre des tirailleurs encore caché) : tirailleurs en position devant l'unité, d'après les positions seulement.
function screenAtPos(p) { return allBattleUnits().find((t) => screenedUnit(t, false)?.id === p.id) || null; }
// Tirailleurs et unité protégée forment un seul ensemble quand on les charge : centre sur la tuile des tirailleurs, orientation de l'unité protégée.
function chargeTargetOf(a, b, byPos) { const t = byPos ? screenAtPos(b) : null; return t && a.team !== t.team ? t : b; }
function moveRange(u) {
    const L = state.landing, b = L.b;
    const order = b.orders[u.id];
    const gord = genPower(u.owner);
    const me = unitPos(u.id);
    // Pouvoir du général : mvt +3 (déplacement ou marche forcée) ou charge +2 pour la seule unité qu'il désigne (chevron) ; att −1 pour toutes ses unités à portée.
    const chosen = L.chev?.[u.owner] === u.id;
    const dep = Math.max(0, u.line.dep);
    if (order?.type === 'charge') return 5 + (gord === 'charge' && chosen ? 2 : 0);
    return (order?.type === 'marche' ? dep * 2 : dep) + (gord === 'mvt' && chosen ? 3 : 0);
}
// Mobilité d'après la colonne « typ » (K) de la fiche : v / vs = vol, j = saut (franchissent montagnes et rivières, sans s'y arrêter) ; Saurus = nage.
// Une unité volante (v, vs) choisit à chaque ordre « en vol » (par défaut) ou « au sol » ; au sol elle se déplace comme une unité au sol.
const isFlier = (u) => { const k = String(u.line.kin || ''); return k === 'v' || k === 'vs'; };
const flying = (u) => isFlier(u) && state.landing.b?.orders?.[u.id]?.air !== false;
function unitMob(u) {
    const k = String(u.line.kin || '');
    const fly = flying(u), jump = k === 'j';
    const ba = hasBA(u);
    return { fly, jump, air: fly || jump, swim: ba && u.line.army === 'saurus', woods: ba && u.line.army === 'elfes_sylvains', cav: /^c/i.test(String(u.line.type || '')) };
}
// Bonus d'armée (BA) : seulement pour les unités dont le nom porte « BA » entre parenthèses.
const hasBA = (u) => !u?.line?.merc && unitTags(u?.line?.name).has('ba'); // mercenaires : jamais de bonus d'armée
// BA de terrain : attaque −1 si l'unité est dans le terrain ou à 3 hexagones ou moins (Elfes sylvains : forêt ; Saurus : rivière, pont compris ; Skavens : village).
const TERRAIN_BA = {
    elfes_sylvains: { label: 'forêt', test: (g) => g.object === 'forest' },
    saurus: { label: 'rivière', test: (g) => g.terrain === 'water' },
    skavens: { label: 'village', test: (g) => g.object === 'village' || g.object === 'village-flat' }
};
const TERRAIN_BA_RADIUS = 3;
function terrainBA(u) {
    const def = TERRAIN_BA[u?.line?.army];
    if (!def) return undefined; // armée sans BA de terrain
    const p = unitPos(u.id);
    if (!hasBA(u) || !p) return null;
    for (const [k, g] of Object.entries(state.gridData || {})) if (g && def.test(g) && hexDistance(p, k) <= TERRAIN_BA_RADIUS) return def.label;
    return null;
}
// Trajet réel : coût 1 par tuile ; forêt +1 (sauf Elfes sylvains BA) et marécage +1 (sauf charge et vol ; les unités qui sautent paient) ; montagne et eau (hors pont) infranchissables
// sauf vol, saut, Saurus (eau) ; une unité adverse barre le passage (sauf vol/saut) ; la cavalerie ne monte pas sur une fortification.
// Charge (unité qui ne vole pas et ne saute pas) : aucune unité, amie ou ennemie, ne se traverse, sauf through (aucun chemin libre : charge sans voir).
function reachMap(u, limit, charge, through) {
    const me = unitPos(u.id);
    const mob = unitMob(u);
    const scr = charge ? screenOf(u)?.id : null; // ses tirailleurs : traversés sans malus
    // Une unité au sol peut passer sous une unité volante en vol (sans s'arrêter sur sa tuile).
    const enemy = new Set(allBattleUnits().filter((x) => through ? false : !flying(x) && (charge ? x.id !== u.id && x.id !== scr : (x.team && u.team && x.team !== u.team))).map((x) => unitPos(x.id)).filter(Boolean));
    const dist = new Map([[me, 0]]);
    let queue = [[0, me]];
    while (queue.length) {
        queue.sort((a, b) => a[0] - b[0]);
        const [d, key] = queue.shift();
        if (d > dist.get(key)) continue;
        const [c, r] = key.split(',').map(Number);
        for (const [nc, nr] of hexNeighbors(c, r)) {
            if (!mapHas(nc, nr)) continue;
            const nk = `${nc},${nr}`;
            const t = state.gridData[nk];
            const ter = t?.terrain ?? 'plain', obj = t?.object ?? null;
            if (!mob.air) {
                if (enemy.has(nk)) continue;
                if (ter === 'mountain') continue;
                if (ter === 'water' && obj !== 'bridge' && !mob.swim) continue;
            }
            if (mob.cav && (obj === 'fortress' || obj === 'fortress-half')) continue;
            let cost = 1;
            if (!charge && !mob.fly) { if (obj === 'forest' && !mob.woods) cost++; if (ter === 'swamp') cost++; } // déplacement −1 en forêt et marais, sauf charge et vol
            const nd = d + cost;
            if (nd > limit || nd >= (dist.get(nk) ?? Infinity)) continue;
            dist.set(nk, nd);
            queue.push([nd, nk]);
        }
    }
    return dist;
}
// Tuiles où l'unité peut s'arrêter (sa propre tuile comprise) : charge = tuile contiguë à la cible ; déplacement = pas à côté d'un adversaire.
function moveAllowed(u) {
    const L = state.landing, m = L.m;
    const me = unitPos(u.id);
    if (!me || !m) return [];
    const isCharge = m.step === 'charge';
    const cur = isCharge ? m.queue[m.qi] : null;
    if (cur?.mutual) return (cur.plan?.choice ? cur.plan.choice.unit : cur.id) === u.id ? mutualTiles(cur) : [];
    const order = L.b.orders[u.id];
    const tp = isCharge && order?.target ? unitPos(order.target) : null;
    if (isCharge && !tp) return [];
    if (isCharge) return cur && cur.id === u.id ? (cur.failed ? failedChargeTiles(u, tp) : chargeTiles(u, tp).tiles) : [];
    return stopTiles(u, moveRange(u), false, null, false);
}
// Tuiles d'arrivée d'une charge réussie (succès décidé à la révélation des ordres : l'ordre des charges n'y change rien).
// 1) tuile libre au contact de la cible : dans la portée si possible, sinon au plus court (au-delà de la portée), en contournant les unités puis à travers ;
// 2) toutes les tuiles au contact prises : au plus près de la cible, en deuxième rideau (pas de combat).
// Charge échouée (cible hors de portée à la révélation) : l'unité avance quand même au maximum de sa capacité de charge vers sa cible
// (à confirmer : capacité de charge ou capacité de déplacement maximale) ; elle s'arrête au plus près de la cible, sans toucher d'adversaire au même niveau.
function failedChargeTiles(u, tp) {
    const R = moveRange(u), me = unitPos(u.id), mob = unitMob(u);
    const all = allBattleUnits();
    const occ = new Set(all.filter((x) => x.id !== u.id).map((x) => unitPos(x.id)).filter(Boolean));
    const foes = all.filter((x) => x.team && u.team && x.team !== u.team).map((x) => unitPos(x.id)).filter(Boolean);
    for (const th of [false, true]) {
        const dist = reachMap(u, R, true, th);
        let best = [], bd = Infinity;
        for (const [k] of dist) {
            if (k !== me && (occ.has(k) || stopBlock(k, u) || (mob.cav && ['fortress', 'fortress-half'].includes(state.gridData[k]?.object)) || foes.some((fp) => hexDistance(k, fp) <= 1 && groundLevel(k) === groundLevel(fp)))) continue;
            const h = hexDistance(k, tp);
            if (h < bd) { best = [k]; bd = h; } else if (h === bd) best.push(k);
        }
        if (best.length) return best;
    }
    return [me];
}
// Facette de charge : la facette de la cible la plus proche de l'attaquant (celle que traverse le trait de centre à centre) ;
// si elle est occupée, les autres facettes de la charge (avant pour une charge de face, arrière pour une charge à revers, fixé à la révélation) ;
// si elle est inaccessible (décor à contourner, terrain interdit), la plus proche par le trajet parmi celles-ci ;
// quand toutes celles-ci sont prises, étalement sur les autres facettes libres (sans prise à revers ce tour-ci) ;
// toutes les facettes accessibles prises : deuxième rideau.
function chargeFacets(u, tp) {
    const me = unitPos(u.id), mob = unitMob(u);
    const occ = new Set(allBattleUnits().filter((x) => x.id !== u.id).map((x) => unitPos(x.id)).filter(Boolean));
    const [c, r] = tp.split(',').map(Number);
    const contact = hexNeighbors(c, r).map(([x, y]) => `${x},${y}`).filter((k) => mapHas(...k.split(',').map(Number)) && !occ.has(k) && !stopBlock(k, u) && !(mob.cav && ['fortress', 'fortress-half'].includes(state.gridData[k]?.object)));
    let acc = new Map();
    for (const th of [false, true]) {
        const dist = reachMap(u, 60, true, th);
        acc = new Map(contact.filter((k) => dist.has(k)).map((k) => [k, dist.get(k)]));
        if (acc.size) break;
    }
    if (!acc.size) return [];
    // Facettes « de la charge » : les 3 facettes avant de la cible pour une charge de face, les 3 arrière pour une charge à revers,
    // d'après la prise à revers et l'orientation de la cible fixées à la révélation des ordres.
    const L = state.landing, o = L.b?.orders?.[u.id], tid = o?.target;
    const ot = tid != null ? (L.m?.snap?.orient?.[tid] ?? L.b?.orient?.[tid]) : null;
    const cls = new Set(Number.isInteger(ot) ? (o?.rear ? [2, 3, 4] : [0, 1, 5]).map((k) => tileInDir(tp, (ot + k) % 6)) : []);
    const d0 = facing(tp, me), f0 = tileInDir(tp, d0);
    const nearest = (set) => { const ks = [...acc.keys()].filter((k) => set.has(k)); if (!ks.length) return []; const min = Math.min(...ks.map((k) => acc.get(k))); return ks.filter((k) => acc.get(k) === min); };
    if (acc.has(f0)) return [f0];
    if (f0 && occ.has(f0)) { const same = [...acc.keys()].filter((k) => cls.has(k)); if (same.length) return same; } // facette prise : les autres facettes de la charge
    else { const n1 = nearest(cls); if (n1.length) return n1; const n2 = nearest(new Set(acc.keys())); if (n2.length && !cls.size) return n2; } // décor à contourner
    return [...acc.keys()]; // surnombre : étalement sur les autres facettes
}
function chargeTiles(u, tp) {
    const facets = chargeFacets(u, tp);
    if (facets.length) return { tiles: facets, contact: true };
    const me = unitPos(u.id), mob = unitMob(u);
    const occ = new Set(allBattleUnits().filter((x) => x.id !== u.id).map((x) => unitPos(x.id)).filter(Boolean));
    // Deuxième rideau : au plus près du combat (de la cible) en respectant le déplacement de charge — d'abord dans sa capacité de charge,
    // sans traverser d'unité, puis à travers ; au-delà de sa capacité seulement si rien n'est atteignable.
    for (const [lim, th] of [[moveRange(u), false], [moveRange(u), true], [60, false], [60, true]]) {
        const dist = reachMap(u, lim, true, th);
        let best = [], bd = Infinity, bc = Infinity;
        for (const [k, d] of dist) {
            if (k !== me && (occ.has(k) || stopBlock(k, u) || (mob.cav && ['fortress', 'fortress-half'].includes(state.gridData[k]?.object)))) continue;
            const h = hexDistance(k, tp);
            if (h < bd || (h === bd && d < bc)) { best = [k]; bd = h; bc = d; } else if (h === bd && d === bc) best.push(k);
        }
        if (best.length && !(best.length === 1 && best[0] === me && lim !== 60)) return { tiles: best, contact: false };
    }
    return { tiles: [], contact: false };
}
// Portée réelle d'un déplacement pendant la pose des ordres (même calcul que pendant les déplacements, trajet compris).
function orderReach(u, type) {
    const L = state.landing;
    const me = unitPos(u.id);
    if (!me) return [];
    const dep = Math.max(0, u.line.dep);
    return stopTiles(u, (type === 'marche' ? dep * 2 : dep) + (genPower(u.owner) === 'mvt' && L.chev?.[u.owner] === u.id ? 3 : 0), false, null);
}
// Tuiles d'arrêt possibles à portée R par un trajet réel (coûts de terrain, obstacles, adversaires).
function stopTiles(u, R, isCharge, tp, through) {
    const me = unitPos(u.id);
    const mob = unitMob(u);
    const dist = reachMap(u, R + 2, isCharge, through);
    const all = allBattleUnits();
    const occ = new Set(all.filter((x) => x.id !== u.id).map((x) => unitPos(x.id)).filter(Boolean));
    const foes = all.filter((x) => x.team && u.team && x.team !== u.team).map((x) => unitPos(x.id)).filter(Boolean);
    const out = [];
    for (const [k, d] of dist) {
        if (k !== me) {
            // route : +2 si le déplacement se termine dessus (sauf vol/saut et sauf charge)
            const bonus = !isCharge && !mob.fly && (state.gridData[k]?.terrain ?? 'plain') === 'path' ? 2 : 0; // route +2 si on y termine (sauf vol ; pas en charge)
            if (d > R + bonus) continue;
            if (occ.has(k) || stopBlock(k, u)) continue;
            if (mob.cav && ['fortress', 'fortress-half'].includes(state.gridData[k]?.object)) continue;
        }
        if (isCharge) { if (hexDistance(k, tp) !== 1) continue; }
        else if (k !== me && foes.some((fp) => hexDistance(k, fp) <= 1 && groundLevel(k) === groundLevel(fp))) continue; // zone d'interdiction, sauf différence de hauteur
        out.push(k);
    }
    return out;
}
function eligibleMovers() {
    const L = state.landing;
    if (!L.b || !L.m) return [];
    return allBattleUnits().filter((u) => { const o = L.b.orders[u.id]; return o && (o.type === 'depl' || o.type === 'marche') && !L.m.moved[u.id] && unitPos(u.id); });
}
// Distance d'une charge sur le vrai trajet (tuiles jusqu'à la cible) ; à travers les unités s'il n'y a pas de chemin libre ; à défaut, à vol d'oiseau.
function chargeDistance(u, tp) {
    const [c, r] = tp.split(',').map(Number);
    const near = hexNeighbors(c, r).map(([x, y]) => `${x},${y}`);
    for (const through of [false, true]) {
        const dist = reachMap(u, 60, true, through);
        const best = Math.min(...near.map((k) => dist.get(k) ?? Infinity));
        if (best < Infinity) return best + 1;
    }
    return hexDistance(unitPos(u.id), tp);
}
function buildChargeQueue() {
    const L = state.landing;
    const q = [];
    for (const u of allBattleUnits()) {
        const o = L.b.orders[u.id];
        if (o?.type !== 'charge' || !o.target) continue;
        const a = unitPos(u.id), t = unitPos(o.target);
        if (a && t) q.push({ id: u.id, target: o.target, dist: chargeDistance(u, t), tie: 0, ...(o.failed ? { failed: true } : {}) });
    }
    // Charge mutuelle : A charge B et B charge A → une seule entrée (rencontre à mi-chemin).
    for (const x of q) {
        if (x.drop) continue;
        const y = q.find((z) => !z.drop && z !== x && z.id === x.target && z.target === x.id);
        if (y) { y.drop = true; x.mutual = true; x.failed = Boolean(x.failed && y.failed); if (!x.failed) delete x.failed; }
    }
    for (let i = q.length - 1; i >= 0; i--) if (q[i].drop) q.splice(i, 1);
    const groups = {};
    for (const x of q) (groups[x.dist] = groups[x.dist] || []).push(x);
    for (const g of Object.values(groups)) {
        if (g.length < 2) continue;
        const seen = new Set();
        for (const x of g) { let r, k = 0; do { r = rollD(10); } while (seen.has(r) && ++k < 50 && seen.size < 10); seen.add(r); x.tie = r; } // d10, relancé en cas d'égalité
        battleLog(`🎲 ${g.length} charges à ${g[0].dist} hexagone(s) : dé pour les départager.`);
        const best = Math.max(...g.map((x) => x.tie));
        announceRoll(`Charges à égalité (${g[0].dist} hex)`, g.map((x) => { const u = findUnitAny(x.id); return { label: u ? `${u.line.name} ${u.idx}` : '?', sides: 10, v: x.tie, ok: x.tie === best }; }), 'Le plus haut charge en premier.');
    }
    return q.sort((a, b) => a.dist - b.dist || b.tie - a.tie);
}


/* ---------- Charge : prise à revers et visibilité de la cible (vérifiées à la pose de l'ordre) ---------- */

// Hauteur d'une tuile : colline 1 ; fortification ou village à toit plat 1 ; les deux (sur une colline) 2.
function groundLevel(tile) {
    const g = state.gridData[tile] || {};
    return ((g.terrain ?? 'plain') === 'hill' ? 1 : 0) + (['fortress', 'fortress-half', 'village-flat'].includes(g.object) ? 1 : 0);
}
// Cible prise à revers : le trait tracé du centre de la tuile de la cible au centre de celle de l'unité qui charge sort de l'hexagone
// de la cible par un de ses 3 côtés arrière. Les 3 côtés avant couvrent ±90° autour de l'orientation ; un trait qui passe exactement
// par le sommet entre un côté avant et un côté arrière compte comme avant.
function chargeRear(a, b) { const p = b && screenedUnit(b, false); return throughRear(b, a, p ? state.landing.b.orient[p.id] : undefined); }
// Le trait tracé du centre de l'unité u vers le centre de l'unité v sort-il par un des 3 côtés arrière de u ?
function rearToward(u, tile) {
    const pu = unitPos(u.id), o = state.landing.b.orient[u.id];
    if (!pu || !Number.isInteger(o) || pu === tile) return false;
    const P = hexXY(pu), Q = hexXY(tile);
    const ang = Math.atan2(Q.y - P.y, Q.x - P.x) * 180 / Math.PI;
    return Math.abs(((((ang - o * 60) % 360) + 540) % 360) - 180) > 90 + 1e-6;
}
function throughRear(u, v, orient) {
    const pu = unitPos(u.id), pv = unitPos(v.id);
    const o = orient ?? state.landing.b.orient[u.id];
    if (!pu || !pv || !Number.isInteger(o) || pu === pv) return false;
    const P = hexXY(pu), Q = hexXY(pv);
    const ang = Math.atan2(Q.y - P.y, Q.x - P.x) * 180 / Math.PI;
    const diff = Math.abs(((((ang - o * 60) % 360) + 540) % 360) - 180);
    return diff > 90 + 1e-6;
}
// Visibilité de la cible : trait du centre de la tuile de l'unité qui charge au centre de celle de la cible.
// On regarde au niveau de la plus haute des deux unités : une tuile bloque si c'est une montagne (toujours), si elle est plus haute que ce niveau,
// ou si elle est à ce niveau et porte un obstacle (forêt, village à toit, unité). Plus haut, on voit par-dessus les obstacles d'en bas.
function chargeSight(a, b, hideFoeAir = true) { return visionCheck(a, b, { hideFoeAir }); }

/* ---------- Règle de vision (charges et tirs) — voir REGLE-VISION.md ---------- */

// Catégorie de vision : 'fly' (unité volante en vol), 'tall' (grande taille ou unité volante au sol), 'ground'.
// hideAir : pour une unité adverse dont l'ordre est encore caché, on suppose le choix par défaut « en vol ».
function visCat(u, hideAir) {
    if (isFlier(u)) return (hideAir || state.landing.b?.orders?.[u.id]?.air !== false) ? 'fly' : 'tall';
    return hasTag(u, 'haut') ? 'tall' : 'ground';
}
const OBST = new Set(['forest', 'village', 'village-flat', 'fortress', 'fortress-half']);
const VIEW360 = new Set(['fortress', 'fortress-half', 'village-flat']);
// Vision de l'unité a (qui charge ou qui tire) vers la cible b. opts.hideFoeAir : choix « en vol / au sol » de la cible supposé « en vol ».
// Renvoie { seen, why, forestBehind } ; forestBehind = forêt sur la tuile juste devant la cible (modificateur de tir « derrière une forêt »).
function visionCheck(a, b, opts = {}) {
    if (!b && opts.tile) { // vision vers une tuile (point visé par l'artillerie) : comme vers une unité au sol posée sur cette tuile
        const occupant = allBattleUnits().find((x) => unitPos(x.id) === opts.tile);
        if (occupant && occupant.id !== a.id) return visionCheck(a, occupant, { ...opts, tile: undefined });
        b = { id: '__tile__', team: null, line: { kin: '', name: '' }, __tile: opts.tile };
    }
    const pa = unitPos(a.id), pb = b.__tile || unitPos(b.id);
    if (!pa || !pb) return { seen: false, why: 'unité absente', forestBehind: false };
    const ca = visCat(a, false), cb = b.__tile ? 'ground' : visCat(b, Boolean(opts.hideFoeAir));
    const gb = state.gridData[pb] || {};
    // 1. Action vers l'arrière (sauf vue à 360° sur fortification, demi-fortification, village à toit plat)
    if (!VIEW360.has((state.gridData[pa] || {}).object) && (b.__tile ? rearToward(a, pb) : throughRear(a, b))) return { seen: false, why: 'dans son dos', forestBehind: false };
    // 2. Cible dans une forêt (sauf unité volante en vol) : toujours cachée
    if (gb.object === 'forest' && cb !== 'fly') return { seen: false, why: 'dans une forêt', forestBehind: false };
    if (pa === pb) return { seen: true, why: '', forestBehind: false };
    const la = groundLevel(pa), lb = groundLevel(pb);
    const ground = new Map(); // unités sur le plateau (hors a et b) : catégorie de vision
    const scr = state.landing.b ? screenOf(a)?.id : null; // ses propres tirailleurs ne gênent pas sa vision
    for (const x of allBattleUnits()) { if (x.id === a.id || x.id === b.id || x.id === scr) continue; const p = unitPos(x.id); if (p) ground.set(p, visCat(x, true)); }
    const ter = (t) => (state.gridData[t]?.terrain ?? 'plain');
    const obj = (t) => state.gridData[t]?.object ?? null;
    const anyFly = ca === 'fly' || cb === 'fly';
    const seesOverUnits = ca !== 'ground' || cb !== 'ground'; // grande taille ou unité volante
    const tryLine = (eps) => {
        const hs = hexTrace(pa, pb, eps[0] > 0 ? 1 : -1).filter((t) => t !== pa && t !== pb);
        const forestBehind = hs.length > 0 && obj(hs[hs.length - 1]) === 'forest';
        // 3. Montagne : toujours
        if (hs.some((t) => ter(t) === 'mountain')) return { seen: false, why: 'montagne', forestBehind };
        // 4. Unité volante en vol : voit et est vue par-dessus tout le reste
        if (anyFly) return { seen: true, why: '', forestBehind };
        if (!hs.length) return { seen: true, why: '', forestBehind };
        // 5. Abris : tuile juste à côté de chaque unité sur le trait
        const abri = (t, lvl) => OBST.has(obj(t)) || groundLevel(t) > lvl;
        if (abri(hs[0], la)) return { seen: false, why: obj(hs[0]) === 'forest' ? 'forêt (abri)' : (OBST.has(obj(hs[0])) ? 'abri' : 'colline (abri)'), forestBehind };
        if (abri(hs[hs.length - 1], lb)) return { seen: false, why: obj(hs[hs.length - 1]) === 'forest' ? 'forêt (abri)' : (OBST.has(obj(hs[hs.length - 1])) ? 'abri' : 'colline (abri)'), forestBehind };
        if (la === lb) {
            // 6. Même niveau : ligne horizontale
            const L0 = la;
            for (const t of hs) {
                const h = groundLevel(t);
                if (h > L0) return { seen: false, why: 'hauteur', forestBehind };
                if (h === L0 && OBST.has(obj(t))) return { seen: false, why: obj(t) === 'forest' ? 'forêt' : (obj(t) && obj(t).startsWith('village') ? 'village' : 'fortification'), forestBehind };
                if (h === L0 && ground.has(t) && ground.get(t) !== 'fly' && !seesOverUnits) return { seen: false, why: 'unité', forestBehind };
            }
            return { seen: true, why: '', forestBehind };
        }
        // 7. Niveaux différents : relief aussi haut que l'unité haute
        const H = Math.max(la, lb);
        for (const t of hs) if (groundLevel(t) >= H) return { seen: false, why: 'relief', forestBehind };
        return { seen: true, why: '', forestBehind };
    };
    const e = [1e-6, 2e-6, -3e-6];
    const r1 = tryLine(e);
    if (r1.seen) return r1;
    const r2 = tryLine(e.map((x) => -x)); // trait le long d'un bord : il suffit qu'un côté soit dégagé
    return r2.seen ? r2 : r1;
}

// Met à jour revers et vision d'un ordre de charge. hideFoeAir : à la pose des ordres, le choix « en vol / au sol » de la cible adverse est caché
// (supposé « en vol ») ; à la révélation des ordres, on recalcule avec les vrais choix.
function setChargeSight(id, hideFoeAir) {
    const L = state.landing, o = L.b?.orders?.[id];
    if (!o || o.type !== 'charge' || !o.target) return;
    const A = allBattleUnits().find((x) => x.id === id), B0 = allBattleUnits().find((x) => x.id === o.target);
    if (!A || !B0) return;
    const B = chargeTargetOf(A, B0, hideFoeAir); // pose de l'ordre : une unité protégée se charge par ses tirailleurs
    if (!unitPos(A.id) || !unitPos(B.id)) return;
    const foeHidden = hideFoeAir && A.team !== B.team;
    const sg = visionCheck(A, B, { hideFoeAir: foeHidden });
    o.rear = chargeRear(A, B); o.seen = sg.seen;
    // Marqueurs de terrain de la cible (sauvegarde au corps à corps) et charge de cavalerie (C) : att ×2, sauf contre une cible en forêt ou dans une construction.
    const tp = unitPos(B.id), pa = unitPos(A.id);
    const parts = ccSaveParts(tp, B, tileInDir(tp, facing(tp, pa)), A);
    const marks = parts.map((p) => p.k).concat(String(B.line.kin || '') === 'vs' ? ['vs'] : []);
    if (marks.length) o.save = marks; else delete o.save;
    if (unitTags(A.line.name).has('c')) o.cav = !parts.some((p) => p.k !== 'hill'); else delete o.cav;
    if (sg.seen) delete o.why; else o.why = sg.why;
}

/* ---------- Charges mutuelles : rencontre à mi-chemin sur le trajet réel ---------- */

// Protection au corps à corps d'une tuile pour une unité : colline +1, forêt +2, construction +2 (fortification sauf vol, muret, village), et +2 sur la
// tuile juste avant un pont quand l'adversaire arrive par le pont (« sortie de pont »).
// Village : sauvegarde pour les tuiles autour des maisons (on ne se tient jamais dans un village simple), et sur un village à toit plat.
function villageCover(tile) {
    if (state.gridData[tile]?.object === 'village-flat') return true;
    const [c, r] = tile.split(',').map(Number);
    return hexNeighbors(c, r).some(([x, y]) => ['village', 'village-flat'].includes(state.gridData[`${x},${y}`]?.object));
}
// Modificateurs de sauvegarde de terrain au corps à corps (marqueurs) : colline +1 (sauf vol), forêt +2, construction +2 (fortification sauf vol,
// muret, autour d'un village ou sur un village à toit plat), sortie de pont +2 (l'adversaire arrive par le pont).
// att (facultatif) : l'unité qui attaque. Unité volante en vol : ni malus ni protection par les hauteurs (colline, fortification), attaque un pont sans malus ;
// unité qui saute : attaque une fortification et un pont sans malus. Vol stationnaire (vs) : sauvegarde +2 au corps à corps (marqueur seulement).
function ccSaveParts(tile, u, next, att) {
    const g = state.gridData[tile] || {};
    const fly = unitMob(u).fly, aFly = att ? unitMob(att).fly : false, aJump = att ? unitMob(att).jump : false;
    const out = [];
    if ((g.terrain ?? 'plain') === 'hill' && !fly && !aFly) out.push({ k: 'hill', v: 1 });
    if (g.object === 'forest') out.push({ k: 'forest', v: 2 });
    const fort = ['fortress', 'fortress-half'].includes(g.object);
    if (g.object === 'wall' || villageCover(tile) || (fort && !fly && !aFly && !aJump)) out.push({ k: 'build', v: 2 });
    if (next && g.object !== 'bridge' && state.gridData[next]?.object === 'bridge' && !aFly && !aJump) out.push({ k: 'bridge', v: 2 });
    return out;
}
function ccProtection(tile, u, next) { return ccSaveParts(tile, u, next).reduce((t, p) => t + p.v, 0); }
// Trajet réel le plus court entre deux unités (coût 1 par tuile en charge) : ni montagne, ni eau sans pont (sauf si les deux volent ou sautent,
// ou nagent pour l'eau), ni tuile occupée par une autre unité. Renvoie la liste des tuiles, extrémités comprises, ou null.
function chargePath(a, b, through) {
    const pa = unitPos(a.id), pb = unitPos(b.id);
    if (!pa || !pb) return null;
    const ma = unitMob(a), mb = unitMob(b);
    const air = ma.air && mb.air, swim = (ma.swim || ma.air) && (mb.swim || mb.air);
    const occ = new Set(allBattleUnits().filter((x) => x.id !== a.id && x.id !== b.id && !air && !through && !flying(x)).map((x) => unitPos(x.id)).filter(Boolean));
    const prev = new Map([[pa, null]]);
    let fr = [pa];
    while (fr.length && !prev.has(pb)) {
        const next = [];
        for (const k of fr) {
            const [c, r] = k.split(',').map(Number);
            for (const [nc, nr] of hexNeighbors(c, r)) {
                const nk = `${nc},${nr}`;
                if (prev.has(nk) || !mapHas(nc, nr)) continue;
                if (nk !== pb) {
                    const g = state.gridData[nk] || {};
                    const ter = g.terrain ?? 'plain';
                    if (occ.has(nk)) continue;
                    if (!air && ter === 'mountain') continue;
                    if (ter === 'water' && g.object !== 'bridge' && !swim) continue;
                }
                prev.set(nk, k); next.push(nk);
            }
        }
        fr = next;
    }
    if (!prev.has(pb)) return null;
    const path = [];
    for (let k = pb; k; k = prev.get(k)) path.unshift(k);
    return path;
}
// Prépare la charge mutuelle en cours : trajet, partage du chemin (dé d10 si nombre impair de tuiles), portées, avantage de terrain.
// plan.k = nombre de tuiles parcourues par A (B en parcourt n - k) ; plan.choice = unité avantagée qui choisit où s'arrêter.
// Cible à distance de charge : une tuile au contact de la cible atteinte en R tuiles au plus par un chemin autorisé
// (en contournant les unités, sinon à travers elles), sans tenir compte des unités posées sur ces tuiles de contact.
function chargeInRange(u, tp, R, modes = [false, true]) {
    const [c, r] = tp.split(',').map(Number);
    const near = hexNeighbors(c, r).map(([x, y]) => `${x},${y}`).filter((k) => !stopBlock(k, u) && !(unitMob(u).cav && ['fortress', 'fortress-half'].includes(state.gridData[k]?.object)));
    for (const through of modes) { const dist = reachMap(u, R, true, through); if (near.some((k) => dist.has(k)) || near.includes(unitPos(u.id))) return true; }
    return false;
}
const chargeRangeOf = (u) => 5 + (genPower(u.owner) === 'charge' && state.landing.chev?.[u.owner] === u.id ? 2 : 0);
function prepareMutual(it) {
    if (!it?.mutual || it.plan) return;
    const A = allBattleUnits().find((x) => x.id === it.id), B = allBattleUnits().find((x) => x.id === it.target);
    let path = A && B ? chargePath(A, B, false) : null;
    let thru = false;
    if (!path && A && B) { path = chargePath(A, B, true); thru = Boolean(path); } // pas de chemin libre : les deux unités se rejoignent à travers les unités, sans voir
    if (!path) { it.plan = { none: true }; battleLog('⚔️ Charge mutuelle sans trajet possible : chaque unité reste en place.'); return; }
    const n = path.length - 2; // tuiles libres entre les deux unités
    const RA = moveRange(A), RB = moveRange(B);
    if (it.failed) { // les deux charges échouent : chacune avance au maximum de sa capacité de charge, sans contact
        const kA = Math.min(RA, n), kB = Math.min(RB, n - kA);
        it.plan = { path, n, kA, kB, roll: null, contact: false, RA, RB };
        battleLog(`❌ Charge mutuelle ${unitLabel(A)} ⇄ ${unitLabel(B)} : les deux sont hors de portée ; chacune avance au maximum de sa capacité de charge.`);
        return;
    }
    // Pont : chaque unité sur sa tuile d'entrée de pont (de part et d'autre du pont) → un seul d10 pour le côté du pont, pas de dé de mi-chemin.
    const entA = [], entB = [];
    for (let k = 0; k <= n; k++) if (ccSaveParts(path[k], A, path[k + 1]).some((p) => p.k === 'bridge')) entA.push(k);
    for (let i = 1; i <= n + 1; i++) if (ccSaveParts(path[i], B, path[i - 1]).some((p) => p.k === 'bridge')) entB.push(i);
    const bridgeCase = entA.length && entB.length && entA[entA.length - 1] < entB[0];
    let kA = Math.floor(n / 2), roll = null;
    if (n % 2 === 1 && !bridgeCase) {
        let r; do { r = { a: rollD(10), b: rollD(10) }; } while (r.a === r.b);
        roll = r; if (r.a > r.b) kA++;
        announceRoll('Charge mutuelle : qui avance d’une tuile de plus ?', [{ label: unitLabel(A), sides: 10, v: r.a, ok: r.a > r.b }, { label: unitLabel(B), sides: 10, v: r.b, ok: r.b > r.a }], `${unitLabel(r.a > r.b ? A : B)} avance d’une tuile de plus.`);
    }
    // Contact toujours : une unité qui n'a pas assez de portée rejoint quand même la ligne de front.
    const plan = { path, n, kA, roll, contact: true, RA, RB };
    // Éléments de décor croisés (modificateur de terrain : colline +1, forêt +2, construction +2, tuile juste avant un pont +2) : chaque unité compare
    // le plus fort modificateur des tuiles qu'elle traverse sur sa moitié du trajet (tuile de départ comprise). La plus forte peut s'arrêter sur une tuile dont le modificateur dépasse
    // le meilleur de l'adversaire (ou aller à mi-chemin) ; l'autre vient à son contact, sans limite de portée. Égalité (même modificateur maximum) : au milieu.
    const protA = (k) => ccProtection(path[k], A, path[k + 1]);
    const protB = (k) => ccProtection(path[k], B, path[k - 1]);
    // sa tuile de départ compte (elle peut y rester)
    const halfA = Array.from({ length: plan.kA + 1 }, (_, i) => i), halfB = Array.from({ length: n - plan.kA + 1 }, (_, i) => plan.kA + 1 + i);
    const mA = Math.max(0, ...halfA.map(protA)), mB = Math.max(0, ...halfB.map(protB));
    plan.mods = { a: mA, b: mB };
    // Pont : chacune sur sa tuile d'entrée (même modificateur) → un d10 désigne de quel côté du pont a lieu la charge, et le modificateur de pont
    // ne s'applique à aucune des deux unités.
    const brA = entA, brB = entB;
    if (bridgeCase) {
        let r; do { r = { a: rollD(10), b: rollD(10) }; } while (r.a === r.b);
        const X = r.a > r.b ? 'A' : 'B';
        announceRoll('Charge mutuelle sur un pont : de quel côté ?', [{ label: unitLabel(A), sides: 10, v: r.a, ok: r.a > r.b }, { label: unitLabel(B), sides: 10, v: r.b, ok: r.b > r.a }], `La charge a lieu du côté de ${unitLabel(X === 'A' ? A : B)} ; pas de modificateur de pont.`);
        plan.choice = { side: X, unit: X === 'A' ? A.id : B.id, opts: X === 'A' ? [brA[brA.length - 1]] : [n + 1 - brB[0]], tie: r, bridge: true };
        plan.noBridge = true;
    } else if (mA !== mB) {
        const X = mA > mB ? 'A' : 'B';
        const opts = X === 'A' ? [...halfA.filter((k) => protA(k) > mB), plan.kA] : [...halfB.filter((i) => protB(i) > mA).map((i) => n + 1 - i), n - plan.kA];
        plan.choice = { side: X, unit: X === 'A' ? A.id : B.id, opts: [...new Set(opts)].sort((p1, p2) => p1 - p2) };
    }
    // l'arrêt doit se faire sur des tuiles libres
    const occNow = new Set(allBattleUnits().filter((x) => x.id !== A.id && x.id !== B.id).map((x) => unitPos(x.id)).filter(Boolean));
    if (plan.contact && !plan.choice && (occNow.has(path[plan.kA]) || occNow.has(path[plan.kA + 1]))) { it.plan = { none: true }; battleLog('⚔️ Charge mutuelle impossible : pas de tuiles libres pour la rencontre.'); return; }
    if (plan.choice) plan.choice.opts = plan.choice.opts.filter((k) => { const ia = plan.choice.side === 'A' ? k : n - k, ib = ia + 1; return !occNow.has(path[ia]) || ia === 0 ? (!occNow.has(path[ib]) || ib === n + 1) : false; });
    if (thru) plan.through = true;
    it.plan = plan;
    battleLog(`⚔️ Charge mutuelle ${unitLabel(A)} ⇄ ${unitLabel(B)} : ${n} tuile(s) entre elles${plan.contact ? '' : ' — portées insuffisantes, pas de contact'}${plan.choice ? (plan.choice.cancel ? ` · égalité : combat du côté de ${unitLabel(plan.choice.unit === A.id ? A : B)}, bonus de terrain annulés` : ` · ${unitLabel(plan.choice.unit === A.id ? A : B)} atteint une tuile protectrice la première : elle choisit où s’arrêter, l’autre vient au contact`) : ''}.`);
}
// Tuiles proposées pour la charge mutuelle en cours, et position finale des deux unités pour une tuile choisie.
function mutualTiles(it) {
    const p = it.plan;
    if (!p || p.none) return [];
    if (p.choice) return p.choice.side === 'A' ? p.choice.opts.map((k) => p.path[k]) : p.choice.opts.map((k) => p.path[p.n + 1 - k]);
    return [p.path[p.kA]];
}
function mutualResolve(it, tile) {
    const p = it.plan;
    if (!p.contact) return { a: p.path[p.kA], b: p.path[p.n + 1 - p.kB] };
    let kA = p.kA;
    if (p.choice) {
        const idx = p.path.indexOf(tile);
        kA = p.choice.side === 'A' ? idx : idx - 1; // B s'arrête sur la tuile choisie, A vient juste à côté
    }
    return { a: p.path[kA], b: p.path[kA + 1] };
}
function startMoveStep() {
    const L = state.landing, m = L.m;
    const left = eligibleMovers();
    if (!left.length) { m.step = 'done'; battleLog('✅ Déplacements terminés.'); return; }
    m.step = 'move';
    const teams = new Set(left.map((u) => u.team).filter(Boolean));
    if (teams.size > 1) {
        // Nouveau dé à chaque tour pour savoir qui commence les déplacements (gardé si le MJ annule puis rejoue).
        if (!m.roll) { const r = rollInitiative(); m.roll = r.roll; m.first = r.first; announceRoll('Déplacements : qui commence ?', [{ label: tName('t1'), sides: 10, v: r.roll.t1, ok: r.first === 't1' }, { label: tName('t2'), sides: 10, v: r.roll.t2, ok: r.first === 't2' }], `${tName(r.first)} commence les déplacements.`); }
        m.active = m.first;
        battleLog(`🎲 Déplacements : ${tName('t1')} ${m.roll.t1} · ${tName('t2')} ${m.roll.t2} → ${tName(m.active)} commence.`);
    } else {
        m.active = [...teams][0] || 't1';
        battleLog(`👣 Déplacements : seule ${tName(m.active)} a des unités à déplacer.`);
    }
}
// Charge suivante de la file : la charge est obligatoire. Son succès a été décidé à la révélation des ordres (échouée : l'unité reste en place) ;
// une charge réussie va au contact, ou au plus près en deuxième rideau si toutes les tuiles au contact de la cible sont prises.
function enterCharge() {
    const L = state.landing, m = L.m;
    while (m.qi < m.queue.length) {
        const it = m.queue[m.qi];
        if (it.mutual) {
            prepareMutual(it);
            if (!it.plan?.none) {
                // Une seule issue possible : la charge se résout toute seule (les joueurs voient les unités avancer).
                const actor = allBattleUnits().find((x) => x.id === (it.plan?.choice ? it.plan.choice.unit : it.id));
                const tiles = actor ? moveAllowed(actor) : [];
                if (actor && tiles.length === 1 && !L.m.manual) { doMove(actor, tiles[0]); return; }
                return;
            }
        } else {
            const u = allBattleUnits().find((x) => x.id === it.id);
            if (u && unitPos(u.id) && unitPos(it.target)) {
                const tiles = moveAllowed(u);
                if (tiles.length === 1 && !L.m.manual) { doMove(u, tiles[0]); return; }
                if (tiles.length) return;
            }
            battleLog(`⛔ ${unitLabel(u)} : aucune tuile libre pour avancer, elle reste en place.`);
            chargeRecord(it, 'none', `${unitLabel(u)} : aucune tuile libre pour avancer, elle reste en place.`, u ? [{ id: u.id, from: unitPos(u.id), to: unitPos(u.id), path: [unitPos(u.id)] }] : []);
        }
        m.qi++;
    }
    battleLog('⚔️ Charges terminées.');
    startMoveStep();
}
// Annulation des déplacements : état de l'unité (et de sa cible) avant l'action.
function pushMoveUndo(u, tid) {
    const L = state.landing, m = L.m;
    m.stack.push({ id: u.id, pos: L.b.pos[u.id] ?? null, orient: L.b.orient[u.id] ?? null, tid: tid ?? null, torient: tid ? (L.b.orient[tid] ?? null) : null, tpos: tid ? (L.b.pos[tid] ?? null) : null, step: m.step, qi: m.qi, active: m.active, moved: Boolean(m.moved[u.id]) });
    if (m.stack.length > 300) m.stack.shift();
}
// Exécute un déplacement ou une charge vers une tuile déjà vérifiée (joueur, MJ ou résolution automatique).
function doMove(u, tile, orient) {
    const L = state.landing, m = L.m;
        const it = m.step === 'charge' ? m.queue[m.qi] : null;
    // Tirailleurs d'une unité qui charge : repérés avant le déplacement (ils sont devant elle), ils la suivent juste derrière.
    const screens = it ? (it.mutual ? [it.id, it.target] : [u.id]).map((id) => allBattleUnits().find((x) => x.id === id)).filter(Boolean).map((p) => ({ p, t: screenOf(p) })).filter((z) => z.t) : [];
    const follow = () => {
        const rec = [];
        for (const { p, t } of screens) {
            const pp = unitPos(p.id), back = tileInDir(pp, ((L.b.orient[p.id] ?? 0) + 3) % 6);
            const occ = new Set(allBattleUnits().filter((x) => x.id !== t.id).map((x) => unitPos(x.id)).filter(Boolean));
            const [c, r] = pp.split(',').map(Number);
            const cands = hexNeighbors(c, r).map(([x, y]) => `${x},${y}`).filter((k) => mapHas(...k.split(',').map(Number)) && !occ.has(k) && !stopBlock(k, t))
                .sort((k1, k2) => (k1 === back ? -1 : 0) - (k2 === back ? -1 : 0) || hexDistance(k1, back || k1) - hexDistance(k2, back || k2));
            const dest = cands[0];
            if (!dest) continue;
            rec.push({ id: t.id, pos: L.b.pos[t.id] ?? null, orient: L.b.orient[t.id] ?? null });
            if (it?.res) it.res.units.push({ id: t.id, from: unitPos(t.id), to: dest, path: [unitPos(t.id), dest], screen: true });
            if (dest === L.placed[t.id]) delete L.b.pos[t.id]; else L.b.pos[t.id] = dest;
            L.b.orient[t.id] = L.b.orient[p.id];
            battleLog(`🪶 Les tirailleurs ${unitLabel(t)} accompagnent la charge et se placent juste derrière ${unitLabel(p)}.`);
        }
        if (rec.length) m.stack[m.stack.length - 1].follow = rec;
    };
    if (it?.mutual) {
        // Les deux unités avancent l'une vers l'autre sur le trajet ; l'unité avantagée a pu choisir où s'arrêter.
        const A = allBattleUnits().find((x) => x.id === it.id), B = allBattleUnits().find((x) => x.id === it.target);
        pushMoveUndo(A, B.id);
        m.stack[m.stack.length - 1].mutual = true;
        const fin = mutualResolve(it, tile);
        const setPos = (x, t) => { if (t === L.placed[x.id]) delete L.b.pos[x.id]; else L.b.pos[x.id] = t; };
        const startA = unitPos(A.id), startB = unitPos(B.id);
        const pp = it.plan.path || [];
        const seg = (from, to) => { const i = pp.indexOf(from), j = pp.indexOf(to); if (i < 0 || j < 0) return hexLine(from, to, [1e-6, 2e-6, -3e-6]); return i <= j ? pp.slice(i, j + 1) : pp.slice(j, i + 1).reverse(); };
        const resUnits = [{ id: A.id, from: startA, to: fin.a, path: seg(startA, fin.a) }, { id: B.id, from: startB, to: fin.b, path: seg(startB, fin.b) }];
        setPos(A, fin.a); setPos(B, fin.b);
        // Marqueurs de sauvegarde recalculés seulement pour l'unité qui s'est déplacée (celle qui garde sa tuile protectrice garde ses marqueurs).
        for (const [X, Y, moved] of [[A, B, fin.b !== startB], [B, A, fin.a !== startA]]) {
            const ox = L.b.orders[X.id];
            if (!ox || !moved) continue;
            const py = unitPos(Y.id), parts = ccSaveParts(py, Y, unitPos(X.id), X);
            const mk = parts.map((p) => p.k).concat(String(Y.line.kin || '') === 'vs' ? ['vs'] : []);
            if (mk.length) ox.save = mk; else delete ox.save;
            if (unitTags(X.line.name).has('c')) ox.cav = !parts.some((p) => p.k !== 'hill');
        }
        if (it.plan.noBridge) for (const X of [A, B]) { const ox = L.b.orders[X.id]; if (ox?.save) { ox.save = ox.save.filter((k) => k !== 'bridge'); if (!ox.save.length) delete ox.save; } } // pont : modificateur annulé des deux côtés
        L.b.orient[A.id] = facing(fin.a, fin.b); L.b.orient[B.id] = facing(fin.b, fin.a);
        m.moved[A.id] = true; m.moved[B.id] = true;
        battleLog(`⚔️ ${unitLabel(A)} et ${unitLabel(B)} se chargent mutuellement${it.plan.contact ? ' et se rencontrent' : ' (pas de contact : portées insuffisantes)'}.`);
        chargeRecord(it, it.plan.contact ? 'mutual' : 'failed', `${unitLabel(A)} et ${unitLabel(B)} se chargent mutuellement${it.plan.contact ? ' et se rencontrent' : ' : pas de contact (portées insuffisantes)'}${it.plan.choice?.bridge ? ' (pont : un d10 a désigné le côté, pas de modificateur de pont)' : it.plan.choice ? ' (décor plus fort d’un côté : il fixe la ligne de front)' : ''}.`, resUnits);
        follow();
        finishRecord(it);
        advanceMove(u.team);
        return true;
    }
    const tid = it ? it.target : null;
    pushMoveUndo(u, tid);
    const from0 = unitPos(u.id);
    const route = it ? routeOf(u, from0, tile, true) : null;
    const moved = tile !== unitPos(u.id);
    if (tile === L.placed[u.id]) delete L.b.pos[u.id]; else L.b.pos[u.id] = tile;
    if (it?.failed) {
        L.b.orient[u.id] = facing(tile, unitPos(tid));
        battleLog(`❌ ${unitLabel(u)} : charge échouée, elle avance au maximum de sa capacité de charge vers sa cible.`);
        chargeRecord(it, 'failed', `${unitLabel(u)} : charge échouée (cible hors de portée à la révélation) ; elle avance au maximum vers sa cible.`, [{ id: u.id, from: from0, to: tile, path: route }]);
    } else if (it && hexDistance(tile, unitPos(tid)) > 1) {
        // Toutes les tuiles au contact de la cible sont prises : deuxième rideau, l'unité ne combattra pas.
        L.b.orient[u.id] = facing(tile, unitPos(tid));
        L.b.orders[u.id].second = true;
        const tu = allBattleUnits().find((x) => x.id === tid);
        battleLog(`🛡️ ${unitLabel(u)} : toutes les tuiles au contact de ${unitLabel(tu)} sont prises ; elle s’avance au plus près, en deuxième rideau, et ne combattra pas.`);
        chargeRecord(it, 'second', `${unitLabel(u)} : toutes les tuiles au contact de ${unitLabel(tu)} sont prises ; deuxième rideau (soutien, ne combat pas).`, [{ id: u.id, from: from0, to: tile, path: route }]);
    } else if (it) {
        const tp = unitPos(tid);
        L.b.orient[u.id] = facing(tile, tp);
        // La cible se tourne vers l'attaquant, sauf si elle est déjà au corps à corps avec une autre unité.
        const busy = allBattleUnits().some((x) => x.id !== u.id && x.team && x.team === u.team && unitPos(x.id) && hexDistance(unitPos(x.id), tp) === 1);
        if (!busy) L.b.orient[tid] = facing(tp, tile);
        const tu = allBattleUnits().find((x) => x.id === tid);
        battleLog(`⚔️ ${u.line.name} ${u.idx} charge ${tu ? `${tu.line.name} ${tu.idx}` : 'sa cible'}${moved ? '' : ' (déjà au contact)'}.`);
        chargeRecord(it, 'contact', `${unitLabel(u)} charge ${tu ? unitLabel(tu) : 'sa cible'} et arrive au contact${moved ? '' : ' (elle y était déjà)'}${busy ? ' ; la cible, déjà au corps à corps, ne se retourne pas' : ' ; la cible se tourne vers elle'}.`, [{ id: u.id, from: from0, to: tile, path: route }]);
        follow();
    } else {
        const o = Number(orient);
        if (Number.isInteger(o) && o >= 0 && o <= 5) L.b.orient[u.id] = o;
        battleLog(`👣 ${u.line.name} ${u.idx} se déplace${moved ? '' : ' (reste en place)'}.`);
    }
    m.moved[u.id] = true;
    finishRecord(it);
    advanceMove(u.team);
    return true;

}
// Trajet suivi par une unité de sa tuile vers la tuile d'arrivée (plus court chemin de charge ; sinon ligne droite, charge qui traverse).
function routeOf(u, from, to, charge) {
    if (!from || !to) return [];
    if (from === to) return [from];
    const dist = reachMap(u, 60, charge);
    if (dist.has(to)) {
        const path = [to];
        let cur = to;
        for (let guard = 0; cur !== from && guard < 80; guard++) {
            const [c, r] = cur.split(',').map(Number);
            const d = dist.get(cur);
            const prev = hexNeighbors(c, r).map(([x, y]) => `${x},${y}`).filter((k) => dist.has(k) && dist.get(k) < d).sort((a, b) => dist.get(a) - dist.get(b))[0];
            if (!prev) break;
            path.unshift(prev); cur = prev;
        }
        if (path[0] === from) return path;
    }
    return hexLine(from, to, [1e-6, 2e-6, -3e-6]);
}
// Résultat d'une charge, conservé dans la file : détail des charges consultable pas à pas par tous.
// Orientation de chaque unité concernée (et de la cible) après la charge : le film des charges les rejoue.
function finishRecord(it) {
    if (!it?.res) return;
    const L = state.landing, ids = new Set([...it.res.units.map((x) => x.id), it.id, it.target]);
    it.res.orient = {};
    for (const id of ids) if (L.b.orient[id] != null) it.res.orient[id] = L.b.orient[id];
}
function chargeRecord(it, kind, text, units) { if (it) it.res = { kind, text: String(text).slice(0, 240), units: units.slice(0, 6) }; }
function advanceMove(justPlayed) {
    const m = state.landing.m;
    if (m.step === 'charge') { m.qi++; enterCharge(); return; }
    const left = eligibleMovers();
    if (!left.length) { m.step = 'done'; m.active = null; battleLog('✅ Déplacements terminés.'); return; }
    const other = justPlayed === 't1' ? 't2' : 't1';
    m.active = left.some((u) => u.team === other) ? other : justPlayed;
}

/* ---------- Tirs : artillerie puis autres tirs, à tour de rôle ; le MJ lance les dés, l'outil calcule ---------- */

const FIRE_SHORT = 3, FIRE_LONG = 7, ART_RANGE = 10;
// Un projectile d'artillerie : d4 1-3 → tuile ; 4 → nouveau d4 : 1-3 → tuile si la machine voit le point (sinon rien), 4 → incident de tir ;
// canon des Nains (unité spéciale) : une relance supplémentaire avant l'incident.
function artShot(prof, three, noLos) {
    const sh = { r1: rollD(4), dmg: prof.art.dmg };
    const second = (r) => { if (r <= 3) { if (!noLos) sh.tile = three[r - 1]; else sh.blind = true; return true; } return false; };
    if (sh.r1 <= 3) { sh.tile = three[sh.r1 - 1]; return sh; }
    sh.r2 = rollD(4);
    if (second(sh.r2)) return sh;
    if ((prof.tags || []).includes('spe')) { sh.r3 = rollD(4); if (second(sh.r3)) return sh; }
    sh.incident = true;
    return sh;
}
// Les 3 tuiles consécutives du trajet qui finissent au point visé : [1 = la plus proche de la machine, 2, 3 = le point] ; null si hors du trajet (point à moins de 3 hex).
function artTiles(sp, pt) {
    const line = hexLine(sp, pt, [1e-6, 2e-6, -3e-6]), d = line.length - 1;
    return [d - 2, d - 1, d].map((i) => (i >= 1 ? line[i] : null));
}
// Capacités écrites entre parenthèses dans le nom de la fiche : « roquette (aL,mag) » → al, mag.
function unitTags(name) {
    const out = new Set();
    for (const grp of String(name || '').match(/\(([^)]*)\)/g) || []) {
        for (let t of grp.slice(1, -1).split(',')) {
            t = t.trim().toLowerCase().replace(/\s+/g, ' ');
            if (/^(dep\+t|dep\+tir|tir\+dep)$/.test(t)) { out.add('dep+t'); continue; }
            if (t === '2 att') t = '2att';
            for (const x of t.split(/\+| ou /)) if (x.trim()) out.add(x.trim());
        }
    }
    return out;
}
function armyUnitOf(armyId, uid) {
    const army = fichesArmy(armyId);
    return army ? (army.units || []).find((x) => unitKey(army.id, x) === uid) || null : null;
}
function lineSource(line) {
    if (line.merc) {
        const id = String(line.uid).slice(5);
        for (const list of Object.values(state.fichesTeams.mercs || {})) { const m = (list || []).find((x) => x.id === id); if (m) return armyUnitOf(m.army, m.uid); }
        return null;
    }
    return armyUnitOf(line.army, line.uid);
}
// Profil d'une figurine d'après sa fiche : PV (G), armure (H), att (C), tir (portée « 3/7 » de la ligne ou de sa 2e ligne), artillerie (portée 10, dégâts = att).
function profileOf(src, fallbackName) {
    const i = src?.in_ || {};
    const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const name = String(i.B || fallbackName || '');
    const C = num(i.C) ?? 0;
    const p = { name, pv: Math.max(1, num(i.G) ?? 1), arm: num(i.H), att: C, tir: null, art: null, tags: [...unitTags(name)] };
    const E = String(i.E ?? '').trim();
    if (E === '10') p.art = { dmg: C }; else if (E.includes('/')) p.tir = { att: C };
    p.cc = !E && C > 0; // attaque de corps à corps : att de la ligne principale, sans portée
    const l2 = src?.l2?.in_;
    if (!p.tir && l2 && String(l2.E ?? '').includes('/')) p.tir = { att: num(l2.C) ?? 0 };
    return p;
}
// Figurines d'une unité : parts (profils) et, pour chaque figurine, l'indice de sa part. Les blessures retirent d'abord les dernières figurines :
// dans une unité composée, la part la plus nombreuse (servants, troupe) tombe avant la figurine seule (machine, champion).
function unitTemplate(u) {
    const line = u.line;
    let parts;
    if (Array.isArray(line.comp) && line.comp.length) {
        parts = line.comp.map((c) => ({ prof: profileOf(armyUnitOf(line.army, c.uid), c.name), n: Math.max(0, c.figs) })).filter((p) => p.n > 0);
        parts.sort((a, b) => a.n - b.n);
    } else {
        const q = Math.max(1, line.qty), base = Math.floor(line.figs / q), extra = line.figs % q;
        parts = [{ prof: profileOf(lineSource(line), line.name), n: Math.max(1, base + (u.idx <= extra ? 1 : 0)) }];
    }
    const figs = [];
    parts.forEach((p, pi) => { for (let k = 0; k < p.n; k++) figs.push(pi); });
    return { parts: parts.map((p) => p.prof), figs };
}
// Capacités d'une ligne pour les ordres : cc (charge), tir (courte/longue), art (artillerie). Unité composée : la ligne de base (machine, troupe).
function lineCaps(line) {
    const src = Array.isArray(line.comp) && line.comp.length ? armyUnitOf(line.army, line.comp[0].uid) : lineSource(line);
    if (!src) return { cc: true, tir: false, art: false }; // ligne sans fiche : seule la charge reste possible
    const p = profileOf(src, line.name);
    return { cc: p.cc, tir: Boolean(p.tir), art: Boolean(p.art) };
}
function unitHp(u) {
    const b = state.landing.b;
    if (Array.isArray(b?.hp?.[u.id])) return b.hp[u.id].slice();
    const t = unitTemplate(u);
    return t.figs.map((pi) => t.parts[pi].pv);
}
const aliveCount = (u) => unitHp(u).filter((x) => x > 0).length;
// Profils des figurines encore en vie (pour le nombre de points d'attaque).
function aliveProfiles(u) {
    const t = unitTemplate(u), hp = unitHp(u);
    return hp.map((x, i) => (x > 0 ? t.parts[t.figs[Math.min(i, t.figs.length - 1)]] : null)).filter(Boolean);
}
// Profil de la figurine qui encaisse en premier (la dernière encore en vie).
function frontProfile(u) {
    const t = unitTemplate(u), hp = unitHp(u);
    for (let i = hp.length - 1; i >= 0; i--) if (hp[i] > 0) return t.parts[t.figs[Math.min(i, t.figs.length - 1)]];
    return t.parts[0];
}
function setHp(u, hp) {
    const b = state.landing.b;
    b.hp = b.hp || {}; b.dead = b.dead || {};
    b.hp[u.id] = hp.map((x) => Math.max(0, Math.round(x * 10) / 10));
    if (!hp.some((x) => x > 0)) b.dead[u.id] = true; else delete b.dead[u.id];
}
// Retire `dmg` PV en partant de la dernière figurine ; `single` : une seule figurine touchée (artillerie), le surplus est perdu.
function applyDamage(hp, dmg, single) {
    let left = dmg;
    for (let i = hp.length - 1; i >= 0 && left > 0; i--) {
        if (hp[i] <= 0) continue;
        const d = Math.min(hp[i], left);
        hp[i] -= d; left -= d;
        if (single) break;
    }
    return dmg - left;
}
// Artillerie : tous ses points d'attaque sur une seule figurine, sans armure ; en priorité une grande figurine, un monstre ou une pièce d'artillerie
// (la figurine vivante qui a le plus de PV de départ), sinon la dernière figurine.
function applyArtDamage(u, hp, dmg) {
    const t = unitTemplate(u);
    let best = -1, bpv = -1;
    for (let i = hp.length - 1; i >= 0; i--) { if (hp[i] <= 0) continue; const pv = t.parts[t.figs[i]]?.pv || 0; if (pv > bpv) { best = i; bpv = pv; } }
    if (best < 0) return 0;
    const d = Math.min(hp[best], dmg);
    hp[best] -= d;
    return d;
}
const isGenUnit = (u) => state.landing.gen?.[u.owner] === u.id;
const foesOf = (u) => allBattleUnits().filter((x) => x.team && u.team && x.team !== u.team && unitPos(x.id));
const inMelee = (u) => { const p = unitPos(u.id); return Boolean(p) && foesOf(u).some((x) => hexDistance(unitPos(x.id), p) === 1); };
const hasTag = (u, tag) => unitTemplate(u).parts.some((p) => p.tags.includes(tag));

// Trait de vision : hexagones traversés entre deux centres (voir visionCheck).
const cubeOf = (key) => { const [c, r] = key.split(',').map(Number); const x = c - (r - (r & 1)) / 2; return [x, -x - r, r]; };
function cubeRound([x, y, z]) {
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    return [rx, ry, rz];
}
// Toutes les tuiles réellement traversées par le segment de centre à centre (y compris un coin rogné), dans l'ordre du trajet.
// eps : léger décalage perpendiculaire (trait qui passe exactement par un sommet ou longe un bord : un côté puis l'autre).
function hexTrace(a, b, side) {
    const A = hexXY(a), B = hexXY(b), n = hexDistance(a, b);
    if (!n) return [a];
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * 1e-4 * side, py = (dx / len) * 1e-4 * side;
    const out = [];
    const steps = n * 40;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = A.x + dx * t + (i && i < steps ? px : 0), y = A.y + dy * t + (i && i < steps ? py : 0);
        const rq = (Math.sqrt(3) / 3 * x - y / 3), rr = 2 / 3 * y;
        let cx = rq, cz = rr, cy = -cx - cz;
        let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
        const ddx = Math.abs(rx - cx), ddy = Math.abs(ry - cy), ddz = Math.abs(rz - cz);
        if (ddx > ddy && ddx > ddz) rx = -ry - rz; else if (ddy > ddz) ry = -rx - rz; else rz = -rx - ry;
        const k = `${rx + (rz - (rz & 1)) / 2},${rz}`;
        if (out[out.length - 1] !== k) out.push(k);
    }
    return out;
}
function hexLine(a, b, eps) {
    const A = cubeOf(a), B = cubeOf(b), n = hexDistance(a, b), out = [];
    for (let i = 0; i <= n; i++) {
        const t = n ? i / n : 0;
        const [x, , z] = cubeRound([0, 1, 2].map((k) => A[k] + (B[k] - A[k]) * t + eps[k]));
        out.push(`${x + (z - (z & 1)) / 2},${z}`);
    }
    return out;
}

// Peut tirer pendant l'étape : artillerie (portée 10) ou tir (3/7). Ordres permis : tir, déplacement (malus +3 après déplacement), tirailleur.
// Artillerie et armes lourdes : pas de tir après déplacement ni au corps à corps.
function fireModes(u) {
    const L = state.landing, f = L.f;
    if (!f || f.shot[u.id] || !unitPos(u.id) || !u.team) return [];
    const o = L.b.orders[u.id];
    if (!o || !['tir', 'depl', 'tirailleur'].includes(o.type)) return [];
    const profs = aliveProfiles(u);
    const heavyBlocked = Boolean(f.moved[u.id]) || inMelee(u);
    const modes = [];
    const rg = o.type === 'tir' ? o.range : null; // art : artillerie seulement ; court/long : tir seulement
    if (!heavyBlocked && profs.some((p) => p.art) && o.type === 'tir' && rg !== 'court' && rg !== 'long') modes.push('art'); // artillerie : seulement avec son ordre de tir
    if (profs.some((p) => p.tir && (!p.tags.includes('al') || !heavyBlocked)) && rg !== 'art') modes.push('tir');
    return modes;
}
const fireShooters = (step) => allBattleUnits().filter((u) => fireModes(u).includes(step));
function fireTargets(u, mode) {
    const p = unitPos(u.id);
    const o = state.landing.b.orders[u.id];
    const max = mode === 'art' ? ART_RANGE : (o?.type === 'tir' && o.range === 'court' ? FIRE_SHORT : FIRE_LONG);
    return foesOf(u).map((t) => ({ t, d: hexDistance(p, unitPos(t.id)) })).filter((x) => x.d <= max && !(mode === 'art' && isGenUnit(x.t))).sort((a, b) => a.d - b.d);
}
// Modificateurs proposés (lus sur la carte) ; le MJ peut les cocher ou décocher. v > 0 : malus (seuil plus haut), v < 0 : bonus.
function fireMods(u, t, mode) {
    const L = state.landing;
    const sp = unitPos(u.id), tp = unitPos(t.id);
    const d = hexDistance(sp, tp);
    const vc = visionCheck(u, t); // règle de vision, au moment du tir (après charges et déplacements)
    const los = { ok: vc.seen, reason: vc.why, forestBehind: vc.forestBehind };
    if (mode === 'art') return { d, los, mods: [{ k: 'nolos', label: 'Sans ligne de vue (la relance sur 4 ne touche pas)', v: 0, on: !los.ok }] };
    const tirP = aliveProfiles(u).filter((p) => p.tir);
    const tags = new Set(tirP.flatMap((p) => p.tags));
    const heavy = tags.has('al');
    const depT = tags.has('dep+t') || /^cl/.test(String(u.line.type || ''));
    const order = L.b.orders[u.id];
    const gtile = state.gridData[tp] || {};
    const tFly = unitMob(t).fly;
    const gen = L.gen[u.owner] ? unitPos(L.gen[u.owner]) : null;
    const near = Boolean(gen && hexDistance(sp, gen) <= genRadius(u.owner));
    const baT = terrainBA(u);
    const build = gtile.object === 'wall' || villageCover(tp) || (['fortress', 'fortress-half'].includes(gtile.object) && !tFly);
    const mods = [
        { k: 'long', label: heavy ? 'Longue portée (arme lourde)' : 'Longue portée', v: heavy ? 1 : 3, on: d > FIRE_SHORT },
        { k: 'moved', label: 'Tir après déplacement', v: 3, on: Boolean(L.f.moved[u.id]) && !depT },
        { k: 'melee', label: 'Tireur pris au corps à corps', v: 3, on: inMelee(u) && order?.type !== 'tirailleur' },
        { k: 'nolos', label: `Sans voir${los.ok ? '' : ` (${los.reason})`}`, v: 4, on: !los.ok },
        { k: 'std', label: 'Cible avec étendard', v: 1, on: Boolean(L.std[t.id]) },
        { k: 'hill', label: 'Cible sur colline', v: 1, on: (gtile.terrain ?? 'plain') === 'hill' && !tFly },
        { k: 'forest', label: 'Cible dans ou derrière une forêt', v: 2, on: gtile.object === 'forest' || los.forestBehind },
        { k: 'build', label: 'Cible dans une construction (fortification, muret) ou autour d’un village', v: 2, on: build },
        { k: 'bridge', label: 'Cible à la sortie du pont (le tir arrive par le pont)', v: 2, on: (() => { if (gtile.object === 'bridge' || unitMob(u).fly || unitMob(u).jump) return false; return [[1e-6, 2e-6, -3e-6], [-1e-6, -2e-6, 3e-6]].some((e) => { const ln = hexLine(sp, tp, e); return state.gridData[ln[ln.length - 2]]?.object === 'bridge'; }); })() }, // trait le long d'un bord : l'un des deux côtés suffit
        { k: 'trear', label: 'Cible prise à revers', v: -2, on: (() => { const p = screenedUnit(t, false); return throughRear(t, u, p ? L.b.orient[p.id] : undefined); })() },
        { k: 'tmarche', label: 'Cible en marche forcée', v: -2, on: L.b.orders?.[t.id]?.type === 'marche' },
        { k: 'gen', label: 'Cible : unité du général', v: 3, on: isGenUnit(t) },
        { k: 'gatt', label: 'Ordre du général « att »', v: -1, on: genPower(u.owner) === 'att' && near },
        ...(baT === undefined ? [] : [{ k: 'ba', label: `Bonus d'armée (${TERRAIN_BA[u.line.army].label} à ${TERRAIN_BA_RADIUS} hex ou moins)`, v: -1, on: Boolean(baT) }]),
        { k: 'spe', label: 'Unité spéciale', v: -1, on: tags.has('spe') },
        { k: 'mag', label: 'Magie : armure de la cible +1', v: 0, arm: 1, on: tags.has('mag') }
    ];
    return { d, los, mods };
}
const fireThreshold = (p) => 4 + p.mods.filter((m) => m.on).reduce((s, m) => s + m.v, 0) + (p.adj || 0);
// Points d'attaque → dés : un d10 par dizaine (valeur 10) et un dé pour le reste (valeur = le reste).
function attackDice(points) {
    const out = [];
    for (let i = 0; i < Math.floor(points / 10); i++) out.push(10);
    if (points % 10) out.push(Math.round((points % 10) * 10) / 10);
    return out;
}
const teamLabel = (t) => state.fichesTeams.names[t] || (t === 't1' ? 'Équipe 1' : 'Équipe 2');
const unitLabel = (u) => (u ? `${u.line.name} ${u.idx}` : '?');
function fireStart(step) {
    const f = state.landing.f;
    f.step = step; f.pending = null;
    const left = fireShooters(step);
    if (!left.length) {
        battleLog(step === 'art' ? '💥 Aucune artillerie ne peut tirer.' : '🏹 Aucun autre tir possible.');
        if (step === 'art') return fireStart('tir');
        return startFlee();
    }
    const teams = new Set(left.map((u) => u.team));
    if (teams.size > 1) {
        const r = rollInitiative();
        f.rolls[step] = r.roll; f.active = r.first;
        battleLog(`🎲 ${step === 'art' ? 'Artillerie' : 'Tirs'} : ${teamLabel('t1')} ${r.roll.t1} · ${teamLabel('t2')} ${r.roll.t2} → ${teamLabel(r.first)} commence.`);
        announceRoll(step === 'art' ? 'Artillerie : qui commence ?' : 'Tirs : qui commence ?', [{ label: teamLabel('t1'), sides: 10, v: r.roll.t1, ok: r.first === 't1' }, { label: teamLabel('t2'), sides: 10, v: r.roll.t2, ok: r.first === 't2' }], `${teamLabel(r.first)} commence.`);
    } else {
        f.rolls[step] = null; f.active = [...teams][0];
        battleLog(`${step === 'art' ? '💥 Artillerie' : '🏹 Tirs'} : seule ${teamLabel(f.active)} peut tirer.`);
    }
}
function fireAdvance(justPlayed) {
    const f = state.landing.f;
    f.pending = null;
    const left = fireShooters(f.step);
    if (!left.length) return f.step === 'art' ? fireStart('tir') : startFlee();
    const other = justPlayed === 't1' ? 't2' : 't1';
    f.active = left.some((u) => u.team === other) ? other : justPlayed;
}
// Jets de fuite : unités qui sont passées à la moitié de leurs figurines ou moins pendant les tirs (sauf l'unité du général).
// Fin de la phase de tir : les tirailleurs chargés (après avoir tiré) échangent leur place avec l'unité qu'ils protègent ; le corps à corps aura lieu
// entre l'unité qui a chargé et l'unité protégée.
function fireFinished() {
    const L = state.landing, b = L.b;
    for (const sw of b.swaps || []) {
        if (sw.done) continue;
        const T = allBattleUnits().find((x) => x.id === sw.t), P = allBattleUnits().find((x) => x.id === sw.p), F = allBattleUnits().find((x) => x.id === sw.foe);
        const pt = T && unitPos(T.id), pp = P && unitPos(P.id), pf = F && unitPos(F.id);
        if (!pt || !pp || !pf || b.dead?.[T.id] || b.dead?.[P.id] || b.dead?.[F.id] || hexDistance(pt, pf) !== 1) continue;
        const setPos = (x, t) => { if (t === L.placed[x.id]) delete b.pos[x.id]; else b.pos[x.id] = t; };
        setPos(T, pp); setPos(P, pt);
        b.orient[P.id] = facing(pt, pf); b.orient[T.id] = b.orient[P.id]; // l'ensemble garde une seule orientation
        sw.done = true;
        battleLog(`🪶 ${unitLabel(P)} passe devant ses tirailleurs ${unitLabel(T)} : le corps à corps aura lieu entre ${unitLabel(F)} et ${unitLabel(P)}.`);
    }
}
function startFlee() {
    const f = state.landing.f;
    f.step = 'flee'; f.active = null; f.pending = null; f.flee = {};
    for (const u of allBattleUnits()) {
        if (!unitPos(u.id) || isGenUnit(u)) continue;
        const total = unitTemplate(u).figs.length, now = aliveCount(u), before = f.start[u.id] ?? total;
        if (now * 2 <= total && before * 2 > total) f.flee[u.id] = null;
    }
    const n = Object.keys(f.flee).length;
    if (!n) { f.step = 'done'; battleLog('✅ Tirs terminés, aucun jet de fuite.'); fireFinished(); }
    else battleLog(`🏳️ Tirs terminés : ${n} jet(s) de fuite à faire.`);
}
const fearless = (u) => /^(iL|ie|cL|m)/.test(String(u.line.type || '')); // indémoralisables : infanterie lourde ou d'élite, cavalerie lourde, monstres
// Armure (A) de la cible : celle de la figurine qui encaisse ; magie +1. null = pas d'armure (tous les dés qui touchent blessent).
function armourOf(t, p) {
    const a = frontProfile(t).arm;
    if (a == null) return null;
    return a + (p.mods.some((m) => m.arm && m.on) ? 1 : 0);
}
function pushFire(tid, more = []) {
    const L = state.landing, f = L.f;
    const { stack, snap, ...rest } = f;
    const snapOf = (id) => ({ tid: id, hp: L.b.hp?.[id] ? L.b.hp[id].slice() : null, dead: Boolean(L.b.dead?.[id]) });
    stack.push({ f: JSON.stringify(rest), tid: tid ?? null, hp: tid && L.b.hp?.[tid] ? L.b.hp[tid].slice() : null, dead: Boolean(tid && L.b.dead?.[tid]), extra: more.filter((id) => id && id !== tid).map(snapOf) });
    if (stack.length > 60) stack.shift();
}

function emitLanding() {
    pruneBattle();
    pruneGeneral();
    pruneSim();
    for (const s of io.sockets.sockets.values()) {
        if (s.data?.name) s.emit('landing', landingViewFor(s));
    }
}

/* ------------------------------------------------------------------ */
/* Export du jeu complet pour un serveur local (sans internet)          */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// Archive ZIP minimale (sans compression) : suffisante pour un dossier de quelques Mo.
function makeZip(files) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const name = Buffer.from(f.name, 'utf8');
        const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
        local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
        parts.push(local, name, data);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x031e, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(0, 10);
        cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(((f.mode ?? 0o644) << 16) >>> 0, 38); cd.writeUInt32LE(offset, 42);
        central.push(cd, name);
        offset += local.length + name.length + data.length;
    }
    const cdBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cdBuf, end]);
}

const LOCAL_PACKAGE_JSON = JSON.stringify({
    name: 'jeu-local', version: '1.0.0', private: true, main: 'server.js',
    scripts: { start: 'node server.js' }, dependencies: { express: '^4.19.2', 'socket.io': '^4.7.5' }
}, null, 2);

const LOCAL_BAT = [
    '@echo off', 'chcp 65001 >nul', 'cd /d "%~dp0"',
    'where node >nul 2>nul || (echo Node.js n est pas installe. Installez-le depuis https://nodejs.org puis relancez ce fichier. & pause & exit /b 1)',
    'if not exist node_modules (echo Premiere installation : une connexion internet est necessaire UNE SEULE FOIS. & call npm install --omit=dev || (echo Echec de l installation. & pause & exit /b 1))',
    'if "%ADMIN_PASSWORD%"=="" set /p ADMIN_PASSWORD=Choisissez le mot de passe du MJ : ',
    'set PORT=3000', 'echo.',
    'echo Les joueurs doivent etre sur le meme Wi-Fi et ouvrir l une des adresses affichees ci-dessous.',
    'node server.js', 'pause', ''
].join('\r\n');

const LOCAL_SH = [
    '#!/bin/sh', 'cd "$(dirname "$0")"',
    'command -v node >/dev/null 2>&1 || { echo "Node.js n est pas installe (https://nodejs.org, ou : pkg install nodejs sous Termux)."; exit 1; }',
    '[ -d node_modules ] || { echo "Premiere installation : une connexion internet est necessaire UNE SEULE FOIS."; npm install --omit=dev || exit 1; }',
    '[ -n "$ADMIN_PASSWORD" ] || { printf "Choisissez le mot de passe du MJ : "; read ADMIN_PASSWORD; export ADMIN_PASSWORD; }',
    'export PORT=3000', 'echo "Les joueurs doivent etre sur le meme Wi-Fi et ouvrir l une des adresses affichees ci-dessous."',
    'node server.js', ''
].join('\n');

const LOCAL_README = `JEU EN SERVEUR LOCAL (sans internet)
=====================================

Ce dossier contient tout le jeu : le serveur, les pages, vos cartes, vos fiches d'armée,
l'équipe, les légions choisies et le débarquement en cours, tels qu'ils étaient à l'export.

1. PRÉPARATION (une seule fois, AVEC internet)
   - Installez Node.js (https://nodejs.org, version 18 ou plus récente) sur l'appareil qui servira de serveur.
   - Windows : double-cliquez sur « demarrer-windows.bat ».
     Mac / Linux : dans un terminal, « sh demarrer-mac-linux.sh ».
     Téléphone Android : installez Termux, puis « pkg install nodejs », ouvrez ce dossier
     et lancez « sh demarrer-mac-linux.sh ».
   - Au premier lancement, les composants du serveur sont téléchargés (dossier node_modules).
     Une fois fait, plus aucune connexion internet n'est nécessaire.

2. JOUER SANS INTERNET
   - L'appareil serveur et tous les joueurs doivent être sur le même réseau Wi-Fi. Sans box internet,
     activez le partage de connexion (point d'accès Wi-Fi) d'un téléphone ou d'un PC : il n'a pas
     besoin d'internet pour que les appareils se voient entre eux.
   - Au démarrage, le serveur affiche ses adresses, par exemple http://192.168.1.20:3000.
     Chaque joueur ouvre cette adresse dans son navigateur. Le MJ se connecte avec le pseudo « MJ »
     et le mot de passe choisi au lancement.
   - Le Bluetooth n'est pas pris en charge : le jeu a besoin d'un réseau Wi-Fi (ou Ethernet).

3. DONNÉES
   - Tout est enregistré dans le dossier « data ». Gardez-le : c'est votre partie.
   - Pour revenir sur le serveur en ligne, exportez à nouveau depuis le jeu local (fenêtre Cartes)
     et utilisez les fichiers exportés de cartes et de fiches.
`;

function lanAddresses(port) {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
    }
    return out;
}

async function buildGamePackage() {
    const files = [];
    const add = (name, data, mode) => files.push({ name, data, mode });
    add('LISEZMOI.txt', LOCAL_README);
    add('package.json', LOCAL_PACKAGE_JSON);
    add('demarrer-windows.bat', LOCAL_BAT);
    add('demarrer-mac-linux.sh', LOCAL_SH, 0o755);
    add('server.js', fs.readFileSync(__filename));
    if (fs.existsSync(FICHES_SEED_FILE)) add('fiches-seed.json', fs.readFileSync(FICHES_SEED_FILE));
    const pubDir = path.join(__dirname, 'public');
    const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, `${rel}${entry.name}/`);
            else add(`public/${rel}${entry.name}`, fs.readFileSync(full));
        }
    };
    if (fs.existsSync(pubDir)) walk(pubDir, '');
    add('data/state.json', JSON.stringify(state));
    for (const id of mapsIndex.keys()) {
        const map = await storage.getMap(id);
        if (map) add(`data/maps/${id}.json`, JSON.stringify({ ...map, id }));
    }
    const bg = await storage.loadBackground();
    if (bg) add('data/background.json', JSON.stringify({ version: bg.version, image: bg.buffer.toString('base64') }));
    const docIds = [];
    for (const id of allArmyIds()) docIds.push(`fiches_a_${id}`);
    docIds.push('fiches_fams', 'fiches_custom', SNAPS_INDEX);
    for (const m of await loadSnapIndex()) docIds.push(`fiches_snap_${m.id}`);
    for (const id of docIds) {
        const doc = await storage.loadDoc(id);
        if (doc) add(`data/docs/${id}.json`, JSON.stringify(doc));
    }
    return makeZip(files);
}

/* ------------------------------------------------------------------ */
/* Serveur HTTP + Socket.IO                                            */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, p) => { if (/\.html$/.test(p)) res.setHeader('Cache-Control', 'no-cache, must-revalidate'); } }));

// Image de fond de la page de connexion ; le numéro de version dans l'adresse permet un cache durable.
app.get('/background.jpg', (req, res) => {
    if (!background) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.send(background.buffer);
});

const server = http.createServer(app);
// Délais plus larges : un téléphone en veille ne doit pas être considéré comme déconnecté trop vite.
const io = new Server(server, { pingInterval: 20000, pingTimeout: 60000, maxHttpBufferSize: 6e6 });

function connectedUsers() {
    const names = [];
    for (const s of io.sockets.sockets.values()) {
        if (s.data.name) names.push(s.data.name);
    }
    return [...new Set(names)];
}

// Pseudos ayant modifié la carte en cours (affichés hors ligne sur la page de connexion).
const contributors = new Set();

function rebuildContributors() {
    contributors.clear();
    for (const tile of Object.values(state.gridData)) {
        if (tile.author) contributors.add(tile.author);
        if (tile.objectAuthor) contributors.add(tile.objectAuthor);
    }
}

function presence() {
    const online = connectedUsers();
    const onlineLower = new Set(online.map((name) => name.toLowerCase()));
    const offline = [...contributors]
        .filter((name) => !onlineLower.has(name.toLowerCase()))
        .sort((a, b) => a.localeCompare(b, 'fr'));
    return { online, offline };
}

const broadcastUsers = () => io.emit('update-users-list', presence());
const broadcastMaps = () => io.to('admins').emit('maps-list', listMaps());
// changes : { "col,ligne": case | null }
const broadcastTiles = (changes) => io.emit('update-tiles', { changes });

function releaseSession(s) {
    s.data.name = '';
    s.data.isAdmin = false;
    s.data.token = '';
    s.leave('admins');
}

// Mode « test et correction » du MJ : il agit pour tous les joueurs (et lance leurs dés). Hors de ce mode, chacun ne gère que ses unités.
const testMJ = (socket) => Boolean(socket.data.isAdmin && state.landing?.test?.on);
// Joueurs que le MJ peut incarner en mode test : ceux qui ont des unités, et tous les joueurs des équipes (choix des zones, avant le dépôt).
function testPlayers() {
    const out = [];
    for (const n of [...Object.keys(state.landing.roster || {}), ...Object.keys(state.fichesTeams.members || {}).filter((n) => state.fichesTeams.members[n])]) if (!out.some((x) => ci(x, n))) out.push(n);
    return out;
}
function actorName(socket, payload) {
    if (testMJ(socket) && typeof payload?.as === 'string') { const n = testPlayers().find((x) => ci(x, payload.as)); if (n) return n; }
    const uid0 = typeof payload?.unit === 'string' ? payload.unit : (Array.isArray(payload?.units) ? String(payload.units[0] ?? '') : '');
    if (testMJ(socket) && uid0.includes('|')) { const o = uid0.slice(0, uid0.indexOf('|')); if (keyOf(state.landing.roster || {}, o)) return keyOf(state.landing.roster, o); }
    return socket.data.name;
}
function requireAdmin(socket, ack) {
    if (socket.data.isAdmin) return true;
    reply(ack, { success: false, message: 'Action réservée à l’administrateur.' });
    return false;
}

// Historique annuler / rétablir : un par joueur (en mémoire, perdu au redémarrage du serveur).
const histories = new Map(); // pseudo -> { undo: [lot], redo: [lot] } ; lot = [{ key, before, after }] (JSON)

function historyOf(name) {
    if (!histories.has(name)) histories.set(name, { undo: [], redo: [] });
    return histories.get(name);
}

// Les dépôts d'unités partagent l'historique des modifications de tuiles : une entrée de débarquement est { landing: true, unit, before, after }
// où before / after = { tile: 'col,ligne' | null, std: booléen }. Annuler / rétablir suit donc l'ordre réel des actions de chaque joueur.
const isLandingBatch = (batch) => Boolean(batch?.[0]?.landing);

function recordLandingMove(name, unitId, before, after) {
    if (before.tile === after.tile && before.std === after.std) return;
    recordHistory(name, [{ landing: true, unit: unitId, before, after }]);
}

// Le débarquement vient de changer d'étape ou de recommencer : les anciennes entrées de dépôt n'ont plus de sens.
function purgeLandingHistory() {
    for (const history of histories.values()) {
        history.undo = history.undo.filter((b) => !isLandingBatch(b));
        history.redo = history.redo.filter((b) => !isLandingBatch(b));
    }
}

function recordHistory(name, batch) {
    const history = historyOf(name);
    history.undo.push(batch);
    history.redo = [];
    let total = history.undo.reduce((sum, b) => sum + b.length, 0);
    while (history.undo.length > HISTORY_MAX_BATCHES || (total > HISTORY_MAX_ENTRIES && history.undo.length > 1)) {
        total -= history.undo.shift().length;
    }
}

// Rejoue un lot en sens inverse. Une case modifiée depuis par quelqu'un d'autre est laissée telle quelle.
function replayBatch(grid, batch) {
    const changes = {};
    const inverse = [];
    for (const { key, before, after } of batch) {
        if (JSON.stringify(grid[key] ?? null) !== after) continue;
        const tile = JSON.parse(before);
        if (tile) grid[key] = tile;
        else delete grid[key];
        changes[key] = tile;
        inverse.push({ key, before: after, after: before });
    }
    return { changes, inverse };
}

// Applique une action sur des cases, sauvegarde, diffuse uniquement ce qui a changé et l'inscrit dans l'historique.
function applyEdits(keys, action, options, author) {
    const changes = {};
    const batch = [];
    for (const key of new Set(keys)) {
        if (!isValidKey(key, state.config)) continue;
        const previous = state.gridData[key];
        const next = editTile(previous, action, options, author);
        if (next === undefined) continue;

        if (next === null) delete state.gridData[key];
        else state.gridData[key] = next;
        changes[key] = next;
        batch.push({ key, before: JSON.stringify(previous ?? null), after: JSON.stringify(next) });
    }
    if (batch.length > 0) {
        recordHistory(author, batch);
        scheduleSave();
        broadcastTiles(changes);
        if (author && !contributors.has(author)) {
            contributors.add(author);
            broadcastUsers();
        }
    }
}

function runHistory(socket, ack, from, to) {
    if (!socket.data.name) return reply(ack, { success: false, message: 'Connectez-vous d’abord.' });

    const history = historyOf(socket.data.name);
    const top = history[from][history[from].length - 1];
    if (isLandingBatch(top)) return runLandingHistory(socket, ack, from, to, history);
    if (state.isLocked) return reply(ack, { success: false, message: 'Le plateau est verrouillé.' });
    const batch = history[from].pop();
    if (!batch) return reply(ack, { success: false, message: from === 'undo' ? 'Rien à annuler.' : 'Rien à rétablir.' });

    const { changes, inverse } = replayBatch(state.gridData, batch);
    if (inverse.length === 0) {
        return reply(ack, { success: false, message: 'Ces cases ont été modifiées par quelqu’un d’autre : impossible.' });
    }
    history[to].push(inverse);
    scheduleSave();
    broadcastTiles(changes);
    const label = from === 'undo' ? 'Annulé' : 'Rétabli';
    return reply(ack, { success: true, message: `${label} (${inverse.length} case${inverse.length > 1 ? 's' : ''}).` });
}

// Annuler / rétablir un dépôt d'unité : l'unité retrouve sa tuile (ou le sélecteur) et son étendard d'avant.
function runLandingHistory(socket, ack, from, to, history) {
    const L = state.landing;
    const name = socket.data.name;
    const entry = history[from].pop()[0];
    const label = from === 'undo' ? 'Annulé' : 'Rétabli';
    const target = from === 'undo' ? entry.before : entry.after;
    const current = from === 'undo' ? entry.after : entry.before;
    const found = findLine(name, entry.unit);
    if (L.phase !== 'place' || !found) return reply(ack, { success: false, message: 'Le dépôt des unités n’est plus ouvert : rien à ' + (from === 'undo' ? 'annuler' : 'rétablir') + '.' });
    if ((L.placed[found.id] ?? null) !== current.tile || Boolean(L.std[found.id]) !== current.std) {
        return reply(ack, { success: false, message: 'Cette unité a été modifiée depuis : impossible.' });
    }
    if (target.tile) {
        const zone = zoneById(L.choices[keyOf(L.choices, name) ?? ''] ?? '');
        if (!zone || !zone.tiles.includes(target.tile)) return reply(ack, { success: false, message: 'Cette tuile n’appartient plus à votre zone.' });
        L.placed[found.id] = target.tile;
    } else delete L.placed[found.id];
    if (target.tile && target.std) L.std[found.id] = true; else delete L.std[found.id];
    history[to].push([entry]);
    scheduleSave();
    emitLanding();
    return reply(ack, { success: true, message: `${label} : unité ${target.tile ? 'replacée' : 'retirée de la carte'}.` });
}

// Évite qu'une erreur de stockage ne fasse tomber le serveur : le client reçoit un message clair.
const guarded = (handler) => async (payload, ack) => {
    try {
        await handler(payload, ack);
    } catch (err) {
        console.error('⚠️ Erreur de stockage :', err.message);
        reply(ack, { success: false, message: 'Erreur du serveur (stockage). Réessayez.' });
    }
};

io.on('connection', (socket) => {
    socket.data = { name: '', clientId: '', isAdmin: false, token: '' };

    socket.emit('init', {
        config: state.config,
        gridData: state.gridData,
        terrains: state.terrainsList,
        presence: presence(),
        protection: state.protection,
        isLocked: state.isLocked,
        fichesAccess: state.fichesAccess,
        fichesFrozen: state.fichesFrozen,
        landing: landingViewFor(socket),
        fichesPickLabels: fichesPickLabels(),
        backgroundVersion: background?.version ?? 0
    });

    /* ---------- Connexion ---------- */

    socket.on('set-username', (payload, ack) => {
        const ip = socket.handshake.address;
        const clientId = cleanText(payload?.clientId, 64);
        let name;
        let wantsAdmin;
        let token = '';

        if (payload?.token) {
            // Reprise de session : pas besoin de ressaisir le mot de passe admin.
            token = String(payload.token);
            const session = sessions.get(token);
            const invalid = !session
                || Date.now() - session.lastSeen > SESSION_TTL_MS
                || (session.isAdmin && session.fp !== ADMIN_FINGERPRINT);
            if (invalid) {
                dropSession(token);
                return reply(ack, { success: false, code: 'session-expired', message: 'Session expirée, reconnectez-vous.' });
            }
            name = session.name;
            wantsAdmin = session.isAdmin;
        } else {
            name = cleanText(payload?.name, LIMITS.maxName);
            if (!name) return reply(ack, { success: false, message: 'Pseudo invalide.' });

            wantsAdmin = name.toLowerCase() === ADMIN_NAME;
            if (wantsAdmin) {
                if (isBlocked(ip)) {
                    return reply(ack, { success: false, message: 'Trop de tentatives. Réessayez dans une minute.' });
                }
                if (!passwordMatches(payload?.password)) {
                    registerFailure(ip);
                    return reply(ack, { success: false, message: 'Mot de passe administrateur incorrect.' });
                }
                loginFailures.delete(ip);
                name = 'MJ';
            }
        }

        releaseSession(socket);

        for (const other of io.sockets.sockets.values()) {
            if (other.id === socket.id || !other.data.name) continue;
            if (other.data.name.toLowerCase() !== name.toLowerCase()) continue;

            const sameClient = clientId && other.data.clientId === clientId;
            if (wantsAdmin || sameClient) {
                // Reconnexion ou reprise de session : l'ancienne connexion est remplacée.
                releaseSession(other);
                other.emit('kicked', 'Cette session a été ouverte depuis un autre appareil ou onglet.');
                other.emit('landing', landingViewFor(other));
            } else {
                return reply(ack, { success: false, message: 'Ce pseudo est déjà utilisé.' });
            }
        }

        if (token) {
            const session = sessions.get(token);
            if (Date.now() - session.lastSeen > SESSION_TOUCH_MS) {
                session.lastSeen = Date.now();
                storage.saveSession(token, session).catch(logError('Mise à jour de la session'));
            }
        } else {
            token = createSession(name, wantsAdmin);
        }

        socket.data = { name, clientId, isAdmin: wantsAdmin, token };
        if (wantsAdmin) {
            socket.join('admins');
            socket.emit('maps-list', listMaps());
        }
        broadcastUsers();
        reply(ack, { success: true, name, isAdmin: wantsAdmin, token });
        // Le débarquement dépend de la personne connectée : on envoie sa vue dès qu'elle est identifiée
        // (connexion, reprise de session après rechargement ou coupure réseau).
        socket.emit('landing', landingViewFor(socket));
    });

    socket.on('logout', (payload, ack) => {
        if (socket.data.token) dropSession(socket.data.token);
        releaseSession(socket);
        broadcastUsers();
        reply(ack, { success: true });
        socket.emit('landing', landingViewFor(socket)); // vue anonyme : plus aucune donnée privée sur cet appareil
    });

    /* ---------- Cases (tous les joueurs connectés, plateau déverrouillé) ---------- */

    // Pinceau : terrain, objet, ou retrait de l'objet.
    socket.on('paint-tile', (data) => {
        if (state.isLocked || !socket.data.name) return;
        { const lock = battleEditLock(); if (lock && !(process.env.GAME_TEST && data?.testForce)) { socket.emit('edit-refused', lock); return; } }
        if (!isValidKey(data?.key, state.config)) return;

        const options = {};
        let action;
        if (data.kind === 'terrain' && TERRAIN_IDS.includes(data.id)) {
            action = 'terrain';
            options.terrain = data.id;
        } else if (data.kind === 'object' && isObjectId(data.id)) {
            action = 'object';
            options.object = data.id;
        } else {
            return;
        }
        applyEdits([data.key], action, options, socket.data.name);
    });

    // Double toucher : fait pivoter un objet orienté (pont, muret, forteresse à deux faces crénelées).
    socket.on('rotate-object', (data) => {
        if (state.isLocked || !socket.data.name) return;
        { const lock = battleEditLock(); if (lock && !(process.env.GAME_TEST && data?.testForce)) { socket.emit('edit-refused', lock); return; } }
        if (!isValidKey(data?.key, state.config)) return;
        applyEdits([data.key], 'rotate', {}, socket.data.name);
    });

    /* ---------- Actions admin ---------- */

    // Rectangle de sélection, gomme, marques : uniquement pour l'administrateur.
    socket.on('edit-tiles', (data) => {
        if (!requireAdmin(socket) || state.isLocked) return;

        const action = data?.action;
        if (!EDIT_ACTIONS.has(action)) return;
        // Terrain figé une fois les ordres validés (jusqu'au tour suivant) : une modification pourrait faire échouer des charges déjà posées.
        const lock = action === 'mark' || action === 'unmark' ? null : battleEditLock();
        if (lock && !(process.env.GAME_TEST && data.testForce)) { socket.emit('edit-refused', lock); return; } // testForce : tests automatiques seulement

        const options = {};
        if (action === 'terrain') {
            if (!TERRAIN_IDS.includes(data.terrain)) return;
            options.terrain = data.terrain;
        }
        if (action === 'object') {
            if (!isObjectId(data.object)) return;
            options.object = data.object;
        }
        if (action === 'mark') {
            if (!MARKS.has(data.mark)) return;
            options.mark = data.mark;
        }

        const keys = Array.isArray(data.keys) ? data.keys.slice(0, LIMITS.maxSize * LIMITS.maxSize) : [];
        applyEdits(keys, action, options, socket.data.name);
    });

    socket.on('toggle-lock', (locked) => {
        if (!requireAdmin(socket)) return;
        state.isLocked = Boolean(locked);
        scheduleSave();
        io.emit('update-lock', state.isLocked);
    });

    // Les cases référencent leur terrain par son nom : elles suivent automatiquement la nouvelle couleur.
    socket.on('update-terrains', (list) => {
        if (!requireAdmin(socket)) return;
        state.terrainsList = sanitizeTerrains(list);
        scheduleSave();
        io.emit('update-terrains', state.terrainsList);
    });

    // La taille du plateau ne se règle qu'à la création d'une nouvelle carte.
    socket.on('new-map', guarded(async (newConfig, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const config = sanitizeConfig(newConfig);
        if (!config) {
            return reply(ack, {
                success: false,
                message: `Taille invalide (entre ${LIMITS.minSize} et ${LIMITS.maxSize}).`
            });
        }

        await createAutoBackup('nouvelle carte', socket.data.name);
        state.config = config;
        state.gridData = {}; // toutes les cases redeviennent des plaines
        state.landing = defaultLanding();
        histories.clear();
        rebuildContributors();
        broadcastUsers();
        await saveNow();
        io.emit('update-config', { config: state.config, gridData: state.gridData });
        emitLanding();
        broadcastMaps();
        reply(ack, { success: true, message: 'Nouvelle carte créée. L’ancienne a été sauvegardée automatiquement.' });
    }));

    /* ---------- Fiches d'armée ---------- */

    const broadcastPicks = () => {
        io.emit('fiches-picks', fichesPickLabels());
        io.emit('fiches-changed', { picks: true });
    };

    // Chargement : le serveur décide de ce que le joueur a le droit de voir.
    socket.on('fiches-load', (payload, ack) => {
        if (!fiches.ready) {
            return reply(ack, { success: false, message: 'Fiches d’armée indisponibles (fichier fiches-seed.json absent du serveur).' });
        }
        const name = socket.data.name;
        if (!name) return reply(ack, { success: false, message: 'Connectez-vous d’abord.' });

        const base = {
            success: true,
            access: state.fichesAccess,
            frozen: state.fichesFrozen,
            version: fiches.version,
            stale: socket.data.isAdmin ? fiches.customStale : [],
            families: fichesFamilies(),
            famTexts: fiches.famTexts,
            picks: { ...state.fichesPicks },
            teams: { names: { ...state.fichesTeams.names }, members: { ...state.fichesTeams.members } },
            // Tout le monde peut voir, à tout moment, les légions prises par les autres joueurs, leur valeur et leurs mercenaires (jamais où ils débarquent).
            mercs: { ...state.fichesTeams.mercs }
        };
        if (socket.data.isAdmin) { base.roster = [...state.fichesTeams.roster]; base.online = onlineNames(); }
        if (socket.data.isAdmin || state.fichesAccess) {
            return reply(ack, { ...base, mode: 'full', armies: allArmyIds().map(fichesArmy) });
        }
        // Accès refusé : les légions choisies par les joueurs (la sienne comprise) restent consultables, rien d'autre.
        return reply(ack, { ...base, mode: 'own', armies: fichesPickedArmies(), pick: state.fichesPicks[findName(name) || name] || null, catalog: fichesCatalog() });
    });

    // Un joueur (ou le MJ) choisit une légion. Une légion ne peut être choisie que par un seul joueur.
    // Le MJ peut aussi choisir ou retirer la légion d'un autre pseudo (payload.name).
    socket.on('fiches-pick', (payload, ack) => {
        const name = socket.data.name;
        if (!name) return reply(ack, { success: false, message: 'Connectez-vous d’abord.' });
        const admin = socket.data.isAdmin;
        const me = findName(name) || name;
        let target = me;
        if (admin && payload?.name) {
            target = findName(cleanText(payload.name, LIMITS.maxName));
            if (!target) return reply(ack, { success: false, message: 'Pseudo inconnu : ajoutez-le d’abord.' });
        }

        if (payload?.clear) {
            if (!state.fichesPicks[target]) return reply(ack, { success: false, message: 'Aucun choix à retirer.' });
            if (!admin && state.fichesFrozen) return reply(ack, { success: false, message: 'Le MJ a verrouillé les légions : seul lui peut les modifier.' });
            delete state.fichesPicks[target];
        } else {
            if (!validPick(payload?.army, payload?.legion)) return reply(ack, { success: false, message: 'Légion invalide ou vide.' });
            if (!admin && state.fichesFrozen && state.fichesPicks[target]) {
                return reply(ack, { success: false, message: 'Le MJ a verrouillé les légions : votre choix ne peut plus changer.' });
            }
            const owner = pickTakenBy(payload.army, payload.legion, target);
            if (owner) return reply(ack, { success: false, message: `Cette légion est déjà choisie par ${owner}.` });
            state.fichesPicks[target] = { army: payload.army, legion: payload.legion };
        }
        scheduleSave();
        broadcastPicks();
        return reply(ack, { success: true });
    });

    // Le MJ gère les pseudos et les équipes : ajouter, supprimer, renommer, affecter, nommer une équipe.
    socket.on('fiches-team', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const t = state.fichesTeams;
        const op = payload?.op;
        const clean = (v) => cleanText(v, LIMITS.maxName);

        if (op === 'add') {
            const name = clean(payload.name);
            if (!name) return reply(ack, { success: false, message: 'Pseudo vide.' });
            if (findName(name)) return reply(ack, { success: false, message: 'Ce pseudo existe déjà.' });
            if (t.roster.length >= 300) return reply(ack, { success: false, message: 'Liste pleine.' });
            t.roster.push(name);
        } else if (op === 'remove') {
            const name = findName(clean(payload.name));
            if (!name) return reply(ack, { success: false, message: 'Pseudo inconnu.' });
            t.roster = t.roster.filter((n) => n !== name);
            delete t.mercs[name];
            delete t.members[name];
            delete state.fichesPicks[name];
        } else if (op === 'rename') {
            const from = findName(clean(payload.name));
            const to = clean(payload.to);
            if (!from || !to) return reply(ack, { success: false, message: 'Pseudo invalide.' });
            const clash = findName(to);
            if (clash && clash !== from) return reply(ack, { success: false, message: 'Ce pseudo existe déjà.' });
            renamePseudo(from, to);
        } else if (op === 'assign') {
            const name = findName(clean(payload.name));
            if (!name) return reply(ack, { success: false, message: 'Pseudo inconnu.' });
            if (payload.team === 't1' || payload.team === 't2') t.members[name] = payload.team;
            else delete t.members[name];
            if (!t.roster.includes(name)) t.roster.push(name);
        } else if (op === 'teamname') {
            if (payload.team !== 't1' && payload.team !== 't2') return reply(ack, { success: false, message: 'Équipe invalide.' });
            t.names[payload.team] = cleanText(payload.label, 30) || (payload.team === 't1' ? 'Équipe 1' : 'Équipe 2');
        } else {
            return reply(ack, { success: false, message: 'Action inconnue.' });
        }
        pruneFichesPicks();
        scheduleSave();
        broadcastPicks();
        return reply(ack, { success: true });
    });

    // Le MJ autorise ou refuse l'accès à toutes les fiches (les légions choisies restent consultables).
    // Mercenaires : le MJ ajoute à un joueur des unités d'infanterie légère prises dans une légion qu'aucun joueur n'a choisie.
    // Elles n'ont pas droit aux bonus d'armée (leur valeur est calculée sans bonus par le MJ).
    socket.on('fiches-merc', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const t = state.fichesTeams;
        const name = findName(cleanText(payload?.name, LIMITS.maxName));
        if (!name) return reply(ack, { success: false, message: 'Pseudo inconnu.' });
        if (payload?.op === 'remove') {
            const list = t.mercs[name] || [];
            const next = list.filter((m) => m.id !== String(payload.id));
            if (next.length === list.length) return reply(ack, { success: false, message: 'Mercenaires introuvables.' });
            if (next.length) t.mercs[name] = next; else delete t.mercs[name];
        } else if (payload?.op === 'add') {
            const armyId = String(payload.army || '');
            const lid = String(payload.legion || '');
            if (!validPick(armyId, lid)) return reply(ack, { success: false, message: 'Légion invalide.' });
            const owner = pickTakenBy(armyId, lid, '');
            if (owner) return reply(ack, { success: false, message: `Cette légion est déjà choisie par ${owner} : choisissez une légion libre.` });
            const army = fichesArmy(armyId);
            const unit = (army.units || []).find((u) => unitKey(army.id, u) === String(payload.uid) && Array.isArray(u.q?.[lid]) && u.q[lid][0] > 0);
            const plain = String(unit?.in_?.B || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (!unit || !/\binf\w*\.?\s*leg/i.test(plain)) return reply(ack, { success: false, message: 'Seule l’infanterie légère peut devenir mercenaire.' });
            const q = unit.q[lid];
            const total = Math.max(1, Math.min(400, Math.floor(Number(q[6]) || 1)));
            const units = Math.max(1, Math.min(total, Math.floor(Number(payload.units) || 1)));
            if ((t.mercs[name] || []).length >= 20) return reply(ack, { success: false, message: 'Trop de lignes de mercenaires pour ce joueur.' });
            const merc = sanitizeMerc({
                id: crypto.randomUUID().slice(0, 8), army: armyId, legion: lid, uid: String(payload.uid), name: String(unit.in_.B || 'inf legere'),
                units, figsPerUnit: Math.max(1, Math.round((Number(q[0]) || 1) / total)), ptsUnit: payload.ptsUnit, type: q[7],
                dep: Number.isFinite(Number(unit.in_?.I)) ? Number(unit.in_.I) : 0, row: payload.row
            });
            if (!merc) return reply(ack, { success: false, message: 'Valeur de l’unité invalide.' });
            (t.mercs[name] = t.mercs[name] || []).push(merc);
        } else {
            return reply(ack, { success: false, message: 'Action inconnue.' });
        }
        const synced = syncLandingMercs(name);
        scheduleSave();
        broadcastPicks();
        if (synced) emitLanding();
        return reply(ack, { success: true });
    });

    socket.on('fiches-access', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        state.fichesAccess = Boolean(payload?.allow);
        scheduleSave();
        io.emit('fiches-access', state.fichesAccess);
        io.emit('fiches-changed', { access: true });
        reply(ack, { success: true, allow: state.fichesAccess });
    });

    // Le MJ fige les légions choisies, ou laisse les joueurs en changer.
    socket.on('fiches-freeze', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        state.fichesFrozen = Boolean(payload?.freeze);
        scheduleSave();
        io.emit('fiches-freeze', state.fichesFrozen);
        reply(ack, { success: true, freeze: state.fichesFrozen });
    });

    // Le MJ modifie des armées (unités, légions, sections) et/ou des formules : enregistré pour tout le monde.
    // Suppression d'une armée créée par le MJ (les armées d'origine ne se suppriment pas).
    socket.on('fiches-army-delete', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const id = String(payload?.id ?? '');
        if (!fiches.custom.has(id)) return reply(ack, { success: false, message: 'Seules les armées créées peuvent être supprimées.' });
        fiches.custom.delete(id);
        fiches.armies.delete(id);
        await storage.saveDoc(`fiches_a_${id}`, { version: fiches.version, army: null });
        await saveCustomIds();
        const pruned = pruneFichesPicks();
        if (pruned) { scheduleSave(); broadcastPicks(); }
        io.emit('fiches-changed', { armies: [id], fams: false });
        reply(ack, { success: true });
    }));

    socket.on('fiches-save', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        if (!fiches.ready) return reply(ack, { success: false, message: 'Fiches d’armée indisponibles.' });

        const armies = payload?.armies && typeof payload.armies === 'object' ? Object.entries(payload.armies).slice(0, 40) : [];
        for (const [id, army] of armies) {
            const problem = checkFichesArmy(id, army);
            if (problem) return reply(ack, { success: false, message: `Fiche refusée (${String(id).slice(0, 30)}) : ${problem}.` });
        }

        let famDoc = null;
        if (payload?.fams && typeof payload.fams === 'object') {
            const seedCol = new Map(fiches.families.map((f) => [f.id, f]));
            const texts = {};
            const custom = {};
            for (const [id, f] of Object.entries(payload.fams).slice(0, 200)) {
                if (!f || typeof f.text !== 'string' || f.text.length > 2000 || !FAM_COLS.has(f.col)) continue;
                const seed = seedCol.get(id);
                if (seed) { if (seed.col === f.col && f.text !== String(seed.rel).replace(/\[\+0\]/g, '')) texts[id] = f.text; }
                else if (FAM_ID.test(id) && Object.keys(custom).length < 100) custom[id] = { col: f.col, text: f.text };
            }
            famDoc = { texts, custom };
        }

        const newIds = armies.filter(([id]) => !fiches.seedArmies.has(id) && !fiches.custom.has(id)).map(([id]) => id);
        if (fiches.custom.size + newIds.length > MAX_CUSTOM_ARMIES) return reply(ack, { success: false, message: `Pas plus de ${MAX_CUSTOM_ARMIES} armées créées.` });
        for (const [id, army] of armies) {
            await storage.saveDoc(`fiches_a_${id}`, { version: fiches.version, army });
            fiches.armies.set(id, army);
        }
        if (newIds.length) { for (const id of newIds) fiches.custom.add(id); await saveCustomIds(); }
        fiches.customStale = fiches.customStale.filter((x) => !armies.some(([id]) => id === x.id));
        if (famDoc) {
            await storage.saveDoc('fiches_fams', { version: fiches.version, ...famDoc });
            fiches.famTexts = famDoc.texts;
            fiches.famCustom = famDoc.custom;
        }
        const pruned = pruneFichesPicks();
        if (pruned) scheduleSave();
        socket.broadcast.emit('fiches-changed', { armies: armies.map(([id]) => id), fams: Boolean(famDoc) });
        if (pruned) broadcastPicks();
        reply(ack, { success: true, picksChanged: pruned });
    }));

    // Test du stockage : écrit puis relit un document, et liste ce qui est enregistré pour les fiches.
    socket.on('fiches-diag', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const started = Date.now();
        const stamp = `${started}-${Math.random().toString(36).slice(2, 8)}`;
        let writeRead = false;
        let detail = '';
        try {
            await storage.saveDoc('diag_ping', { stamp });
            const back = await storage.loadDoc('diag_ping');
            writeRead = back?.stamp === stamp;
            if (!writeRead) detail = 'Le document relu ne correspond pas à celui écrit.';
        } catch (err) {
            detail = String(err?.message || err).slice(0, 200);
        }
        const saved = [];
        for (const id of allArmyIds()) {
            try {
                const doc = await storage.loadDoc(`fiches_a_${id}`);
                if (doc?.army) saved.push(id);
            } catch { /* ignoré : simple information */ }
        }
        let famSaved = false;
        try { famSaved = Boolean(await storage.loadDoc('fiches_fams')); } catch { /* ignoré */ }
        reply(ack, {
            success: true,
            storage: storage.label || (process.env.SUPABASE_URL ? 'Supabase' : 'fichiers locaux'),
            writeRead,
            detail,
            ms: Date.now() - started,
            version: fiches.version,
            armiesSaved: saved,
            famSaved,
            customFams: Object.keys(fiches.famCustom).length,
            picks: Object.keys(state.fichesPicks).length
        });
    }));

    /* ---------- Sauvegardes, exports et imports des fiches (MJ) ---------- */

    socket.on('fiches-snaps', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const list = (await loadSnapIndex()).sort((a, b) => b.savedAt - a.savedAt);
        reply(ack, { success: true, list, current: { armies: fiches.armies.size, customFams: Object.keys(fiches.famCustom).length } });
    }));

    socket.on('fiches-snap-save', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const name = cleanText(payload?.name, LIMITS.maxMapName);
        if (!name) return reply(ack, { success: false, message: 'Donnez un nom à la sauvegarde.' });
        const list = await loadSnapIndex();
        let id = null;
        const same = list.find((m) => !m.auto && m.name.toLowerCase() === name.toLowerCase());
        if (payload?.id) {
            id = String(payload.id);
            if (!list.some((m) => m.id === id)) return reply(ack, { success: false, message: 'Sauvegarde introuvable.' });
        } else if (same) {
            return reply(ack, { success: false, code: 'exists', id: same.id });
        }
        if (!id && list.filter((m) => !m.auto).length >= MAX_SNAPS) return reply(ack, { success: false, message: `Limite de ${MAX_SNAPS} sauvegardes atteinte : supprimez-en une.` });
        id = id || `s${crypto.randomBytes(8).toString('hex')}`;
        await putSnapshot(id, currentFichesFile(name), socket.data.name);
        reply(ack, { success: true, message: `Sauvegarde « ${name} » enregistrée.` });
    }));

    socket.on('fiches-snap-load', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const id = String(payload?.id ?? '');
        if (!SNAP_ID.test(id)) return reply(ack, { success: false, message: 'Sauvegarde introuvable.' });
        const file = await storage.loadDoc(`fiches_snap_${id}`);
        const problem = checkFichesFile(file);
        if (problem) return reply(ack, { success: false, message: `Sauvegarde illisible : ${problem}.` });
        await putSnapshot(`s${crypto.randomBytes(8).toString('hex')}`, currentFichesFile(`Sauvegarde auto (avant chargement) ${new Date().toLocaleString('fr-FR')}`), socket.data.name, true);
        await applyFichesFile(file);
        io.emit('fiches-changed', { armies: allArmyIds(), fams: true });
        broadcastPicks();
        reply(ack, { success: true, message: `Fiches « ${file.name} » chargées pour tous les joueurs.` });
    }));

    socket.on('fiches-snap-rename', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const id = String(payload?.id ?? '');
        const name = cleanText(payload?.name, LIMITS.maxMapName);
        if (!SNAP_ID.test(id) || !name) return reply(ack, { success: false, message: 'Nom ou sauvegarde invalide.' });
        const file = await storage.loadDoc(`fiches_snap_${id}`);
        if (!file) return reply(ack, { success: false, message: 'Sauvegarde introuvable.' });
        await putSnapshot(id, { ...file, name }, socket.data.name);
        reply(ack, { success: true, message: 'Sauvegarde renommée.' });
    }));

    socket.on('fiches-snap-delete', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const id = String(payload?.id ?? '');
        if (!SNAP_ID.test(id)) return reply(ack, { success: false, message: 'Sauvegarde introuvable.' });
        const list = (await loadSnapIndex()).filter((m) => m.id !== id);
        await saveSnapIndex(list);
        await storage.saveDoc(`fiches_snap_${id}`, { kind: 'supprimee' }); // le contenu n'est plus lisible
        reply(ack, { success: true, message: 'Sauvegarde supprimée.' });
    }));

    // Export : l'état actuel des fiches, ou une sauvegarde, sous forme de fichier à télécharger.
    socket.on('fiches-export', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        let file;
        if (payload?.id) {
            const id = String(payload.id);
            if (!SNAP_ID.test(id)) return reply(ack, { success: false, message: 'Sauvegarde introuvable.' });
            file = await storage.loadDoc(`fiches_snap_${id}`);
            if (checkFichesFile(file)) return reply(ack, { success: false, message: 'Sauvegarde illisible.' });
        } else {
            file = currentFichesFile('Fiches d’armée (état actuel)');
        }
        reply(ack, { success: true, file });
    }));

    // Import : un fichier exporté devient une sauvegarde de la liste (il n'écrase rien tant qu'on ne le charge pas).
    socket.on('fiches-import', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const file = payload?.file;
        const problem = checkFichesFile(file);
        if (problem) return reply(ack, { success: false, message: `Fichier refusé : ${problem}.` });
        const list = await loadSnapIndex();
        if (list.filter((m) => !m.auto).length >= MAX_SNAPS) return reply(ack, { success: false, message: `Limite de ${MAX_SNAPS} sauvegardes atteinte : supprimez-en une.` });
        const name = cleanText(file.name, LIMITS.maxMapName) || 'Fiches importées';
        const clean = { kind: file.kind, format: 1, version: file.version, name: `${name} (importé)`.slice(0, LIMITS.maxMapName), savedAt: Date.now(), armies: file.armies, fams: file.fams || { texts: {}, custom: {} } };
        await putSnapshot(`s${crypto.randomBytes(8).toString('hex')}`, clean, socket.data.name);
        reply(ack, { success: true, message: 'Fichier importé : retrouvez-le dans la liste des sauvegardes.' });
    }));

    /* ---------- Débarquement ---------- */

    const landingFail = (ack, message) => reply(ack, { success: false, message });
    const landingOk = (ack, extra = {}) => { pruneBattle(); pruneGeneral(); pruneSim(); scheduleSave(); emitLanding(); reply(ack, { success: true, ...extra }); };

    // Le MJ lance le débarquement : les zones sont détectées à partir des losanges et triangles.
    socket.on('landing-start', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        state.landing = defaultLanding();
        purgeLandingHistory();
        refreshZones();
        if (!state.landing.zones.length) { state.landing = defaultLanding(); return landingFail(ack, 'Aucune zone : placez au moins 2 losanges (ou triangles) sur des tuiles voisines.'); }
        state.landing.phase = 'zones';
        landingOk(ack, { zones: state.landing.zones.length });
    });

    socket.on('landing-refresh', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        if (state.landing.phase !== 'zones') return landingFail(ack, 'Les zones ne peuvent être recalculées qu’au début.');
        refreshZones();
        if (!state.landing.zones.length) return landingFail(ack, 'Aucune zone détectée.');
        landingOk(ack);
    });

    // Rattache une zone aux « entrées A », aux « entrées B » ou à aucune.
    socket.on('landing-group', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'zones') return landingFail(ack, 'Les groupes se choisissent avant l’affectation des équipes.');
        const id = String(payload?.zone ?? '');
        if (!zoneById(id)) return landingFail(ack, 'Zone inconnue.');
        if (payload?.group === 'A' || payload?.group === 'B') L.groups[id] = payload.group; else delete L.groups[id];
        landingOk(ack);
    });

    // Affecte chaque équipe à un groupe d'entrées ; les joueurs peuvent ensuite choisir leur zone.
    socket.on('landing-teams', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'zones' && L.phase !== 'choose') return landingFail(ack, 'Étape incorrecte.');
        const hasA = Object.values(L.groups).includes('A');
        const hasB = Object.values(L.groups).includes('B');
        if (!hasA || !hasB) return landingFail(ack, 'Il faut au moins une zone dans les entrées A et une dans les entrées B.');
        const a = payload?.A;
        if (!TEAM_IDS.includes(a)) return landingFail(ack, 'Équipe invalide.');
        L.teamEntry = a === 't1' ? { t1: 'A', t2: 'B' } : { t1: 'B', t2: 'A' };
        L.phase = 'choose';
        landingOk(ack);
    });

    // Le MJ règle le bonus de déplacement (0 à 9 tuiles, 2 par défaut) d'une section d'une zone :
    // section = 'mid' (le centre) ou la tuile d'une extrémité ("col,ligne").
    socket.on('landing-bonus', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase === 'off') return landingFail(ack, 'Le débarquement n’est pas lancé.');
        const id = String(payload?.zone ?? '');
        const zone = zoneById(id);
        if (!zone) return landingFail(ack, 'Zone inconnue.');
        const section = String(payload?.section ?? '');
        const value = Number(payload?.value);
        if (!Number.isInteger(value) || value < 0 || value > 9) return landingFail(ack, 'Le bonus doit être un nombre entier de 0 à 9.');
        if (section !== 'mid' && !zoneEnds(zone).includes(section)) return landingFail(ack, 'Section inconnue.');
        const entry = L.bonus[id] || { ends: {} };
        entry.ends = entry.ends || {};
        if (section === 'mid') entry.mid = value; else entry.ends[section] = value;
        L.bonus[id] = entry;
        landingOk(ack);
    });

    // Un joueur choisit sa zone parmi celles de son équipe.
    socket.on('landing-choose', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        const late = L.phase === 'place' && !keyOf(L.roster, name); // dépôt en cours : seul un joueur sans zone peut encore choisir
        if (L.phase !== 'choose' && !late) return landingFail(ack, L.phase === 'place' ? 'Votre zone est figée : vous ne pouvez plus en changer.' : 'Les choix de zone ne sont pas ouverts.');
        if (L.phase === 'choose' && keyOf(L.roster, name)) return landingFail(ack, 'Votre zone est figée : vous ne pouvez plus en changer.');
        const team = teamOfName(name);
        if (!team) return landingFail(ack, 'Vous n’êtes dans aucune équipe.');
        if (!keyOf(state.fichesPicks, name)) return landingFail(ack, 'Choisissez d’abord une légion.');
        const id = String(payload?.zone ?? '');
        const zone = zoneById(id);
        if (!zone || L.groups[id] !== groupOfTeam(team)) return landingFail(ack, 'Cette zone n’est pas accessible à votre équipe.');
        const holder = Object.keys(L.choices).find((n) => L.choices[n] === id && n.toLowerCase() !== name.toLowerCase());
        if (holder) return landingFail(ack, `Cette zone est déjà choisie par ${holder}.`);
        const old = keyOf(L.choices, name);
        if (old) delete L.choices[old];
        L.choices[name] = id;
        if (late) L.roster[name] = rosterFor(name); // ses unités arrivent aussitôt, sans toucher à celles des autres
        landingOk(ack);
    });

    // Le MJ libère un joueur figé : sa zone, ses unités et ses dépôts sont effacés, il peut rechoisir.
    socket.on('landing-release', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'choose' && L.phase !== 'place') return landingFail(ack, 'Étape incorrecte.');
        const name = keyOf(L.roster, String(payload?.name ?? '')) ?? keyOf(L.choices, String(payload?.name ?? ''));
        if (!name) return landingFail(ack, 'Joueur inconnu.');
        releaseLandingPlayer(name);
        purgeLandingHistory();
        landingOk(ack);
    });

    // Le MJ fige les affectations : chaque joueur reçoit les unités de sa légion à déposer.
    socket.on('landing-freeze', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'choose') return landingFail(ack, 'Étape incorrecte.');
        const players = Object.keys(state.fichesTeams.members).filter((n) => state.fichesTeams.members[n]);
        const missing = players.filter((n) => !keyOf(L.choices, n));
        if (missing.length && !payload?.force) return reply(ack, { success: false, code: 'missing', missing, message: `${missing.length} joueur(s) n’ont pas choisi de zone.` });
        // Les joueurs déjà figés gardent leurs unités posées ; seuls les nouveaux reçoivent leurs unités.
        for (const n of players) if (keyOf(L.choices, n) && !keyOf(L.roster, n)) L.roster[n] = rosterFor(n);
        purgeLandingHistory();
        L.phase = 'place';
        landingOk(ack);
    });

    // Un joueur dépose (ou déplace) une unité à la fois sur une tuile de sa zone.
    socket.on('landing-place', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'place') return landingFail(ack, 'Le dépôt des unités n’est pas ouvert.');
        const ids = (Array.isArray(payload?.units) ? payload.units : [payload?.unit]).filter((x) => typeof x === 'string');
        if (!ids.length) return landingFail(ack, 'Aucune unité.');
        if (ids.length > 1) return landingFail(ack, 'Les unités se déposent une par une.');
        const found = ids.map((id) => findLine(name, id));
        if (found.some((f) => !f)) return landingFail(ack, 'Unité inconnue.');
        if (payload?.tile == null) {
            for (const f of found) {
                recordLandingMove(name, f.id, { tile: L.placed[f.id] ?? null, std: Boolean(L.std[f.id]) }, { tile: null, std: false });
                delete L.placed[f.id]; delete L.std[f.id];
            }
            return landingOk(ack);
        }
        const zone = zoneById(L.choices[keyOf(L.choices, name) ?? ''] ?? '');
        const tile = String(payload.tile);
        if (!zone || !zone.tiles.includes(tile)) return landingFail(ack, 'Cette tuile n’appartient pas à votre zone de débarquement.');
        for (const f of found) {
            const std = Boolean(L.std[f.id]);
            recordLandingMove(name, f.id, { tile: L.placed[f.id] ?? null, std }, { tile, std });
            L.placed[f.id] = tile;
        }
        landingOk(ack);
    });


    // Général : le joueur l'affecte à l'une de ses unités posées (plusieurs figurines). Plus de tuiles de placement supplémentaires au débarquement.
    socket.on('landing-general', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'place') return landingFail(ack, 'Le général s’attribue pendant le dépôt des unités.');
        const rk = keyOf(L.roster, name);
        if (!rk) return landingFail(ack, 'Vous n’avez pas d’unités à déposer.');
        if (payload?.unit == null) { delete L.gen[rk]; delete L.chev[rk]; return landingOk(ack); }
        const f = findLine(name, payload.unit);
        if (!f) return landingFail(ack, 'Unité inconnue.');
        if (!L.placed[f.id]) return landingFail(ack, 'Posez d’abord cette unité sur la carte.');
        if (f.line.figs / Math.max(1, f.line.qty) <= 1) return landingFail(ack, 'Le général ne peut rejoindre qu’une unité de plusieurs figurines.');
        L.gen[rk] = f.id;
        landingOk(ack);
    });

    // Chevron de général : une seule unité à 6 hexagones ou moins du général ; au tour de placement de bataille elle gagne 3 tuiles, puis elle reçoit le pouvoir mvt +3 ou charge +2.
    socket.on('landing-chevron', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'place') return landingFail(ack, 'Le chevron s’attribue pendant le dépôt des unités.');
        const rk = keyOf(L.roster, name);
        if (!rk) return landingFail(ack, 'Vous n’avez pas d’unités à déposer.');
        if (payload?.unit == null) { delete L.chev[rk]; return landingOk(ack); }
        const g = L.gen[rk];
        if (!g || !L.placed[g]) return landingFail(ack, 'Affectez d’abord le général à une unité.');
        const f = findLine(name, payload.unit);
        if (!f || !L.placed[f.id]) return landingFail(ack, 'Unité inconnue ou pas encore posée.');
        if (hexDistance(L.placed[g], L.placed[f.id]) > genRadius(rk)) return landingFail(ack, `Cette unité est à plus de ${genRadius(rk)} hexagones du général.`);
        L.chev[rk] = f.id;
        landingOk(ack);
    });


    // Simulation (carte virtuelle) : un joueur place la position virtuelle de l'une de ses unités posées, dans la portée qu'elle a depuis sa tuile de dépôt
    // (la portée exacte est vérifiée sur la carte ; le serveur contrôle les règles communes). Une seule unité par tuile hors tuiles de dépôt.
    socket.on('landing-sim', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'place') return landingFail(ack, 'La simulation se modifie pendant le dépôt des unités.');
        const rk = keyOf(L.roster, name);
        if (!rk) return landingFail(ack, 'Vous n’avez pas d’unités.');
        const f = findLine(name, payload?.unit);
        if (!f) return landingFail(ack, 'Unité inconnue.');
        const home = L.placed[f.id];
        if (!home) return landingFail(ack, 'Posez d’abord cette unité sur la carte.');
        if (payload?.tile == null || payload.tile === home) { delete L.sim[f.id]; return landingOk(ack); }
        const tile = String(payload.tile);
        if (!/^\d{1,3},\d{1,3}$/.test(tile)) return landingFail(ack, 'Tuile invalide.');
        const [tc, tr] = tile.split(',').map(Number);
        if (!mapHas(tc, tr)) return landingFail(ack, 'Cette tuile n’est pas sur la carte.');
        if (hexDistance(home, tile) > Math.max(1, f.line.dep) + 10) return landingFail(ack, 'Cette tuile est hors de portée.');
        // Montagnes et eau (hors pont) : interdites, sauf pour les Saurus qui traversent l'eau.
        const gt = state.gridData[tile];
        if (gt?.removed) return landingFail(ack, 'Cette tuile n’existe plus sur la carte.');
        if ((gt?.terrain ?? 'plain') === 'mountain') return landingFail(ack, 'Les montagnes sont infranchissables.');
        if (gt?.object === 'village') return landingFail(ack, 'On ne s’arrête jamais dans un village simple (seulement à côté).');
        if ((gt?.terrain ?? 'plain') === 'water' && gt?.object !== 'bridge' && !(f.line.army === 'saurus' && hasBA(f))) return landingFail(ack, 'Seules les unités saurus (BA) peuvent se tenir sur l’eau.');
        const inZone = state.landing.zones.some((z) => z.tiles.includes(tile));
        if (!inZone) {
            const team = teamOfName(name);
            for (const [oid, v] of Object.entries(L.sim)) {
                if (oid === f.id || v.tile !== tile) continue;
                const oo = oid.slice(0, oid.indexOf('|'));
                if (!team || teamOfName(oo) === team) return landingFail(ack, 'Cette tuile est déjà occupée dans la simulation.');
            }
        }
        L.sim[f.id] = { tile, from: home, bonus: L.gen[rk] === f.id || L.chev[rk] === f.id };
        landingOk(ack);
    });

    // Étendards : le nombre d'unités d'une ligne qui en portent un est limité par la colonne E de la légion.
    socket.on('landing-standard', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'place') return landingFail(ack, 'Les étendards s’attribuent pendant le dépôt des unités.');
        const f = findLine(name, payload?.unit);
        if (!f) return landingFail(ack, 'Unité inconnue.');
        if (!L.placed[f.id]) return landingFail(ack, 'Débarquez d’abord cette unité.');
        if (payload?.on) {
            if (L.std[f.id]) return landingOk(ack);
            let used = 0;
            for (let i = 1; i <= f.line.qty; i++) if (L.std[unitIdOf(f.owner, f.line.uid, i)]) used++;
            if (used >= f.line.stdMax) return landingFail(ack, f.line.stdMax ? `Tous les étendards de cette ligne sont attribués (${f.line.stdMax}).` : 'Cette ligne n’a pas d’étendard.');
            recordLandingMove(name, f.id, { tile: L.placed[f.id], std: false }, { tile: L.placed[f.id], std: true });
            L.std[f.id] = true;
        } else {
            recordLandingMove(name, f.id, { tile: L.placed[f.id], std: Boolean(L.std[f.id]) }, { tile: L.placed[f.id], std: false });
            delete L.std[f.id];
        }
        landingOk(ack);
    });

    // Le MJ verrouille les placements : tout le monde voit alors toutes les unités.
    socket.on('landing-lock', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'place') return landingFail(ack, 'Étape incorrecte.');
        const left = Object.entries(L.roster).reduce((t, [o, list]) => t + list.reduce((k, l) => { let n = 0; for (let i = 1; i <= l.qty; i++) if (!L.placed[unitIdOf(o, l.uid, i)]) n++; return k + n; }, 0), 0);
        if (left && !payload?.force) return reply(ack, { success: false, code: 'missing', left, message: `${left} unité(s) ne sont pas encore placées.` });
        // Instantané automatique avant le verrouillage (c'est l'étape qui efface l'historique des déplacements).
        landingBackupAt = Date.now();
        storage.saveDoc('landing_backup', { at: landingBackupAt, by: socket.data.name, landing: JSON.parse(JSON.stringify(L)) }).catch((e) => console.warn('Sauvegarde du débarquement impossible :', e?.message || e));
        purgeLandingHistory();
        L.phase = 'locked';
        landingOk(ack);
    });

    // Restaure l'instantané pris juste avant le dernier verrouillage (retour à l'étape de dépôt).
    socket.on('landing-restore', async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        if (state.landing.phase !== 'place' && state.landing.phase !== 'locked') return landingFail(ack, 'Aucun dépôt en cours.');
        const doc = await storage.loadDoc('landing_backup');
        if (!doc?.landing) return landingFail(ack, 'Aucune sauvegarde disponible.');
        state.landing = normalizeLanding(doc.landing);
        state.landing.phase = 'place';
        landingOk(ack);
    });

    // Un joueur remet toutes ses unités à leur position de dépôt dans la simulation.
    socket.on('landing-sim-reset', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'place') return landingFail(ack, 'La simulation se modifie pendant le dépôt des unités.');
        const rk = keyOf(L.roster, name);
        if (!rk) return landingFail(ack, 'Vous n’avez pas d’unités.');
        for (const id of Object.keys(L.sim)) if (id.startsWith(`${rk}|`)) delete L.sim[id];
        landingOk(ack);
    });


    /* ---------- Bataille : placement à tour de rôle ---------- */

    const battleCell = (tile) => { if (!/^\d{1,3},\d{1,3}$/.test(String(tile))) return null; const [c, r] = String(tile).split(',').map(Number); return mapHas(c, r) ? String(tile) : null; };

    // MJ : passe de « verrouillé » au tour de placement ; le dé désigne l'équipe qui commence.
    socket.on('landing-battle', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'locked') return landingFail(ack, 'Verrouillez d’abord les placements.');
        const { roll, first } = rollInitiative();
        L.b = { first, active: first, turn: 1, roll, pos: {}, orient: {}, done: {}, orders: {}, gorders: {}, ready: {}, revealed: false, stack: [], log: [] };
        L.phase = 'bplace';
        buildClusters();
        announceInitiative('Dé d’initiative');
        landingOk(ack);
    });

    // MJ : relance le dé d'initiative tant qu'aucune unité n'a été placée.
    socket.on('battle-roll', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'bplace' || !L.b) return landingFail(ack, 'Le tour de placement n’est pas en cours.');
        if (L.b.stack.length) return landingFail(ack, 'Des unités ont déjà été placées.');
        const { roll, first } = rollInitiative();
        Object.assign(L.b, { roll, first, active: first });
        buildClusters();
        announceInitiative('Dés relancés');
        landingOk(ack);
    });

    // Un joueur place une unité (de sa tuile de débarquement vers une tuile permise) et choisit son orientation (0 à 5).
    socket.on('battle-place', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'bplace' || !L.b) return landingFail(ack, 'Ce n’est pas le tour de placement.');
        const f = findLine(name, payload?.unit);
        if (!f) return landingFail(ack, 'Unité inconnue.');
        const team = teamOfName(name);
        const cl = L.b.clusters?.[L.b.ucl?.[f.id]];
        if (!team || !cl || team !== cl.active) return landingFail(ack, 'Ce n’est pas le tour de votre équipe dans ce secteur (les sections voisines jouent à tour de rôle).');
        if (L.b.done[f.id]) return landingFail(ack, 'Cette unité est déjà placée.');
        const home = L.placed[f.id];
        if (!home) return landingFail(ack, 'Cette unité n’a pas été déposée.');
        const orient = Number(payload?.orient);
        if (!Number.isInteger(orient) || orient < 0 || orient > 5) return landingFail(ack, 'Orientation invalide.');
        const tile = battleCell(payload?.tile ?? home);
        if (!tile) return landingFail(ack, 'Tuile invalide.');
        if (tile !== home) {
            if (hexDistance(home, tile) > Math.max(1, f.line.dep) + 10) return landingFail(ack, 'Cette tuile est hors de portée.');
            const blocked = stopBlock(tile, f);
            if (blocked) return landingFail(ack, blocked);
        }
        const inZone = L.zones.some((z) => z.tiles.includes(tile));
        if (!inZone && allBattleUnits().some((u) => u.id !== f.id && unitPos(u.id) === tile)) return landingFail(ack, 'Cette tuile est déjà occupée.');
        // Tuile de dépôt : les unités pas encore placées peuvent y attendre, mais une seule unité placée par tuile (aucune pile à la fin du placement).
        if (inZone && !process.env.TEST_ALLOW_PILES && allBattleUnits().some((u) => u.id !== f.id && L.b.done[u.id] && unitPos(u.id) === tile)) return landingFail(ack, 'Une unité placée occupe déjà cette tuile de dépôt : une seule unité par tuile à la fin du placement.');
        if (tile === home) delete L.b.pos[f.id]; else L.b.pos[f.id] = tile;
        L.b.orient[f.id] = orient;
        L.b.done[f.id] = true;
        L.b.stack.push(f.id);
        battleLog(`${name} place ${f.line.name} ${f.idx}${tile === home ? ' (reste en place)' : ''}.`);
        advanceCluster(f.id, team);
        landingOk(ack);
    });

    // MJ : annule le dernier placement.
    socket.on('battle-undo', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'bplace' || !L.b || !L.b.stack.length) return landingFail(ack, 'Rien à annuler.');
        const id = L.b.stack.pop();
        delete L.b.done[id]; delete L.b.pos[id]; delete L.b.orient[id];
        const u = allBattleUnits().find((x) => x.id === id);
        if (u?.team && L.b.clusters?.[L.b.ucl?.[id]]) L.b.clusters[L.b.ucl[id]].active = u.team;
        battleLog(`↩️ Placement annulé par le MJ (${u ? `${u.line.name} ${u.idx}` : id}).`);
        landingOk(ack);
    });

    // MJ : passe à la pose des ordres.
    socket.on('landing-orders', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'bplace' || !L.b) return landingFail(ack, 'Étape incorrecte.');
        const left = allBattleUnits().filter((u) => !L.b.done[u.id] && L.placed[u.id]).length; // les unités non déposées ne comptent pas
        if (left && !payload?.force) return reply(ack, { success: false, code: 'missing', left, message: `${left} unité(s) ne sont pas encore placées.` });
        const count = new Map();
        for (const u of allBattleUnits()) { const p = unitPos(u.id); if (p) count.set(p, (count.get(p) || 0) + 1); }
        const piles = [...count].filter(([, n]) => n > 1).map(([k]) => k);
        if (piles.length && !process.env.TEST_ALLOW_PILES) return landingFail(ack, `Plusieurs unités restent sur une même tuile de dépôt (${piles.join(', ')}) : il faut les placer sur des tuiles différentes avant de passer aux ordres.`);
        L.phase = 'orders';
        L.b.ready = {};
        battleLog('📝 Pose des ordres : chaque joueur donne ses ordres (visibles de son équipe seulement).');
        landingOk(ack);
    });

    /* ---------- Bataille : ordres ---------- */

    // order : null (efface) ou { type: charge|tir|depl|marche|tirailleur, target?, tile? }.
    socket.on('battle-order', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'orders' || !L.b) return landingFail(ack, 'Ce n’est pas la pose des ordres.');
        const f = findLine(name, payload?.unit);
        if (!f) return landingFail(ack, 'Unité inconnue.');
        const myTeam = teamOfName(name);
        if (L.b.ready[f.owner]) return landingFail(ack, 'Vous avez déjà validé vos ordres : annulez la validation pour les modifier.');
        const o = payload?.order;
        if (o == null) { delete L.b.orders[f.id]; return landingOk(ack); }
        if (!ORDER_TYPES.includes(o.type)) return landingFail(ack, 'Ordre inconnu.');
        if (L.b.dead?.[f.id]) return landingFail(ack, 'Cette unité est détruite.');
        const me = unitPos(f.id);
        if (!me) return landingFail(ack, 'Unité non placée.');
        const gord = genPower(f.owner);
        const nearGen = L.chev?.[f.owner] === f.id; // bénéficiaire désigné du pouvoir mvt +3 / charge +2
        const dep = Math.max(0, f.line.dep);
        const entry = { type: o.type };
        const caps = lineCaps(f.line);
        if (o.type === 'charge' && !caps.cc) return landingFail(ack, 'Cette unité n’a pas d’attaque de corps à corps : pas de charge.');
        if (o.type === 'tir') {
            // Tir court (3 hex) ou long (7 hex) pour les unités de tir ; ordre de tir unique pour l'artillerie (10 hex).
            const range = o.range ?? (caps.art && !caps.tir ? 'art' : null);
            if (!['court', 'long', 'art'].includes(range)) return landingFail(ack, 'Choisissez tir court ou tir long.');
            if (range === 'art' ? !caps.art : !caps.tir) return landingFail(ack, range === 'art' ? 'Cette unité n’est pas une artillerie.' : 'Cette unité n’a pas d’attaque de tir.');
            entry.range = range;
        }
        if (o.type === 'charge' || (o.type === 'tir' && o.target != null)) { // tir : la cible se choisit au moment du tir (facultative ici)
            const t = findUnitAny(o.target);
            if (!t || t.team === myTeam || !t.team) return landingFail(ack, 'Choisissez une unité de l’équipe adverse.');
            const tp = unitPos(t.id);
            if (!tp) return landingFail(ack, 'Cible non placée.');
            const d = hexDistance(me, tp);
            const max = o.type === 'charge' ? 5 + (gord === 'charge' && nearGen ? 2 : 0) : ({ court: FIRE_SHORT, long: FIRE_LONG, art: ART_RANGE }[entry.range]);
            if (o.type === 'charge') { const tt = chargeTargetOf({ team: myTeam }, t, true); if (!chargeInRange(f, unitPos(tt.id), max)) return landingFail(ack, `Cible hors de portée de charge (${max} tuiles au plus par un chemin autorisé jusqu’au contact${tt !== t ? ' de ses tirailleurs' : ''}).`); }
            else if (d > max) return landingFail(ack, `Cible trop loin (${d} hexagones, maximum ${max}).`);
            entry.target = t.id;
        } else if ((o.type === 'depl' || o.type === 'marche') && o.tile != null) {
            // Destination facultative : sans destination, le joueur choisit au moment des déplacements de bouger ou non.
            const tile = battleCell(o.tile);
            if (!tile) return landingFail(ack, 'Tuile de destination invalide.');
            const base = (o.type === 'marche' ? dep * 2 : dep) + (gord === 'mvt' && nearGen ? 3 : 0);
            const d = hexDistance(me, tile);
            if (d > base) return landingFail(ack, `Destination trop loin (${d} hexagones, maximum ${base}).`);
            const blocked = stopBlock(tile, f);
            if (blocked) return landingFail(ack, blocked);
            entry.tile = tile;
        } else if (o.type === 'tirailleur') {
            if (!/T/.test(String(f.line.type))) return landingFail(ack, 'Seules les unités tirailleurs (T) peuvent recevoir cet ordre.');
            const tu = allBattleUnits().find((x) => x.id === f.id);
            if (!screenedUnit(tu, false)) return landingFail(ack, 'Ordre tirailleur impossible : il faut une unité alliée de corps à corps ou mixte (pas au corps à corps) juste derrière les tirailleurs, qui les regarde (tirailleurs sur la tuile juste devant elle), et les tirailleurs tournés dans la même direction qu’elle.');
        }
        // Unité volante : « en vol » (par défaut) ou « au sol », pour tout le tour.
        if (isFlier(f)) entry.air = o.air === false ? false : (o.air === true ? true : (L.b.orders[f.id]?.air ?? true));
        L.b.orders[f.id] = entry;
        if (entry.type === 'charge') setChargeSight(f.id, true);
        landingOk(ack);
    });

    // Unité volante : change sa position « en vol / au sol » sans changer son ordre.
    socket.on('battle-air', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name || L.phase !== 'orders' || !L.b) return landingFail(ack, 'Ce n’est pas la pose des ordres.');
        const f = findLine(name, payload?.unit);
        if (!f || !isFlier(f)) return landingFail(ack, 'Seules les unités volantes choisissent « en vol » ou « au sol ».');
        if (L.b.ready[f.owner]) return landingFail(ack, 'Vous avez déjà validé vos ordres.');
        const o = L.b.orders[f.id];
        if (!o) return landingFail(ack, 'Donnez d’abord un ordre à cette unité.');
        o.air = payload?.air !== false;
        // Les charges adverses vers cette unité restent calculées « en vol » jusqu'à la révélation des ordres ; on met à jour sa propre charge.
        if (o.type === 'charge') setChargeSight(f.id, true);
        landingOk(ack);
    });

    // Avant de confirmer une charge : prise à revers ? cible visible ?
    socket.on('battle-charge-check', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name || L.phase !== 'orders' || !L.b) return reply(ack, { success: false, message: 'Ce n’est pas la pose des ordres.' });
        const f = findLine(name, payload?.unit);
        const A = f && allBattleUnits().find((x) => x.id === f.id), B = allBattleUnits().find((x) => x.id === String(payload?.target));
        if (!A || !B) return reply(ack, { success: false, message: 'Unité inconnue.' });
        const sg = visionCheck(A, B, { hideFoeAir: A.team !== B.team });
        reply(ack, { success: true, rear: chargeRear(A, B), seen: sg.seen, why: sg.why });
    });

    // Cibles qu'une de mes unités peut charger (distance de charge par un chemin autorisé), pour les entourer sur la carte.
    socket.on('battle-charge-targets', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name || L.phase !== 'orders' || !L.b) return reply(ack, { success: false, message: 'Ce n’est pas la pose des ordres.' });
        const f = findLine(name, payload?.unit);
        const u = f && allBattleUnits().find((x) => x.id === f.id);
        if (!u || !unitPos(u.id)) return reply(ack, { success: false, message: 'Unité inconnue.' });
        const R = chargeRangeOf(u);
        reply(ack, { success: true, max: R, targets: foesOf(u).filter((t) => unitPos(t.id) && chargeInRange(u, unitPos(chargeTargetOf(u, t, true).id), R)).map((t) => t.id) });
    });

    // Portée réelle (trajet compris) d'une de mes unités pour un ordre de déplacement ou de marche forcée.
    socket.on('battle-reach', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name || L.phase !== 'orders' || !L.b) return reply(ack, { success: false, message: 'Ce n’est pas la pose des ordres.' });
        const f = findLine(name, payload?.unit);
        if (!f) return reply(ack, { success: false, message: 'Unité inconnue.' });
        const u = allBattleUnits().find((x) => x.id === f.id);
        reply(ack, { success: true, tiles: orderReach(u, payload?.type === 'marche' ? 'marche' : 'depl') });
    });

    // Ordre du général : att (attaque −1 pour les unités à 6 hex), mvt (+3 hex), charge (+2 hex), ou null.
    socket.on('battle-gorder', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'orders' || !L.b) return landingFail(ack, 'Ce n’est pas la pose des ordres.');
        const rk = keyOf(L.roster, name);
        if (!rk || !L.gen[rk]) return landingFail(ack, 'Vous n’avez pas désigné de général.');
        if (!genAlive(rk) && payload?.order != null) return landingFail(ack, 'L’unité de votre général est détruite : il n’a plus de pouvoirs.');
        if (L.b.ready[rk]) return landingFail(ack, 'Vous avez déjà validé vos ordres.');
        if (payload?.order == null) { delete L.b.gorders[rk]; return landingOk(ack); }
        if (!GEN_ORDERS.includes(payload.order)) return landingFail(ack, 'Ordre du général inconnu.');
        if (payload.order === 'mvt' || payload.order === 'charge') {
            // mvt +3 ou charge +2 : une seule unité, désignée par le général (chevron), à 6 hexagones ou moins de lui ; il peut en changer à chaque tour.
            const unitId = payload.unit ?? L.chev[rk];
            const f = unitId ? findLine(rk, unitId) : null;
            if (!f) return reply(ack, { success: false, code: 'need-unit', message: 'Désignez l’unité qui reçoit le pouvoir du général.' });
            const pg = unitPos(L.gen[rk]), pu = unitPos(f.id);
            if (!pu || L.b.dead?.[f.id]) return landingFail(ack, 'Unité absente du plateau.');
            if (!pg || hexDistance(pg, pu) > genRadius(rk)) return landingFail(ack, `Cette unité est à plus de ${genRadius(rk)} hexagones du général.`);
            L.chev[rk] = f.id;
        }
        L.b.gorders[rk] = payload.order;
        landingOk(ack);
    });

    // Un joueur valide (ou annule la validation de) ses ordres.
    socket.on('battle-ready', (payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) return landingFail(ack, 'Connectez-vous d’abord.');
        if (L.phase !== 'orders' || !L.b) return landingFail(ack, 'Ce n’est pas la pose des ordres.');
        const rk = keyOf(L.roster, name);
        if (!rk) return landingFail(ack, 'Vous n’avez pas d’unités.');
        if (payload?.on !== false) {
            // Toutes les unités sur le plateau doivent avoir un ordre (« reste en place » = déplacement vers sa propre tuile).
            const missing = allBattleUnits().filter((u) => ci(u.owner, rk) && unitPos(u.id) && !L.b.orders[u.id]);
            if (missing.length) return reply(ack, { success: false, code: 'no-order', units: missing.map((u) => u.id), message: `${missing.length} unité(s) sans ordre : donnez un ordre à chacune (un ordre de déplacement laisse le choix de bouger ou non).` });
        }
        if (payload?.on === false) delete L.b.ready[rk]; else L.b.ready[rk] = true;
        landingOk(ack);
    });

    // MJ : révèle (ou recache) les ordres à tous.
    socket.on('battle-reveal', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'orders' || !L.b) return landingFail(ack, 'Ce n’est pas la pose des ordres.');
        L.b.revealed = payload?.on !== false;
        battleLog(L.b.revealed ? '👁 Les ordres sont révélés à tous.' : 'Les ordres sont de nouveau cachés.');
        landingOk(ack);
    });

    /* ---------- Déplacements ---------- */

    // MJ : passe de la pose des ordres aux déplacements (les ordres sont alors révélés à tous).
    socket.on('landing-move', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'orders' || !L.b) return landingFail(ack, 'Étape incorrecte.');
        const missing = Object.keys(L.roster).filter((n) => !keyOf(L.b.ready, n));
        if (missing.length && !payload?.force) return reply(ack, { success: false, code: 'missing', left: missing.length, names: missing, message: `${missing.length} joueur(s) n’ont pas validé leurs ordres.` });
        L.phase = 'move';
        L.b.revealed = true;
        // Tirailleurs : une charge sur une unité protégée par des tirailleurs se dirige vers les tirailleurs ; échange de places après les tirs.
        L.b.swaps = [];
        for (const [id, o] of Object.entries(L.b.orders)) if (o.type === 'charge' && o.target) {
            const P = allBattleUnits().find((x) => x.id === o.target), T = P && screenOf(P);
            const A = allBattleUnits().find((x) => x.id === id);
            if (T && A && A.team !== T.team) { o.target = T.id; o.screened = P.id; battleLog(`🪶 ${unitLabel(P)} est protégée par des tirailleurs : la charge de ${unitLabel(A)} se dirige vers ${unitLabel(T)}.`); }
            const T2 = allBattleUnits().find((x) => x.id === o.target), P2 = T2 && screenedUnit(T2);
            if (P2 && A && A.team !== T2.team) L.b.swaps.push({ t: T2.id, p: P2.id, foe: id });
        }
        // La vision des charges est fixée ici, à la révélation des ordres : recalcul de toutes les charges avec la carte et les vrais choix « en vol / au sol »
        // (à la pose de l'ordre, elle n'était qu'une indication pour le joueur, avec l'unité volante adverse supposée en vol).
        for (const [id, o] of Object.entries(L.b.orders)) if (o.type === 'charge' && o.target) {
            const B = allBattleUnits().find((x) => x.id === o.target);
            const before = o.seen; setChargeSight(id, false);
            // Succès de la charge et traversée d'unités : décidés ici, avec les positions de la révélation (l'ordre des charges n'y change rien).
            const A = allBattleUnits().find((x) => x.id === id), tpos = B && unitPos(B.id);
            o.failed = false;
            if (A && tpos) {
                const mutual = L.b.orders[B.id]?.type === 'charge' && L.b.orders[B.id].target === id;
                if (mutual) {
                    if (!chargePath(A, B, false) && chargePath(A, B, true)) { o.seen = false; o.why = 'à travers des unités'; }
                    if (!chargeInRange(A, tpos, chargeRangeOf(A)) && !chargeInRange(B, unitPos(A.id), chargeRangeOf(B))) o.failed = true; // les deux hors de portée
                }
                else {
                    const R = chargeRangeOf(A);
                    if (!chargeInRange(A, tpos, R, [false])) {
                        if (chargeInRange(A, tpos, R, [true])) { o.seen = false; o.why = 'à travers des unités'; }
                        else { o.failed = true; battleLog(`❌ ${unitLabel(A)} : charge échouée sur ${unitLabel(B)} (hors de portée de charge à la révélation des ordres) ; elle avancera au maximum de sa capacité de charge.`); }
                    }
                }
            }
            if (B && before !== o.seen) { const A = allBattleUnits().find((x) => x.id === id); battleLog(`👁 ${unitLabel(A)} : finalement, charge ${o.seen ? 'en voyant' : 'sans voir'}${isFlier(B) ? ` (cible ${L.b.orders[B.id]?.air === false ? 'au sol' : 'en vol'})` : ''}.`); }
        }
        L.m = { step: 'charge', qi: 0, active: null, queue: [], moved: {}, stack: [], snap: { pos: { ...L.b.pos }, orient: { ...L.b.orient } } };
        if (process.env.GAME_TEST && payload?.manual) L.m.manual = true; // tests : charges jouées à la main, sans résolution automatique
        L.m.queue = buildChargeQueue();
        battleLog('👣 Les ordres sont révélés. Phase de déplacement : d’abord les charges, de la plus proche à la plus lointaine.');
        if (!L.m.queue.length) { battleLog('Aucune charge ordonnée.'); startMoveStep(); }
        else enterCharge();
        landingOk(ack);
    });

    const moveActor = (socket, payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing;
        if (!name) { landingFail(ack, 'Connectez-vous d’abord.'); return null; }
        if (L.phase !== 'move' || !L.m) { landingFail(ack, 'Ce n’est pas la phase de déplacement.'); return null; }
        const m = L.m;
        const u = allBattleUnits().find((x) => x.id === String(payload?.unit));
        if (!u) { landingFail(ack, 'Unité inconnue.'); return null; }
        if (!testMJ(socket) && !ci(u.owner, name)) { landingFail(ack, 'Ce n’est pas votre unité : chaque joueur ne gère que ses propres unités (et ses mercenaires).'); return null; }
        if (m.step === 'charge') {
            const it = m.queue[m.qi];
            const who = it?.mutual && it.plan?.choice ? it.plan.choice.unit : it?.id;
            if (!it || who !== u.id) { landingFail(ack, 'Ce n’est pas le tour de cette unité (charges dans l’ordre).'); return null; }
        } else if (m.step === 'move') {
            if (u.team !== m.active) { landingFail(ack, 'Ce n’est pas le tour de votre équipe.'); return null; }
            if (m.moved[u.id] || !eligibleMovers().some((x) => x.id === u.id)) { landingFail(ack, 'Cette unité n’a pas d’ordre de déplacement à exécuter.'); return null; }
        } else { landingFail(ack, 'Les déplacements sont terminés.'); return null; }
        return u;
    };

    // Déplace (ou charge avec) l'unité. Charge : la tuile doit toucher la cible, l'orientation est automatique.
    socket.on('move-do', (payload, ack) => {
        const u = moveActor(socket, payload, ack);
        if (!u) return;
        const tile = battleCell(payload?.tile);
        if (!tile) return landingFail(ack, 'Tuile invalide.');
        if (!moveAllowed(u).includes(tile)) return landingFail(ack, 'Tuile hors de portée, occupée ou interdite (zone d’exclusion, terrain).');
        doMove(u, tile, payload?.orient);
        landingOk(ack);
    });

    // L'unité ne bouge pas (charge abandonnée ou déplacement non effectué).
    socket.on('move-skip', (payload, ack) => {
        const u = moveActor(socket, payload, ack);
        if (!u) return;
        const L = state.landing, m = L.m;
        if (m.step === 'charge' && !testMJ(socket)) return landingFail(ack, 'Une fois les ordres révélés, la charge est obligatoire (seul le MJ, en mode test et correction, peut l’annuler).');
        pushMoveUndo(u, null);
        m.moved[u.id] = true;
        if (m.step === 'charge') chargeRecord(m.queue[m.qi], 'none', `${unitLabel(u)} ne charge pas (décision du MJ).`, [{ id: u.id, from: unitPos(u.id), to: unitPos(u.id), path: [unitPos(u.id)] }]);
        battleLog(`⏭ ${u.line.name} ${u.idx} ne ${m.step === 'charge' ? 'charge pas (décision du MJ)' : 'se déplace pas'}.`);
        advanceMove(u.team);
        landingOk(ack);
    });

    // MJ : annule la dernière action.
    socket.on('move-undo', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'move' || !L.m || !L.m.stack.length) return landingFail(ack, 'Rien à annuler.');
        const m = L.m;
        const x = m.stack.pop();
        if (x.pos) L.b.pos[x.id] = x.pos; else delete L.b.pos[x.id];
        if (x.orient != null) L.b.orient[x.id] = x.orient; else delete L.b.orient[x.id];
        if (x.tid) {
            if (x.torient != null) L.b.orient[x.tid] = x.torient; else delete L.b.orient[x.tid];
            if (x.mutual) { if (x.tpos) L.b.pos[x.tid] = x.tpos; else delete L.b.pos[x.tid]; }
        }
        if (!x.moved) delete m.moved[x.id];
        if (x.sight && L.b.orders[x.id]) { L.b.orders[x.id].seen = x.sight.seen; if (x.sight.why) L.b.orders[x.id].why = x.sight.why; else delete L.b.orders[x.id].why; }
        m.step = x.step; m.qi = x.qi; m.active = x.active;
        for (let i = m.qi; i < m.queue.length; i++) delete m.queue[i].res; // charges annulées : leur détail disparaît
        if (L.b.orders[x.id]) delete L.b.orders[x.id].second;
        for (const fw of x.follow || []) { if (fw.pos) L.b.pos[fw.id] = fw.pos; else delete L.b.pos[fw.id]; if (fw.orient != null) L.b.orient[fw.id] = fw.orient; else delete L.b.orient[fw.id]; }
        battleLog('↩️ Dernière action annulée par le MJ.');
        if (m.step === 'charge') enterCharge();
        landingOk(ack);
    });

    // MJ : termine l'étape en cours (charges restantes abandonnées, ou déplacements restants non exécutés).
    socket.on('move-end', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'move' || !L.m) return landingFail(ack, 'Ce n’est pas la phase de déplacement.');
        if (L.m.step === 'charge') { battleLog('⏭ Charges restantes abandonnées par le MJ.'); startMoveStep(); }
        else if (L.m.step === 'move') { L.m.step = 'done'; L.m.active = null; battleLog('⏭ Déplacements restants abandonnés par le MJ.'); }
        landingOk(ack);
    });

    /* ---------- Tirs ---------- */

    // MJ : passe des déplacements aux tirs. Un dé désigne l'équipe qui ouvre l'artillerie, un second dé celle qui ouvre les autres tirs.
    socket.on('landing-fire', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'move' || !L.b || !L.m) return landingFail(ack, 'Étape incorrecte.');
        if (L.m.step !== 'done' && !payload?.force) return reply(ack, { success: false, code: 'missing', message: 'Les charges ou déplacements ne sont pas terminés.' });
        const moved = {}, start = {};
        for (const u of allBattleUnits()) {
            const before = L.m.snap.pos[u.id] ?? L.placed[u.id] ?? null;
            if (L.m.moved[u.id] && unitPos(u.id) && unitPos(u.id) !== before) moved[u.id] = true;
            if (unitPos(u.id)) start[u.id] = aliveCount(u);
        }
        L.phase = 'fire';
        L.f = { step: 'art', active: null, rolls: { art: null, tir: null }, shot: {}, moved, start, flee: {}, pending: null, last: null, stack: [],
            snap: { hp: JSON.parse(JSON.stringify(L.b.hp || {})), dead: { ...(L.b.dead || {}) } } };
        battleLog('🏹 Phase de tir : l’artillerie d’abord, puis les autres tirs, à tour de rôle.');
        fireStart('art');
        landingOk(ack);
    });

    const fireActor = (socket, payload, ack) => {
        const name = actorName(socket, payload);
        const L = state.landing, f = L.f;
        if (!name) { landingFail(ack, 'Connectez-vous d’abord.'); return null; }
        if (L.phase !== 'fire' || !f) { landingFail(ack, 'Ce n’est pas la phase de tir.'); return null; }
        if (f.step !== 'art' && f.step !== 'tir') { landingFail(ack, 'Les tirs sont terminés.'); return null; }
        const u = allBattleUnits().find((x) => x.id === String(payload?.unit));
        if (!u) { landingFail(ack, 'Unité inconnue.'); return null; }
        if (!testMJ(socket) && !ci(u.owner, name)) { landingFail(ack, 'Ce n’est pas votre unité : chaque joueur ne gère que ses propres unités (et ses mercenaires).'); return null; }
        if (u.team !== f.active) { landingFail(ack, 'Ce n’est pas le tour de votre équipe.'); return null; }
        if (!fireModes(u).includes(f.step)) { landingFail(ack, f.step === 'art' ? 'Cette unité ne peut pas tirer à l’artillerie maintenant.' : 'Cette unité ne peut pas tirer maintenant.'); return null; }
        return u;
    };

    // Le joueur (ou le MJ) vise : tireur + cible. Les modificateurs sont proposés d'après la carte ; le MJ les corrige puis lance les dés.
    socket.on('fire-aim', (payload, ack) => {
        const u = fireActor(socket, payload, ack);
        if (!u) return;
        const L = state.landing, f = L.f;
        if (f.step === 'art') {
            // Artillerie : le joueur indique le point maximal (une tuile à 10 hex au plus, pas de portée minimale).
            const sp = unitPos(u.id), tile = /^\d{1,3},\d{1,3}$/.test(String(payload?.tile)) ? String(payload.tile) : null;
            if (!tile || !mapHas(...tile.split(',').map(Number))) return landingFail(ack, 'Touchez la tuile du point maximal du tir.');
            const d = hexDistance(sp, tile);
            if (d < 1 || d > ART_RANGE) return landingFail(ack, `Point trop loin (${d} hexagones, maximum ${ART_RANGE}).`);
            f.pending = { id: u.id, tid: null, tile, three: artTiles(sp, tile), mode: 'art', d, adj: 0, los: (() => { const v = visionCheck(u, null, { tile }); return { ok: v.seen, reason: v.why }; })(), mods: [] };
            f.pending.mods = [{ k: 'nolos', label: `La machine ne voit pas le point visé${f.pending.los.ok ? '' : ` (${f.pending.los.reason})`} : sur un 4, la relance ne touche pas`, v: 0, on: !f.pending.los.ok }];
            return landingOk(ack);
        }
        const t = allBattleUnits().find((x) => x.id === String(payload?.target));
        if (!t || !t.team || t.team === u.team || !unitPos(t.id)) return landingFail(ack, 'Choisissez une unité adverse sur le plateau.');
        if (f.step === 'art' && isGenUnit(t)) return landingFail(ack, 'L’unité du général ignore l’artillerie.');
        const ord = L.b.orders[u.id];
        const max = f.step === 'art' ? ART_RANGE : (ord?.type === 'tir' && ord.range === 'court' ? FIRE_SHORT : FIRE_LONG);
        const fm = fireMods(u, t, f.step);
        if (fm.d > max) return landingFail(ack, `Cible trop loin (${fm.d} hexagones, maximum ${max}).`);
        f.pending = { id: u.id, tid: t.id, mode: f.step, d: fm.d, adj: 0, los: { ok: fm.los.ok, reason: fm.los.reason }, mods: fm.mods };
        landingOk(ack);
    });

    // MJ : coche ou décoche un modificateur ({ k, on }) ou règle un ajustement libre ({ adj }).
    socket.on('fire-mod', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const p = state.landing.f?.pending;
        if (state.landing.phase !== 'fire' || !p) return landingFail(ack, 'Aucun tir en préparation.');
        if (payload?.adj != null) p.adj = Math.max(-9, Math.min(9, Math.floor(Number(payload.adj) || 0)));
        else {
            const m = p.mods.find((x) => x.k === payload?.k);
            if (!m) return landingFail(ack, 'Modificateur inconnu.');
            m.on = payload.on !== false;
        }
        landingOk(ack);
    });

    socket.on('fire-cancel', (payload, ack) => {
        const L = state.landing, p = L.f?.pending;
        if (L.phase !== 'fire' || !p) return landingFail(ack, 'Aucun tir en préparation.');
        const u = findUnitAny(p.id);
        if (!socket.data.isAdmin && !(u && ci(u.owner, socket.data.name || ''))) return landingFail(ack, 'Seul le MJ ou le propriétaire du tireur peut annuler.');
        L.f.pending = null;
        landingOk(ack);
    });

    // MJ : lance les dés du tir en préparation et applique les pertes.
    socket.on('fire-roll', (payload, ack) => {
        const L = state.landing, f = L.f, p = f?.pending;
        if (L.phase !== 'fire' || !p) return landingFail(ack, 'Aucun tir en préparation.');
        // Dés : lancés par le joueur du tireur ; en mode test et correction, par le MJ.
        { const sh = findUnitAny(p.id); if (!(testMJ(socket) || (!L.test?.on && sh && ci(sh.owner, socket.data.name || '')))) return landingFail(ack, L.test?.on ? 'Mode test du MJ : c’est le MJ qui lance les dés.' : 'Ce sont les dés du joueur du tireur.'); }
        const u = allBattleUnits().find((x) => x.id === p.id);
        if (p.mode === 'art') {
            if (!u || !unitPos(u.id)) { f.pending = null; return landingFail(ack, 'Tireur absent.'); }
            // Chaque machine : d4. 1 à 3 → tuile correspondante ; 4 → nouveau d4 : 1 à 3 → tuile correspondante si la machine voit le point, sinon rien ;
            // 4 → incident de tir : la machine perd ses propres points d'attaque. Unité sur la tuile touchée (amie comme ennemie) : points d'attaque de la machine
            // sur une seule figurine (priorité aux grandes figurines, monstres, pièces d'artillerie), sans armure. Tuile vide : rien.
            const noLos = p.mods.some((m) => m.k === 'nolos' && m.on);
            const shots = [], touched = new Map();
            const unitAt = (k) => (k ? allBattleUnits().find((x) => unitPos(x.id) === k) : null);
            const hpOf = (x) => { if (!touched.has(x.id)) touched.set(x.id, { u: x, before: aliveCount(x), hp: unitHp(x) }); return touched.get(x.id).hp; };
            const plan = [];
            for (const prof of aliveProfiles(u).filter((x) => x.art)) plan.push(artShot(prof, p.three, noLos));
            for (const sh of plan) {
                const tu = sh.incident ? u : unitAt(sh.tile);
                if (tu) { sh.unit = tu.id; sh.done = applyArtDamage(tu, hpOf(tu), sh.dmg); }
                shots.push(sh);
            }
            pushFire(null, [...touched.keys()]);
            for (const { u: x, hp } of touched.values()) setHp(x, hp);
            const res = { id: u.id, mode: 'art', tile: p.tile, three: p.three, d: p.d, t: Date.now(), shots, hits: [...touched.values()].map(({ u: x, before }) => ({ id: x.id, lost: before - aliveCount(x), left: aliveCount(x), destroyed: Boolean(L.b.dead[x.id]) })) };
            res.dmg = shots.reduce((x, sh) => x + (sh.done || 0), 0);
            f.last = res; f.shot[u.id] = true;
            const txt = (sh) => sh.incident ? `incident de tir : ${sh.done || 0} PV à la machine` : (sh.blind ? 'sans vision : rien' : (sh.tile ? (sh.unit ? `tuile ${p.three.indexOf(sh.tile) + 1} : ${unitLabel(findUnitAny(sh.unit))} perd ${sh.done} PV` : `tuile ${p.three.indexOf(sh.tile) + 1} vide`) : 'hors du trajet'));
            announceRoll(`💥 ${unitLabel(u)} → point ${p.tile}`, shots.flatMap((sh) => [{ label: 'd4', sides: 4, v: sh.r1, ok: sh.r1 <= 3 }, ...(sh.r2 ? [{ label: 'nouveau d4', sides: 4, v: sh.r2, ok: sh.r2 <= 3 && !sh.blind }] : []), ...(sh.r3 ? [{ label: 'relance du canon nain', sides: 4, v: sh.r3, ok: !sh.incident && !sh.blind }] : [])]), shots.map(txt).join(' · '),
                { who: [u.owner, ...[...touched.values()].map(({ u: x }) => x.owner)], tiles: [unitPos(u.id), ...p.three] });
            battleLog(`💥 ${unitLabel(u)} → point ${p.tile} : ${shots.map(txt).join(' ; ')}.`);
            fireAdvance(u.team);
            return landingOk(ack);
        }
        const t = allBattleUnits().find((x) => x.id === p.tid);
        if (!u || !t || !unitPos(u.id) || !unitPos(t.id)) { f.pending = null; return landingFail(ack, 'Tireur ou cible absent.'); }
        const before = aliveCount(t);
        const hp = unitHp(t);
        const res = { id: u.id, tid: t.id, mode: p.mode, d: p.d, t: Date.now() };
        if (p.mode === 'art') {
            const noLos = p.mods.some((m) => m.k === 'nolos' && m.on);
            const shots = [];
            for (const prof of aliveProfiles(u).filter((x) => x.art)) {
                const r1 = rollD(4);
                const s = { r1, dmg: prof.art.dmg };
                if (r1 <= 3) s.hit = true;
                else { s.r2 = rollD(4); if (s.r2 === 4) s.incident = true; else s.hit = !noLos; }
                if (s.hit) s.done = applyDamage(hp, prof.art.dmg, true);
                shots.push(s);
            }
            res.shots = shots;
            res.dmg = shots.reduce((x, s) => x + (s.done || 0), 0);
        } else {
            const pts = aliveProfiles(u).reduce((x, pr) => x + (pr.tir?.att || 0), 0);
            if (pts <= 0) return landingFail(ack, 'Aucune figurine de cette unité ne peut tirer.');
            const thr = fireThreshold(p), arm = armourOf(t, p);
            res.thr = thr; res.arm = arm; res.points = pts;
            res.dice = attackDice(pts).map((v) => {
                const r = rollD(10), dd = { v, r, hit: r >= thr };
                if (dd.hit) { if (arm == null) dd.wound = true; else { dd.a = rollD(10); dd.wound = dd.a < arm; } }
                return dd;
            });
            res.melee = inMelee(t);
            res.ones = res.melee ? res.dice.filter((dd) => dd.r === 1).length : 0;
            res.dmg = applyDamage(hp, res.dice.filter((dd) => dd.wound).reduce((x, dd) => x + dd.v, 0), false);
        }
        pushFire(t.id);
        setHp(t, hp);
        res.lost = before - aliveCount(t);
        res.left = aliveCount(t);
        res.destroyed = Boolean(L.b.dead[t.id]);
        f.last = res;
        f.shot[u.id] = true;
        if (p.mode === 'art') announceRoll(`💥 ${unitLabel(u)} → ${unitLabel(t)}`, res.shots.flatMap((sh) => [{ label: 'd4', sides: 4, v: sh.r1, ok: sh.r1 <= 3 }, ...(sh.r2 ? [{ label: 'relance', sides: 4, v: sh.r2, ok: Boolean(sh.hit) }] : [])]), `${res.dmg} PV · ${res.lost} figurine(s) retirée(s)${res.destroyed ? ' · unité détruite' : ''}${res.shots.some((sh) => sh.incident) ? ' · incident de tir !' : ''}`);
        else announceRoll(`🏹 ${unitLabel(u)} → ${unitLabel(t)} · touche sur ${res.thr}+`, [...res.dice.map((dd) => ({ label: `${dd.v} pts`, sides: 10, v: dd.r, ok: dd.hit })), ...res.dice.filter((dd) => dd.a != null).map((dd) => ({ label: `🛡 < ${res.arm}`, sides: 10, v: dd.a, ok: dd.wound }))], `${res.dmg} PV · ${res.lost} figurine(s) retirée(s)${res.destroyed ? ' · unité détruite' : ''}`, { who: [u.owner, t.owner], tiles: [unitPos(u.id), unitPos(t.id)] });
        const extra = res.ones ? ` · ${res.ones} dé(s) à 1 : tir sur une unité alliée au contact (à résoudre)` : '';
        battleLog(`${p.mode === 'art' ? '💥' : '🏹'} ${unitLabel(u)} → ${unitLabel(t)} : ${res.dmg} PV, ${res.lost} figurine(s) retirée(s)${res.destroyed ? ', unité détruite' : ''}${res.shots?.some((s) => s.incident) ? ' · incident de tir !' : ''}${extra}.`);
        fireAdvance(u.team);
        landingOk(ack);
    });

    // Le tireur ne tire pas (passe son tour).
    socket.on('fire-skip', (payload, ack) => {
        const u = fireActor(socket, payload, ack);
        if (!u) return;
        const f = state.landing.f;
        pushFire(null);
        f.shot[u.id] = true;
        battleLog(`⏭ ${unitLabel(u)} ne tire pas.`);
        fireAdvance(u.team);
        landingOk(ack);
    });

    // MJ : annule la dernière action de la phase de tir (tir, passe, correction, jet de fuite).
    socket.on('fire-undo', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing, f = L.f;
        if (L.phase !== 'fire' || !f || !f.stack.length) return landingFail(ack, 'Rien à annuler.');
        const x = f.stack.pop();
        const rest = JSON.parse(x.f);
        L.f = { ...rest, stack: f.stack, snap: f.snap };
        for (const e of [...(x.tid ? [{ tid: x.tid, hp: x.hp, dead: x.dead }] : []), ...(x.extra || [])]) {
            L.b.hp = L.b.hp || {}; L.b.dead = L.b.dead || {};
            if (e.hp) L.b.hp[e.tid] = e.hp; else delete L.b.hp[e.tid];
            if (e.dead) L.b.dead[e.tid] = true; else delete L.b.dead[e.tid];
        }
        battleLog('↩️ Dernière action de tir annulée par le MJ.');
        landingOk(ack);
    });

    // MJ : corrige le nombre de figurines restantes d'une unité (0 = détruite).
    socket.on('fire-fix', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'fire' || !L.f) return landingFail(ack, 'Ce n’est pas la phase de tir.');
        const u = allBattleUnits().find((x) => x.id === String(payload?.unit));
        if (!u) return landingFail(ack, 'Unité inconnue.');
        const t = unitTemplate(u), hp = unitHp(u);
        const n = Math.max(0, Math.min(hp.length, Math.floor(Number(payload?.figs))));
        if (!Number.isFinite(n)) return landingFail(ack, 'Nombre invalide.');
        let alive = hp.filter((x) => x > 0).length;
        for (let i = hp.length - 1; i >= 0 && alive > n; i--) if (hp[i] > 0) { hp[i] = 0; alive--; }
        for (let i = 0; i < hp.length && alive < n; i++) if (hp[i] <= 0) { hp[i] = t.parts[t.figs[Math.min(i, t.figs.length - 1)]].pv; alive++; }
        pushFire(u.id);
        setHp(u, hp);
        battleLog(`✏️ MJ : ${unitLabel(u)} a maintenant ${n} figurine(s)${n ? '' : ' (détruite)'}.`);
        landingOk(ack);
    });

    // MJ : termine l'étape (artillerie → autres tirs → jets de fuite → fin).
    socket.on('fire-end', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing, f = L.f;
        if (L.phase !== 'fire' || !f) return landingFail(ack, 'Ce n’est pas la phase de tir.');
        pushFire(null);
        if (f.step === 'art') { battleLog('⏭ Artillerie restante abandonnée par le MJ.'); fireStart('tir'); }
        else if (f.step === 'tir') { battleLog('⏭ Tirs restants abandonnés par le MJ.'); startFlee(); }
        else if (f.step === 'flee') { f.step = 'done'; battleLog('⏭ Jets de fuite restants ignorés.'); fireFinished(); }
        else { f.stack.pop(); return landingFail(ack, 'La phase de tir est déjà terminée.'); }
        landingOk(ack);
    });

    // MJ : jet de fuite d'une unité (d10). Démoralisable : 1 à 7 = détruite ; indémoralisable : 1 = détruite ; +1 si le général de l'armée est mort.
    socket.on('fire-flee', (payload, ack) => {
        const L = state.landing, f = L.f;
        { const fu = findUnitAny(String(payload?.unit)); if (!(testMJ(socket) || (!L.test?.on && fu && ci(fu.owner, socket.data.name || '')) || (payload?.skip && socket.data.isAdmin))) return landingFail(ack, L.test?.on ? 'Mode test du MJ : c’est le MJ qui lance les dés.' : 'Ce sont les dés du joueur de l’unité.'); }
        if (L.phase !== 'fire' || !f || f.step !== 'flee') return landingFail(ack, 'Ce n’est pas le moment des jets de fuite.');
        const id = String(payload?.unit);
        if (!(id in f.flee) || f.flee[id]) return landingFail(ack, 'Pas de jet de fuite à faire pour cette unité.');
        const u = allBattleUnits().find((x) => x.id === id);
        if (!u) return landingFail(ack, 'Unité inconnue.');
        pushFire(u.id);
        if (payload?.skip) { f.flee[id] = { r: 0, thr: 0, out: false, skip: true }; battleLog(`⏭ Jet de fuite ignoré : ${unitLabel(u)}.`); }
        else {
            const genId = L.gen?.[u.owner];
            const genDead = Boolean(genId && L.b.dead?.[genId]);
            const thr = (fearless(u) ? 1 : 7) + (genDead ? 1 : 0);
            const r = rollD(10);
            f.flee[id] = { r, thr, out: r <= thr };
            if (r <= thr) { const hp = unitHp(u).map(() => 0); setHp(u, hp); }
            announceRoll(`🏳️ Jet de fuite : ${unitLabel(u)}`, [{ label: `fuit si ≤ ${thr}`, sides: 10, v: r, ok: r > thr }], r <= thr ? 'L’unité fuit : détruite.' : 'L’unité tient.', { who: [u.owner], tiles: [unitPos(u.id)] });
            battleLog(`🏳️ Jet de fuite ${unitLabel(u)} : ${r} (${r <= thr ? `≤ ${thr} → l’unité fuit, détruite` : `> ${thr} → elle tient`}).`);
        }
        if (Object.values(f.flee).every(Boolean)) { f.step = 'done'; battleLog('✅ Phase de tir terminée.'); fireFinished(); }
        landingOk(ack);
    });

    // MJ : tour suivant (le corps à corps n'est pas encore automatisé). Positions, orientations et pertes sont conservées ; les ordres repartent à zéro.
    socket.on('battle-next-turn', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        if (L.phase !== 'fire' || !L.f || !L.b) return landingFail(ack, 'Étape incorrecte.');
        if (L.f.step !== 'done' && !payload?.force) return reply(ack, { success: false, code: 'missing', message: 'Les tirs ne sont pas terminés.' });
        L.b.turn = (L.b.turn || 1) + 1;
        L.b.orders = {}; L.b.gorders = {}; L.b.ready = {}; L.b.revealed = false;
        L.m = null; L.f = null;
        L.phase = 'orders';
        battleLog(`🔁 Tour ${L.b.turn} : pose des ordres.`);
        landingOk(ack);
    });

    // Retour à une étape précédente (les données déjà saisies sont conservées) ou arrêt complet.
    // Mode « test et correction » du MJ. Activation : on garde une copie de l'état. Désactivation : garder l'état actuel, ou revenir à la copie.
    // MJ en mode test : joueur incarné (null = le MJ lui-même, arbitre qui voit tout).
    socket.on('mj-test-as', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        if (!state.landing.test?.on) return landingFail(ack, 'Activez d’abord le mode test.');
        const n = payload?.name == null ? null : testPlayers().find((x) => ci(x, payload.name));
        if (payload?.name != null && !n) return landingFail(ack, 'Joueur inconnu.');
        socket.data.testAs = n || null;
        reply(ack, { success: true });
        socket.emit('landing', landingViewFor(socket));
    });
    socket.on('mj-test', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        delete socket.data.testAs;
        if (payload?.on) {
            if (L.test?.on) return landingOk(ack);
            const { test, ...rest } = L;
            L.test = { on: true, snap: JSON.stringify(rest), at: Date.now() };
            battleLog('🧪 Le MJ passe en mode test et correction.');
            return landingOk(ack);
        }
        if (!L.test?.on) return landingOk(ack);
        if (payload?.keep === false) {
            const back = JSON.parse(L.test.snap);
            for (const k of Object.keys(L)) delete L[k];
            Object.assign(L, back);
            delete L.test;
            battleLog('🧪 Fin du mode test : retour à l’état du début du test.');
        } else {
            delete L.test;
            battleLog('🧪 Fin du mode test : l’état actuel est conservé.');
        }
        landingOk(ack);
    });

    socket.on('landing-goto', (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const L = state.landing;
        const target = payload?.phase;
        purgeLandingHistory();
        if (target === 'off') { state.landing = defaultLanding(); return landingOk(ack); }
        const order = ['zones', 'choose', 'place', 'locked', 'bplace', 'orders', 'move', 'fire'];
        if (!order.includes(target) || order.indexOf(target) > order.indexOf(L.phase)) return landingFail(ack, 'Étape invalide.');
        if (L.phase === 'fire' && L.f && target !== 'fire') {
            // Retour avant les tirs : pertes d'avant la phase de tir.
            L.b.hp = JSON.parse(JSON.stringify(L.f.snap.hp || {})); L.b.dead = { ...(L.f.snap.dead || {}) }; L.f = null;
        }
        if ((L.phase === 'move' || L.phase === 'fire') && L.m && order.indexOf(target) < order.indexOf('move')) {
            // Retour avant les déplacements : positions et orientations d'avant les charges.
            L.b.pos = { ...L.m.snap.pos }; L.b.orient = { ...L.m.snap.orient }; L.b.revealed = false; L.m = null;
        }
        if (order.indexOf(target) < order.indexOf('bplace')) L.b = null; // retour avant la bataille : positions et ordres de bataille effacés
        else if (target === 'bplace' && L.b) { L.b.orders = {}; L.b.gorders = {}; L.b.ready = {}; L.b.revealed = false; }
        if (target === 'zones') { L.teamEntry = null; L.choices = {}; L.roster = {}; L.placed = {}; L.std = {}; L.gen = {}; L.chev = {}; L.sim = {}; }
        // Retour au choix des zones : les joueurs déjà figés gardent leur zone et leurs unités posées.
        if (target === 'place') { /* les unités restent placées */ }
        L.phase = target;
        landingOk(ack);
    });

    /* ---------- Protection de ses propres modifications ---------- */

    // Activer / désactiver : les autres joueurs doivent-ils confirmer avant de modifier mes tuiles ?
    socket.on('set-protection', (payload) => {
        const name = socket.data.name;
        if (!name) return;
        const rule = state.protection[name] ?? { on: true, clearedAt: 0 };
        state.protection[name] = { on: payload?.on !== false, clearedAt: rule.clearedAt };
        scheduleSave();
        io.emit('update-protection', state.protection);
    });

    // Libérer définitivement les modifications faites jusqu'ici (l'historique annuler / rétablir est conservé).
    socket.on('clear-protection', () => {
        const name = socket.data.name;
        if (!name) return;
        const rule = state.protection[name] ?? { on: true, clearedAt: 0 };
        state.protection[name] = { on: rule.on, clearedAt: Date.now() };
        scheduleSave();
        io.emit('update-protection', state.protection);
    });

    /* ---------- Annuler / rétablir (chacun ses propres modifications) ---------- */

    socket.on('undo', (payload, ack) => runHistory(socket, ack, 'undo', 'redo'));
    socket.on('redo', (payload, ack) => runHistory(socket, ack, 'redo', 'undo'));

    /* ---------- Image de fond de la page de connexion (MJ) ---------- */

    socket.on('set-background', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;

        const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(payload?.dataUrl ?? ''));
        if (!match) return reply(ack, { success: false, message: 'Image invalide (JPEG attendu).' });

        const buffer = Buffer.from(match[1], 'base64');
        if (buffer.length > BACKGROUND_MAX_BYTES || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
            return reply(ack, { success: false, message: 'Image trop lourde ou illisible.' });
        }

        background = { buffer, version: Date.now() };
        await storage.saveBackground(background);
        io.emit('update-background', { version: background.version });
        reply(ack, { success: true, message: 'Image de fond enregistrée.' });
    }));

    socket.on('clear-background', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        background = null;
        await storage.saveBackground(null);
        io.emit('update-background', { version: 0 });
        reply(ack, { success: true, message: 'Image de fond retirée.' });
    }));

    /* ---------- Cartes enregistrées ---------- */

    socket.on('list-maps', () => {
        if (socket.data.isAdmin) socket.emit('maps-list', listMaps());
    });

    socket.on('save-map', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;

        const name = cleanText(payload?.name, LIMITS.maxMapName);
        if (!name) return reply(ack, { success: false, message: 'Donnez un nom à la carte.' });

        let id = null;
        if (payload?.id !== undefined) {
            id = String(payload.id);
            if (!mapsIndex.has(id)) return reply(ack, { success: false, message: 'Carte introuvable.' });
        } else {
            const existing = [...mapsIndex.values()]
                .find((m) => !m.auto && m.name.toLowerCase() === name.toLowerCase());
            if (existing) return reply(ack, { success: false, code: 'exists', id: existing.id });
        }

        await saveMap({ id, name }, socket.data.name);
        broadcastMaps();
        reply(ack, { success: true, message: `Carte « ${name} » enregistrée.` });
    }));

    socket.on('load-map', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;

        const id = String(payload?.id ?? '');
        if (!MAP_ID.test(id) || !mapsIndex.has(id)) {
            return reply(ack, { success: false, message: 'Carte introuvable.' });
        }

        const map = await storage.getMap(id);
        const config = sanitizeConfig(map?.config);
        if (!config) return reply(ack, { success: false, message: 'Fichier de carte illisible.' });

        const gridData = sanitizeGrid(map.gridData, config);
        const terrains = sanitizeTerrains(map.terrainsList);

        await createAutoBackup('avant chargement', socket.data.name);

        state.config = config;
        state.gridData = gridData;
        state.landing = normalizeLanding(map.landing);
        histories.clear();
        rebuildContributors();
        broadcastUsers();
        if (terrains) state.terrainsList = terrains;
        await saveNow();

        io.emit('update-config', { config: state.config, gridData: state.gridData });
        io.emit('update-terrains', state.terrainsList);
        emitLanding();
        broadcastMaps();
        reply(ack, { success: true, message: `Carte « ${map.name} » chargée${state.landing.phase !== 'off' ? ' avec son débarquement' : ''}.` });
    }));

    // Export du jeu complet (serveur, pages, cartes, fiches, état) : un dossier à lancer sur un PC ou un téléphone, sans internet.
    socket.on('export-package', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const zip = await buildGamePackage();
        if (zip.length > 80 * 1024 * 1024) return reply(ack, { success: false, message: 'Le jeu est trop volumineux pour être exporté en une fois : exportez les cartes une par une.' });
        reply(ack, { success: true, name: `jeu-local-${new Date().toISOString().slice(0, 10)}.zip`, size: zip.length, data: zip.toString('base64') });
    }));

    // Export d'une carte (ou de la carte en cours) vers un fichier local.
    socket.on('export-map', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        let map;
        if (payload?.id) {
            const id = String(payload.id);
            if (!MAP_ID.test(id) || !mapsIndex.has(id)) return reply(ack, { success: false, message: 'Carte introuvable.' });
            map = await storage.getMap(id);
        } else {
            map = { name: 'Carte en cours', config: state.config, terrainsList: state.terrainsList, gridData: state.gridData, landing: state.landing.phase === 'off' ? null : state.landing };
        }
        if (!map) return reply(ack, { success: false, message: 'Carte introuvable.' });
        reply(ack, { success: true, file: { kind: 'carte', format: 1, name: map.name, savedAt: Date.now(), config: map.config, terrainsList: map.terrainsList, gridData: map.gridData, landing: map.landing ?? null } });
    }));

    // Import d'une carte depuis un fichier local : elle s'ajoute à la liste, sans toucher au plateau en cours.
    socket.on('import-map', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;
        const file = payload?.file;
        if (!file || file.kind !== 'carte') return reply(ack, { success: false, message: 'Ce fichier n’est pas une carte exportée.' });
        const config = sanitizeConfig(file.config);
        if (!config) return reply(ack, { success: false, message: 'Carte illisible (dimensions invalides).' });
        const gridData = sanitizeGrid(file.gridData, config);
        const terrains = sanitizeTerrains(file.terrainsList) || state.terrainsList;
        const manual = [...mapsIndex.values()].filter((m) => !m.auto).length;
        if (manual >= 200) return reply(ack, { success: false, message: 'Trop de cartes enregistrées : supprimez-en.' });
        const name = cleanText(file.name, LIMITS.maxMapName - 10) || 'Carte importée';
        const map = {
            id: crypto.randomUUID(),
            name: `${name} (importée)`,
            auto: false,
            author: socket.data.name,
            savedAt: Date.now(),
            config,
            terrainsList: terrains.map((t) => ({ ...t })),
            gridData,
            landing: file.landing && file.landing.phase !== 'off' ? normalizeLanding(file.landing) : null
        };
        await storage.putMap(map);
        mapsIndex.set(map.id, metaOf(map));
        broadcastMaps();
        reply(ack, { success: true, message: `Carte « ${map.name} » importée.` });
    }));

    socket.on('rename-map', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;

        const id = String(payload?.id ?? '');
        const name = cleanText(payload?.name, LIMITS.maxMapName);
        if (!name) return reply(ack, { success: false, message: 'Le nom ne peut pas être vide.' });
        if (!MAP_ID.test(id) || !mapsIndex.has(id)) {
            return reply(ack, { success: false, message: 'Carte introuvable.' });
        }

        await storage.renameMap(id, name);
        const meta = mapsIndex.get(id);
        meta.name = name;
        meta.auto = false;
        broadcastMaps();
        reply(ack, { success: true, message: 'Carte renommée.' });
    }));

    socket.on('delete-map', guarded(async (payload, ack) => {
        if (!requireAdmin(socket, ack)) return;

        const id = String(payload?.id ?? '');
        if (!MAP_ID.test(id) || !mapsIndex.has(id)) {
            return reply(ack, { success: false, message: 'Carte introuvable.' });
        }

        await deleteMap(id);
        broadcastMaps();
        reply(ack, { success: true, message: 'Carte supprimée.' });
    }));

    /* ---------- Déconnexion ---------- */

    socket.on('disconnect', () => {
        if (socket.data.name) broadcastUsers();
    });
});

/* ------------------------------------------------------------------ */
/* Démarrage / arrêt propre                                            */
/* ------------------------------------------------------------------ */

async function start() {
    console.log(`💾 Stockage : ${storage.label}`);

    let raw = await storage.loadState();
    if (!raw && storage !== fileStorage) {
        // Première utilisation de Supabase : on récupère d'éventuelles données locales.
        raw = await fileStorage.loadState();
        if (raw) console.log('✅ Données locales trouvées : elles sont importées dans Supabase.');
    }
    if (!raw) console.log('🆕 Aucune donnée trouvée : plateau par défaut (150x100).');

    state = normalizeState(raw);
    rebuildContributors();
    await storage.saveState(state);

    background = await storage.loadBackground();

    try {
        loadFichesSeed();
        await loadFichesOverrides();
        if (fiches.customStale.length) {
            // Sauvegarde automatique (une seule par version) : les armées créées ne sont jamais perdues par un changement de fichier d'origine.
            const sid = `sstale${String(fiches.version).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`;
            try { await putSnapshot(sid, currentFichesFile(`Sauvegarde auto (version des fiches changée : ${fiches.version})`), 'serveur', true); } catch (e) { console.warn('Sauvegarde automatique impossible :', e?.message || e); }
            console.warn(`⚠️ ${fiches.customStale.length} armée(s) créée(s) avec une ancienne version des fiches : formules à vérifier.`);
        }
    } catch (err) {
        console.error('⚠️ Fiches d’armée : modifications du MJ illisibles, version d’origine utilisée :', err.message);
    }

    for (const meta of await storage.listMaps()) mapsIndex.set(meta.id, meta);
    console.log(`🗺️  ${mapsIndex.size} carte(s) enregistrée(s).`);

    const now = Date.now();
    for (const [token, session] of Object.entries(await storage.loadSessions())) {
        if (session && typeof session.name === 'string' && now - session.lastSeen < SESSION_TTL_MS) {
            sessions.set(token, session);
        }
    }

    server.listen(PORT, () => {
        console.log(`Serveur prêt sur http://localhost:${PORT}`);
        const lan = lanAddresses(PORT);
        if (lan.length) console.log(`Sur le même réseau Wi-Fi, les joueurs peuvent ouvrir : ${lan.join('  ou  ')}`);
    });
}

async function shutdown() {
    try {
        await saveNow();
    } finally {
        process.exit(0);
    }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
    console.error('❌ Démarrage impossible :', err.message);
    if (storage !== fileStorage) {
        console.error('   Vérifiez SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, et que supabase-schema.sql a été exécuté.');
    }
    process.exit(1);
});

// Tests automatiques seulement (GAME_TEST=1) : accès direct à quelques fonctions de règle.
if (process.env.GAME_TEST) global.__srv = { get state() { return state; }, hexTrace, hexLine, artShot, unitHp, artTiles, applyArtDamage, chargeFacets, screenOf, screenedUnit, fireFinished, emitLanding, chargeInRange, genPower, moveRange, terrainBA, fireMods, unitMob, hasBA, genRadius, allBattleUnits, orderReach };
