# GMG Slack Bot v1 알림 명세

## 채널 라우팅

모든 공개 GMG 알림은 설정된 announcement channel로 보낸다.

`/gmg`가 실행된 source channel에는 기본적으로 공개 모임 상태를 보내지 않는다. Slack 구현이 자연스럽게 지원한다면 creator에게 private 또는 ephemeral feedback을 보낼 수는 있다.

## 알림 종류

| 종류 | Trigger | 수신 위치 | 필수 내용 | Suppression |
| --- | --- | --- | --- | --- |
| 최초 공지 | modal 제출 | announcement channel | 모임 정보, creator, 마감, 정원, 버튼 | 생성 실패가 아니라면 보내야 함 |
| 참여자 갱신 | 참여 상태 변경 | announcement channel | 그룹별 참여자 목록과 count 갱신 | message update만으로 처리 가능 |
| 참여자 스레드 넛지 | 참여 상태가 실제로 변경됨 | announcement message thread | 상태를 바꾼 사용자 mention과 status별 짧은 문구 | `cancel_response`, 거절된 action, 같은 status 재클릭, thread target 없음이면 억제 |
| 정원 도달 확정 | 정원 도달 | announcement channel | 모임 정보와 counted attendee mention | 같은 capacity milestone 중복 게시 억제. 단, 다시 열렸다가 다시 차면 게시 가능 |
| 마감 확정 | 마감 도달 | announcement channel | 최종 attendee mention과 모임 정보 | cancelled 상태면 억제 |
| 수동 확정 | creator 확정 | announcement channel | 최종 attendee mention과 모임 정보 | 이미 locked/cancelled면 억제 |
| 취소 | creator 취소 | announcement channel | 취소된 모임 정보와 creator mention | 취소 성공 시 반드시 게시 |
| 약속 시간 임박 | 약속 시간 임박 | announcement channel | 모임 정보와 attendee mention | cancelled 상태면 억제 |
| 고민중 리마인더 | 약속 30분 전 | announcement channel | 아직 `considering`인 사용자 mention | `considering` 사용자가 없거나 cancelled면 억제 |

## Mention 규칙

- 적극 알림은 관련 Slack user를 mention해야 한다.
- 참여자 스레드 넛지는 상태를 바꾼 사용자만 mention한다.
- 최종 확정 알림은 `GMG + late_join` 사용자를 mention한다.
- 30분 전 considering reminder는 현재 status가 `considering`인 사용자만 mention한다.
- `not_attending` 사용자는 reminder에서 mention하지 않는다.
- 구현이 `@here` 또는 `@channel`을 사용한다면 의도적으로 사용해야 하며, 선택한 Slack permission model에서 다뤄야 한다.

## Fallback Text(대체 텍스트)

blocks가 포함된 모든 Slack message는 top-level fallback text를 포함해야 한다. fallback text는 짧고 사람이 읽을 수 있어야 하며 아래 정보를 포함한다.

- GMG.
- Meeting title(모임 제목).
- 현재 lifecycle event.
- 관련 있는 경우 meeting time 또는 deadline.

예시:

- `GMG: 저녁 번개 모집이 열렸습니다. 마감 18:00.`
- `GMG: 저녁 번개가 확정되었습니다. 참석자 4명.`
- `GMG: 저녁 번개가 취소되었습니다.`
- `GMG: 저녁 번개 30분 전입니다. 아직 고민중인 사람이 있습니다.`

## 톤 정책

제품은 장난스러울 수 있지만, 봇은 친근해야 한다.

허용:

- 상태 중심의 가벼운 놀림.
- 가벼운 긴장감.
- 사용자가 아직 `considering` 상태라는 언급.

허용하지 않음:

- 모욕.
- 개인 공격.
- 개인 특성, 근무 습관, 참석 이력에 대한 shame.
- 설정된 reminder event를 넘어서는 반복 spam.

권장 30분 전 reminder 스타일:

`<@USER>님이 아직도!? 고민중입니다. GMG 버튼으로 마음을 정해볼까요?`

이 문구는 제품 예시이며 hard-coded string이 아니다. 이후 구현은 tone policy를 유지하는 선에서 copy를 조정할 수 있다.

참여자 스레드 넛지는 제품이 의도한 짧은 장난성 문구를 그대로 사용한다. 다만 같은 status 재클릭에는 반복 게시하지 않아 mention spam으로 번지지 않게 한다.

## Update와 New Message의 구분

live state는 message update로 처리한다.

- 참여자 목록 변경.
- Count 변경.
- Open/full/locked 상태 표시.
- 버튼 사용 가능 여부.

중요한 event는 new message로 게시한다.

- 최초 공지.
- 참여자 스레드 넛지(thread reply).
- 정원 도달 확정.
- 마감 확정.
- 수동 확정.
- 취소.
- 약속 시간 임박 리마인더.
- 고민중 리마인더.

meeting이 이미 `confirmed_by_capacity`에 도달했더라도, 마감 확정과 수동 확정은 여전히 최종 잠금 event이므로 별도의 최종 확정 메시지를 게시해야 한다. 정원 도달 확정만으로 최종 참석자 잠금 메시지를 대체하지 않는다.

## Reminder Timing

v1 필수 reminder trigger:

- 모임이 확정되었을 때.
- 모임이 취소되었을 때.
- 약속 시간이 다가왔을 때.
- 약속 시간 30분 전, `considering` 사용자에게.

현재 구현은 일반 approaching-time reminder도 약속 시간 30분 전을 기본값으로 사용한다. 이 값을 바꾸려면 scheduler 구현과 테스트 명세를 함께 갱신한다.
