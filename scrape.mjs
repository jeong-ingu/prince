// 왕십리자이(단지 111002) 매매 매물 추적 스크레이퍼
// 실행: node scrape.mjs
// - Edge(msedge)로 fin.land 지도 페이지를 열어 /complex/article/list 응답을 가로챈다.
// - articleNumber(개별 게시글 고유키) 기준으로 스냅샷을 뜨고, 이전 상태와 비교해
//   추가/삭제 이벤트를 tracker.json 에 누적한다. 화면용으로 tracker-data.js 도 쓴다.
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 추적 대상 (다른 단지로 바꾸려면 이 URL만 교체) ──────────────────
const COMPLEX_NAME = '왕십리자이';
const MAP_URL =
  'https://fin.land.naver.com/map?center=3zjtDs-2ALNl6&zoom=15.486219241809744&layer=NobwRAlgJmBcYGMD2BbADgGwKYA8D6UWALgIYQZgA0YaJATiSgM5zjLrY4CSM8AjAIAMggExgAvtSZZ6CABYAFeoxaxwEJgDVyGEnABmJDNOqkARnDD0iEBNipW6Nu1gAqDQq4CeaLKrAAgnwS1HTEAK50AHYkZvawRHThWOIAukA';
// ─────────────────────────────────────────────────────────────────

const STATE_FILE = path.join(__dirname, 'tracker.json');
const DATA_JS = path.join(__dirname, 'tracker-data.js');

const DIR = { WS:'남서', SW:'남서', ES:'남동', SE:'남동', SS:'남', NS:'남', SN:'북', NN:'북',
  EE:'동', WE:'동', EW:'서', WW:'서', NE:'북동', EN:'북동', NW:'북서', WN:'북서' };
const TRADE = { A1:'매매', B1:'전세', B2:'월세', B3:'단기임대' };

function priceText(n) {
  if (!n) return '-';
  const eok = Math.floor(n / 1e8);
  const man = Math.round((n % 1e8) / 1e4);
  if (eok > 0) return man > 0 ? `${eok}억 ${man.toLocaleString()}` : `${eok}억`;
  return `${man.toLocaleString()}만`;
}

const priceOf = (a) => a.dealPrice || a.warrantyPrice || 0;

// 네이버 응답 list → 집(동일묶음) 단위 배열. 각 집은 소속 게시글(members)을 가짐.
function toGroups(list) {
  return list.map((it) => {
    const rep = it.representativeArticleInfo;
    const dup = it.duplicatedArticleInfo;
    const arr = dup?.articleInfoList?.length ? dup.articleInfoList : [rep];
    if (!arr.some(a => a.articleNumber === rep.articleNumber)) arr.push(rep);
    const seen = new Set();
    const members = [];
    for (const a of arr) {
      if (!a?.articleNumber || seen.has(a.articleNumber)) continue;
      seen.add(a.articleNumber);
      members.push({
        articleNumber: a.articleNumber,
        tradeType: TRADE[a.tradeType] || a.tradeType,
        dong: a.dongName || '',
        floor: a.articleDetail?.floorInfo || '',
        areaName: a.spaceInfo?.supplySpaceName || '',
        exclusive: a.spaceInfo?.exclusiveSpace ?? null,
        direction: DIR[a.articleDetail?.direction] || a.articleDetail?.direction || '',
        dealPrice: a.priceInfo?.dealPrice ?? 0,
        warrantyPrice: a.priceInfo?.warrantyPrice ?? 0,
        confirmDate: a.verificationInfo?.articleConfirmDate || '',
        feature: a.articleDetail?.articleFeatureDescription || '',
        broker: a.brokerInfo?.brokerageName || '',
        url: `https://fin.land.naver.com/articles/${a.articleNumber}`,
      });
    }
    return { members };
  }).filter(g => g.members.length);
}

// 집 단위 집계 (표시/이벤트용)
function aggregate(members) {
  members = [...members].sort((a, b) => priceOf(a) - priceOf(b));
  const prices = members.map(priceOf).filter(Boolean);
  const rep = members[0];
  return {
    tradeType: rep.tradeType, dong: rep.dong, areaName: rep.areaName, exclusive: rep.exclusive,
    floor: rep.floor, direction: rep.direction,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    memberCount: members.length,
    confirmDate: members.map(m => m.confirmDate || '').sort().slice(-1)[0] || '',
    memo: (members.find(m => m.feature) || rep).feature || '',
    repArticleNumber: rep.articleNumber, url: rep.url,
    members: members.map(m => m.articleNumber),
    brokers: [...new Set(members.map(m => m.broker).filter(Boolean))],
  };
}

// 재등록 매칭 창: 삭제된 집이 이 기간 내 같은 signature로 다시 나오면 재등장으로 간주
export const REAPPEAR_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
// 방향은 부동산마다 표기가 달라(남/남동) 같은 집도 갈리므로 제외. 중개사 겹침으로 구분.
const sigOfGroup = (o) => [o.dong, o.areaName, o.floor].join('|');

// 스냅샷 diff — 네이버 묶음(집) 단위. 스냅샷 간 매물번호 겹침으로 같은 집을 추적(대표번호 바뀌어도 유지).
// 매물번호가 완전히 바뀐 재등록은 signature(동·면적·층·방향)로 재등장 처리.
// 부동산 한두 곳이 올렸다 내려도(집은 그대로) 신규/삭제로 안 잡고, 가격(최저 호가)만 반영.
export function computeDiff(state, groupsIn, now, isBaseline) {
  state.groups = state.groups || {};
  const events = [];

  const prevActive = Object.values(state.groups).filter(g => g.active);
  const memberIndex = new Map(); // articleNumber -> groupId
  for (const g of prevActive) for (const an of (g.members || [])) memberIndex.set(an, g.groupId);
  const matched = new Set();
  const newGroups = [];

  for (const grp of groupsIn) {
    const agg = aggregate(grp.members);
    // 이전 집과 매물번호가 하나라도 겹치면 같은 집
    let gid = null;
    for (const an of agg.members) { if (memberIndex.has(an)) { gid = memberIndex.get(an); break; } }

    if (gid && state.groups[gid]) {
      const ex = state.groups[gid]; matched.add(gid);
      const hist = ex.priceHistory || [{ t: ex.firstSeen, price: ex.minPrice }];
      const lastP = hist[hist.length - 1].price;
      if (agg.minPrice && lastP && agg.minPrice !== lastP) {
        hist.push({ t: now, price: agg.minPrice });
        events.push({ time: now, type: 'PRICE', gid, from: lastP, to: agg.minPrice,
          label: `${agg.dong}동 ${agg.areaName} ${agg.floor} ${priceText(lastP)} → ${priceText(agg.minPrice)}` });
      }
      state.groups[gid] = { ...ex, ...agg, groupId: gid, active: true, lastSeen: now, firstSeen: ex.firstSeen, priceHistory: hist, removedAt: undefined };
    } else {
      newGroups.push(agg); // 겹침 없음 → 재등록/신규 판단 보류
    }
  }

  // 이번에 사라진 집 + 최근 삭제된(윈도우 내) 집 = 재등록 후보
  const removedNow = prevActive.filter(g => !matched.has(g.groupId));
  const recentInactive = Object.values(state.groups).filter(g => !g.active && g.removedAt
    && (new Date(now) - new Date(g.removedAt)) <= REAPPEAR_WINDOW_MS);
  const reappearCands = [...removedNow, ...recentInactive];
  const usedCand = new Set();

  // 같은 부동산(중개사)이 올린 것인지: 중개사 목록이 하나라도 겹치는지 (한쪽 정보 없으면 통과)
  const brokerMatch = (a, b) => {
    const ba = a.brokers || [], bb = b.brokers || [];
    if (!ba.length || !bb.length) return true;
    return ba.some((x) => bb.includes(x));
  };
  for (const agg of newGroups) {
    const label = `${agg.tradeType} ${agg.dong}동 ${agg.areaName} ${agg.floor} ${priceText(agg.minPrice)}`;
    const sig = sigOfGroup(agg);
    const cand = reappearCands.find(g => !usedCand.has(g.groupId) && sigOfGroup(g) === sig && brokerMatch(g, agg));
    if (cand) {
      // 같은 집이 새 매물번호로 재등록 → 재등장 (기존 집 이력 계승)
      usedCand.add(cand.groupId);
      const hist = (cand.priceHistory || [{ t: cand.firstSeen, price: cand.minPrice }]).slice();
      if (hist[hist.length - 1].price !== agg.minPrice) hist.push({ t: now, price: agg.minPrice });
      state.groups[cand.groupId] = { ...cand, ...agg, groupId: cand.groupId, active: true, lastSeen: now, firstSeen: cand.firstSeen, priceHistory: hist, removedAt: undefined, reappearedAt: now };
      events.push({ time: now, type: 'REAPPEARED', gid: cand.groupId, label });
    } else {
      const newId = agg.repArticleNumber;
      state.groups[newId] = { ...agg, groupId: newId, active: true,
        firstSeen: isBaseline ? '2000-01-01T00:00:00.000Z' : now, lastSeen: now,
        priceHistory: [{ t: now, price: agg.minPrice }] };
      if (!isBaseline) events.push({ time: now, type: 'ADDED', gid: newId, label });
    }
  }

  // 재등록으로 연결 안 된 삭제 집 → 삭제 확정
  for (const g of removedNow) {
    if (usedCand.has(g.groupId)) continue;
    g.active = false; g.removedAt = now;
    events.push({ time: now, type: 'REMOVED', gid: g.groupId,
      label: `${g.tradeType} ${g.dong}동 ${g.areaName} ${g.floor} ${priceText(g.minPrice)}` });
  }
  return events;
}

async function fetchOnce() {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    locale: 'ko-KR',
    viewport: { width: 1500, height: 1000 },
  });
  const page = await ctx.newPage();
  const pages = [];
  page.on('response', async (res) => {
    if (res.url().includes('/complex/article/list')) {
      try { pages.push(await res.json()); } catch {}
    }
  });

  // 1) naver.com 방문해 NNB 쿠키 확보 (없으면 fin.land 지도가 404)
  await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // 2) 지도 페이지 진입 → 앱이 매물 리스트를 요청. 간헐적 404 대비 최대 3회 재시도.
  for (let attempt = 1; attempt <= 3 && pages.length === 0; attempt++) {
    await page.goto(MAP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(7000);
    if (pages.length === 0) {
      const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 120)).catch(() => '');
      console.error(`  [attempt ${attempt}] no list yet. page: ${body.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }

  // 3) 스크롤로 다음 페이지 로딩 유도 (매물 30개 초과 대비)
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 100) el.scrollTop = el.scrollHeight;
      });
    }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1000);

  if (!pages.length) throw new Error('매물 리스트 응답을 받지 못했습니다. (로그인/차단 여부 확인)');
  const all = [];
  let totalCount = 0;
  for (const p of pages) {
    const r = p.result || p;
    totalCount = r.totalCount ?? totalCount;
    if (Array.isArray(r.list)) all.push(...r.list);
  }
  return { groups: toGroups(all), groupCount: totalCount };
  } finally {
    await browser.close().catch(() => {});
  }
}

// 동시 실행 충돌/일시 오류 대비 최대 2회 재시도
async function fetchListings() {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await fetchOnce(); }
    catch (e) { lastErr = e; console.error(`수집 시도 ${attempt} 실패: ${e.message}`); if (attempt < 2) await new Promise((r) => setTimeout(r, 5000)); }
  }
  throw lastErr;
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return { complexName: COMPLEX_NAME, groups: {}, events: [], updatedAt: null };
}

function run() {
  return fetchListings().then(({ groups, groupCount }) => {
    const now = new Date().toISOString();
    const state = loadState();
    state.complexName = COMPLEX_NAME;
    // 첫 스냅샷이면 이벤트 없이 기준선만 저장
    const isBaseline = !state.groups || Object.keys(state.groups).length === 0;
    const events = computeDiff(state, groups, now, isBaseline);

    state.events = [...events, ...state.events].slice(0, 500);
    state.updatedAt = now;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    fs.writeFileSync(DATA_JS, 'window.TRACKER = ' + JSON.stringify(state) + ';\n');

    const activeGroups = Object.values(state.groups).filter(g => g.active).length;
    const regCount = groups.reduce((s, g) => s + g.members.length, 0);
    console.log(`[${now}]`);
    console.log(`현재 매물(집): ${activeGroups}건 · 등록글 ${regCount}건 (네이버 대표 ${groupCount}그룹)`);
    if (isBaseline) console.log('첫 스냅샷(기준선) 저장 완료 — 다음 실행부터 집 단위 신규/삭제·가격변경이 감지됩니다.');
    else {
      const add = events.filter(e => e.type === 'ADDED').length;
      const rea = events.filter(e => e.type === 'REAPPEARED' || e.type === 'READDED').length;
      const rem = events.filter(e => e.type === 'REMOVED').length;
      const pr = events.filter(e => e.type === 'PRICE').length;
      console.log(`이번 변동 → 신규 ${add} · 재등장 ${rea} · 삭제 ${rem} · 가격변경 ${pr}`);
    }
  });
}

// 직접 실행할 때만 스크레이핑 수행 (테스트 등에서 import 시엔 실행 안 함)
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run().catch((e) => { console.error('실패:', e.message); process.exit(1); });
}
