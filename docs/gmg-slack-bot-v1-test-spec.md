# GMG Slack Bot v1 테스트 명세

이 문서는 이후 구현이 만족해야 할 behavior test를 정의한다.

## 테스트 수준

- Unit: state transition, capacity counting, participant status overwrite, deadline lock.
- Integration: Slack command, modal submission, action payload, message post/update wrapper.
- Scheduler: reminder 생성, 취소, 억제, 발송.
- 수동 Slack QA: dev workspace에서 정원 있는 모임 하나와 정원 없는 모임 하나 테스트.

## 시나리오 테스트

| ID | 시나리오 | 준비 | 행동 | 예상 결과 |
| --- | --- | --- | --- | --- |
| S01 | 임의 채널에서 slash command 실행 | 사용자가 `/gmg`를 실행할 수 있음 | 사용자가 `/gmg` 실행 | command가 빠르게 ack되고 modal이 열림 |
| S02 | modal이 meetup 생성 | 유효한 modal data | 사용자가 modal 제출 | meeting record 생성, 설정된 채널에 announcement 게시 |
| S02-1 | 생성 시간 5분 단위 선택 | modal 또는 App Home 생성 form이 열림 | 사용자가 시와 5분 단위 분을 선택 | `HH:mm` 값으로 조합되어 meeting/deadline 시간이 저장됨 |
| S02-2 | 비 5분 단위 시간 방어 | 조작된 interaction payload가 5분 단위가 아닌 분 값을 포함 | 사용자가 form 제출 | field error를 반환하고 meeting을 생성하지 않음 |
| S02-3 | App Home 일정 compact layout | App Home이 열림 | 사용자가 생성 폼을 확인 | 약속 날짜/시/분과 마감 날짜/시/분이 각각 한 행으로 묶여 보임 |
| S03 | source channel은 공개 출력 위치가 아님 | `/gmg`가 임의 채널에서 실행됨 | modal 제출 | public announcement는 announcement channel에만 게시 |
| S04 | GMG는 정원에 포함 | 정원 2명 | 사용자 A가 `GMG` 클릭 | counted attendee count가 1 |
| S05 | late join은 정원에 포함 | 정원 2명 | 사용자 A가 `late_join` 클릭 | counted attendee count가 1 |
| S06 | considering은 정원 제외 | 정원 2명 | 사용자 A가 `considering` 클릭 | counted attendee count는 0 유지 |
| S07 | not attending은 정원 제외 | 정원 2명 | 사용자 A가 `not_attending` 클릭 | counted attendee count는 0 유지 |
| S08 | status overwrite | 사용자 A가 `considering` | 사용자 A가 `GMG` 클릭 | 사용자 A state는 `GMG`, considering list에서 사용자 A 제거 |
| S09 | 응답 취소 | 사용자 A가 `GMG` | 사용자 A가 `cancel_response` 클릭 | 사용자 A participant status 없음, capacity 감소 |
| S10 | capacity-full milestone | 정원 2명, counted attendee 1명 | 사용자 B가 `GMG` 클릭 | state가 `confirmed_by_capacity`, 정원 도달 알림 게시 |
| S11 | 정원이 찬 상태에서 새 counted response 허용 | 정원 2명, counted attendee 2명 | 사용자 C가 `GMG` 클릭 | state 유지, count가 3/2처럼 증가, private rejection 없음 |
| S12 | 마감 전 capacity 재오픈 | State `confirmed_by_capacity`, capacity 2, counted attendee 2명 | 사용자 A가 마감 전 취소 | capacity 기준 state가 `open`으로 돌아가고 count는 1 |
| S13 | no-capacity는 무제한 허용 | Capacity mode unlimited | 사용자 3명이 counted state 클릭 | 마감 전까지 모두 허용 |
| S14 | deadline auto-confirm | Open meeting이 deadline 도달 | scheduler가 deadline job 실행 | state가 `confirmed_by_deadline`, final attendee는 `GMG + late_join` |
| S15 | deadline 이후 거절 | State `confirmed_by_deadline` | 사용자가 participant button 클릭 | private rejection, state 변화 없음 |
| S16 | manual confirmation lock | Open meeting | creator가 confirm 클릭 | state가 `confirmed_manually`, participant change 거절 |
| S17 | non-creator confirm 불가 | Open meeting | non-creator가 confirm 클릭 | private rejection, lifecycle 변화 없음 |
| S18 | manual cancellation lock | Open meeting | creator가 cancel 클릭 | state가 `cancelled`, cancellation notice 게시, future reminder 억제 |
| S19 | capacity milestone 이후 deadline finalization | State `confirmed_by_capacity` | deadline job 실행 | state가 `confirmed_by_deadline`, final confirmation notice 게시 |
| S20 | capacity milestone 이후 manual finalization | State `confirmed_by_capacity` | creator가 confirm 클릭 | state가 `confirmed_manually`, final confirmation notice 게시 |
| S21 | post-deadline cancellation 거절 | State `confirmed_by_deadline` | creator가 cancel 클릭 | private rejection, lifecycle 변화 없음 |
| S22 | post-manual-confirm cancellation 거절 | State `confirmed_manually` | creator가 cancel 클릭 | private rejection, lifecycle 변화 없음 |
| S23 | considering reminder는 considering user만 mention | 약속 30분 전, 사용자 A는 considering, 사용자 B는 GMG | reminder 실행 | 메시지는 사용자 A만 mention |
| S24 | considering reminder suppression | 약속 30분 전, considering user 없음 | reminder 실행 | considering pressure message 게시 안 함 |
| S25 | cancel 후 approaching reminder 억제 | Meeting cancelled 상태 | approaching reminder job 실행 | approaching reminder 게시 안 함 |
| S26 | announcement update ownership | 봇이 announcement 게시함 | participant status 변경 | app이 저장된 bot-owned message를 갱신하거나 update failure 기록 |
| S27 | participant threaded nudge | 봇이 announcement 게시함 | 사용자가 participant status를 실제 변경 | announcement thread에 해당 사용자 mention과 status별 문구 게시 |
| S28 | participant nudge suppression | 사용자 A가 이미 `GMG` | 사용자 A가 다시 `GMG` 클릭 | state는 유지되고 중복 thread mention은 게시 안 함 |

## Slack 플랫폼 계약 테스트

| ID | 계약 | 기대 확인 |
| --- | --- | --- |
| P01 | Command ack | `/gmg` handler가 느린 side effect 전에 ack 호출 |
| P02 | Interaction ack | Button handler가 persistence 또는 Slack API update work 전에 ack 호출 |
| P03 | Modal trigger | modal open이 command payload의 `trigger_id` 사용 |
| P04 | Fallback text | 모든 block message가 top-level `text` 포함 |
| P05 | Message update identifiers | Meeting이 announcement channel ID와 message timestamp 저장 |
| P06 | Bot-owned update | `chat.update` wrapper가 meeting state를 망가뜨리지 않고 update failure 처리 |
| P07 | Scheduled-message limits | Scheduler abstraction이 Slack schedule limit과 metadata caveat를 피하거나 처리 가능 |
| P08 | Stable action IDs | Button이 stable action ID와 meeting lookup value를 가짐 |
| P09 | Participant nudge idempotency | 같은 status 재클릭, `cancel_response`, 거절된 action, thread target 없음에서는 thread mention을 게시하지 않음 |

## State Invariant Tests

- 한 사용자는 한 meeting에서 두 개의 active status를 가질 수 없다.
- `GMG + late_join` count는 일관되게 계산된다.
- `considering + not_attending`은 절대 count에 포함되지 않는다.
- capacity update는 atomic하다.
- locked state는 participant action을 거절한다.
- cancellation은 이후 non-cancellation reminder를 억제한다.

## 수동 QA 스크립트

1. dev Slack app과 announcement channel을 설정한다.
2. announcement channel이 아닌 채널에서 `/gmg`를 실행한다.
3. 정원 있는 모임을 만든다.
   - 약속 시간과 마감 시간은 `20:35`, `19:05`처럼 5분 단위 분 선택으로 지정한다.
4. 여러 사용자로 각 participant status를 클릭한다.
5. 정원을 채우고 정원 도달 알림을 확인한다.
6. 정원이 찬 뒤에도 다른 사용자가 `GMG` 또는 `late_join`으로 추가 참여할 수 있는지 확인한다.
7. 마감 전에 counted user가 빠져 count가 capacity보다 낮아지면 capacity 기준 상태가 다시 열리는지 확인한다.
8. 수동 확정 후 participant action이 거절되는지 확인한다.
9. 정원 없는 모임을 만든다.
10. deadline job이 현재 counted attendee를 최종 확정하게 한다.
11. 모임을 취소하고 pending reminder가 게시되지 않는지 확인한다.
