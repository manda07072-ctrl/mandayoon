const PORTONE_CONFIG = {
  storeId: 'store-33be0510-ab4b-4791-8b5f-ebce201873cc',
  channelKey: 'channel-key-c4a0318c-6f6a-423d-853b-e90f9c5ac49d',
  defaultSheetName: '주문관리', pendingSheetName: '_카드결제대기',
  headerRow: 4, dataStartRow: 5, paymentIdColumn: 18,
  version: '2026-10-21-fast-checkout-v1'
};
const PRODUCT_CATALOG = {
  '두피샴푸 건성|300ml': 35000, '두피샴푸 건성|1000ml': 80000,
  '두피샴푸 지성|300ml': 35000, '두피샴푸 지성|1000ml': 83000,
  '두피팩 건성|300g': 45000, '두피팩 건성|1000g': 120000,
  '두피팩 지성|300g': 45000, '두피팩 지성|1000g': 120000,
  '스케일링 젤|150ml': 36000, '메르윈 리턴 클리닉 세트|200ml(g)': 180000
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  let result;
  try {
    if (p.action === 'ping') result = { ok: isConfigured(), message: isConfigured() ? 'ready' : '설정이 필요합니다.', version: PORTONE_CONFIG.version };
    else if (p.action === 'status') result = getOrderStatus_(p.paymentId);
    else if (p.action === 'confirm') result = verifyAndSave_(p.paymentId);
    else result = { ok: false, message: '지원하지 않는 요청입니다.' };
  } catch (error) { result = { ok: false, message: safeMessage_(error) }; }
  return respond_(result, p.callback);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'externalVerify' || body.action === 'externalSync') return jsonResponse_(externalCheckout_(body));
    if (body.action === 'createPending') return jsonResponse_(createPending_(body));
    const paymentId = body.paymentId || (body.data && body.data.paymentId);
    return jsonResponse_(paymentId ? verifyAndSave_(paymentId) : { ok: false, message: '결제 ID가 없습니다.' });
  } catch (error) { return jsonResponse_({ ok: false, message: safeMessage_(error) }); }
}

function isConfigured() {
  const p = PropertiesService.getScriptProperties();
  return Boolean(p.getProperty('PORTONE_API_SECRET') && p.getProperty('ORDER_SPREADSHEET_ID'));
}
function assertConfigured_() { if (!isConfigured()) throw new Error('서버 결제 설정이 완료되지 않았습니다.'); }
function validatePaymentId_(id) { if (!/^mdy-[a-f0-9-]{36}$/i.test(String(id || ''))) throw new Error('결제 ID 형식이 올바르지 않습니다.'); }
function spreadsheet_() {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('ORDER_SPREADSHEET_ID'));
}
function orderSheet_(ss) {
  const name = PropertiesService.getScriptProperties().getProperty('ORDER_SHEET_NAME') || PORTONE_CONFIG.defaultSheetName;
  const sheet = (ss || spreadsheet_()).getSheetByName(name);
  if (!sheet) throw new Error('기존 주문관리 시트 탭을 찾을 수 없습니다.');
  return sheet;
}
function pendingSheet_(ss) {
  const sheet = (ss || spreadsheet_()).getSheetByName(PORTONE_CONFIG.pendingSheetName);
  if (!sheet) throw new Error('카드결제 준비 설정이 필요합니다.');
  return sheet;
}
function findRow_(sheet, id, column, start) {
  const count = sheet.getLastRow() - start + 1;
  if (count <= 0) return 0;
  const found = sheet.getRange(start, column, count, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}
function pendingRecord_(sheet, id) {
  const row = findRow_(sheet, id, 2, 2);
  return row ? { row, order: JSON.parse(sheet.getRange(row, 4).getValue()), state: sheet.getRange(row, 5).getValue() } : null;
}
function cacheStatus_(id, status, orderNo) {
  // Cache is only an acknowledgement accelerator; the durable record is written first.
  CacheService.getScriptCache().put('checkout:' + id, JSON.stringify({ ok: true, status, orderNo }), 600);
}
function validateOrder_(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 20) throw new Error('주문 상품을 확인할 수 없습니다.');
  let amount = 0, quantity = 0;
  const descriptions = [];
  items.forEach(item => {
    const price = PRODUCT_CATALOG[String(item.name || '') + '|' + String(item.volume || '')];
    const qty = Number(item.qty);
    if (!price || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('상품 또는 수량이 올바르지 않습니다.');
    amount += price * qty; quantity += qty;
    descriptions.push(`${item.name} ${item.volume} × ${qty}`);
  });
  if (Number(body.amount) !== amount) throw new Error('주문 금액이 상품 가격과 일치하지 않습니다.');
  const b = body.buyer || {};
  const buyer = { name: String(b.name || '').trim(), phone: String(b.phone || '').replace(/\D/g, ''), postcode: String(b.postcode || '').trim(), address: String(b.address || '').trim() };
  if (!buyer.name || buyer.name.length > 50 || !/^01[016789]\d{7,8}$/.test(buyer.phone) || !/^\d{5}$/.test(buyer.postcode) || !buyer.address || buyer.address.length > 300) throw new Error('주문자 정보나 배송지를 확인해주세요.');
  return { amount, quantity, summary: descriptions.join(' / '), buyer };
}
function createPending_(body) {
  assertConfigured_(); validatePaymentId_(body.paymentId);
  const order = validateOrder_(body);
  if (!/^MDY-\d{8}-[a-f0-9]{8}$/i.test(String(body.orderNo || ''))) throw new Error('주문번호 형식이 올바르지 않습니다.');
  order.orderNo = body.orderNo; order.createdAt = new Date().toISOString();
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = pendingSheet_();
    const previous = pendingRecord_(sheet, body.paymentId);
    if (previous) {
      // An existing payment ID must never be overwritten by a second request.
      if (JSON.stringify(previous.order.buyer) !== JSON.stringify(order.buyer) || previous.order.amount !== order.amount || previous.order.summary !== order.summary) throw new Error('다른 주문에 사용된 결제 ID입니다.');
      return { ok: true, status: previous.state === 'PAID' ? 'PAID' : '결제대기', orderNo: previous.order.orderNo };
    }
    sheet.appendRow([new Date(order.createdAt), body.paymentId, order.orderNo, JSON.stringify(order), 'OPEN', '']);
    SpreadsheetApp.flush();
    cacheStatus_(body.paymentId, '결제대기', order.orderNo);
    return { ok: true, status: '결제대기', orderNo: order.orderNo };
  } finally { lock.releaseLock(); }
}
function getOrderStatus_(id) {
  assertConfigured_(); validatePaymentId_(id);
  const cached = CacheService.getScriptCache().get('checkout:' + id);
  if (cached) return JSON.parse(cached);
  const pending = pendingRecord_(pendingSheet_(), id);
  if (pending) return { ok: true, status: pending.state === 'PAID' ? 'PAID' : '결제대기', orderNo: pending.order.orderNo };
  return { ok: false, status: 'NOT_FOUND', message: '주문 준비가 완료되지 않았습니다. 잠시 후 다시 시도해주세요.' };
}
function fetchPayment_(id) {
  const secret = PropertiesService.getScriptProperties().getProperty('PORTONE_API_SECRET');
  const response = UrlFetchApp.fetch('https://api.portone.io/payments/' + encodeURIComponent(id) + '?storeId=' + encodeURIComponent(PORTONE_CONFIG.storeId), {
    method: 'get', headers: { Authorization: 'PortOne ' + secret }, muteHttpExceptions: true
  });
  if (response.getResponseCode() === 404) return { status: 'NOT_FOUND' };
  if (response.getResponseCode() !== 200) throw new Error('포트원 결제 조회에 실패했습니다. 주문 정보는 보관되어 있습니다.');
  return JSON.parse(response.getContentText());
}
function assertPaid_(payment, id, expectedAmount) {
  if (payment.id !== id || payment.storeId !== PORTONE_CONFIG.storeId || payment.status !== 'PAID' ||
      !payment.channel || payment.channel.key !== PORTONE_CONFIG.channelKey || payment.channel.type !== 'LIVE' ||
      payment.currency !== 'KRW' || Number(payment.amount && payment.amount.total) !== expectedAmount ||
      !payment.method || payment.method.type !== 'PaymentMethodCard') throw new Error('결제 정보가 주문 내용과 일치하지 않습니다. 판매자에게 문의해주세요.');
}
function safeCell_(s) { return /^[=+\-@]/.test(String(s)) ? "'" + s : String(s); }
function appendPaidOrder_(sheet, id, order) {
  const row = Math.max(PORTONE_CONFIG.dataStartRow, sheet.getLastRow() + 1);
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);
  sheet.getRange(row, 1, 1, 2).setValues([[new Date(order.createdAt), safeCell_(order.orderNo)]]);
  // Preserve C:D and all existing bank-transfer columns/validations.
  sheet.getRange(row, 5, 1, 14).setValues([[
    safeCell_(order.summary), order.quantity, order.amount, safeCell_(order.buyer.name),
    safeCell_(order.buyer.phone), safeCell_((order.buyer.postcode ? '[' + order.buyer.postcode + '] ' : '') + order.buyer.address),
    '', '입금완료', '미신청', '배송전', '', '포트원 카드결제', '카드결제', id
  ]]);
  sheet.getRange(row, 1).setNumberFormat('yyyy-mm-dd hh:mm');
}
function verifyAndSave_(id) {
  assertConfigured_(); validatePaymentId_(id);
  const payment = fetchPayment_(id); // Never trust a client callback/webhook as proof of payment.
  if (payment.status !== 'PAID') return { ok: false, status: payment.status, message: ['FAILED', 'CANCELLED', 'NOT_FOUND'].indexOf(payment.status) >= 0 ? '결제가 완료되지 않았습니다. 주문으로 접수되지 않았습니다.' : '결제 승인 확인 중입니다. 다시 결제하지 말고 잠시 후 확인해주세요.' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const ss = spreadsheet_(), sheet = orderSheet_(ss), queue = pendingSheet_(ss);
    const row = findRow_(sheet, id, PORTONE_CONFIG.paymentIdColumn, PORTONE_CONFIG.dataStartRow);
    const pending = pendingRecord_(queue, id);
    if (!pending && !row) return { ok: false, status: 'REVIEW_REQUIRED', message: '결제는 승인되었으나 주문 확인이 필요합니다. 다시 결제하지 말고 판매자에게 문의해주세요.' };
    const expected = pending ? pending.order.amount : Number(sheet.getRange(row, 7).getValue());
    assertPaid_(payment, id, expected);
    let orderNo;
    if (row) { sheet.getRange(row, 12).setValue('입금완료'); orderNo = sheet.getRange(row, 2).getDisplayValue(); }
    else { appendPaidOrder_(sheet, id, pending.order); orderNo = pending.order.orderNo; }
    if (pending) queue.getRange(pending.row, 5, 1, 2).setValues([['PAID', new Date()]]);
    SpreadsheetApp.flush(); cacheStatus_(id, 'PAID', orderNo);
    return { ok: true, status: 'PAID', orderNo };
  } finally { lock.releaseLock(); }
}

// Run once after deployment. Does not create, charge, cancel or refund a payment.
function setupCheckout() {
  assertConfigured_();
  const ss = spreadsheet_(), sheet = orderSheet_(ss);
  ss.setSpreadsheetTimeZone('Asia/Seoul');
  const headers = sheet.getRange(4, 17, 1, 2).getDisplayValues()[0];
  if ((headers[0] && headers[0] !== '결제방식') || (headers[1] && headers[1] !== '포트원 결제 ID')) throw new Error('Q:R 기존 제목을 확인해주세요.');
  sheet.getRange(4, 17, 1, 2).setValues([['결제방식', '포트원 결제 ID']]);
  sheet.getRange(5, 1, sheet.getMaxRows() - 4, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  let queue = ss.getSheetByName(PORTONE_CONFIG.pendingSheetName);
  if (!queue) {
    queue = ss.insertSheet(PORTONE_CONFIG.pendingSheetName);
    queue.appendRow(['준비일시', '결제 ID', '주문번호', '주문정보', '상태', '확인일시']);
    queue.setFrozenRows(1); queue.hideSheet();
  }
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'reconcileCardOrders')) ScriptApp.newTrigger('reconcileCardOrders').timeBased().everyMinutes(15).create();
  const result = migrateLegacyPending_();
  console.log(JSON.stringify({ version: PORTONE_CONFIG.version, migrated: result }));
}
function migrateLegacyPending_() {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  let migrated = 0;
  try {
    const ss = spreadsheet_(), sheet = orderSheet_(ss), queue = pendingSheet_(ss);
    const count = sheet.getLastRow() - 4;
    if (count <= 0) return 0;
    const rows = sheet.getRange(5, 1, count, 18).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = rows[i];
      if (v[16] !== '카드결제' || v[11] !== '미입금' || !/^mdy-[a-f0-9-]{36}$/i.test(v[17])) continue;
      let payment;
      try { payment = fetchPayment_(v[17]); } catch (error) { continue; } // Keep unresolved rows.
      if (payment.status === 'PAID') {
        try {
          assertPaid_(payment, v[17], Number(v[6]));
          sheet.getRange(i + 5, 12).setValue('입금완료');
          if (payment.requestedAt) sheet.getRange(i + 5, 1).setValue(new Date(payment.requestedAt)).setNumberFormat('yyyy-mm-dd hh:mm');
        } catch (error) { continue; }
      } else if (['READY', 'FAILED', 'NOT_FOUND'].indexOf(payment.status) >= 0) {
        if (!pendingRecord_(queue, v[17])) {
          const order = { createdAt: new Date().toISOString(), orderNo: String(v[1]), summary: String(v[4]), quantity: Number(v[5]), amount: Number(v[6]), buyer: { name: String(v[7]), phone: String(v[8]), postcode: '', address: String(v[9]) } };
          queue.appendRow([new Date(), v[17], v[1], JSON.stringify(order), 'OPEN', '']);
          SpreadsheetApp.flush();
        }
        sheet.deleteRow(i + 5); migrated++;
      }
    }
    return migrated;
  } finally { lock.releaseLock(); }
}
function reconcileCardOrders() {
  // Wake durable recovery outside this Apps Script request. No new checkout waits for Google.
  try { UrlFetchApp.fetch('https://mandayoon-checkout-api.dilec.chatgpt.site/recover', {
    method: 'post', contentType: 'application/json', payload: '{}', muteHttpExceptions: true
  }); } catch (error) { /* Retry at the next existing 15-minute trigger. */ }
  // Retain uncertain/in-flight records. Retry paid webhooks that were delayed/lost.
  const queue = pendingSheet_(), last = queue.getLastRow();
  if (last < 2) return;
  const rows = queue.getRange(2, 1, last - 1, 6).getValues().sort((a, b) => new Date(a[5] || a[0]).getTime() - new Date(b[5] || b[0]).getTime());
  let checked = 0;
  for (let i = 0; i < rows.length && checked < 20; i++) {
    const age = Date.now() - new Date(rows[i][0]).getTime();
    if (rows[i][4] !== 'OPEN' || age < 5 * 60000) continue;
    checked++;
    try {
      const result = verifyAndSave_(rows[i][1]);
      if (result.status !== 'PAID') {
        const row = findRow_(queue, rows[i][1], 2, 2);
        if (row) queue.getRange(row, 6).setValue(new Date());
      }
      // Only terminal failures / never-created payments older than seven days may be removed.
      if (age > 7 * 86400000 && ['FAILED', 'NOT_FOUND'].indexOf(result.status) >= 0) {
        const lock = LockService.getScriptLock(); lock.waitLock(10000);
        try { const row = findRow_(queue, rows[i][1], 2, 2); if (row) queue.deleteRow(row); }
        finally { lock.releaseLock(); }
      }
    } catch (error) { /* Leave the durable order intact for the next reconciliation. */ }
  }
  migrateLegacyPending_();
}
function respond_(result, callback) {
  if (callback && /^[A-Za-z_$][\w$]{0,80}$/.test(callback)) return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return jsonResponse_(result);
}
function jsonResponse_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function safeMessage_(error) { return String(error && error.message || '처리 중 오류가 발생했습니다.').slice(0, 200); }

function externalCheckout_(body) {
  assertConfigured_();
  if (typeof body.payload !== 'string' || body.payload.length > 16000) throw new Error('주문 서버 인증에 실패했습니다.');
  // Authenticate against the fixed trusted server and its immutable durable order.
  // The server's signing secret never needs to be copied into Apps Script.
  const envelope = UrlFetchApp.fetch('https://mandayoon-checkout-api.dilec.chatgpt.site/internal/verify-envelope', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (envelope.getResponseCode() !== 200 || JSON.parse(envelope.getContentText()).ok !== true) throw new Error('주문 서버 인증에 실패했습니다.');
  const payload = JSON.parse(body.payload); validatePaymentId_(payload.paymentId);
  const order = validateOrder_(payload);
  if (!/^MDY-\d{8}-[a-f0-9]{8}$/i.test(String(payload.orderNo || '')) || !Number.isFinite(Date.parse(payload.createdAt))) throw new Error('주문 정보가 올바르지 않습니다.');
  order.orderNo = payload.orderNo; order.createdAt = payload.createdAt;
  const payment = fetchPayment_(payload.paymentId);
  if (payment.status !== 'PAID') return { ok: false, status: payment.status };
  assertPaid_(payment, payload.paymentId, order.amount);
  if (body.action === 'externalVerify') return { ok: true, status: 'PAID', orderNo: order.orderNo };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = orderSheet_();
    const row = findRow_(sheet, payload.paymentId, PORTONE_CONFIG.paymentIdColumn, PORTONE_CONFIG.dataStartRow);
    if (!row) appendPaidOrder_(sheet, payload.paymentId, order);
    SpreadsheetApp.flush();
    return { ok: true, status: 'PAID', orderNo: order.orderNo };
  } finally { lock.releaseLock(); }
}

// Removes only the five explicitly identified synthetic timing samples, never customer orders.
function cleanupCheckoutTimingSamples() {
  const ids = ['mdy-473ba6c3-2f9e-4423-b5f5-f1135f8d3d11','mdy-f16d44de-4bbe-4e48-b7aa-f99f915c9a56','mdy-33900e15-c787-4636-9b83-8f6553f0dcd3','mdy-43a793be-f322-4e3a-a587-faad8df680fb','mdy-bd4c5610-bdb1-469b-a44b-dffcebec3a0e'];
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = pendingSheet_(); let removed = 0;
    ids.forEach(id => {
      const found = pendingRecord_(sheet, id);
      if (found && found.state === 'OPEN' && found.order.buyer.name === '속도측정 전용' && found.order.buyer.address === '속도 측정용 가상 주소') { sheet.deleteRow(found.row); removed++; }
    });
    console.log(JSON.stringify({timingSamplesRemoved:removed}));
  } finally { lock.releaseLock(); }
}
