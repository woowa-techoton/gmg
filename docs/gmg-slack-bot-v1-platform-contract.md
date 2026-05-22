# GMG Slack Bot v1 Slack 플랫폼 계약

이 문서는 이후 구현 AI 에이전트가 반드시 지켜야 할 Slack 플랫폼 제약을 정리한다. 특정 프레임워크를 강제하지 않고, 구현 의무만 정의한다.

## 공식 Slack 참고 문서

- [slash command 구현](https://docs.slack.dev/interactivity/implementing-slash-commands/)
- [사용자 interaction 처리](https://docs.slack.dev/interactivity/handling-user-interaction/)
- [Bolt for JavaScript command](https://docs.slack.dev/tools/bolt-js/concepts/commands/)
- [modal 열기](https://docs.slack.dev/tools/bolt-js/concepts/creating-modals/)
- [`views.open`](https://docs.slack.dev/reference/methods/views.open/)
- [`chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage/)
- [`chat.update`](https://docs.slack.dev/reference/methods/chat.update/)
- [`chat.scheduleMessage`](https://docs.slack.dev/reference/methods/chat.scheduleMessage/)
- [button element](https://docs.slack.dev/reference/block-kit/block-elements/button-element/)
- [actions block](https://docs.slack.dev/reference/block-kit/blocks/actions-block/)

## 요청 Acknowledgment

slash command와 interactive payload는 Slack의 짧은 응답 시간 안에 acknowledge해야 한다. 구현은 아래를 지켜야 한다.

- 느린 validation, persistence, network call, scheduling work를 하기 전에 `/gmg`를 ack한다.
- record 갱신이나 메시지 게시 전에 button action을 ack한다.
- modal submission도 느린 작업 전에 ack한다. 단, Slack의 modal response 형식으로 즉시 validation error를 반환하는 경우는 예외다.

완료 기준:

- command 또는 interaction handler가 ack 전에 느린 side effect를 수행하면 테스트가 실패해야 한다.
- integration test는 command, block action, view submission acknowledgement를 다뤄야 한다.

## 모달(Modal) 계약

앱은 `/gmg` command에서 받은 `trigger_id`로 생성 modal을 연다.

완료 기준:

- 유효한 command payload는 modal을 연다.
- invalid 또는 expired modal-opening failure는 creator에게 private하게 알려준다.
- modal field는 meeting record로 결정적으로 매핑된다.

## Message 계약

announcement message는 설정된 announcement channel에 게시해야 한다.

모든 Block Kit message는 notification과 accessibility를 위해 메시지를 요약하는 top-level fallback `text`를 포함해야 한다.

완료 기준:

- meetup announcement를 게시할 때 `blocks`와 fallback `text`가 모두 포함된다.
- 확정, 취소, 리마인더 메시지에도 사람이 읽을 수 있는 fallback `text`가 포함된다.

## Message Update 계약

구현은 `chat.update`로 announcement message를 최신 상태로 유지할 수 있다. 단, 봇이 수정할 권한이 있는 메시지만 갱신해야 한다.

저장해야 하는 식별자:

- Announcement channel ID.
- Announcement message timestamp.
- Meeting ID.

완료 기준:

- 참여자 상태가 바뀌면 저장된 announcement message가 갱신된다.
- `chat.update`가 메시지 수정 불가로 실패하면 앱은 실패를 기록하고 meeting state를 조용히 망가뜨리지 않는다.

## Interactive Control 계약

participant와 creator control은 호환되는 Block Kit block 안의 button을 사용한다.

제약:

- actions block은 여러 interactive element를 담을 수 있지만, 이후 구현자는 Slack 문서의 element 제한 안에서 읽기 좋게 유지해야 한다.
- 취소처럼 파괴적인 action은 선택한 프레임워크가 지원한다면 danger styling과 confirmation step을 사용한다.
- creator action을 제외하면, 한 사용자의 click은 그 사용자 자신의 participant status만 바꿔야 한다.

완료 기준:

- 각 button은 안정적인 action ID를 가진다.
- action payload에는 meeting과 의도한 transition을 찾을 수 있는 value 또는 lookup data가 들어 있다.
- button action handler는 idempotent해야 한다.

## Scheduling 계약

리마인더 발송은 internal scheduler/job queue 또는 Slack scheduled message 중 하나로 구현할 수 있다.

Slack scheduled message를 사용한다면 구현은 아래 제약을 고려해야 한다.

- future scheduling limit.
- channel별 scheduled-message density limit.
- scheduled message metadata caveat.
- meeting이 취소되거나 상태가 바뀌면 pending scheduled reminder를 삭제하거나 무시해야 한다.

완료 기준:

- meeting을 취소하면 이후 non-cancellation reminder가 발송되지 않는다.
- 수동 확정, 마감 확정, 정원 변경이 reminder를 중복 생성하지 않는다.
- 선택한 배포 방식에서 process restart를 고려해야 한다면 reminder job은 복구 가능한 방식으로 저장된다.

## 구현 시 결정해야 할 Slack scope

정확한 scope 목록은 프레임워크와 배포 방식에 따라 달라진다. 그래도 이후 구현은 최소한 아래 권한 필요성을 검토해야 한다.

- announcement channel에 메시지 게시.
- bot-owned message 수정.
- slash command 수신.
- interactivity payload 수신.
- reminder message 예약 또는 발송.

선택한 Slack app architecture를 확인하기 전에는 이 문서에 final scope를 hard-code하지 않는다.
