// ============================================================
// 福山市若松町内会 – Google Apps Script バックエンド
// ============================================================

var LEDGER_SPREADSHEET_NAME = "福山市若松町内会_管理台帳";
var LEDGER_SPREADSHEET_ID = "";
var TOWN_CALENDAR_ID = "replace-with-your-town-calendar-id@group.calendar.google.com";
var EQUIPMENT_CALENDAR_ID = "replace-with-your-equipment-calendar-id@group.calendar.google.com";
var GALLERY_FOLDER_ID = "1uSlpwLAFa1gbBrD18Mn_apKyZ6dhAlcw";
var GALLERY_SHARED_FOLDER_ID = "1uSlpwLAFa1gbBrD18Mn_apKyZ6dhAlcw";
var GALLERY_ARCHIVE_FOLDER_ID = "18SHRujU2DtAe0Fdao_Lt6WWpCM53ICE3";
var PHOTO_ARCHIVE_DAYS = 365;
var INFORMATION_PHOTO_FOLDER_PATH = ["台帳関係", "情報写真"];
var INFORMATION_PHOTO_CATEGORY = "情報写真";
var API_BUILD = "2026-06-18-post-enabled";
var JSON_CACHE_TTL_SECONDS = 1500;
var EVENT_JSON_CACHE_KEYS = {
  schedule: "schedule_events_json",
  entry: "entry_events_json"
};
var SCRIPT_CACHE_MAX_BYTES = 100000;
var SCRIPT_CACHE_SAFE_BYTES = 95000;

var LEDGER_HEADERS = {
  "役員_会員台帳": [
    "ユーザーID(メール等)",
    "PIN(4桁数字)",
    "氏名",
    "役職(役員/一般)"
  ],
  "掲示板(意見交換)": [
    "投稿ID",
    "日時",
    "名前",
    "カテゴリ",
    "内容",
    "返信状態",
    "管理ステータス"
  ],
  "備品予約": [
    "予約ID",
    "カレンダー予定ID",
    "備品名",
    "数量",
    "貸出日",
    "返納日",
    "申請者",
    "ステータス"
  ],
  "備品台帳": [
    "備品ID",
    "備品名",
    "総在庫数",
    "保管場所",
    "状態(良好/要修理等)",
    "備考"
  ],
  "写真メタデータ": [
    "写真ID",
    "ドライブのファイルID",
    "画像URL",
    "投稿日",
    "投稿者氏名",
    "コメント/説明",
    "アルバム名/カテゴリ",
    "ファイル名",
    "保管状態",
    "アーカイブ日時"
  ],
  "町内行事予定": [
    "イベントID",
    "カレンダー予定ID",
    "開始日時",
    "終了日時",
    "タイトル",
    "企画者",
    "場所",
    "説明"
  ],
  "イベント企画": [
    "イベントID",
    "カレンダー予定ID",
    "開始日時",
    "終了日時",
    "タイトル",
    "企画者",
    "場所",
    "最少人数",
    "最大人数",
    "説明"
  ],
  "イベント参加": [
    "申込ID",
    "イベントID",
    "参加者名",
    "連絡先",
    "登録日時"
  ],
  "文書メタデータ": [
    "文書ID",
    "ドライブのファイルID",
    "文書URL",
    "投稿日",
    "投稿者氏名",
    "カテゴリ",
    "タイトル",
    "保存先"
  ]
};

var SHEET_NAME_ALIASES = {
  "掲示板(意見交換": "掲示板(意見交換)",
  "イベント管理": "イベント企画",
  "イベント管理Sheet": "イベント企画",
  "イベント管理シート": "イベント企画",
  "町内会カレンダー": "町内行事予定",
  "町内行事カレンダー": "町内行事予定",
  "イベント参加者": "イベント参加"
};

// ============================================================
// doGet
// ============================================================
function doGet(e) {
  try {
    ensureLedgerStructure_();
    var action = (e && e.parameter && (e.parameter.action || e.parameter.type)) || "";

    switch (action) {
      case "health":
        return jsonResponse_({
          ok: true,
          action: action,
          data: {
            build: API_BUILD,
            method: "GET",
            hasDoPost: true,
            supportedGet: ["health","login","getOpinions","getEvents","getTownEvents","getScheduleEvents","getEntryEvents","calendar_events","getGallery","getEquipment","equipment_status"],
            supportedPost: [
              "health","login","addOpinion","addTownEvent","updateTownEvent","deleteTownEvent",
              "addEvent","addRecurringEvent","joinEvent","registerEventEntry","createUserEvent",
              "reserveEquipment","uploadPhoto","createPhotoFolder","addPeople","addEquipmentMaster",
              "uploadDocument"
            ]
          }
        });
      case "login":
        return jsonResponse_({ ok: true, action: action, data: login_(e.parameter || {}) });
      case "getOpinions":
        return jsonResponse_({ ok: true, action: action, data: getOpinions_() });
      case "getEvents":
        return jsonResponse_({ ok: true, action: action, data: getEvents_() });
      case "getTownEvents":
        return jsonResponse_({ ok: true, action: action, data: getTownEvents_() });
      case "getScheduleEvents":
        return jsonResponse_({ ok: true, action: action, data: getScheduleEvents() });
      case "getEntryEvents":
        return jsonResponse_({ ok: true, action: action, data: getEntryEvents() });
      case "calendar_events":
        return jsonResponse_({ ok: true, action: action, data: getScheduleEvents() });
      case "getGallery":
        return jsonResponse_({ ok: true, action: action, data: getGallery_() });
      case "getEquipment":
        return jsonResponse_({ ok: true, action: action, data: getEquipment_() });
      case "equipment_status":
        return jsonResponse_({ ok: true, action: action, data: getEquipmentStatusForFrontend_() });
      default:
        return jsonResponse_({
          ok: false,
          error: "未対応のactionです。",
          receivedAction: action,
          supportedActions: ["login","getOpinions","getEvents","getTownEvents","getScheduleEvents","getEntryEvents","calendar_events","getGallery","getEquipment","equipment_status"]
        });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message || err) });
  }
}

// ============================================================
// doPost
// ============================================================
function doPost(e) {
  try {
    ensureLedgerStructure_();
    var body = parsePostJson_(e);
    var action = body.action || "";

    switch (action) {
      case "health":
        return jsonResponse_({
          ok: true,
          action: action,
          data: {
            build: API_BUILD,
            method: "POST",
            hasDoPost: true
          }
        });
      case "login":
        return jsonResponse_({ ok: true, action: action, data: login_(body) });
      case "addOpinion":
        return jsonResponse_({ ok: true, action: action, data: addOpinion_(body) });
      case "addTownEvent":
        return jsonResponse_({ ok: true, action: action, data: addTownEvent_(body) });
      case "updateTownEvent":
        return jsonResponse_({ ok: true, action: action, data: updateTownEvent_(body) });
      case "deleteTownEvent":
        return jsonResponse_({ ok: true, action: action, data: deleteTownEvent_(body) });
      case "addEvent":
        return jsonResponse_({ ok: true, action: action, data: addEvent_(body) });
      case "addRecurringEvent":
        return jsonResponse_({ ok: true, action: action, data: addRecurringEvent_(body) });
      case "joinEvent":
        return jsonResponse_({ ok: true, action: action, data: registerEventEntry(body.eventId, body) });
      case "registerEventEntry":
        return jsonResponse_({ ok: true, action: action, data: registerEventEntry(body.eventId, body) });
      case "createUserEvent":
        return jsonResponse_({ ok: true, action: action, data: createUserEvent(body) });
      case "reserveEquipment":
        return jsonResponse_({ ok: true, action: action, data: reserveEquipment_(body) });
      case "uploadPhoto":
        return jsonResponse_({ ok: true, action: action, data: uploadPhoto_(body) });
      case "createPhotoFolder":
        return jsonResponse_({ ok: true, action: action, data: createPhotoFolder_(body) });
      case "addPeople":
        return jsonResponse_({ ok: true, action: action, data: addPeople_(body) });
      case "addEquipmentMaster":
        return jsonResponse_({ ok: true, action: action, data: addEquipmentMaster_(body) });
      case "uploadDocument":
        return jsonResponse_({ ok: true, action: action, data: uploadDocument_(body) });
      default:
        return jsonResponse_({
          ok: false,
          error: "未対応のactionです。",
          receivedAction: action,
          supportedActions: [
            "login","addOpinion","addTownEvent","updateTownEvent","deleteTownEvent",
            "addEvent","addRecurringEvent","joinEvent",
            "reserveEquipment","uploadPhoto","createPhotoFolder","addPeople","addEquipmentMaster",
            "uploadDocument"
          ]
        });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message || err) });
  }
}

// ============================================================
// 手動実行: ヘッダー強制初期化
// ============================================================
function fixAndInitializeSheets() {
  var spreadsheet = getLedgerSpreadsheet();
  var results = [];

  Object.keys(LEDGER_HEADERS).forEach(function(sheetName) {
    var headers = LEDGER_HEADERS[sheetName];
    var sheet = getOrCreateSheet_(spreadsheet, sheetName);
    ensureColumnCount_(sheet, headers.length);
    sheet.getRange(1, 1, 1, sheet.getMaxColumns()).clearContent();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    results.push(sheetName + ": " + headers.length + "列を初期化");
  });

  Logger.log("fixAndInitializeSheets completed: " + results.join(" / "));
}

function getLedgerSpreadsheet() {
  if (LEDGER_SPREADSHEET_ID && String(LEDGER_SPREADSHEET_ID).trim()) {
    try {
      return SpreadsheetApp.openById(String(LEDGER_SPREADSHEET_ID).trim());
    } catch (err) {
      Logger.log("getLedgerSpreadsheet openById failed, fallback to name. " + String(err && err.message || err));
    }
  }
  return openSpreadsheetByName_(LEDGER_SPREADSHEET_NAME);
}

function logJsonCacheError_(label, err) {
  Logger.log(label + ": " + String(err && err.message || err));
}

function safeParseJson_(text) {
  if (!text) { return null; }
  try {
    return JSON.parse(String(text));
  } catch (err) {
    return null;
  }
}

function readJsonCache_(cacheKey) {
  var cache = CacheService.getScriptCache().get(cacheKey);
  var parsed = safeParseJson_(cache);
  return parsed !== null ? parsed : null;
}

function writeJsonCache_(cacheKey, value) {
  var json = JSON.stringify(Array.isArray(value) ? value : []);
  var jsonBytes = Utilities.newBlob(json).getBytes().length;

  if (jsonBytes > SCRIPT_CACHE_MAX_BYTES) {
    logJsonCacheError_("writeJsonCache_ payload too large for ScriptCache key=" + cacheKey + " bytes=" + jsonBytes, new Error("cache payload size over limit"));
    invalidateJsonCache_(cacheKey);
    return JSON.parse(json);
  }

  if (jsonBytes > SCRIPT_CACHE_SAFE_BYTES) {
    Logger.log("writeJsonCache_ payload near limit. key=" + cacheKey + " bytes=" + jsonBytes);
  }

  try {
    CacheService.getScriptCache().put(cacheKey, json, JSON_CACHE_TTL_SECONDS);
  } catch (err) {
    logJsonCacheError_("writeJsonCache_ cache put failed for " + cacheKey + " bytes=" + jsonBytes, err);
  }
  return JSON.parse(json);
}

function invalidateJsonCache_(cacheKey) {
  try {
    CacheService.getScriptCache().remove(cacheKey);
  } catch (err) {
    logJsonCacheError_("invalidateJsonCache_ failed for " + cacheKey, err);
  }
}

function invalidateEventJsonCaches_() {
  invalidateJsonCache_(EVENT_JSON_CACHE_KEYS.schedule);
  invalidateJsonCache_(EVENT_JSON_CACHE_KEYS.entry);
}

function formatTimeRange_(start, end) {
  if (!start) { return ""; }
  var pad = function(n) { return String(n).padStart(2, "0"); };
  var startText = pad(start.getHours()) + ":" + pad(start.getMinutes());
  if (!end) { return startText; }
  var endText = pad(end.getHours()) + ":" + pad(end.getMinutes());
  return startText === endText ? startText : startText + "-" + endText;
}

function buildScheduleEventsJson_() {
  var spreadsheet = getLedgerSpreadsheet();
  var rows = readSheetAsObjects_("町内行事予定", spreadsheet);
  var updatedAt = nowIso_();

  return rows.map(function(row, index) {
    var start = parseDateOrNull_(row["開始日時"]);
    if (!start) { return null; }
    var end = parseDateOrNull_(row["終了日時"]);
    return {
      id: String(row["イベントID"] || "TC-" + index),
      date: toDate_(start),
      title: String(row["タイトル"] || ""),
      time: formatTimeRange_(start, end),
      place: String(row["場所"] || ""),
      note: String(row["説明"] || ""),
      category: "町内行事",
      updatedAt: updatedAt
    };
  }).filter(function(item) { return !!item && !!item.date; });
}

function buildEntryEventsJson_() {
  var spreadsheet = getLedgerSpreadsheet();
  var events = readSheetAsObjects_("イベント企画", spreadsheet);
  var participants = readSheetAsObjects_("イベント参加", spreadsheet);
  var updatedAt = nowIso_();

  var participantCountByEvent = {};
  participants.forEach(function(entry) {
    var key = String(entry["イベントID"] || "").trim();
    if (!key) { return; }
    participantCountByEvent[key] = (participantCountByEvent[key] || 0) + 1;
  });

  return events.map(function(row, index) {
    var start = parseDateOrNull_(row["開始日時"]);
    if (!start) { return null; }
    var end = parseDateOrNull_(row["終了日時"]);
    var eventId = String(row["イベントID"] || "EV-" + index);
    var capacity = Number(row["最大人数"] || 0);
    var currentCount = participantCountByEvent[eventId] || 0;
    var deadline = toIso_(start);
    var closed = start.getTime() <= new Date().getTime() || (capacity > 0 && currentCount >= capacity);

    return {
      eventId: eventId,
      date: toDate_(start),
      title: String(row["タイトル"] || ""),
      time: formatTimeRange_(start, end),
      place: String(row["場所"] || ""),
      description: String(row["説明"] || ""),
      capacity: capacity,
      currentCount: currentCount,
      entryEnabled: !closed,
      deadline: deadline,
      status: closed ? "closed" : "open",
      updatedAt: updatedAt
    };
  }).filter(function(item) { return !!item && !!item.date; });
}

function rebuildScheduleEventsJson() {
  var payload = buildScheduleEventsJson_();
  return writeJsonCache_(EVENT_JSON_CACHE_KEYS.schedule, payload);
}

function rebuildEntryEventsJson() {
  var payload = buildEntryEventsJson_();
  return writeJsonCache_(EVENT_JSON_CACHE_KEYS.entry, payload);
}

function getScheduleEvents() {
  var cached = readJsonCache_(EVENT_JSON_CACHE_KEYS.schedule);
  if (cached !== null) { return Array.isArray(cached) ? cached : []; }

  try {
    return rebuildScheduleEventsJson();
  } catch (err) {
    logJsonCacheError_("getScheduleEvents rebuild failed", err);
    var fallback = readJsonCache_(EVENT_JSON_CACHE_KEYS.schedule);
    return Array.isArray(fallback) ? fallback : [];
  }
}

function getEntryEvents() {
  var cached = readJsonCache_(EVENT_JSON_CACHE_KEYS.entry);
  if (cached !== null) { return Array.isArray(cached) ? cached : []; }

  try {
    return rebuildEntryEventsJson();
  } catch (err) {
    logJsonCacheError_("getEntryEvents rebuild failed", err);
    var fallback = readJsonCache_(EVENT_JSON_CACHE_KEYS.entry);
    return Array.isArray(fallback) ? fallback : [];
  }
}

function refreshScheduleEventsCache_() {
  try {
    invalidateJsonCache_(EVENT_JSON_CACHE_KEYS.schedule);
    return true;
  } catch (err) {
    logJsonCacheError_("refreshScheduleEventsCache_", err);
    return false;
  }
}

function refreshEntryEventsCache_() {
  try {
    invalidateJsonCache_(EVENT_JSON_CACHE_KEYS.entry);
    return true;
  } catch (err) {
    logJsonCacheError_("refreshEntryEventsCache_", err);
    return false;
  }
}

function scheduleJsonToLegacyTownEvent_(event, index) {
  var startText = String(event && event.date || "");
  var timeText = String(event && event.time || "");
  var start = startText ? new Date(startText + "T00:00:00") : null;
  if (start && timeText) {
    var timeMatch = timeText.match(/^(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      start.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
    }
  }

  return {
    eventId: String(event && event.id || "EV-" + index),
    title: String(event && event.title || ""),
    start: start ? toIso_(start) : "",
    end: "",
    place: String(event && event.place || ""),
    description: String(event && event.note || ""),
    category: String(event && event.category || "町内行事"),
    updatedAt: String(event && event.updatedAt || "")
  };
}

function entryJsonToLegacyEvent_(event, index) {
  var startText = String(event && event.date || "");
  var timeText = String(event && event.time || "");
  var start = startText ? new Date(startText + "T00:00:00") : null;
  var end = null;
  if (start && timeText) {
    var timeParts = timeText.split(/\s*[-〜~]\s*/);
    var startMatch = timeParts[0] && timeParts[0].match(/^(\d{1,2}):(\d{2})/);
    if (startMatch) {
      start.setHours(Number(startMatch[1]), Number(startMatch[2]), 0, 0);
    }
    if (timeParts[1]) {
      var endMatch = timeParts[1].match(/^(\d{1,2}):(\d{2})/);
      if (endMatch) {
        end = new Date(start.getTime());
        end.setHours(Number(endMatch[1]), Number(endMatch[2]), 0, 0);
      }
    }
  }

  var scheduleLabel = String(event && event.date || "");
  if (timeText) {
    scheduleLabel += scheduleLabel ? " " + timeText : timeText;
  }

  return {
    id: String(event && event.eventId || "EV-" + index),
    type: "special",
    title: String(event && event.title || ""),
    category: String(event && event.category || "コミニティ"),
    scheduleLabel: scheduleLabel,
    place: String(event && event.place || ""),
    description: String(event && event.description || ""),
    minParticipants: Number(event && event.capacity || 0) > 0 ? 1 : 0,
    maxParticipants: Number(event && event.capacity || 0),
    start: start ? toIso_(start) : "",
    end: end ? toIso_(end) : "",
    recruitFormUrl: "",
    currentCount: Number(event && event.currentCount || 0),
    entryEnabled: !!(event && event.entryEnabled),
    deadline: String(event && event.deadline || ""),
    status: String(event && event.status || "")
  };
}

// ============================================================
// GET ハンドラー群
// ============================================================
function getOpinions_() {
  var spreadsheet = getLedgerSpreadsheet();
  var sheet = getOrCreateSheet_(spreadsheet, "掲示板(意見交換)");
  var values = sheet.getDataRange().getValues();
  if (!values || values.length <= 1) { return []; }

  var headers = values[0].map(function(h) { return String(h || "").trim(); });
  var records = values.slice(1)
    .filter(function(row) { return row.some(function(c) { return String(c || "") !== ""; }); })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) { obj[header] = row[i]; });
      return obj;
    });

  records.sort(function(a, b) {
    var aD = parseDateOrNull_(a["日時"]);
    var bD = parseDateOrNull_(b["日時"]);
    return (bD ? bD.getTime() : 0) - (aD ? aD.getTime() : 0);
  });
  return records;
}

function getEvents_() {
  try {
    return { success: true, data: getEntryEvents().map(entryJsonToLegacyEvent_) };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function getGallery_() {
  return readSheetAsObjects_("写真メタデータ");
}

function getCalendarEventsForFrontend_() {
  return getScheduleEvents();
}

function getEquipmentStatusForFrontend_() {
  var spreadsheet = getLedgerSpreadsheet();
  var rows = readSheetAsObjects_("備品予約", spreadsheet);
  return rows.map(function(row, index) {
    return {
      id: String(row["予約ID"] || "EQ-" + index),
      recordId: String(row["予約ID"] || "EQ-" + index),
      equipment: String(row["備品名"] || ""),
      equipmentLabel: String(row["備品名"] || ""),
      quantity: Number(row["数量"] || 0),
      loanDate: normalizeDateText_(row["貸出日"]),
      returnDate: normalizeDateText_(row["返納日"]),
      applicant: String(row["申請者"] || ""),
      status: String(row["ステータス"] || "")
    };
  }).filter(function(item) { return !!item.equipmentLabel; });
}

function getEquipment_() {
  var spreadsheet = getLedgerSpreadsheet();
  return {
    masters: readSheetAsObjects_("備品台帳", spreadsheet),
    reservations: readSheetAsObjects_("備品予約", spreadsheet)
  };
}

// ============================================================
// POST ハンドラー群
// ============================================================

// login: 役員_会員台帳のヘッダー名で列位置を特定する
function login_(params) {
  try {
    var userId = String(params.userId || "").trim();
    var pin    = String(params.pin    || "").trim();

    if (!userId || !pin) {
      return { success: false, message: "ユーザーIDまたはパスワード(PIN)が正しくありません。" };
    }

    var spreadsheet = getLedgerSpreadsheet();
    var sheet  = getOrCreateSheet_(spreadsheet, "役員_会員台帳");
    var values = sheet.getDataRange().getValues();
    if (!values || values.length <= 1) {
      return { success: false, message: "ユーザーIDまたはパスワード(PIN)が正しくありません。" };
    }

    var headers     = values[0].map(function(h) { return String(h || "").trim(); });
    var userIdIndex = headers.indexOf("ユーザーID(メール等)");
    var pinIndex    = headers.indexOf("PIN(4桁数字)");
    var nameIndex   = headers.indexOf("氏名");
    var roleIndex   = headers.indexOf("役職(役員/一般)");

    var matchedRow = values.slice(1).filter(function(row) {
      return String(row[userIdIndex] || "").trim() === userId
          && String(row[pinIndex]    || "").trim() === pin;
    })[0];

    if (!matchedRow) {
      return { success: false, message: "ユーザーIDまたはパスワード(PIN)が正しくありません。" };
    }

    return {
      success: true,
      message: "ログインに成功しました",
      role: String(matchedRow[roleIndex] || ""),
      name: String(matchedRow[nameIndex] || "")
    };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function addOpinion_(params) {
  try {
    var spreadsheet = getLedgerSpreadsheet();
    var sheet    = getOrCreateSheet_(spreadsheet, "掲示板(意見交換)");
    var postId   = "OP-" + new Date().getTime();
    var postedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
    var photoResult = null;

    var photoDataRaw = String(params.photoData || "").trim();
    if (photoDataRaw) {
      var fileName = String(params.photoFileName || (postId + ".jpg")).trim();
      var mimeTypeFromParam = String(params.photoMimeType || "").trim();
      var photoDescription = String(params.photoDescription || params.content || "").trim();
      var folderId = resolveInformationPhotoFolderId_();

      var match = photoDataRaw.match(/^data:([^;]+);base64,(.*)$/i);
      var mimeType = match ? match[1] : (mimeTypeFromParam || "image/jpeg");
      var base64Body = match ? match[2] : photoDataRaw;
      var bytes = Utilities.base64Decode(base64Body);
      var blob = Utilities.newBlob(bytes, mimeType, fileName || (postId + ".jpg"));

      var folder = DriveApp.getFolderById(folderId);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      var fileId = file.getId();
      var imageUrl = "https://drive.google.com/uc?export=view&id=" + fileId;
      var photoId = "PH-" + new Date().getTime();
      var postedDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd");

      // 写真ID, ドライブのファイルID, 画像URL, 投稿日, 投稿者氏名, コメント/説明, アルバム名/カテゴリ, ファイル名, 保管状態, アーカイブ日時
      appendRow_("写真メタデータ", [
        photoId,
        fileId,
        imageUrl,
        postedDate,
        String(params.name || ""),
        photoDescription,
        INFORMATION_PHOTO_CATEGORY,
        file.getName(),
        "共有中",
        ""
      ]);

      photoResult = {
        fileId: fileId,
        imageUrl: imageUrl,
        folderId: folderId,
        folderPath: INFORMATION_PHOTO_FOLDER_PATH.join("/")
      };
    }

    // 投稿ID, 日時, 名前, カテゴリ, 内容, 返信状態, 管理ステータス
    sheet.appendRow([postId, postedAt, String(params.name||""), String(params.category||""), String(params.content||""), "未対応", "未確認"]);
    return {
      success: true,
      message: photoResult ? "情報投稿と写真の保存が完了しました" : "情報投稿が完了しました",
      postId: postId,
      photo: photoResult
    };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function getTownEvents_() {
  try {
    return getScheduleEvents().map(scheduleJsonToLegacyTownEvent_);
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
}

function deleteTownEvent_(params) {
  try {
    var eventId = String(params.eventId || "").trim();
    if (!eventId) { throw new Error("eventId は必須です。"); }

    var spreadsheet = getLedgerSpreadsheet();
    var sheet = getOrCreateSheet_(spreadsheet, "町内行事予定");
    var values = sheet.getDataRange().getValues();
    var headers = values[0].map(function(h) { return String(h || "").trim(); });
    var idCol = headers.indexOf("イベントID");
    if (idCol < 0) { throw new Error("イベントID列が見つかりません。"); }

    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][idCol] || "").trim() === eventId) {
        sheet.deleteRow(i + 1);
        refreshScheduleEventsCache_();
        return { success: true, message: "削除しました: " + eventId };
      }
    }
    throw new Error("对象のイベントIDが見つかりません: " + eventId);
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function updateTownEvent_(params) {
  try {
    var eventId = String(params.eventId || "").trim();
    if (!eventId) { throw new Error("eventId は必須です。"); }

    var spreadsheet = getLedgerSpreadsheet();
    var sheet  = getOrCreateSheet_(spreadsheet, "町内行事予定");
    var values = sheet.getDataRange().getValues();
    var headers = values[0].map(function(h) { return String(h || "").trim(); });
    var idCol = headers.indexOf("イベントID");
    if (idCol < 0) { throw new Error("イベントID列が見つかりません。"); }

    var rowIndex = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][idCol] || "").trim() === eventId) {
        rowIndex = i + 1; // 1-based
        break;
      }
    }
    if (rowIndex < 0) { throw new Error("对象イベントIDが見つかりません: " + eventId); }

    var start = parseDateOrThrow_(params.start, "start");
    var end   = parseDateOrNull_(params.end);
    if (!end) { end = new Date(start.getTime() + 60 * 60 * 1000); }
    if (end.getTime() <= start.getTime()) { throw new Error("end は start より後を指定してください。"); }

    var fieldMap = {
      "カレンダー予定ID": String(values[rowIndex - 1][headers.indexOf("カレンダー予定ID")] || ""),
      "開始日時":    Utilities.formatDate(start, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      "終了日時":    Utilities.formatDate(end,   Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      "タイトル":      String(params.title       || "").trim(),
      "企画者":    String(params.creator     || "").trim(),
      "場所":        String(params.place       || "").trim(),
      "説明":        String(params.description || "").trim()
    };

    // 列順 (ヘッダー定義順): イベントID, カレンダー予定ID, 開始日時, 終了日時, タイトル, 企画者, 場所, 説明
    var newRow = headers.map(function(h, colIdx) {
      if (h === "イベントID") { return eventId; }
      return Object.prototype.hasOwnProperty.call(fieldMap, h) ? fieldMap[h] : String(values[rowIndex - 1][colIdx] || "");
    });
    sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
    refreshScheduleEventsCache_();

    return { success: true, message: "更新しました: " + eventId };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function addTownEvent_(params) {
  try {
    var title       = String(params.title       || "").trim();
    var start       = parseDateOrThrow_(params.start, "start");
    var end         = parseDateOrNull_(params.end);
    var place       = String(params.place       || "").trim();
    var creator     = String(params.creator     || "").trim();
    var description = String(params.description || "").trim();

    if (!title) { throw new Error("title は必須です。"); }
    if (!end) { end = new Date(start.getTime() + 60 * 60 * 1000); }
    if (end.getTime() <= start.getTime()) { throw new Error("end は start より後の日時を指定してください。"); }

    var calEventId = "";
    var calendar = getCalendarSafely_(TOWN_CALENDAR_ID);
    if (calendar) {
      try {
        var calEvent = calendar.createEvent(title, start, end, {
          location: place,
          description: description + (creator ? "\n企画者: " + creator : "")
        });
        calEventId = String(calEvent.getId() || "");
      } catch (calendarErr) {
        Logger.log("addTownEvent_: calendar.createEvent failed. " + String(calendarErr && calendarErr.message || calendarErr));
      }
    }

    var eventId = "TC-" + new Date().getTime();
    // イベントID, カレンダー予定ID, 開始日時, 終了日時, タイトル, 企画者, 場所, 説明
    appendRow_("町内行事予定", [
      eventId, calEventId,
      Utilities.formatDate(start, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      Utilities.formatDate(end,   Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      title, creator, place, description
    ]);

    refreshScheduleEventsCache_();

    return {
      success: true,
      eventId: eventId,
      calendarEventId: calEventId,
      calendarLinked: !!calEventId,
      message: calEventId ? "カレンダーとシートに登録しました" : "シートに登録しました（カレンダー連携は未設定）"
    };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function addEvent_(params) {
  return createUserEvent(params);
}

function createUserEvent(formData) {
  return addEventToSheet_(formData, "イベント企画");
}

function addEventToSheet_(params, targetSheetName) {
  try {
    var title           = String(params.title       || "").trim();
    var start           = parseDateOrThrow_(params.start, "start");
    var end             = parseDateOrNull_(params.end);
    var place           = String(params.place       || "").trim();
    var creator         = String(params.creator     || "").trim();
    var minParticipants = Number(params.minParticipants || 0);
    var maxParticipants = Number(params.maxParticipants || 0);
    var description     = String(params.description || "").trim();

    if (!title) { throw new Error("title は必須です。"); }
    if (!end) { end = new Date(start.getTime() + 60 * 60 * 1000); }
    if (end.getTime() <= start.getTime()) { throw new Error("end は start より後の日時を指定してください。"); }

    var calEventId = "";
    var calendar = getCalendarSafely_(TOWN_CALENDAR_ID);
    if (calendar) {
      try {
        var calEvent = calendar.createEvent(title, start, end, {
          location: place,
          description: description + (creator ? "\n企画者: " + creator : "")
        });
        calEventId = String(calEvent.getId() || "");
      } catch (calendarErr) {
        Logger.log("addEvent_: calendar.createEvent failed, fallback to sheet-only save. " + String(calendarErr && calendarErr.message || calendarErr));
      }
    }

    var eventId = "EV-" + new Date().getTime();
    // イベントID, カレンダー予定ID, 開始日時, 終了日時, タイトル, 企画者, 場所, 最少人数, 最大人数, 説明
    appendRow_(targetSheetName, [
      eventId,
      calEventId,
      Utilities.formatDate(start, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      Utilities.formatDate(end,   Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      title, creator, place, minParticipants, maxParticipants, description
    ]);

    refreshEntryEventsCache_();

    return {
      success: true,
      eventId: eventId,
      calendarEventId: calEventId,
      calendarLinked: !!calEventId,
      message: calEventId ? "カレンダーとシートに登録しました" : "シートに登録しました（カレンダー連携は未設定）"
    };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function addRecurringEvent_(params) {
  try {
    var title           = String(params.title       || "").trim();
    var place           = String(params.place       || "").trim();
    var creator         = String(params.creator     || "").trim();
    var minParticipants = Number(params.minParticipants || 0);
    var maxParticipants = Number(params.maxParticipants || 0);
    var description     = String(params.description || "").trim();
    var durationMinutes = Math.max(1, Number(params.durationMinutes || 60));

    if (!title) { throw new Error("title は必須です。"); }

    var starts = computeRecurringStartsForOneYear_(params);
    if (starts.length === 0) { throw new Error("定例日を計算できませんでした。パラメータを確認してください。"); }
    if (starts.length !== 12) { throw new Error("定例行事は12回分の日時が必要です。specificDates または条件を見直してください。"); }

    var calendar = getCalendarSafely_(TOWN_CALENDAR_ID);

    var spreadsheet = getLedgerSpreadsheet();
    var sheet = getOrCreateSheet_(spreadsheet, "町内行事予定");
    var createdIds = [];
    var createdCalendarIds = [];
    var calendarLinkedCount = 0;

    var rowsToAppend = [];
    starts.forEach(function(startDate) {
      var endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
      var calEventId = "";
      if (calendar) {
        try {
          var calEvent = calendar.createEvent(title, startDate, endDate, {
            location: place,
            description: description + (creator ? "\n企画者: " + creator : "")
          });
          calEventId = String(calEvent.getId() || "");
        } catch (calendarErr) {
          Logger.log("addRecurringEvent_: calendar.createEvent failed for " + Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy/MM/dd") + ". " + String(calendarErr && calendarErr.message || calendarErr));
        }
      }
      var eventId = "EV-" + startDate.getTime() + "-" + Math.floor(Math.random() * 1000);
      rowsToAppend.push([
        eventId, calEventId,
        Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
        Utilities.formatDate(endDate,   Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
        title, creator, place, minParticipants, maxParticipants, description
      ]);
      createdIds.push(eventId);
      createdCalendarIds.push(calEventId);
      if (calEventId) { calendarLinkedCount += 1; }
    });

    appendRowsToSheet_(sheet, rowsToAppend);

    refreshScheduleEventsCache_();

    return {
      success: true,
      count: createdIds.length,
      eventIds: createdIds,
      calendarEventIds: createdCalendarIds,
      calendarLinkedCount: calendarLinkedCount,
      message: calendarLinkedCount === createdIds.length
        ? "定例行事をカレンダーとシートへ登録しました"
        : "定例行事をシートへ登録しました（一部または全件でカレンダー連携は未設定）"
    };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function joinEvent_(params) {
  return registerEventEntry(params.eventId, params);
}

function registerEventEntry(eventId, formData) {
  try {
    var normalizedEventId = String(eventId || "").trim();
    var name    = String((formData && formData.name)    || "").trim();
    var contact = String((formData && formData.contact) || "").trim();

    if (!normalizedEventId || !name || !contact) { throw new Error("eventId, name, contact は必須です。"); }

    var spreadsheet = getLedgerSpreadsheet();
    var eventRows   = readSheetAsObjects_("イベント企画", spreadsheet);
    var targetEvent = eventRows.filter(function(row) {
      return String(row["イベントID"] || "").trim() === normalizedEventId;
    })[0];

    if (!targetEvent) { throw new Error("指定イベントが見つかりません: " + normalizedEventId); }

    var maxParticipants = Number(targetEvent["最大人数"] || 0);
    var joinRows        = readSheetAsObjects_("イベント参加", spreadsheet);
    var currentCount    = joinRows.filter(function(row) {
      return String(row["イベントID"] || "").trim() === normalizedEventId;
    }).length;

    if (maxParticipants > 0 && currentCount >= maxParticipants) {
      return { success: false, message: "定員に達したため参加登録できません" };
    }

    var participantSheet = getOrCreateSheet_(spreadsheet, "イベント参加");
    // 申込ID, イベントID, 参加者名, 連絡先, 登録日時
    participantSheet.appendRow([
      "EN-" + new Date().getTime(), normalizedEventId, name, contact,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss")
    ]);
    refreshEntryEventsCache_();
    return { success: true, message: "参加登録が完了しました" };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function reserveEquipment_(params) {
  try {
    var applicant = String(params.applicant || "").trim();
    var phone     = String(params.phone     || "").trim();
    var group     = String(params.group     || "").trim();
    var items     = Array.isArray(params.items) ? params.items : [];

    if (!applicant) { throw new Error("applicant は必須です。"); }
    if (items.length === 0) { throw new Error("items は1件以上必要です。"); }

    var normalizedItems = items.map(function(item, index) {
      var equipment  = String((item && (item.equipment || item.equipmentLabel || item.equipmentName || item.name)) || "").trim();
      var quantity   = Number(item && item.quantity || 0);
      var loanDate   = parseDateOrThrow_(item && (item.loanDate   || item.startDate || item.loan  || item.start), "items[" + index + "].loanDate");
      var returnDate = parseDateOrThrow_(item && (item.returnDate || item.endDate   || item.return || item.end),  "items[" + index + "].returnDate");

      if (!equipment) { throw new Error("items[" + index + "].equipment は必須です。"); }
      if (!Number.isFinite(quantity) || quantity <= 0) { throw new Error("items[" + index + "].quantity は1以上で指定してください。"); }
      if (loanDate.getTime() > returnDate.getTime()) { throw new Error("items[" + index + "].loanDate は returnDate 以下で指定してください。"); }

      return { equipment: equipment, equipmentId: String((item && item.equipmentId) || "").trim(), quantity: quantity, loanDate: loanDate, returnDate: returnDate };
    });

    var spreadsheet       = getLedgerSpreadsheet();
    var masters           = readSheetAsObjects_("備品台帳", spreadsheet);
    var reservations      = readSheetAsObjects_("備品予約", spreadsheet);
    var equipmentCalendar = CalendarApp.getCalendarById(EQUIPMENT_CALENDAR_ID);
    if (!equipmentCalendar) { throw new Error("備品予約用カレンダーが見つかりません。EQUIPMENT_CALENDAR_ID を確認してください。"); }

    for (var i = 0; i < normalizedItems.length; i++) {
      var item   = normalizedItems[i];
      var master = masters.filter(function(row) { return String(row["備品名"] || "").trim() === item.equipment; })[0];
      if (!master) { throw new Error("備品台帳に存在しない備品です: " + item.equipment); }

      var totalStock = Number(master["総在庫数"] || 0);
      var usedQty = reservations.filter(function(row) {
        if (String(row["備品名"] || "").trim() !== item.equipment) { return false; }
        if (String(row["ステータス"] || "").trim() === "キャンセル") { return false; }
        var rL = parseDateOrNull_(row["貸出日"]);
        var rR = parseDateOrNull_(row["返納日"]);
        if (!rL || !rR) { return false; }
        return !(rR.getTime() < item.loanDate.getTime() || rL.getTime() > item.returnDate.getTime());
      }).reduce(function(sum, row) { return sum + Number(row["数量"] || 0); }, 0);

      var remaining = totalStock - usedQty;
      if (remaining < item.quantity) {
        return { success: false, message: "「" + item.equipment + "」は指定期間中に在庫が不足（残り" + Math.max(0, remaining) + "個）しているため、予約を完了できません。" };
      }
    }

    var rowsToAppend = [];
    normalizedItems.forEach(function(item, index) {
      var calendarEndDate = new Date(item.returnDate.getTime());
      calendarEndDate.setDate(calendarEndDate.getDate() + 1);
      var calEvent = equipmentCalendar.createAllDayEvent("備品貸出: " + item.equipment, item.loanDate, calendarEndDate);
      var applicantCell = applicant + (phone || group ? " / " + [phone, group].filter(Boolean).join(" / ") : "");
      // 予約ID, カレンダー予定ID, 備品名, 数量, 貸出日, 返納日, 申請者, ステータス
      rowsToAppend.push([
        "EQ-" + new Date().getTime() + "-" + (index + 1),
        String(calEvent.getId() || ""),
        item.equipment, item.quantity,
        toDate_(item.loanDate), toDate_(item.returnDate),
        applicantCell, "予約確定"
      ]);
    });

    appendRows_("備品予約", rowsToAppend);

    return { success: true, message: "備品の予約が完了しました" };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function uploadPhoto_(params) {
  try {
    var photoDataRaw = String(params.photoData || params.base64Data || "").trim();
    var fileName     = String(params.fileName  || "photo.jpg").trim();
    var uploader     = String(params.uploader  || params.uploaderName || params.authorName || "").trim();
    var comment      = String(params.comment   || params.description || "").trim();
    var album        = String(params.album     || params.category    || "").trim();
    var targetFolderId = String(params.folderId || album || resolveSharedPhotoFolderId_() || "").trim();

    if (!photoDataRaw) { throw new Error("photoData は必須です。"); }
    if (!targetFolderId) { throw new Error("folderId（保存先フォルダID）は必須です。"); }

    var match      = photoDataRaw.match(/^data:([^;]+);base64,(.*)$/i);
    var mimeType   = match ? match[1] : (String(params.mimeType || "").trim() || "image/jpeg");
    var base64Body = match ? match[2] : photoDataRaw;
    var bytes      = Utilities.base64Decode(base64Body);
    var blob       = Utilities.newBlob(bytes, mimeType, fileName || ("photo_" + generateId_("IMG") + ".jpg"));

    var folder = DriveApp.getFolderById(targetFolderId);
    var file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId   = file.getId();
    var imageUrl = "https://drive.google.com/uc?export=view&id=" + fileId;
    var photoId  = "PH-" + new Date().getTime();
    var postedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd");
    var albumForSheet = album || targetFolderId;
    var archiveFolderId = resolveArchivePhotoFolderId_();
    var storageStatus = archiveFolderId && albumForSheet === archiveFolderId ? "アーカイブ済" : "共有中";
    var archivedAt = storageStatus === "アーカイブ済" ? nowIso_() : "";

    // 写真ID, ドライブのファイルID, 画像URL, 投稿日, 投稿者氏名, コメント/説明, アルバム名/カテゴリ, ファイル名, 保管状態, アーカイブ日時
    appendRow_("写真メタデータ", [
      photoId,
      fileId,
      imageUrl,
      postedAt,
      uploader,
      comment,
      albumForSheet,
      fileName || file.getName(),
      storageStatus,
      archivedAt
    ]);
    return {
      success: true,
      message: "写真のアップロードが完了しました",
      fileId: fileId,
      folderId: targetFolderId
    };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function createPhotoFolder_(params) {
  try {
    var folderName = String(params.folderName || params.name || "").trim();
    var parentFolderId = String(params.parentFolderId || resolvePhotoRootFolderId_() || "").trim();

    if (!folderName) { throw new Error("folderName は必須です。"); }
    if (!parentFolderId) { throw new Error("parentFolderId が未設定です。共有フォルダIDを設定してください。"); }

    var parent = DriveApp.getFolderById(parentFolderId);
    var child = parent.createFolder(folderName);

    return {
      success: true,
      message: "写真用フォルダを作成しました",
      folderId: child.getId(),
      folderName: child.getName(),
      parentFolderId: parentFolderId,
      folderUrl: child.getUrl()
    };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function addPeople_(params) {
  try {
    var userId = String(params.userId || params.email || "").trim();
    var pin    = String(params.pin    || "").trim();
    var name   = String(params.name   || "").trim();
    var role   = String(params.role   || "一般").trim();

    if (!userId || !pin || !name) { throw new Error("userId, pin, name は必須です。"); }

    // ユーザーID(メール等), PIN(4桁数字), 氏名, 役職(役員/一般)
    appendRow_("役員_会員台帳", [userId, pin, name, role === "役員" ? "役員" : "一般"]);
    return { success: true, message: "役員_会員台帳へ登録しました" };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function addEquipmentMaster_(params) {
  try {
    var equipmentId   = String(params.equipmentId   || generateId_("EQM")).trim();
    var equipmentName = String(params.equipmentName || params.name || "").trim();
    var stock         = Number(params.stock || 0);
    var location      = String(params.location || "").trim();
    var state         = String(params.state    || "良好").trim();
    var memo          = String(params.memo     || "").trim();

    if (!equipmentName) { throw new Error("equipmentName は必須です。"); }
    if (!Number.isFinite(stock) || stock < 0) { throw new Error("stock は0以上の数値で指定してください。"); }

    // 備品ID, 備品名, 総在庫数, 保管場所, 状態(良好/要修理等), 備考
    appendRow_("備品台帳", [equipmentId, equipmentName, stock, location, state || "良好", memo]);
    return { success: true, message: "備品台帳へ登録しました" };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

function uploadDocument_(params) {
  try {
    var destination  = String(params.destination  || "documents").trim();
    var category     = String(params.category     || "").trim();
    var title        = String(params.title || params.fileName || "document.pdf").trim();
    var uploader     = String(params.uploader || params.uploaderName || "").trim();
    var fileDataRaw  = String(params.fileData || params.base64Data || "").trim();

    if (!fileDataRaw) { throw new Error("fileData は必須です。"); }

    var match      = fileDataRaw.match(/^data:([^;]+);base64,(.*)$/i);
    var mimeType   = match ? match[1] : (String(params.mimeType || "application/pdf").trim() || "application/pdf");
    var base64Body = match ? match[2] : fileDataRaw;
    var bytes      = Utilities.base64Decode(base64Body);
    var blob       = Utilities.newBlob(bytes, mimeType, title);

    var targetFolderId = String(params.folderId || GALLERY_FOLDER_ID || "").trim();
    var folder = DriveApp.getFolderById(targetFolderId);
    var file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId   = file.getId();
    var docUrl   = file.getUrl();
    var postedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd");

    // 文書ID, ドライブのファイルID, 文書URL, 投稿日, 投稿者氏名, カテゴリ, タイトル, 保存先
    appendRow_("文書メタデータ", [
      "DOC-" + new Date().getTime(), fileId, docUrl, postedAt, uploader, category, title, destination
    ]);
    return { success: true, message: "文書のアップロードが完了しました", fileId: fileId, url: docUrl };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
}

// ============================================================
// 共通シート操作
// ============================================================
function readSheetAsObjects_(sheetName, spreadsheet) {
  var activeSpreadsheet = spreadsheet || getLedgerSpreadsheet();
  var sheet       = getOrCreateSheet_(activeSpreadsheet, sheetName);
  var values      = sheet.getDataRange().getValues();
  if (!values || values.length <= 1) { return []; }

  var headers = values[0].map(function(h) { return String(h || "").trim(); });
  return values.slice(1)
    .filter(function(row) { return row.some(function(c) { return String(c || "") !== ""; }); })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) { obj[header] = row[i]; });
      return obj;
    });
}

function appendRow_(sheetName, rowValues) {
  var spreadsheet = getLedgerSpreadsheet();
  var sheet       = getOrCreateSheet_(spreadsheet, sheetName);
  ensureColumnCount_(sheet, rowValues.length);
  sheet.appendRow(rowValues);
}

function appendRows_(sheetName, rowsValues) {
  if (!Array.isArray(rowsValues) || rowsValues.length === 0) { return; }
  var spreadsheet = getLedgerSpreadsheet();
  var sheet       = getOrCreateSheet_(spreadsheet, sheetName);
  appendRowsToSheet_(sheet, rowsValues);
}

function appendRowsToSheet_(sheet, rowsValues) {
  if (!Array.isArray(rowsValues) || rowsValues.length === 0) { return; }
  var maxColumns = rowsValues.reduce(function(max, row) {
    return Math.max(max, Array.isArray(row) ? row.length : 0);
  }, 0);
  if (maxColumns <= 0) { return; }

  ensureColumnCount_(sheet, maxColumns);

  var normalizedRows = rowsValues.map(function(row) {
    var values = Array.isArray(row) ? row.slice(0) : [];
    while (values.length < maxColumns) { values.push(""); }
    return values;
  });

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, normalizedRows.length, maxColumns).setValues(normalizedRows);
}

function runPhotoArchiveJob() {
  return autoArchiveOldPhotos_();
}

function setupPhotoArchiveTrigger_() {
  deleteTriggersByHandler_("runPhotoArchiveJob");
  ScriptApp.newTrigger("runPhotoArchiveJob")
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  return { success: true, message: "写真アーカイブの定期トリガーを設定しました（毎日2時）" };
}

function autoArchiveOldPhotos_() {
  ensureLedgerStructure_();

  var archiveFolderId = resolveArchivePhotoFolderId_();
  if (!archiveFolderId) {
    return { success: false, error: "GALLERY_ARCHIVE_FOLDER_ID を設定してください。" };
  }

  var spreadsheet = getLedgerSpreadsheet();
  var sheet = getOrCreateSheet_(spreadsheet, "写真メタデータ");
  var values = sheet.getDataRange().getValues();
  if (!values || values.length <= 1) {
    return { success: true, checked: 0, archived: 0, skipped: 0, failed: 0 };
  }

  var headers = values[0].map(function(v) { return String(v || "").trim(); });
  var indexMap = {};
  headers.forEach(function(h, i) { indexMap[h] = i; });

  var idxFileId = indexMap["ドライブのファイルID"];
  var idxPostedAt = indexMap["投稿日"];
  var idxAlbum = indexMap["アルバム名/カテゴリ"];
  var idxFileName = indexMap["ファイル名"];
  var idxStorage = indexMap["保管状態"];
  var idxArchivedAt = indexMap["アーカイブ日時"];

  if (idxFileId === undefined || idxPostedAt === undefined || idxAlbum === undefined) {
    return { success: false, error: "写真メタデータの必須列が不足しています。" };
  }

  var threshold = new Date();
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - Number(PHOTO_ARCHIVE_DAYS || 365));

  var archiveFolder = DriveApp.getFolderById(archiveFolderId);
  var checked = 0;
  var archived = 0;
  var skipped = 0;
  var failed = 0;

  var hasSheetUpdates = false;

  for (var rowNum = 2; rowNum <= values.length; rowNum++) {
    checked += 1;
    var row = values[rowNum - 1];

    var fileId = String(row[idxFileId] || "").trim();
    var postedAtRaw = row[idxPostedAt];
    var currentAlbum = String(row[idxAlbum] || "").trim();
    var currentStatus = idxStorage === undefined ? "" : String(row[idxStorage] || "").trim();

    if (!fileId) { skipped += 1; continue; }
    if (currentAlbum === archiveFolderId || currentStatus === "アーカイブ済") { skipped += 1; continue; }

    var postedAt = parseDateOrNull_(postedAtRaw);
    if (!postedAt) { skipped += 1; continue; }
    postedAt.setHours(0, 0, 0, 0);
    if (postedAt.getTime() > threshold.getTime()) { skipped += 1; continue; }

    try {
      var file = DriveApp.getFileById(fileId);
      var archivedCopy = archiveFolder.createFile(file.getBlob());
      archivedCopy.setName(file.getName());
      archivedCopy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      var archivedFileId = archivedCopy.getId();
      var archivedUrl = archivedCopy.getUrl();

      try {
        file.setTrashed(true);
      } catch (trashErr) {
        Logger.log("autoArchiveOldPhotos_: setTrashed failed. row=" + rowNum + " / " + String(trashErr && trashErr.message || trashErr));
      }

      row[idxFileId] = archivedFileId;
      row[idxAlbum] = archiveFolderId;
      if (idxFileName !== undefined) { row[idxFileName] = file.getName(); }
      if (idxStorage !== undefined) { row[idxStorage] = "アーカイブ済"; }
      if (idxArchivedAt !== undefined) { row[idxArchivedAt] = nowIso_(); }
      hasSheetUpdates = true;

      archived += 1;
    } catch (err) {
      failed += 1;
      Logger.log("autoArchiveOldPhotos_ failed: row=" + rowNum + " / " + String(err && err.message || err));
    }
  }

  if (hasSheetUpdates) {
    var dataRows = values.slice(1);
    sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
  }

  return {
    success: true,
    checked: checked,
    archived: archived,
    skipped: skipped,
    failed: failed,
    archiveFolderId: archiveFolderId,
    thresholdDate: toDate_(threshold)
  };
}

function parsePostJson_(e) {
  var raw  = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
  var body = {};

  try {
    body = JSON.parse(raw);
  } catch (parseErr) {
    var normalized = String(raw || "").trim();
    if (!normalized) {
      body = {};
    } else if (normalized.indexOf("=") >= 0 && normalized.indexOf("{") === -1) {
      var paramsObj = {};
      normalized.split("&").forEach(function(pair) {
        var parts = pair.split("=");
        paramsObj[decodeURIComponent(parts[0] || "")] = decodeURIComponent(parts[1] || "");
      });
      body = paramsObj;
    } else {
      throw parseErr;
    }
  }

  if (!body || typeof body !== "object") {
    throw new Error("POSTボディはJSONオブジェクトである必要があります。");
  }
  return body;
}

function ensureLedgerStructure_() {
  var spreadsheet = getLedgerSpreadsheet();

  Object.keys(SHEET_NAME_ALIASES).forEach(function(fromName) {
    var toName    = SHEET_NAME_ALIASES[fromName];
    var fromSheet = spreadsheet.getSheetByName(fromName);
    var toSheet   = spreadsheet.getSheetByName(toName);
    if (fromSheet && !toSheet) { fromSheet.setName(toName); }
  });

  Object.keys(LEDGER_HEADERS).forEach(function(sheetName) {
    var headers = LEDGER_HEADERS[sheetName];
    var sheet   = getOrCreateSheet_(spreadsheet, sheetName);
    ensureColumnCount_(sheet, headers.length);
    var current = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(function(v) { return String(v || "").trim(); });
    if (current.join("||") !== headers.join("||")) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    }
  });
}

// ============================================================
// 日付・文字列ユーティリティ
// ============================================================
function normalizeDateText_(value) {
  var date = parseDateOrNull_(value);
  return date ? toDate_(date) : "";
}

function toIsoTextOrOriginal_(value) {
  var date = parseDateOrNull_(value);
  return date ? toIso_(date) : String(value || "").trim();
}

function parseDateOrThrow_(value, fieldName) {
  var date = parseDateOrNull_(value);
  if (!date) { throw new Error(fieldName + " の日時形式が不正です。"); }
  return date;
}

function parseDateOrNull_(value) {
  if (!value && value !== 0) { return null; }
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) { return value; }
  var date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function isPlaceholderFolderId_(value) {
  var id = String(value || "").trim();
  return !id || id.indexOf("replace-with-your-") === 0 || id.indexOf("sample-") === 0;
}

function resolveSharedPhotoFolderId_() {
  if (!isPlaceholderFolderId_(GALLERY_SHARED_FOLDER_ID)) { return String(GALLERY_SHARED_FOLDER_ID).trim(); }
  if (!isPlaceholderFolderId_(GALLERY_FOLDER_ID)) { return String(GALLERY_FOLDER_ID).trim(); }
  return "";
}

function resolvePhotoRootFolderId_() {
  return resolveSharedPhotoFolderId_();
}

function resolveArchivePhotoFolderId_() {
  if (!isPlaceholderFolderId_(GALLERY_ARCHIVE_FOLDER_ID)) { return String(GALLERY_ARCHIVE_FOLDER_ID).trim(); }
  return "";
}

function resolveInformationPhotoFolderId_() {
  return ensureDriveFolderPath_(DriveApp.getRootFolder(), INFORMATION_PHOTO_FOLDER_PATH).getId();
}

function ensureDriveFolderPath_(baseFolder, pathParts) {
  var current = baseFolder;
  pathParts.forEach(function(part) {
    var name = String(part || "").trim();
    if (!name) { return; }
    var next = getChildFolderByName_(current, name);
    if (!next) {
      next = current.createFolder(name);
    }
    current = next;
  });
  return current;
}

function getChildFolderByName_(parentFolder, folderName) {
  var iterator = parentFolder.getFoldersByName(folderName);
  return iterator.hasNext() ? iterator.next() : null;
}

function deleteTriggersByHandler_(handlerName) {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function getCalendarSafely_(calendarId) {
  var id = String(calendarId || "").trim();
  if (!id || id.indexOf("replace-with-your-") >= 0) { return null; }
  try {
    return CalendarApp.getCalendarById(id);
  } catch (err) {
    Logger.log("getCalendarSafely_: failed to open calendar. " + String(err && err.message || err));
    return null;
  }
}

function toIso_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function toDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function nowIso_() {
  return toIso_(new Date());
}

function generateId_(prefix) {
  var ts   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmss");
  var rand = Math.floor(Math.random() * 9000) + 1000;
  return prefix + "-" + ts + "-" + rand;
}

// ============================================================
// レスポンス生成（この定義1か所のみ）
// ============================================================
function jsonResponse_(payload) {
  var envelope = {
    ok: !!payload.ok,
    timestamp: nowIso_(),
    cors: {
      allowOrigin: "*",
      allowMethods: "GET, POST, OPTIONS",
      allowHeaders: "Content-Type"
    }
  };

  Object.keys(payload || {}).forEach(function(key) {
    envelope[key] = payload[key];
  });

  return ContentService
    .createTextOutput(JSON.stringify(envelope))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 定例行事スケジュール計算
// ============================================================
function computeRecurringStartsForOneYear_(params) {
  var startTime     = parseTimeParts_(params.startTime || params.time || "09:00");
  var specificDates = Array.isArray(params.specificDates) ? params.specificDates : [];

  if (specificDates.length > 0) {
    return specificDates
      .map(function(dateText) {
        var date = parseDateOrNull_(dateText);
        if (!date) { return null; }
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), startTime.hours, startTime.minutes, 0, 0);
      })
      .filter(function(d) { return !!d; })
      .sort(function(a, b) { return a.getTime() - b.getTime(); })
      .slice(0, 12);
  }

  var weekOfMonth = normalizeWeekOfMonth_(params.weekOfMonth || params.nth || 1);
  var dayOfWeek   = normalizeDayOfWeek_(params.dayOfWeek || params.weekday || 0);
  var base        = parseDateOrNull_(params.start || params.startDate) || new Date();
  var starts      = [];

  for (var i = 0; i < 12; i++) {
    var month    = base.getMonth() + i;
    var firstDay = new Date(base.getFullYear(), month, 1);
    var target   = nthWeekdayOfMonth_(firstDay.getFullYear(), firstDay.getMonth(), weekOfMonth, dayOfWeek);
    target.setHours(startTime.hours, startTime.minutes, 0, 0);
    starts.push(target);
  }

  return starts;
}

function parseTimeParts_(text) {
  var match = String(text || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) { return { hours: 9, minutes: 0 }; }
  return {
    hours:   Math.max(0, Math.min(23, Number(match[1]))),
    minutes: Math.max(0, Math.min(59, Number(match[2])))
  };
}

function normalizeWeekOfMonth_(value) {
  var lowered = String(value || "").toLowerCase();
  if (lowered === "last" || lowered === "-1") { return -1; }
  var n = Number(value);
  return (n >= 1 && n <= 5) ? n : 1;
}

function normalizeDayOfWeek_(value) {
  var map = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6
  };
  var key = String(value || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(map, key)) { return map[key]; }
  var dayMap = { "日": 0, "月": 1, "火": 2, "水": 3, "木": 4, "金": 5, "土": 6 };
  if (Object.prototype.hasOwnProperty.call(dayMap, value)) { return dayMap[value]; }
  var n = Number(value);
  return (n >= 0 && n <= 6) ? n : 0;
}

function nthWeekdayOfMonth_(year, month, weekOfMonth, dayOfWeek) {
  if (weekOfMonth === -1) {
    var lastDay = new Date(year, month + 1, 0);
    return new Date(year, month, lastDay.getDate() - (lastDay.getDay() - dayOfWeek + 7) % 7);
  }

  var firstDay  = new Date(year, month, 1);
  var firstDiff = (dayOfWeek - firstDay.getDay() + 7) % 7;
  var dateNum   = 1 + firstDiff + (weekOfMonth - 1) * 7;
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  if (dateNum > daysInMonth) {
    var lastDay2 = new Date(year, month + 1, 0);
    return new Date(year, month, lastDay2.getDate() - (lastDay2.getDay() - dayOfWeek + 7) % 7);
  }
  return new Date(year, month, dateNum);
}

// ============================================================
// スプレッドシート操作ヘルパー
// ============================================================
function openSpreadsheetByName_(spreadsheetName) {
  var files = DriveApp.getFilesByName(spreadsheetName);
  if (!files.hasNext()) { throw new Error("対象スプレッドシートが見つかりません: " + spreadsheetName); }
  var file = files.next();
  if (files.hasNext()) { throw new Error("同名スプレッドシートが複数あります。名前を一意にしてください: " + spreadsheetName); }
  return SpreadsheetApp.open(file);
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  var existing = spreadsheet.getSheetByName(sheetName);
  return existing || spreadsheet.insertSheet(sheetName);
}

function ensureColumnCount_(sheet, requiredColumns) {
  var currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}