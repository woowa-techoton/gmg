# ADR 0001: GMG Slack Bot v1 범위와 흐름

## 상태

채택됨

## 배경

GMG에는 사람들이 Slack 안에서 번개 모임 참여자를 쉽게 모을 수 있게 해주는 봇이 필요하다. 이 ADR은 greenfield 상태에서 구현을 시작하기 전에 초기 제품 및 계획 결정을 기록하기 위해 작성되었다.

deep-interview 결과, v1은 넓은 이벤트 운영 도구가 아니라 모임 모집과 참여 상태 추적에 집중해야 한다는 점이 명확해졌다.

## 결정

GMG v1은 Slack-first meetup coordination bot으로 만든다.

- 모든 사용자는 지원되는 채널에서 `/gmg`를 실행할 수 있다.
- 봇은 모임 정보를 입력하는 modal을 연다.
- 공개 모임 상태는 하나의 설정된 announcement channel에 게시한다.
- 참여자는 button으로 응답한다.
- 정원, 마감, 확정, 취소, 리마인더는 봇이 처리한다.

문서는 `docs/` 아래에서 관심사별로 나눈다. 이후 AI 에이전트는 요구사항 인터뷰를 다시 하지 않고 이 문서들을 기준으로 구현할 수 있어야 한다.

## 결정 기준

- 번개 모임 참여자를 모으는 마찰을 줄인다.
- 공개 모임 상태를 한 곳에서 볼 수 있게 한다.
- Slack button으로 참여를 단순하게 만든다.
- 정원과 마감 동작을 테스트 가능하게 만든다.
- v1 scope creep을 피한다.

## 검토한 대안

### PRD 하나만 작성

상태, Slack API, 알림, 테스트 세부사항을 놓치기 쉬워서 기각했다.

### 큰 구현 명세 하나로 통합

이후 변경을 분리하고 검토하기 어려워서 기각했다.

### 관심사별 문서 분리

선택했다. 이후 AI 에이전트가 아래 내용을 명확히 찾을 수 있다.

- 제품 의도.
- Slack interaction.
- Slack platform constraint.
- State model.
- Notification behavior.
- Test.
- ADR.

### 정원 도달 즉시 잠금

기각했다. 인터뷰에서 변경은 마감 후 차단하는 것으로 정리되었다. 정원 도달 즉시 잠그면 마감 전 취소/변경 동작이 사용자에게 어색해진다.

### 정원 도달 확정은 알리되 마감 전까지 변경 허용

선택했다. capacity-full auto-confirmation은 최종 마감이 아니라 정원 도달 milestone이다. 봇은 정원이 찼음을 알리지만, 새 counted user도 마감 전까지 계속 `GMG` 또는 `late_join`으로 참여할 수 있다. count가 capacity보다 낮아지면 정원 기준 상태는 다시 열린다.

### 확정 후 취소

v1에서는 기각했다. 수동 확정과 마감 확정은 final lock이다. 이렇게 해야 상태 모델이 단순하고, 이미 최종 확정 알림을 받은 참석자에게 다시 취소 리마인더를 보내야 하는 애매함을 피할 수 있다.

## 결과

- 구현은 atomic capacity update가 필요하다.
- 봇은 announcement message identifier를 저장해야 한다.
- reminder scheduling은 persistence 또는 durable scheduled-message tracking이 필요하다.
- announcement channel은 명시적으로 설정해야 한다.
- 제품은 Slack-native로 유지되며 별도 UI가 필요하지 않다.
- post-confirm cancellation은 나중에 명시적인 제품 결정과 state/test update가 필요하다.

## 후속 작업

- Slack app framework와 deployment mode 선택.
- storage와 scheduler 선택.
- 정확한 environment variable 이름 정의.
- Slack dev workspace 테스트 후 최종 한국어 메시지 copy 확정.
