const PORTONE_CONFIG = {
  storeId: 'store-33be0510-ab4b-4791-8b5f-ebce201873cc',
  spreadsheetProperty: 'ORDER_SPREADSHEET_ID',
  apiSecretProperty: 'PORTONE_API_SECRET',
  sheetNameProperty: 'ORDER_SHEET_NAME',
  defaultSheetName: '주문관리',
  headerRow: 4,
  dataStartRow: 5,
  paymentMethodColumn: 17,
  paymentIdColumn: 18
};

const PRODUCT_CATALOG = {
  '두피샴푸 건성|300ml': 35000,
  '두피샴푸 건성|1000ml': 80000,
  '두피샴푸 지성|300ml': 35000,
  '두피샴푸 지성|1000ml': 83000,
  '두피팩 건성|300g': 45000,
  '두피팩 건성|1000g': 120000,
  '두피팩 지성|300g': 45000,
  '두피팩 지성|1000g': 120000,
  '스케일링 젤|150ml': 36000,
  '메르윈 리턴 클리닉 세트|200ml(g)': 180000
};

const CARD_HEADERS = ['결제방식', '포트원 결제 ID'];

function doGet(e) {
  const params = (e && e.parameter) || {};
  let result;
  try {
    if (params.action === 'ping') {
      result = { ok: isConfigured(), message: isConfigured() ? 'ready' : '설정이 필요합니다.' };
    } else if (params.action === 'status') {
      result = getOrderStatus_(params.paymentId);
    } else if (params.action === 'confirm') {
      result = verifyAndSave_(params.paymentId);
    } else {
      result = { ok: false, message: '지원하지 않는 요청입니다.' };
    }
  } catch (error) {
    result = { ok: false, message: safeMessage_(error) };
  }
  return respond_(result, params.callback);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'createPending') return jsonResponse_(createPending_(body));
    // 웹훅 내용만으로 결제를 완료 처리하지 않고, PortOne 결제 조회 API로 다시 확인합니다.
    const paymentId = body.paymentId || (body.data && body.data.paymentId);
    if (paymentId) return jsonResponse_(verifyAndSave_(paymentId));
    return jsonResponse_({ ok: false, message: '결제 ID가 없습니다.' });
  } catch (error) {
    return jsonResponse_({ ok: false, message: safeMessage_(error) });
  }
}

function createPending_(body) {
  assertConfigured_();
  validatePaymentId_(body.paymentId);
  const order = validateOrder_(body);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = orderSheet_();
    const existing = findOrderRow_(sheet, body.paymentId);
    if (existing) {
      const status = sheet.getRange(existing, 12).getDisplayValue();
      return { ok: true, status: status === '입금완료' ? 'PAID' : '결제대기', orderNo: sheet.getRange(existing, 2).getDisplayValue() };
    }
    const row = Math.max(PORTONE_CONFIG.dataStartRow, sheet.getLastRow() + 1);
    const fullAddress = '[' + order.buyer.postcode + '] ' + order.buyer.address;
    // C:D는 기존 시트의 빈/병합 영역이므로 건드리지 않고 A:B와 E:R만 기록합니다.
    sheet.getRange(row, 1, 1, 2).setValues([[
      new Date(), String(body.orderNo || '').slice(0, 40)
    ]]);
    sheet.getRange(row, 5, 1, 14).setValues([[
      order.summary, order.quantity, order.amount, order.buyer.name,
      order.buyer.phone, fullAddress, '', '미입금', '미신청',
      '배송전', '', '포트원 카드결제', '카드결제', body.paymentId
    ]]);
    return { ok: true, status: '결제대기', orderNo: body.orderNo };
  } finally {
    lock.releaseLock();
  }
}

function validateOrder_(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 20) throw new Error('주문 상품을 확인할 수 없습니다.');
  let amount = 0;
  let quantity = 0;
  const descriptions = [];
  items.forEach(item => {
    const key = String(item.name || '') + '|' + String(item.volume || '');
    const unitPrice = PRODUCT_CATALOG[key];
    const qty = Number(item.qty);
    if (!unitPrice || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('상품 또는 수량이 올바르지 않습니다.');
    amount += unitPrice * qty;
    quantity += qty;
    descriptions.push(`${item.name} ${item.volume} × ${qty}`);
  });
  if (Number(body.amount) !== amount) throw new Error('주문 금액이 상품 가격과 일치하지 않습니다.');
  const buyer = body.buyer || {};
  const name = String(buyer.name || '').trim();
  const phone = String(buyer.phone || '').replace(/\D/g, '');
  const postcode = String(buyer.postcode || '').trim();
  const address = String(buyer.address || '').trim();
  if (!name || name.length > 50 || !/^01[016789]\d{7,8}$/.test(phone) || !postcode || !address || address.length > 300) {
    throw new Error('주문자 정보나 배송지를 확인해주세요.');
  }
  return { amount, quantity, summary: descriptions.join(' / ').slice(0, 500), buyer: { name, phone, postcode, address } };
}

function verifyAndSave_(paymentId) {
  assertConfigured_();
  validatePaymentId_(paymentId);
  const sheet = orderSheet_();
  const row = findOrderRow_(sheet, paymentId);
  if (!row) return { ok: false, status: 'NOT_FOUND', message: '주문 기록이 없습니다. 다시 결제하지 말고 판매자에게 문의해주세요.' };
  const currentStatus = sheet.getRange(row, 12).getDisplayValue();
  if (currentStatus === '입금완료') return { ok: true, status: 'PAID', orderNo: sheet.getRange(row, 2).getDisplayValue() };

  const secret = PropertiesService.getScriptProperties().getProperty(PORTONE_CONFIG.apiSecretProperty);
  const url = 'https://api.portone.io/payments/' + encodeURIComponent(paymentId);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'PortOne ' + secret },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('포트원 결제 조회에 실패했습니다.');
  const payment = JSON.parse(response.getContentText());
  const expectedAmount = Number(sheet.getRange(row, 7).getValue());
  if (payment.id !== paymentId || payment.storeId !== PORTONE_CONFIG.storeId ||
      payment.status !== 'PAID' || Number(payment.amount && payment.amount.total) !== expectedAmount ||
      !payment.paymentMethod || payment.paymentMethod.type !== 'CARD') {
    return { ok: false, status: payment.status || 'UNVERIFIED', message: '결제 승인을 확인하지 못했습니다. 잠시 뒤 다시 확인해주세요.' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const freshRow = findOrderRow_(sheet, paymentId);
    if (!freshRow) throw new Error('주문 기록을 찾지 못했습니다.');
    sheet.getRange(freshRow, 12).setValue('입금완료');
    return { ok: true, status: 'PAID', orderNo: sheet.getRange(freshRow, 2).getDisplayValue() };
  } finally {
    lock.releaseLock();
  }
}

function getOrderStatus_(paymentId) {
  validatePaymentId_(paymentId);
  const sheet = orderSheet_();
  const row = findOrderRow_(sheet, paymentId);
  if (!row) return { ok: false, status: 'NOT_FOUND', message: '주문 준비가 완료되지 않았습니다.' };
  const storedStatus = sheet.getRange(row, 12).getDisplayValue();
  return { ok: true, status: storedStatus === '입금완료' ? 'PAID' : '결제대기', orderNo: sheet.getRange(row, 2).getDisplayValue() };
}

function orderSheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty(PORTONE_CONFIG.spreadsheetProperty);
  if (!spreadsheetId) throw new Error('주문관리 시트 ID 설정이 필요합니다.');
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const name = props.getProperty(PORTONE_CONFIG.sheetNameProperty) || PORTONE_CONFIG.defaultSheetName;
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('기존 주문관리 시트 탭을 찾을 수 없습니다.');
  const headerRange = sheet.getRange(PORTONE_CONFIG.headerRow, PORTONE_CONFIG.paymentMethodColumn, 1, CARD_HEADERS.length);
  const headers = headerRange.getDisplayValues()[0];
  if (headers[0] && headers[0] !== CARD_HEADERS[0]) throw new Error('Q4 결제방식 열에 다른 제목이 있어 확인이 필요합니다.');
  if (headers[1] && headers[1] !== CARD_HEADERS[1]) throw new Error('R4 포트원 결제 ID 열에 다른 제목이 있어 확인이 필요합니다.');
  if (!headers[0] || !headers[1]) headerRange.setValues([CARD_HEADERS]);
  return sheet;
}

function findOrderRow_(sheet, paymentId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < PORTONE_CONFIG.dataStartRow) return 0;
  const found = sheet.getRange(PORTONE_CONFIG.dataStartRow, PORTONE_CONFIG.paymentIdColumn, lastRow - PORTONE_CONFIG.dataStartRow + 1, 1).createTextFinder(paymentId).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function isConfigured() {
  const props = PropertiesService.getScriptProperties();
  return Boolean(props.getProperty(PORTONE_CONFIG.apiSecretProperty) && props.getProperty(PORTONE_CONFIG.spreadsheetProperty));
}

function assertConfigured_() {
  if (!isConfigured()) throw new Error('서버 결제 설정이 완료되지 않았습니다.');
}

function validatePaymentId_(paymentId) {
  if (!/^mdy-[a-f0-9-]{36}$/i.test(String(paymentId || ''))) throw new Error('결제 ID 형식이 올바르지 않습니다.');
}

function respond_(result, callback) {
  const json = JSON.stringify(result);
  if (callback && /^[A-Za-z_$][\w$]{0,80}$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse_(result);
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function safeMessage_(error) {
  return String(error && error.message || '처리 중 오류가 발생했습니다.').slice(0, 200);
}
