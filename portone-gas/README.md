# 만다윤 주문·카드결제

옵션을 담은 뒤 카드결제/계좌입금을 선택하고 같은 주문 폼에서 진행합니다. 계좌입금 주문은 기존 서버, 카드 주문은 이 Apps Script 웹앱을 사용합니다.

## 카드 주문 기록

- 준비 요청은 숨겨진 `_카드결제대기` 탭에 보관합니다. 캐시는 저장 확인만 빠르게 처리하며 원본 주문은 시트에 먼저 기록합니다.
- PortOne 조회 API에서 `PAID`, 일치하는 결제 ID·Store ID·KRW 금액, `method.type === 'PaymentMethodCard'`를 확인한 뒤 기존 `주문관리` 탭에 `입금완료`로 기록합니다. 중복 알림도 같은 결제 ID로 한 번만 기록합니다.
- A:P 구조와 C:D 영역을 보존하고 Q열에는 카드결제, R열에는 PortOne 결제 ID를 기록합니다. 주문일시는 한국 시간과 `yyyy-mm-dd hh:mm` 형식입니다.
- 15분마다 `reconcileCardOrders`가 알림이 누락된 건을 재조회합니다. 조회 실패·불확실 건은 유지하며 7일 이상 지난 실패·미생성 건만 임시 영역에서 제거합니다. READY와 승인 기록은 자동 삭제하지 않습니다.
- `setupCheckout`은 기존 미입금 카드 행을 먼저 조회합니다. 승인된 행은 완료로 복구하고, 미완료 행은 임시 영역에 보관한 뒤 주문관리에서 제거합니다. 계좌입금 행은 유지합니다.

## 설정·배포

1. `Code.gs`를 복사하고 스크립트 속성에 `PORTONE_API_SECRET`, `ORDER_SPREADSHEET_ID`, `ORDER_SHEET_NAME=주문관리`를 저장합니다. Secret은 채팅·로그·공개 저장소에 기록하지 않습니다.
2. `setupCheckout`을 한 번 실행합니다. 한국 시간대, 날짜 형식, 임시 탭, 주기적 확인 트리거가 설정됩니다. 실제 승인/취소/환불 요청은 하지 않습니다.
3. 기존 웹 앱 배포를 새 버전으로 업데이트합니다. 소유자 계정으로 실행하고 모든 사용자 접근의 기존 권한을 유지합니다.
4. `?action=ping` 응답의 `ready`와 `version`을 확인합니다. 이는 배포 확인이며 실제 카드결제 성공을 뜻하지 않습니다.
5. 랜딩페이지 `backendUrl`과 `noticeUrls`는 이 웹 앱 URL을 사용합니다. 포트원 콘솔의 V2 실연동 웹훅에도 같은 주소를 등록할 수 있습니다.

카드 버튼 클릭 후 매번 ping을 기다리지 않습니다. `POST createPending → status 확인 → SDK 호출`로 진행하며 단계별 로딩·경과 시간과 중복 클릭 방지를 표시합니다. 승인 결과가 불확실하면 같은 결제 ID를 다시 조회합니다.

## 검증

`node --test tests/checkout.test.cjs`로 가격·금액, 승인 응답, 중복 처리, 실패·지연 승인, 기존 대기 행 복구와 날짜 설정을 검증합니다.

`node tests/browser-fixture.cjs`를 실행하고 `http://localhost:8765/?scenario=paid#order`에서 모의 화면을 확인합니다. paid, failed, slow, unknown, prepare-error를 지원하며 모든 결제·주문 요청을 가로채 실제로 전송하지 않습니다. `/mobile`은 390px iframe 화면입니다. 모의 검증과 실카드 검증은 구분합니다.
