# GMG Slack Bot v1 RALPLAN

## 요구사항 요약

GMG v1은 Slack 중심의 번개 모임 조율 봇이다. 사용자는 `/gmg`를 실행해 모달을 작성하고, 공통 공지 채널에 모임을 게시한 뒤, 버튼으로 참여 상태를 모을 수 있다. 목표는 흩어진 사람들에게 말로 일일이 물어보는 불편함을 줄이는 것이다.

현재 저장소에는 앱 코드가 없으므로 문서 우선으로 계획한다. 이후 구현 AI 에이전트는 제품 요구사항을 다시 묻지 않고 이 문서를 기준으로 구현을 시작할 수 있어야 한다.

## RALPLAN-DR 요약

### 원칙

1. 단일 공지 출처: 공개 모임 상태와 리마인더는 하나의 설정된 공지 채널에 모은다.
2. 낮은 참여 마찰: 사용자는 Slack 안에서 `/gmg`, 모달, 버튼만으로 만들고 응답한다.
3. 마감 기반 확정성: 사용자는 마감 전까지 상태를 바꿀 수 있고, 마감 후에는 최종 참석자가 잠긴다.
4. 명확한 정원 규칙: `GMG`와 `late_join`만 정원에 포함한다.
5. v1은 운영 범위를 넓히지 않는다: 정산, 캘린더, 승인/검열, 통계는 하지 않는다.

### 결정 기준

1. 이후 AI 구현자가 제품 질문을 다시 하지 않아도 되어야 한다.
2. 참여 상태, 정원, 확정, 리마인더 동작이 테스트 가능해야 한다.
3. Slack 플랫폼 제약을 문서화하되, 특정 프레임워크를 성급히 고정하지 않는다.

### 검토한 선택지

| 선택지 | 장점 | 단점 | 결정 |
| --- | --- | --- | --- |
| PRD 하나만 작성 | 빠르게 만들 수 있고 훑어보기 쉽다 | 상태와 Slack edge case가 묻힌다 | 기각 |
| 큰 구현 명세 하나로 통합 | 모든 내용이 한 파일에 있다 | 범위가 커질수록 유지보수와 검토가 어렵다 | 기각 |
| 관심사별 문서 분리 | 구현 인수인계가 명확하고 테스트 기준을 찾기 쉽다 | 관리할 파일이 늘어난다 | 선택 |

### `architect` 피드백 반영

- ack 타이밍, 모달 trigger, fallback text, 메시지 수정 권한, Block Kit 제한, scheduled message 제약을 지키도록 Slack 플랫폼 계약을 추가했다.
- 상태 모델에 invariant와 transition table을 추가했다.
- source channel은 호출 맥락으로만 쓰고, 공개 출력은 announcement channel로 보낸다고 명확히 했다.
- 알림 trigger, 수신자, fallback text, 톤 제한을 테스트 가능하게 정리했다.

### `critic` 피드백 반영

- 정원 도달 충돌을 해결했다. 정원 도달 자동 확정은 확정 알림을 보내고 모임이 찼음을 표시하지만, 마감 전 참여 상태 변경을 막지는 않는다. 정원에 포함된 참여자가 마감 전에 빠지면 정원을 다시 계산하고 공지 메시지를 갱신한다.
- 시나리오 기반 acceptance test를 추가했다.
- Slack 계약 검증 항목을 추가했다.
- 30분 전 `considering` 리마인더의 톤 제한과 suppression 규칙을 추가했다.
- 확정 후 취소 규칙을 정했다. v1에서는 수동 확정과 마감 확정을 최종 상태로 보고, 그 이후 취소는 범위 밖이다.

## 추천 문서 구조

문서는 의도적으로 관심사별로 나눈다.

- `docs/README.md`: 기준 문서 색인과 구현 규칙.
- `docs/gmg-slack-bot-v1-prd.md`: 제품 의도, 사용자, 범위, non-goal.
- `docs/gmg-slack-bot-v1-interaction-spec.md`: Slack command, 모달, 버튼, 채널 라우팅.
- `docs/gmg-slack-bot-v1-platform-contract.md`: Slack API 제약과 구현 의무.
- `docs/gmg-slack-bot-v1-state-model.md`: lifecycle, 참여 상태, invariant, transition rule.
- `docs/gmg-slack-bot-v1-notification-spec.md`: 메시지 종류, 리마인더, 수신자, 톤.
- `docs/gmg-slack-bot-v1-test-spec.md`: 시나리오 기반 acceptance check.
- `docs/adr/0001-gmg-slack-bot-v1-scope-and-flow.md`: 결정 기록.

## 이후 구현 단계

1. Slack app runtime을 선택한다.
   - 시작점으로는 Slack Bolt for JavaScript 또는 Python을 추천한다. 단, 프로젝트가 다른 stack을 채택하면 그 선택을 따른다.
   - 이 문서에 언급되었다는 이유만으로 프레임워크를 추가하지 않는다. 앱 코드가 생긴 뒤 실제 프로젝트 구조를 확인한다.

2. 환경 변수와 워크스페이스 설정을 정의한다.
   - 필요한 설정: Slack bot token, signing secret, Socket Mode를 쓰는 경우 app token, announcement channel ID, timezone, reminder 기본 시간.
   - announcement channel은 변할 수 있는 채널명이 아니라 Slack channel ID로 관리한다.

3. `/gmg` command handling을 구현한다.
   - command를 즉시 ack한다.
   - command payload의 `trigger_id`로 생성 모달을 연다.
   - source channel과 creator를 맥락 정보로 저장한다.

4. 모달 제출을 구현한다.
   - 제목, 종류, 약속 시간, 선택적 정원, 마감 시간을 검증한다.
   - meeting record를 만든다.
   - announcement channel에 버튼과 fallback text가 포함된 메시지를 올린다.

5. 참여자 action을 구현한다.
   - 마감 전에는 `GMG`, `late_join`, `considering`, `not_attending`, 응답 취소를 받는다.
   - 한 사용자는 한 모임에서 하나의 active participant state만 가진다.
   - 새 상태를 누르면 이전 상태를 덮어쓴다.

6. lifecycle 자동화를 구현한다.
   - 정원 도달 자동 확정은 확정 알림을 보내고 모임이 찼음을 표시하지만, 수동 확정 전이라면 마감 전 상태 변경은 계속 허용한다.
   - 마감 자동 확정은 최종 `GMG + late_join` 참석자를 잠근다.
   - creator 수동 확정은 즉시 잠근다.
   - creator 취소는 즉시 잠그고 예정된 리마인더를 취소하지만, 최종 확정 전까지만 허용한다.

7. 리마인더를 구현한다.
   - 확정 리마인더.
   - 취소 리마인더.
   - 약속 시간 임박 리마인더.
   - 30분 전 `considering` 사용자 언급 리마인더. 문구는 장난스럽되 선을 넘지 않는다.

8. 메시지 갱신을 구현한다.
   - 참여 상태나 lifecycle이 바뀌면 봇이 올린 announcement message를 갱신한다.
   - 모임이 잠기면 interactive control을 비활성화하거나 제거한다.

9. 테스트 명세에 따라 테스트를 구현한다.
   - 상태 전환 unit test.
   - command/action/view handler integration test.
   - 리마인더와 취소 scheduler test.
   - Slack API wrapper contract test.

## 완료 기준

- 이후 AI 구현자가 문서만 보고 필요한 사용자 흐름을 모두 찾을 수 있다.
- interaction spec에 `/gmg`, 모달 필드, announcement channel 라우팅, 버튼, creator action이 정의되어 있다.
- platform contract에 Slack ack, 모달, 메시지, 갱신, 버튼, scheduled message 제약이 정의되어 있다.
- state model에 lifecycle state, participant state, invariant, transition rule이 있다.
- notification spec에 trigger, 수신자, mention, fallback text, suppression behavior가 정의되어 있다.
- test spec에 주요 동작과 edge case를 다루는 scenario table이 있다.
- PRD와 ADR에서 non-goal이 명확히 제외되어 있다.

## 위험과 대응

| 위험 | 대응 |
| --- | --- |
| Slack request timeout | 느린 작업 전에 command와 interaction을 즉시 ack한다. |
| 공지 메시지 상태 drift | 모든 meeting마다 announcement channel과 message timestamp를 저장한다. |
| 정원 경쟁 상태 | 정원 계산과 참여 상태 변경을 저장소에서 atomic하게 처리한다. |
| 리마인더 중복 발송 | meeting마다 scheduled reminder ID 또는 internal job ID를 저장한다. |
| 문구가 너무 세게 느껴짐 | 압박 리마인더는 장난스럽고 상태 중심으로 유지하며, `considering` 사용자가 없으면 보내지 않는다. |
| Slack scheduled-message 제한 | Slack scheduling은 구현 선택지 중 하나로만 보고, 제한을 문서에 따라 처리한다. |

## 검증 계획

구현 시작 전:

- README 순서대로 모든 문서를 읽는다.
- deep-interview에서 나온 요구사항이 최소 한 문서에 들어 있는지 확인한다.
- state model과 모순되는 문서가 없는지 확인한다.
- test spec이 모든 lifecycle state와 notification trigger를 덮는지 확인한다.

구현 후:

- 상태 전환과 정원 invariant unit test를 실행한다.
- Slack command, modal submission, button action, message update integration test를 실행한다.
- 확정, 취소, 약속 시간 임박, `considering` reminder scheduler test를 실행한다.
- Slack dev workspace에서 정원 없는 모임 하나와 정원 있는 모임 하나를 수동 테스트한다.

## 사용 가능한 Agent Type

- `planner`: 요구사항과 문서 일관성을 관리한다.
- `architect`: runtime, storage, scheduler, deployment design을 선택한다.
- `executor`: 문서를 기준으로 봇을 구현한다.
- `test-engineer`: test spec을 자동화 테스트로 바꾼다.
- `verifier`: 구현이 문서와 맞는지 검증한다.
- `critic`: 문서와 구현의 모순이나 누락을 검토한다.
- `researcher`: 필요할 때 공식 Slack 문서에서 현재 API 동작을 확인한다.

## 후속 작업 배치 가이드

### Ralph 경로

한 명의 owner가 순차 구현과 검증 압박을 유지해야 한다면 `$ralph docs/gmg-slack-bot-v1-plan.md`를 사용한다.

권장 reasoning:

- 설계 검토 pass: high
- 구현 pass: medium
- 검증 pass: high

### Team 경로

구현을 병렬 lane으로 나누려면 `$team docs/gmg-slack-bot-v1-plan.md`를 사용한다.

- 레인 1, architecture/storage/scheduler: `architect`, high reasoning.
- 레인 2, Slack command/modal/actions: `executor`, medium reasoning.
- 레인 3, tests and fixtures: `test-engineer`, medium reasoning.
- 레인 4, docs and implementation consistency: `verifier` 또는 `critic`, high reasoning.

Team 검증 경로:

- Team은 종료 전에 모든 lane이 test spec을 만족한다는 증거를 남긴다.
- 통합 후 최종 `verifier`가 문서, 상태 규칙, Slack contract behavior를 확인한다.
- Team 이후에도 지속적인 단일 owner 수정 루프가 필요할 때만 Ralph를 사용한다.

### Goal-mode 제안

- `$ultragoal`: 여러 세션에 걸친 durable implementation goal로 관리할 때 기본 선택지다.
- `$performance-goal`: 리마인더 처리량이나 Slack rate-limit 성능이 핵심 목표가 될 때만 필요하다.
- `$autoresearch-goal`: 다음 작업이 research-only일 때만 필요하다.
