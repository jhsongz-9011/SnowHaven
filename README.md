# SnowHaven

웹에서 스키 / 보드 / 썰매로 슬로프를 내려오는 멀티플레이 게임 프로토타입. (리프트 탑승 + 활강 + 같이 타기)

## 실행
```bash
npm install
npm run dev        # 개발 서버
npm run build      # 타입 검사 + 빌드
npm run simtest    # 장비별 물리 봇 시뮬레이션
npm run nettest    # 멀티플레이 서버 통합 테스트
npm run server     # 멀티플레이 서버 (개발 중 dev 와 같이 실행)
```

발표/배포용: `npm run build` 후 `npm run server` 하면 `http://localhost:8787` 하나로 게임과 멀티플레이가 모두 동작한다 (서버가 dist 를 내보냄). 환경변수(`PORT`, `STATIC_DIR`, `TRUST_PROXY`, `VITE_WS_URL`)와 배포 방법은 `docs/멀티플레이어.md`.

## 조작
- ← → / A D : 방향 조절 (모바일은 화면 좌/우 터치)
- 1 스키 · 2 보드 · 3 썰매
- E / Space / 화면 버튼 : 리프트 타기 (승강장에서) · 완주 후 승강장으로 돌아가기
- R : 정상 출발선에서 바로 다시 시작 (조작감 튜닝용 지름길)

## 게임 흐름
승강장 대기 → E → 빈 자리가 있는 의자가 오면 자동 탑승(2인승) → 코스를 바라보며 약 90초 올라감 → 정상에서 하차 → 활강 → 결승 → E 로 승강장 복귀

테스트 버전: 우측 상단 '정상으로 바로 가기' 버튼(승강장/대기/탑승 중에만 표시)으로 리프트를 건너뛸 수 있다. 정식 버전에서는 `main.ts` 의 `SHOW_SKIP` 을 false 로.

## 장애물과 충돌
- 고정: 싱크홀 5, 공사 구간 4(주황 고깔 + "안전제일" 노란 판) / 이동: 고라니 3, 토끼 4 (코스를 가로질러 왕복)
- 부딪히면 굴러 넘어져 미끄러지며 점점 느려지고, 속도가 **20km/h 이하**가 되면 일어나 다시 탑승해 계속 달린다 (다시 탄 뒤 1.5초는 충돌 보호)
- 배치는 `src/sim/obstacles.ts` 맨 위 `FIXED_LAYOUT` / `MOVING_LAYOUT`, 충돌 후 감속·복귀 수치는 `src/sim/equipment.ts` 의 `CRASH`

## 구조
- `src/sim/equipment.ts` : 장비별 파라미터 (조작감은 여기 숫자만 바꾸면 됨)
- `src/sim/physics.ts`   : 아케이드식 이동 물리 (three.js 의존 없음, 서버에서도 재사용 가능)
- `src/sim/obstacles.ts` : 장애물 배치, 이동 장애물 위치(시간 t 만의 함수), 충돌 판정 (three.js 의존 없음)
- `src/sim/lift.ts`      : 리프트 경로(닫힌 고리)와 의자 순환. 의자 위치는 시간 t 만의 함수 (three.js 의존 없음). 속도(약 90초 상승)·간격·좌석 수·동승자 확률·위치 파라미터는 맨 위 `LIFT`. 2인승 좌석, 배경 동승자(테스트용 NPC, `LIFT.ambient`)도 여기
- `src/sim/terrain.ts`   : 지형 높이맵
- `server/` : 멀티플레이 릴레이 서버(`index.ts`), 정적 파일(`static.ts`), 통합 테스트(`net-test.ts`)
- `src/net/` : 서버 규약(`protocol.ts`), 접속(`net.ts`), 원격 플레이어(`remote-players.ts`)
- `src/world.ts`, `src/lift-view.ts`, `src/obstacle-view.ts`, `src/rider.ts`, `src/main.ts` : 렌더링, 리프트 모델, 라이더 모델, 상태 머신과 루프

## 다음 단계
1. ~~리프트 탑승~~ (완료)  2. ~~멀티플레이(WebSocket + 보간)~~ (완료, v0.1)  3. 배포 리허설, 원격 눈가루/자국 (서버 이상 이동 감지는 기본형 완료)  4. 기록, 랭킹, 코스 추가, 캐릭터 선택
