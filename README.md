# 왕십리자이 매물 추적

네이버 부동산(fin.land) **왕십리자이(단지 111002)** 매매 매물을 주기적으로 수집해
**집(동·면적·층) 단위**로 신규·삭제·재등록·가격변동을 추적하는 대시보드.

- 정적 페이지: [`index.html`](index.html) — 데이터는 `tracker-data.js`(`window.TRACKER`)에서 읽음
- 수집기: [`scrape.mjs`](scrape.mjs) — Edge 헤드리스로 내부 API 수집 → 스냅샷 비교
- 상태: `tracker.json` (집별 이력 + 이벤트 로그 누적)

## 기능
- 동일매물(중개사만 다른 같은 집) 한 줄로 묶어 가격 오름차순
- 변동 로그: 신규 / 재등록 / 삭제(❗) / 가격변경(▲빨강·▼파랑)
- 재등록 판정: 동·면적·층 + 중개사 겹침 (매물번호가 바뀌어도 같은 집으로)
- 평형 필터, 메모 키워드 강조(R/RR/로얄), 확인일 3주 경과 회색 처리
- 가격 클릭 → 가격 이력 모달, 사라진 매물 목록(매물번호 포함)

## 데이터 갱신
```bash
npm install         # playwright-core
node scrape.mjs     # tracker-data.js / tracker.json 재생성
```
※ 시스템에 설치된 Microsoft Edge를 사용합니다(네이버 봇 차단 우회).

## GitHub Pages
`main` 루트 배포 → `https://<계정>.github.io/prince/`
