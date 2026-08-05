# 왕십리자이 매물 추적기 — 인수인계 (HANDOFF)

작성일: 2026-07-06
위치: `c:\Users\WIN_AD03216734\projects\land`

---

## 1. 무엇을 만들었나

네이버 부동산(fin.land) **왕십리자이(단지ID 111002)** 매매 매물을 주기적으로 수집·추적하는
로컬 대시보드. 매물이 **신규 등록 / 삭제 / 가격변경 / 재등장**하는 것을 자동으로 감지해 기록한다.

- 수집기: `scrape.mjs` (Edge 헤드리스로 네이버 내부 API 호출 → 스냅샷 비교 → 이벤트 기록)
- 대시보드: `index.html` (브라우저로 열기)
- 자동 수집: Windows 작업 스케줄러, 매일 **09:00 · 15:00**

---

## 2. 데이터 수집 방식 (⚠️ 가장 중요, 비자명)

fin.land.naver.com은 **curl 등 비브라우저 요청을 JA3 TLS 지문으로 차단**한다 (항상 429/403).
그래서 다음 절차가 필수:

1. `playwright-core` + **시스템 설치 Edge**(`channel: 'msedge'`) 헤드리스로 구동
2. 먼저 `https://www.naver.com` 방문 → **NNB 쿠키** 획득 (없으면 지도 페이지가 404)
3. 지도 URL 진입 → 앱이 `POST /front-api/v1/complex/article/list` 호출 → **응답을 가로채서** 수집

핵심 상수/키:
- 단지ID `complexId = 111002`
- **매물 고유키 = `articleNumber`** (추적의 기준)
- 응답 `result.list` = 대표매물(그룹) **23개**, 펼치면 개별 게시글 **76건**
  (`duplicatedArticleInfo.articleInfoList` = 같은 집을 여러 중개사가 올린 것)
- 상세페이지: `https://fin.land.naver.com/articles/{articleNumber}`
- 지도 URL의 `layer` 파라미터 = lz-string 압축된 `{complexId, tab, articleTradeTypes}`

---

## 3. 파일 구성

| 파일 | 역할 |
|---|---|
| `scrape.mjs` | 수집 + diff 로직. `computeDiff()` export (테스트 가능). 직접 실행 시에만 스크레이핑 |
| `index.html` | 대시보드. `tracker-data.js`의 `window.TRACKER` 를 읽어 렌더 (CORS 때문에 fetch 아님) |
| `tracker.json` | 상태 원본 (매물별 이력 + 이벤트 로그 누적) |
| `tracker-data.js` | 화면 주입용 (`window.TRACKER = {...}`) |
| `scrape-task.cmd` | 작업 스케줄러가 호출하는 비대화식 실행 스크립트 (로그: `scrape.log`) |
| `refresh.bat` | 수동 갱신용 (더블클릭) |
| `enable-logoff.ps1` | 로그오프 중 실행 설정 (관리자 권한 필요, **미완료**) |
| `tracker.real.bak.json` | 원본 baseline 백업 (샘플 테스트 복구용) |

---

## 4. 대시보드 기능 (index.html)

- **현재 매물**: 동일매물을 한 줄로 묶어 표시(23줄), **가격 오름차순** 정렬
  - 컬럼: `# · 거래 · 면적(공급/전용) · 동 · 층 · 가격 · 확인일 · 등록(중개사 수) · 메모`
  - **평수 필터** 버튼: 전체 / 51 / 59 / 84 (전용면적 기준)
  - **가격 클릭** → 가격 히스토리 모달 (날짜별 변동 + ▲상승/▼하락 델타)
  - **메모 강조**: `R` `RR` `로얄` → 진한 파랑 볼드
  - **확인일 3주(21일) 이상 경과** 행 → 연한 회색 배경
  - 신규/재등장 매물엔 배지(🟢신규 / 🟣재등장)
- **변동 로그**: 시각 + 배지 + 내용
  - 🟢 신규 / 🟣 재등장(추정) / 🟡 가격변경(상승▲빨강·하락▼파랑) / 🔴 삭제(❗ 강조)
- **통계 카드**: 매물(동일묶음) · 등록글 수 · 신규 매물 · 사라진 매물(= 🗑️섹션 개수)
- **🗑️ 사라진 매물** 섹션: 삭제된 매물 목록 (재등장한 건 제외), 사라진 시각 표시

---

## 5. 변동 감지 규칙

- **신규(ADDED)**: 처음 보는 articleNumber
- **삭제(REMOVED)**: 이전 스냅샷엔 있었으나 이번에 없는 articleNumber
- **가격변경(PRICE)**: 같은 articleNumber의 매매가 변동 (from→to 기록, 이력 누적)
- **재등장(READDED)**: 같은 articleNumber가 다시 노출
- **재등장(추정)(REAPPEARED)**: 새 articleNumber지만 아래 조건 모두 만족 시 이전 매물로 이어붙임 (가격이력 승계)
  - 삭제 후 **24시간 이내** (`REMATCH_WINDOW_MS`)
  - **동·층·면적(areaName)·방향 100% 일치**
  - **메모 유사도 ≥ 50%** (`MEMO_SIM_THRESHOLD`, 문자 bigram Jaccard)
  - ※ 층은 엄격 비교("6/20" vs "저/20"이 다르면 매칭 안 됨) — 사용자가 엄격 유지 선택
- 임계값은 `scrape.mjs` 상단 상수에서 조정 가능

---

## 6. 자동화 (Windows 작업 스케줄러)

- 작업 이름: **`WangsimniXi-Scrape`**
- 트리거: 매일 **09:00, 15:00**
- 실행: `scrape-task.cmd` → `node scrape.mjs` (결과는 `scrape.log`)
- 현재 상태: **로그인 상태일 때 실행**(LogonType Interactive). 검증 완료(수동 실행 성공, 결과코드 0).

관리 명령:
```powershell
Get-ScheduledTaskInfo -TaskName "WangsimniXi-Scrape"   # 다음 실행/최근 결과
Start-ScheduledTask    -TaskName "WangsimniXi-Scrape"   # 즉시 실행
Disable-ScheduledTask  -TaskName "WangsimniXi-Scrape"   # 일시 중지
Unregister-ScheduledTask -TaskName "WangsimniXi-Scrape" # 삭제
```

---

## 7. 남은 일 / TODO

- [ ] **로그오프 중에도 실행**: 관리자 권한 PowerShell에서 아래 실행 (내일 예정)
  ```
  powershell -ExecutionPolicy Bypass -File "C:\Users\WIN_AD03216734\projects\land\enable-logoff.ps1"
  ```
  → `LogonType: S4U` 확인. ⚠️ 헤드리스 브라우저가 Session 0(비대화식)에서 불안정할 수 있으니
     `scrape.log`로 결과 확인. 실패 시 비밀번호 저장 방식으로 전환 검토.

아이디어 (미정):
- 알림(카카오/이메일/슬랙)으로 신규·급매·가격하락 push
- 전세·월세(B1/B2) 추적, 여러 단지 동시 추적
- 평형별 최저가 추이 차트, CSV/엑셀 내보내기
- "급매"·"올수리" 등 키워드 필터/알림

---

## 8. 수동 실행 방법

```
cd c:\Users\WIN_AD03216734\projects\land
node scrape.mjs        # 또는 refresh.bat 더블클릭
```
그 후 `index.html` 을 브라우저로 열면 최신 상태 확인.
