# GMG Slack Bot v1 상태 모델

## 모임 Lifecycle State

| 상태값 | 의미 | 참여자 변경 | Creator action(생성자 행동) | 공개 메시지 동작 |
| --- | --- | --- | --- | --- |
| `open` | 참여자를 모집 중인 상태 | 마감 전까지 허용 | 확정 또는 취소 | announcement message에 실시간 인원과 버튼을 표시 |
| `confirmed_by_capacity` | 정원에 한 번 이상 도달한 상태 | 마감 전까지 허용 | 확정 또는 취소 | 정원 도달 알림 게시, announcement는 계속 live 상태 |
| `confirmed_by_deadline` | 마감 시간이 지나 현재 참석자가 최종 확정된 상태 | 거절 | 없음 | announcement locked |
| `confirmed_manually` | creator가 수동 확정한 상태 | 거절 | 없음 | announcement locked |
| `cancelled` | creator가 취소한 상태 | 거절 | 없음 | announcement locked, 취소 알림 게시 |
| `closed` | 최종 locked state를 나타내는 구현 내부 alias | 거절 | 없음 | announcement control 비활성화 또는 제거 |

## Participant State

| State | 정원 포함 여부 | 의미 |
| --- | --- | --- |
| `GMG` | 예 | 일반 참여 |
| `late_join` | 예 | 늦게라도 참여 |
| `considering` | 아니오 | 아직 고민 중 |
| `not_attending` | 아니오 | 불참 |
| 상태 없음 | 아니오 | 아직 응답하지 않았거나 응답을 취소함 |

## 핵심 Invariant

- 하나의 meeting에는 creator가 한 명 있다.
- 하나의 meeting에는 설정된 announcement message가 하나 있다.
- 한 사용자는 한 meeting에서 최대 하나의 active participant state만 가진다.
- 새 participant status는 사용자의 이전 status를 덮어쓴다.
- response cancellation은 사용자의 active status를 비운다.
- `GMG + late_join`이 정원에 포함되는 attendee set이다.
- `considering + not_attending`은 절대 정원에 포함하지 않는다.
- 정원 도달 알림이 중복으로 과하게 나가지 않도록 capacity counting은 atomic해야 한다.
- 마감 후 participant change는 거절한다.
- 수동 확정은 participant change를 즉시 잠근다.
- 취소는 participant change를 즉시 잠근다.
- 마감 확정은 participant change를 즉시 잠근다.

## 정원 규칙

### 정원 있는 모임

정원이 있는 경우:

1. 현재 `GMG` 또는 `late_join` 상태인 사용자를 센다.
2. 현재 count가 capacity보다 작으면 다른 사용자가 `GMG` 또는 `late_join`을 선택할 수 있다.
3. count가 capacity에 도달하면 `confirmed_by_capacity`로 전환하고 정원 도달 알림을 게시한다.
4. 마감 전에는 기존 참여자가 자기 응답을 변경하거나 취소할 수 있다.
5. counted user가 빠져서 count가 capacity보다 작아지면, 모임은 정원 기준으로 다시 `open`이 되고 announcement message를 갱신한다.
6. count가 capacity 이상이어도 현재 non-counted user의 새 counted response를 허용한다. 표시 인원은 `3/2명`처럼 정원을 초과할 수 있다.
7. 마감 시간이 되면 `confirmed_by_deadline`으로 전환하고 최종 counted attendee set을 잠근다.

### 정원 없는 모임

정원이 없는 경우:

1. 사용자는 마감 전까지 `GMG` 또는 `late_join`을 선택할 수 있다.
2. capacity-full auto-confirmation은 발생하지 않는다.
3. 마감 시간이 되면 `confirmed_by_deadline`으로 전환한다.
4. 최종 참석자는 현재 `GMG + late_join` 사용자다.

## 전환 표

| From | Event | Guard | To | Effects |
| --- | --- | --- | --- | --- |
| 없음 | modal 제출 | 유효한 필드 | `open` | meeting 생성, announcement 게시 |
| `open` | 사용자가 `GMG` 또는 `late_join` 설정 | 마감 전 | `open` 또는 `confirmed_by_capacity` | status upsert, announcement 갱신, 필요 시 정원 도달 알림 게시 |
| `open` | 사용자가 `considering` 또는 `not_attending` 설정 | 마감 전 | `open` | status upsert, announcement 갱신 |
| `open` | 사용자가 응답 취소 | 마감 전 | `open` | status 제거, announcement 갱신 |
| `open` | 마감 도달 | 항상 | `confirmed_by_deadline` | 최종 counted attendee 잠금, 확정 알림 게시 |
| `open` | creator 확정 | creator만 | `confirmed_manually` | 최종 counted attendee 잠금, 확정 알림 게시 |
| `open` | creator 취소 | creator만 | `cancelled` | 잠금, 취소 알림 게시, pending reminder 취소 |
| `confirmed_by_capacity` | counted user가 나가거나 non-counted로 변경 | 마감 전이고 count가 capacity 미만이 됨 | `open` | announcement와 capacity display 갱신 |
| `confirmed_by_capacity` | 사용자가 status 변경 | 마감 전 | `confirmed_by_capacity` | status upsert, announcement 갱신 |
| `confirmed_by_capacity` | 마감 도달 | 항상 | `confirmed_by_deadline` | 최종 counted attendee 잠금, 최종 확정 알림 게시 |
| `confirmed_by_capacity` | creator 확정 | creator만 | `confirmed_manually` | 최종 counted attendee 잠금, 최종 확정 알림 게시 |
| `confirmed_by_capacity` | creator 취소 | creator만 | `cancelled` | 잠금, 취소 알림 게시, pending reminder 취소 |
| `confirmed_by_deadline` | 모든 participant action | 항상 | `confirmed_by_deadline` | private rejection, state change 없음 |
| `confirmed_by_deadline` | creator 취소 | 항상 | `confirmed_by_deadline` | private rejection, state change 없음 |
| `confirmed_manually` | 모든 participant action | 항상 | `confirmed_manually` | private rejection, state change 없음 |
| `confirmed_manually` | creator 취소 | 항상 | `confirmed_manually` | private rejection, state change 없음 |
| `cancelled` | 모든 participant action | 항상 | `cancelled` | private rejection, state change 없음 |

## 잠금 정책

capacity-full auto-confirmation은 최종 잠금이 아니다. 모임이 목표 정원에 도달했음을 채널에 알리는 milestone이며, 정원이 차도 추가 참여와 참여 상태 변경은 여전히 마감 규칙을 따른다.

최종 잠금:

- 마감 확정.
- 수동 확정.
- 취소.

v1은 마감 확정 또는 수동 확정 이후 취소를 지원하지 않는다. 나중에 이 제품 결정을 바꾸려면 state model, notification spec, test spec을 함께 수정해야 한다.

## Data Model 힌트

이후 구현은 최소한 아래 데이터를 모델링해야 한다.

- Meeting ID(모임 ID).
- Creator user ID(생성자 사용자 ID).
- Source channel ID(출처 채널 ID).
- Announcement channel ID(공지 채널 ID).
- Announcement message timestamp(공지 메시지 timestamp).
- Title(제목).
- Type(종류).
- Meeting time(약속 시간).
- Deadline(마감 시간).
- Capacity mode and capacity count(정원 모드와 정원 수).
- Lifecycle state(생명주기 상태).
- User ID별 participant status.
- Reminder job ID 또는 scheduled message ID.
- Created and updated timestamps(생성/수정 시각).
