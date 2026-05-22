# GMG Slack Bot

GMG는 Slack에서 `/gmg` 명령어로 번개 모임을 만들고, 공통 공지 채널에서 버튼으로 참여자를 모으는 Slack 봇입니다.

## 구현된 범위

- `/gmg` slash command에서 모임 생성 모달 열기
- 모임명, 종류, 약속 시간, 정원 모드, 정원 수, 마감 시간 입력
- 모든 공개 알림을 `GMG_ANNOUNCEMENT_CHANNEL_ID` 공지 채널로 라우팅
- 참여 버튼: `GMG`, `late_join`, `considering`, `not_attending`, `cancel_response`
- 생성자 버튼: `confirm_meeting`, `cancel_meeting`
- `GMG + late_join`만 정원 포함
- `considering + not_attending`은 정원 제외
- 정원 도달 시 알림 milestone 처리, 마감 전 재오픈 허용
- 마감 확정, 수동 확정, 취소 후 참여 변경 차단
- 30분 전 `considering` 적극 알림
- 약속 시간 임박 리마인더

## 실행 준비

1. Slack App manifest로 `slack/manifest.json`을 사용해 앱을 만든다.
2. 앱을 `초록과로지가상준덴` 워크스페이스에 설치한다.
3. 공지 채널에 봇을 초대하고, 채널 ID를 확인한다.
4. `.env.example`을 기준으로 `.env`를 채운다.

필수 환경 변수:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_SOCKET_MODE`
- `SLACK_APP_TOKEN`
- `GMG_ANNOUNCEMENT_CHANNEL_ID`
- `GMG_DATA_FILE`

## 개발 명령어

```sh
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

## 문서

구현 기준 문서는 [docs/README.md](./docs/README.md)에서 읽는 순서를 확인할 수 있습니다.

## 멤버
<table>
  <tr>
    <td align="center"><a href="https://github.com/2Jaeheon"><img src="https://github.com/2Jaeheon.png" width="200px;" alt=""/><br /><sub><b>초록</b></sub></a></td>
    <td align="center"><a href="https://github.com/sangjun121"><img src="https://github.com/sangjun121.png" width="200px;" alt=""/><br /><sub><b>샤를</b></sub></a></td>
    <td align="center"><a href="https://github.com/Jihyun3478"><img src="https://github.com/Jihyun3478.png" width="200px;" alt=""/><br /><sub><b>로지</b></sub></a></td>
    <td align="center"><a href="https://github.com/RealTake"><img src="https://github.com/RealTake.png" width="200px;" alt=""/><br /><sub><b>에덴</b></sub></a></td>
    </tr>
</table>
