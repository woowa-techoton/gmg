# GMG Slack Bot v1 문서

이 폴더는 GMG 첫 구현의 기준 문서입니다. GMG는 Slack 안에서 번개 모임을 만들고 참여자를 모으기 위한 봇입니다.

현재 저장소에는 이 문서를 기준으로 한 TypeScript/Bolt 구현이 포함되어 있습니다. 이후 구현을 맡는 사람이나 AI 에이전트는 기능을 바꾸기 전에 이 문서들을 먼저 읽고, 문서의 제품 계약과 테스트 계약을 함께 갱신해야 합니다.

## 구현 위치

- 앱 엔트리포인트: `src/index.ts`
- Slack Bolt 연결: `src/slack/app.ts`
- Slack command, modal, button handler: `src/slack/handlers.ts`
- Block Kit 메시지 생성: `src/slack/blocks.ts`
- 상태 전이와 정원 규칙: `src/domain/meeting-service.ts`
- 메모리 저장소: `src/storage/memory-meeting-store.ts`
- 리마인더: `src/reminders/`
- Slack App manifest: `slack/manifest.json`

## 읽는 순서

1. [RALPLAN 구현 계획](./gmg-slack-bot-v1-plan.md)
2. [제품 요구사항](./gmg-slack-bot-v1-prd.md)
3. [Slack 상호작용 명세](./gmg-slack-bot-v1-interaction-spec.md)
4. [Slack 플랫폼 계약](./gmg-slack-bot-v1-platform-contract.md)
5. [상태 모델](./gmg-slack-bot-v1-state-model.md)
6. [알림 명세](./gmg-slack-bot-v1-notification-spec.md)
7. [테스트 명세](./gmg-slack-bot-v1-test-spec.md)
8. [ADR 0001](./adr/0001-gmg-slack-bot-v1-scope-and-flow.md)

## 제품 요약

GMG는 사람들이 Slack에서 일일이 물어보지 않고도 모임 참여자를 모을 수 있게 해준다. 워크스페이스 구성원은 어느 채널에서든 `/gmg`를 실행하고, 모달을 작성한 뒤, 공통 공지 채널에 모임을 올릴 수 있다. 참여자는 Slack 버튼으로 응답하고, 봇은 공지 메시지, 정원, 마감, 확정, 취소, 리마인더 상태를 일관되게 관리한다.

## 하지 않는 일

- 비용 정산
- 캘린더 연동
- 승인, 검열, 운영자 심사 흐름
- 참석률 통계
- 별도 웹 앱 또는 모바일 UI

## 이후 AI 구현자가 반드시 지켜야 할 규칙

아래 핵심 규칙을 바꾸려면 먼저 문서를 수정해야 한다.

- 공개 모임 정보는 모두 하나의 설정된 공지 채널로 보낸다.
- `GMG`와 `late_join`만 정원에 포함한다.
- `considering`과 `not_attending`은 정원에 포함하지 않는다.
- 마감 시간이 지나면 참여 상태 변경을 거절한다.
- 정원이 찼다는 자동 확정은 알림 milestone일 뿐, 최종 참여자 잠금은 아니다.
- 수동 확정, 마감 확정, 취소는 최종 상태다.
- v1에서는 수동 확정 또는 마감 확정 이후 취소를 허용하지 않는다.
- Slack command와 interaction handler는 느린 작업을 하기 전에 Slack 요청을 먼저 acknowledge해야 한다.
