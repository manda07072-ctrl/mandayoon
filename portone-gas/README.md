# PortOne V2 카드 결제 서버

Apps Script 웹앱은 랜딩페이지에서 받은 주문을 기존 **만다윤 주문관리 시트**에 기록하고, PortOne 결제 조회 API로 승인 상태·금액·Store ID·카드 수단을 확인한 뒤에만 입금 완료로 처리합니다. API Secret은 공개 저장소에 저장하지 않습니다.

## 현재 배포 상태

- GitHub Pages 랜딩페이지와 Apps Script 웹앱이 연결되어 있습니다.
- 주문은 기존 주문관리 시트 탭에 기록됩니다. 기존 A:P 열 구조를 사용하고, 결제방식은 Q열, PortOne 결제 ID는 R열에 추가합니다. 기존 C:D 영역은 건드리지 않습니다.
- 서버는 action=ping 요청에 ready로 응답해야 결제를 시작합니다.
- 운영 Apps Script의 PORTONE_API_SECRET은 프로젝트 스크립트 속성에 설정합니다. 새 프로젝트를 만들 때만 이 속성을 직접 입력하세요.

## 새 환경을 설정할 때

1. 이 폴더의 Code.gs를 Apps Script 프로젝트에 복사합니다.
2. 프로젝트 설정의 스크립트 속성에 PORTONE_API_SECRET (PortOne V2 API Secret), ORDER_SPREADSHEET_ID (주문관리 스프레드시트 ID), ORDER_SHEET_NAME (주문관리)을 설정합니다.
3. 웹 앱으로 배포하고 실행 권한은 소유자, 액세스 권한은 모든 사용자로 설정합니다. 랜딩페이지 index.html의 backendUrl에 배포 URL을 넣습니다.
4. action=ping이 ready인지 확인하고 PortOne 콘솔에서 V2 실연동 웹훅을 설정합니다.

Secret은 결제 API에 접근할 수 있는 민감 정보입니다. 채팅이나 GitHub 저장소에 올리지 말고, Apps Script 스크립트 속성에만 저장하세요. 실제 카드 결제는 실청구가 발생하므로 PG 심사 승인을 확인한 뒤 진행하세요.
