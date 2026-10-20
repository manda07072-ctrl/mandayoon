# PortOne V2 카드 결제 서버

Apps Script 웹앱이 주문 정보를 기존 **만다윤 주문관리 시트**에 기록하고, PortOne 결제 조회 API로 실제 승인 상태와 결제 금액을 확인한 뒤에만 입금 완료 처리합니다. API Secret은 공개 저장소에 두지 않습니다.

## 현재 연결

- 랜딩페이지: GitHub Pages의 index.html에서 Store ID, 채널 키, Apps Script URL을 사용합니다.
- Apps Script 속성: ORDER_SPREADSHEET_ID는 주문관리 스프레드시트, ORDER_SHEET_NAME은 주문관리입니다.
- 결제 전 A:B와 E:P에 주문을 미입금으로 기록하고, Q열에 카드결제, R열에 PortOne 결제 ID를 추가합니다. 기존 C:D 영역은 건드리지 않습니다.
- 결제 완료는 서버에서 PortOne 결제 ID, Store ID, 승인 상태, 금액, 카드 수단을 다시 확인한 뒤 기존 입금 상태 열을 입금완료로 바꿉니다.

## 남은 활성화 설정

Apps Script 프로젝트 설정 → 스크립트 속성 수정에서 PORTONE_API_SECRET을 직접 입력하고 저장하세요. 이 키는 채팅이나 GitHub에 올리지 마세요. 저장 후 웹앱 배포를 새 버전으로 업데이트하고 action=ping 응답이 ready인지 확인해야 합니다.

웹앱 주소는 랜딩페이지에 설정되어 있습니다. 배포는 소유자 계정으로 실행하고 액세스 권한은 모든 사용자로 설정해야 합니다. 실제 카드 결제는 실청구가 발생하므로, PG 실연동 심사 승인과 KCP 사이트 코드/채널 설정을 확인한 뒤 진행하세요.
