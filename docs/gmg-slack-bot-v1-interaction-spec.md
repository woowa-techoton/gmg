# GMG Slack Bot v1 상호작용 명세

## Command 진입점

Command: `/gmg`

사용 가능 대상:

- app command를 실행할 수 있는 모든 Slack workspace 구성원.
- Slack이 custom slash command를 허용하는 모든 채널.

중요한 Slack 동작:

- slash command는 Slack 대화에서 실행할 수 있지만, custom slash command는 message thread 안에서는 사용할 수 없다.
- command handler는 느린 작업을 하기 전에 Slack 요청을 빠르게 acknowledge해야 한다.

## 출처 채널(Source Channel)과 공지 채널(Announcement Channel)

source channel은 creator가 `/gmg`를 입력한 채널이다. 이 채널은 맥락과 기록 용도로만 사용한다.

모든 공개 모임 출력은 설정된 GMG announcement channel로 보내야 한다.

- 최초 모임 공지.
- 참여자 상태 갱신.
- 정원 도달 확정 알림.
- 마감 확정 알림.
- 수동 확정 알림.
- 취소 알림.
- 약속 시간 임박 리마인더.
- 30분 전 `considering` 리마인더.

구현은 필요하면 source interaction에서 creator에게 private 또는 ephemeral feedback을 보낼 수 있다. 하지만 공개 모임 상태의 기준 위치는 announcement channel이다.

## 생성 모달(Modal)

`/gmg` command는 아래 필드를 가진 modal을 연다.

| 필드 | 필수 여부 | 타입 | 검증 |
| --- | --- | --- | --- |
| 모임 제목 | 필수 | 텍스트(Text) | 비어 있지 않고 사람이 읽을 수 있어야 함 |
| 모임 종류 | 필수 | 선택(Select) 또는 텍스트(text) | 모든 모임 category 허용 |
| 약속 시간 | 필수 | 날짜 + 시 선택 + 5분 단위 분 선택 | 현재 이후이고 분은 5분 단위여야 함 |
| 정원 모드 | 필수 | 선택(Select) | `limited` 또는 `unlimited` |
| 정원 수 | `limited`일 때 필수 | 숫자(Number) | 양의 정수 |
| 마감 시간 | 필수 | 날짜 + 시 선택 + 5분 단위 분 선택 | 약속 시간보다 이르거나 같고 분은 5분 단위여야 함 |

modal 제출은 meeting을 만들고 announcement message를 게시한다.

## App Home 생성 폼

GMG App Home은 생성 폼을 바로 보여주되, modal처럼 모든 입력을 풀폭 세로 나열하지 않는다.

- 기본 정보는 모임명과 종류 입력으로 둔다.
- 일정 영역은 약속 날짜/시/분을 한 행으로, 마감 날짜/시/분을 한 행으로 묶는다.
- 분 선택은 5분 단위 옵션만 보여준다.
- 정원 영역과 제출 버튼은 일정 영역과 구분되는 별도 섹션으로 배치한다.
- App Home 제출 payload는 Home view의 full state를 읽어 modal 제출과 같은 생성 검증을 사용한다.

## 공지 메시지(Announcement Message)

announcement message에는 아래 정보가 보여야 한다.

- 모임 제목.
- 모임 종류.
- creator mention.
- 약속 시간.
- 마감 시간.
- 정원 모드와 현재 정원 포함 인원.
- 현재 참여자 그룹:
  - `GMG`
  - `late_join`
  - `considering`
  - `not_attending`
- 현재 lifecycle state.
- 사용 가능한 버튼.

메시지는 Slack notification과 accessibility를 위해 top-level fallback `text`를 반드시 포함해야 한다.

## Participant Buttons

버튼:

- `GMG`
- `late_join`
- `considering`
- `not_attending`
- `cancel_response`

동작:

- 모임이 잠기기 전까지 버튼을 사용할 수 있다.
- participant button을 누르면 해당 사용자의 그 모임 status가 설정된다.
- 다른 participant button을 누르면 이전 status를 덮어쓴다.
- status가 실제로 바뀐 participant button 응답은 announcement message thread에 해당 사용자를 mention하는 짧은 넛지 댓글을 게시한다.
- 같은 status를 다시 누르거나 `cancel_response`를 누르는 경우에는 thread 넛지를 게시하지 않는다.
- `cancel_response`는 사용자의 status를 비운다.
- 마감, 수동 확정, 취소 이후에는 participant button 변경을 거절하고 announcement에 잠긴 상태를 보여준다.

정원 동작:

- `GMG`와 `late_join`은 정원에 포함한다.
- `considering`과 `not_attending`은 정원에 포함하지 않는다.
- 정원이 있는 모임에서 현재 정원 포함 인원이 정원에 도달하면 공지 채널에 정원 도달 알림을 보낸다.
- 정원 도달은 최종 마감이 아니다. 정원이 차도 새 `GMG` 또는 `late_join` 응답을 계속 받을 수 있다.
- 기존 counted user는 마감 전까지 non-counted status로 바꾸거나 응답을 취소할 수 있고, count가 capacity보다 낮아지면 정원 기준 상태는 다시 열린다.

## 생성자 버튼(Creator Buttons)

creator action:

- `confirm_meeting`
- `cancel_meeting`

규칙:

- creator만 수동 확정 또는 취소를 할 수 있다.
- 수동 확정은 모임을 즉시 잠근다.
- 수동 취소는 meeting이 `open` 또는 `confirmed_by_capacity` 상태일 때만 즉시 잠근다.
- v1에서는 `confirmed_by_deadline` 또는 `confirmed_manually` 이후 취소를 허용하지 않는다.
- creator가 아닌 사용자의 시도는 private rejection으로 응답한다.

## Slack Message에 미치는 Lifecycle 효과

봇이 올린 announcement message는 아래 상황에서 갱신되어야 한다.

- 참여자 status 변경.
- 응답 취소.
- 정원 도달 자동 확정.
- 꽉 찬 모임에서 counted participant가 빠지는 경우.
- 마감 자동 확정.
- 수동 확정.
- 취소.

모임이 잠기면 메시지에서 변경이 닫혔다는 사실을 명확히 보여줘야 한다.
