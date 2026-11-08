// Builds the Courtney site: downloads the latest women's college basketball schedule and last season's
// box scores (ESPN data mirrored by the open-source sportsdataverse/wehoop project), compacts them,
// computes schedule-adjusted team ratings, and writes public/index.html plus one calendar feed per team.
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download';
const SEASON = 2027, STATS_SEASON = 2026;
const SCHED_URL = `${BASE}/espn_womens_college_basketball_schedules/wbb_schedule_${SEASON}.parquet`;
const BOX_URL = `${BASE}/espn_womens_college_basketball_team_boxscores/team_box_${STATS_SEASON}.parquet`;

async function load(url, columns) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const file = await res.arrayBuffer();
  return parquetReadObjects({ file, compressors, columns });
}
const N = v => (v === null || v === undefined || v === '') ? NaN : Number(v);
const S = v => typeof v === 'string' ? v : '';

/* ---------- schedule ---------- */
const sched = (await load(SCHED_URL, ['id', 'date', 'time_valid', 'neutral_site', 'broadcast', 'notes_headline', 'venue_full_name', 'venue_address_city', 'venue_address_state',
  'status_type_name', 'home_id', 'home_location', 'home_name', 'home_abbreviation', 'home_short_display_name', 'home_color', 'home_alternate_color', 'home_score', 'home_records', 'home_current_rank', 'home_conference_id',
  'away_id', 'away_location', 'away_name', 'away_abbreviation', 'away_short_display_name', 'away_color', 'away_alternate_color', 'away_score', 'away_records', 'away_current_rank', 'away_conference_id',
  'conference_competition', 'groups_id', 'groups_short_name', 'groups_is_conference'])).sort((a, b) => S(a.date) < S(b.date) ? -1 : S(a.date) > S(b.date) ? 1 : 0);

const conf = {};
for (const r of sched) if (r.groups_is_conference && !isNaN(N(r.groups_id))) conf[N(r.groups_id)] = S(r.groups_short_name);
const recOf = s => { const m = /'type': 'total', 'summary': '([^']*)'/.exec(S(s)); return m ? m[1] : ''; };
const teams = new Map();
for (let i = sched.length - 1; i >= 0; i--) {
  const r = sched[i];
  for (const s of ['home', 'away']) {
    const id = N(r[s + '_id']); if (isNaN(id) || teams.has(id)) continue;
    const cf = N(r[s + '_conference_id']), rk = N(r[s + '_current_rank']);
    teams.set(id, { id, n: S(r[s + '_short_display_name']) || S(r[s + '_location']), loc: S(r[s + '_location']), m: S(r[s + '_name']), ab: S(r[s + '_abbreviation']),
      c: S(r[s + '_color']).toLowerCase(), c2: S(r[s + '_alternate_color']).toLowerCase(), cf: isNaN(cf) ? '' : (conf[cf] || ''), rk: !isNaN(rk) && rk < 99 ? rk : 0, rec: recOf(r[s + '_records']) });
  }
}
const ids = [...teams.keys()].sort((a, b) => { const A = teams.get(a), B = teams.get(b); return (A.cf === '') - (B.cf === '') || A.loc.localeCompare(B.loc); });
const idx = new Map(ids.map((id, i) => [id, i]));
const T = ids.map(id => { const t = teams.get(id); return [t.id, t.n, t.m, t.ab, t.c, t.c2, t.cf, t.rk, t.rec, t.loc]; });
const tables = () => { const map = new Map(), list = []; return [list, k => { const key = JSON.stringify(k); if (!map.has(key)) { map.set(key, list.length); list.push(k); } return map.get(key); }]; };
const [V, vi] = tables(), [TV, ti] = tables(), [NT, ni] = tables();
const G = [];
for (const r of sched) {
  if (S(r.status_type_name) === 'STATUS_CANCELED') continue;
  const t = Date.parse(S(r.date)); if (isNaN(t)) continue;
  const fin = S(r.status_type_name) === 'STATUS_FINAL' ? 1 : 0;
  G.push([N(r.id), Math.floor(t / 60000), idx.get(N(r.home_id)), idx.get(N(r.away_id)),
    (r.neutral_site ? 1 : 0) | (r.time_valid ? 0 : 2) | (r.conference_competition ? 4 : 0),
    ti(S(r.broadcast).trim()), vi([S(r.venue_full_name), S(r.venue_address_city), S(r.venue_address_state)]),
    fin ? N(r.home_score) || 0 : 0, fin ? N(r.away_score) || 0 : 0, fin, ni(S(r.notes_headline).trim())]);
}
if (G.length < 1000) throw new Error('Schedule looks incomplete: ' + G.length + ' games');

/* ---------- last season's ratings ---------- */
const D1 = new Set(T.filter(t => t[6]).map(t => t[0]));
const box = (await load(BOX_URL, ['game_id', 'team_id', 'opponent_team_id', 'team_score', 'opponent_team_score', 'field_goals_attempted', 'offensive_rebounds', 'turnovers',
  'free_throws_attempted', 'three_point_field_goals_attempted', 'lead_changes'])).map(r => ({ g: N(r.game_id), t: N(r.team_id), o: N(r.opponent_team_id), pts: N(r.team_score), opp: N(r.opponent_team_score),
  fga: N(r.field_goals_attempted), orb: N(r.offensive_rebounds), tov: N(r.turnovers), fta: N(r.free_throws_attempted), tpa: N(r.three_point_field_goals_attempted), lc: N(r.lead_changes) }))
  .filter(r => D1.has(r.t) && D1.has(r.o));
for (const r of box) r.poss = r.fga - r.orb + r.tov + .44 * r.fta;
const possBy = new Map(box.map(r => [r.g + ':' + r.t, r.poss]));
const rows = [];
for (const r of box) { const op = possBy.get(r.g + ':' + r.o); if (op === undefined) continue; r.P = (r.poss + op) / 2; if (!(r.P > 40)) continue; r.ortg = 100 * r.pts / r.P; r.drtg = 100 * r.opp / r.P; r.margin = r.pts - r.opp; rows.push(r); }
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const avg = mean(rows.map(r => r.ortg));
let adjO = new Map([...D1].map(t => [t, avg])), adjD = new Map([...D1].map(t => [t, avg]));
const byTeam = new Map(); for (const r of rows) { if (!byTeam.has(r.t)) byTeam.set(r.t, []); byTeam.get(r.t).push(r); }
for (let k = 0; k < 25; k++) {
  const nO = new Map(), nD = new Map();
  for (const [t, rs] of byTeam) { nO.set(t, mean(rs.map(r => r.ortg - ((adjD.get(r.o) ?? avg) - avg)))); nD.set(t, mean(rs.map(r => r.drtg - ((adjO.get(r.o) ?? avg) - avg)))); }
  adjO = nO; adjD = nD;
}
const st = [];
for (const [t, rs] of byTeam) {
  if (rs.length < 12) continue;
  const lcs = rs.map(r => r.lc).filter(x => !isNaN(x));
  st.push({ t, n: rs.length, w: rs.filter(r => r.margin > 0).length, o: adjO.get(t), d: adjD.get(t), pace: mean(rs.map(r => r.P)),
    tpa: rs.reduce((s, r) => s + r.tpa, 0) / rs.reduce((s, r) => s + r.fga, 0), close: rs.filter(r => Math.abs(r.margin) <= 6).length / rs.length, lc: lcs.length ? mean(lcs) : NaN });
}
for (const s of st) s.net = s.o - s.d;
const lcMean = mean(st.filter(s => !isNaN(s.lc)).map(s => s.lc)); for (const s of st) if (isNaN(s.lc)) s.lc = lcMean;
const z = k => { const v = st.map(s => s[k]), m = mean(v), sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return x => (x - m) / sd; };
const zn = z('net'), zp = z('pace'), zl = z('lc'), zc = z('close'), zt = z('tpa');
for (const s of st) s.e = .3 * zn(s.net) + .2 * zp(s.pace) + .2 * zl(s.lc) + .2 * zc(s.close) + .1 * zt(s.tpa);
const ze = z('e');
const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;
const stats = {};
for (const s of st) stats[s.t] = [s.n, s.w, r1(s.o), r1(s.d), r1(s.net), r1(s.pace), r3(s.tpa), r3(s.close), r1(s.lc), Math.round(Math.min(100, Math.max(0, 50 + 15 * ze(s.e))))];

/* ---------- players to watch: each team's top three ---------- */
async function players() {
  const cols = ['game_id', 'athlete_id', 'athlete_display_name', 'athlete_short_name', 'athlete_position_abbreviation', 'athlete_jersey', 'team_id', 'team_short_display_name', 'minutes', 'points', 'rebounds', 'assists', 'did_not_play', 'game_date'];
  const url = y => `${BASE}/espn_womens_college_basketball_player_boxscores/player_box_${y}.parquet`;
  const agg = rows => {
    const m = new Map();
    for (const r of rows) {
      if (r.did_not_play === true || !(N(r.minutes) > 0)) continue;
      const id = N(r.athlete_id); let a = m.get(id);
      if (!a) m.set(id, a = { games: new Set(), pts: 0, reb: 0, ast: 0, mins: 0, last: null, lastT: -Infinity });
      if (a.games.has(r.game_id)) continue;
      a.games.add(r.game_id); a.pts += N(r.points) || 0; a.reb += N(r.rebounds) || 0; a.ast += N(r.assists) || 0; a.mins += N(r.minutes) || 0;
      const tt = new Date(r.game_date).getTime() || 0; if (tt >= a.lastT) { a.lastT = tt; a.last = r; }
    }
    for (const a of m.values()) { const g = a.games.size; a.gp = g; a.pts /= g; a.reb /= g; a.ast /= g; a.mins /= g; }
    return m;
  };
  const ty = agg(await load(url(SEASON), cols)), ly = agg(await load(url(STATS_SEASON), cols));
  const byTeam = {};
  for (const [id, r] of ty) {
    const info = r.last, tid = N(info.team_id), L = ly.get(id);
    let pts, reb, ast, gp, lbl, prev = '';
    if (L && L.gp >= 10) {
      const w = Math.min(r.gp, 5) / 15;
      pts = L.pts * (1 - w) + r.pts * w; reb = L.reb * (1 - w) + r.reb * w; ast = L.ast * (1 - w) + r.ast * w; gp = L.gp; lbl = 'ly';
      if (N(L.last.team_id) !== tid) prev = S(L.last.team_short_display_name);
    } else { if (r.mins < 15) continue; pts = r.pts; reb = r.reb; ast = r.ast; gp = r.gp; lbl = 'ty'; }
    const impact = (pts + .5 * reb + .7 * ast) * (lbl === 'ty' ? .85 : 1);
    (byTeam[tid] ||= []).push([impact, [S(info.athlete_display_name), S(info.athlete_short_name), S(info.athlete_position_abbreviation), S(String(info.athlete_jersey ?? '')), r1(pts), r1(reb), r1(ast), gp, lbl, prev]]);
  }
  const out = {}; for (const [k, v] of Object.entries(byTeam)) out[k] = v.sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
  return out;
}
let PLAYERS = {};
try { PLAYERS = await players(); } catch (e) { console.warn('Players skipped: ' + e.message); }

/* ---------- write the page ---------- */
const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const data = { asOf, teams: T, venues: V, tv: TV, notes: NT, games: G, stats, statsSeason: (STATS_SEASON - 1) + '–' + String(STATS_SEASON).slice(2) };
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const page = readFileSync('page.html', 'utf8').replace('__DATA__', () => json).replace('__PLAYERS__', () => JSON.stringify(PLAYERS).replace(/</g, '\\u003c'));
mkdirSync('public/cal', { recursive: true });
writeFileSync('public/index.html', page);

/* ---------- one calendar feed per team ---------- */
const icsTime = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const fold = l => { const out = []; let s = l; while (s.length > 72) { out.push(s.slice(0, 72)); s = ' ' + s.slice(72); } out.push(s); return out.join('\r\n'); };
const etDate = (t, add = 0) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); const d = new Date(p + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + add); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
const stamp = icsTime(Date.now());
const gamesBy = new Map(); for (const g of G) for (const x of [g[2], g[3]]) { if (!gamesBy.has(x)) gamesBy.set(x, []); gamesBy.get(x).push(g); }
let feeds = 0;
T.forEach((t, i) => {
  if (!t[6]) return;
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Courtney//Womens College Basketball//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEsc(t[1] + ' women\'s basketball'), 'X-PUBLISHED-TTL:PT12H', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H'];
  for (const g of gamesBy.get(i) || []) {
    const ms = g[1] * 60000, H = T[g[2]], A = T[g[3]], v = V[g[6]], tv = TV[g[5]], note = NT[g[10]];
    let sum = g[4] & 1 ? `${A[1]} vs. ${H[1]}` : `${A[1]} at ${H[1]}`;
    if (g[9]) sum += ` (${A[1]} ${g[8]}, ${H[1]} ${g[7]})`;
    L.push('BEGIN:VEVENT', 'UID:' + g[0] + '-' + t[0] + '@courtney-wbb', 'DTSTAMP:' + stamp);
    if (g[4] & 2) L.push('DTSTART;VALUE=DATE:' + etDate(ms), 'DTEND;VALUE=DATE:' + etDate(ms, 1)); else L.push('DTSTART:' + icsTime(ms), 'DTEND:' + icsTime(ms + 2 * 36e5));
    L.push('SUMMARY:' + icsEsc(sum));
    const loc = [v[0], [v[1], v[2]].filter(Boolean).join(', ')].filter(Boolean).join(', '); if (loc) L.push('LOCATION:' + icsEsc(loc));
    L.push('DESCRIPTION:' + icsEsc([tv ? 'TV: ' + tv : 'No broadcast listed yet', note, g[4] & 2 ? 'Tip-off time to be announced.' : ''].filter(Boolean).join('\n')), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  writeFileSync(`public/cal/${t[0]}.ics`, L.map(fold).join('\r\n') + '\r\n'); feeds++;
});
console.log(`Built ${G.length} games, ${Object.keys(PLAYERS).length} teams with players, ${T.length} teams, ${Object.keys(stats).length} rated teams, ${feeds} calendar feeds. Data as of ${asOf}.`);
