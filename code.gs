const LEDGER_SPREADSHEET_NAME = "福山市若松町内会_管理台帳";
const TOWN_CALENDAR_ID = "replace-with-your-town-calendar-id@group.calendar.google.com";
const EQUIPMENT_CALENDAR_ID = "replace-with-your-equipment-calendar-id@group.calendar.google.com";
const GALLERY_FOLDER_ID = "replace-with-your-gallery-folder-id";

const LEDGER_HEADERS = {
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
    "アルバム名/カテゴリ"
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
  "イベント参加者": [
    "申込ID",
    "イベントID",
    "参加者名",
    "連絡先",
    "登録日時"
  ],
  "イベントカテゴリ": [
    "カテゴリ名",
    "作成日時",
    "作成者",
    "備考"
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

const SHEET_NAME_ALIASES = {
  "掲示板(意見交換": "掲示板(意見交換)"
};

/**
 * Webアプリ GET エンドポイント。
 * action:
 * - getOpinions
 * - getEvents
 * - getGallery
 * - getEquipment
 */
function doGet(e) {
  try {
    ensureLedgerStructure_();
    const action = (e && e.parameter && (e.parameter.action || e.parameter.type)) || "";

    switch (action) {
      case "getOpinions":
        return jsonResponse_({ ok: true, action: action, data: getOpinions_() });
      case "getEvents":
        return jsonResponse_({ ok: true, action: action, data: getEvents_() });
      case "calendar_events":
        return jsonResponse_({ ok: true, action: action, data: getCalendarEventsForFrontend_() });
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
          supportedActions: ["getOpinions", "getEvents", "calendar_events", "getGallery", "getEquipment", "equipment_status"]
        });
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error && error.message || error) });
  }
}

/**
 * Webアプリ POST エンドポイント。
 * body.action:
 * - login
 * - addOpinion
 * - addEvent
 * - addRecurringEvent
 * - joinEvent
 * - reserveEquipment
 * - uploadPhoto
 */
function doPost(e) {
  try {
    ensureLedgerStructure_();
    const body = parsePostJson_(e);
    const action = body.action || "";

    switch (action) {
      case "login":
        return jsonResponse_({ ok: true, action: action, data: login_(body) });
      case "addOpinion":
        return jsonResponse_({ ok: true, action: action, data: addOpinion_(body) });
      case "addEvent":
        return jsonResponse_({ ok: true, action: action, data: addEvent_(body) });
      case "addRecurringEvent":
        return jsonResponse_({ ok: true, action: action, data: addRecurringEvent_(body) });
      case "joinEvent":
        return jsonResponse_({ ok: true, action: action, data: joinEvent_(body) });
      case "reserveEquipment":
        return jsonResponse_({ ok: true, action: action, data: reserveEquipment_(body) });
      case "uploadPhoto":
        return jsonResponse_({ ok: true, action: action, data: uploadPhoto_(body) });
      case "addPeople":
        return jsonResponse_({ ok: true, action: action, data: addPeople_(body) });
      case "addEquipmentMaster":
        return jsonResponse_({ ok: true, action: action, data: addEquipmentMaster_(body) });
      case "addEventCategory":
        return jsonResponse_({ ok: true, action: action, data: addEventCategory_(body) });
      case "uploadDocument":
        return jsonResponse_({ ok: true, action: action, data: uploadDocument_(body) });
      default:
        return jsonResponse_({
          ok: false,
          error: "未対応のactionです。",
          receivedAction: action,
          supportedActions: [
            "login",
            "addOpinion",
            "addEvent",
            "addRecurringEvent",
            "joinEvent",
            "reserveEquipment",
            "uploadPhoto",
            "addPeople",
            "addEquipmentMaster",
            "addEventCategory",
            "uploadDocument"
          ]
        });
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error && error.message || error) });
  }
}

/**
 * 町内会管理台帳のシート構成をクレンジングし、必要ヘッダーを初期化する。
 * - 対象スプレッドシート名: 福山市若松町内会_管理台帳
 * - 対象シート: 役員_会員台帳, 掲示板(意見交換), 備品予約, 備品台帳,
 *   写真メタデータ, イベント企画, イベント参加者
 */
function fixAndInitializeSheets() {
  const spreadsheet = getLedgerSpreadsheet();
  const results = [];

  Object.keys(LEDGER_HEADERS).forEach(function(sheetName) {
    const headers = LEDGER_HEADERS[sheetName];
    const sheet = getOrCreateSheet_(spreadsheet, sheetName);

    ensureColumnCount_(sheet, headers.length);

    // 既存ヘッダー残骸を避けるため、1行目を一度クリアしてから上書きする。
    sheet.getRange(1, 1, 1, sheet.getMaxColumns()).clearContent();
    sheet
      .getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight("bold");

    results.push(sheetName + ": " + headers.length + "列を初期化");
  });

  Logger.log("fixAndInitializeSheets completed: " + results.join(" / "));
}

/**
 * 既存の安全設計を共通化した、管理台帳スプレッドシート取得ヘルパー。
 */
function getLedgerSpreadsheet() {
  return openSpreadsheetByName_(LEDGER_SPREADSHEET_NAME);
}

function getOpinions_() {
  const spreadsheet = getLedgerSpreadsheet();
  const sheet = getOrCreateSheet_(spreadsheet, "掲示板(意見交換)");
  const values = sheet.getDataRange().getValues();

  if (!values || values.length <= 1) {
    return [];
  }

  const headers = values[0].map(function(header) {
    return String(header || "").trim();
  });

  const records = values.slice(1)
    .filter(function(row) {
      return row.some(function(cell) {
        return String(cell || "") !== "";
      });
    })
    .map(function(row) {
      const obj = {};
      headers.forEach(function(header, index) {
        obj[header] = row[index];
      });
      return obj;
    });

  records.sort(function(a, b) {
    const aDate = parseDateOrNull_(a["日時"]);
    const bDate = parseDateOrNull_(b["日時"]);
    const aTime = aDate ? aDate.getTime() : 0;
    const bTime = bDate ? bDate.getTime() : 0;
    return bTime - aTime;
  });

  return records;
}

function getEvents_() {
  try {
    const spreadsheet = getLedgerSpreadsheet();
    const sheet = getOrCreateSheet_(spreadsheet, "イベント企画");
    const values = sheet.getDataRange().getValues();

    if (!values || values.length <= 1) {
      return { success: true, data: [] };
    }

    const headers = values[0].map(function(header) {
      return String(header || "").trim();
    });

    const records = values.slice(1)
      .filter(function(row) {
        return row.some(function(cell) {
          return String(cell || "") !== "";
        });
      })
      .map(function(row) {
        const obj = {};
        headers.forEach(function(header, index) {
          obj[header] = row[index];
        });
        return obj;
      });

    return { success: true, data: records };
  } catch (error) {
    return {
      success: false,
      error: String(error && error.message || error)
    };
  }
}

function getGallery_() {
  return readSheetAsObjects_("写真メタデータ");
}

function getCalendarEventsForFrontend_() {
  const rows = readSheetAsObjects_("イベント企画");
  return rows.map(function(row, index) {
    return {
      id: String(row["イベントID"] || "EV-" + index),
      title: String(row["タイトル"] || ""),
      start: toIsoTextOrOriginal_(row["開始日時"]),
      end: toIsoTextOrOriginal_(row["終了日時"]),
      location: String(row["場所"] || ""),
      description: String(row["説明"] || "")
    };
  }).filter(function(item) {
    return !!item.start;
  });
}

function getEquipmentStatusForFrontend_() {
  const rows = readSheetAsObjects_("備品予約");
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
  }).filter(function(item) {
    return !!item.equipmentLabel;
  });
}

function getEquipment_() {
  return {
    masters: readSheetAsObjects_("備品台帳"),
    reservations: readSheetAsObjects_("備品予約")
  };
}

function login_(params) {
  try {
    const userId = String(params.userId || "").trim();
    const pin = String(params.pin || "").trim();

    if (!userId || !pin) {
      return {
        success: false,
        message: "ユーザーIDまたはパスワード(PIN)が正しくありません。"
      };
    }

    const spreadsheet = getLedgerSpreadsheet();
    const sheet = getOrCreateSheet_(spreadsheet, "役員_会員台帳");
    const values = sheet.getDataRange().getValues();

    if (!values || values.length <= 1) {
      return {
        success: false,
        message: "ユーザーIDまたはパスワード(PIN)が正しくありません。"
      };
    }

    const headers = values[0].map(function(header) {
      return String(header || "").trim();
    });
    const userIdIndex = headers.indexOf("ユーザーID(メール等)");
    const pinIndex = headers.indexOf("PIN(4桁数字)");
    const nameIndex = headers.indexOf("氏名");
    const roleIndex = headers.indexOf("役職(役員/一般)");

    const matchedRow = values.slice(1).find(function(row) {
      return String(row[userIdIndex] || "").trim() === userId && String(row[pinIndex] || "").trim() === pin;
    });

    if (!matchedRow) {
      return {
        success: false,
        message: "ユーザーIDまたはパスワード(PIN)が正しくありません。"
      };
    }

    return {
      success: true,
      message: "ログインに成功しました",
      role: String(matchedRow[roleIndex] || ""),
      name: String(matchedRow[nameIndex] || "")
    };
  } catch (error) {
    return {
      success: false,
      error: String(error && error.message || error)
    };
  }
}

function addOpinion_(params) {
  try {
    const spreadsheet = getLedgerSpreadsheet();
    const sheet = getOrCreateSheet_(spreadsheet, "掲示板(意見交換)");

    const postId = "OP-" + new Date().getTime();
    const postedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");

    const row = [
      postId,
      postedAt,
      String(params.name || ""),
      String(params.category || ""),
      String(params.content || ""),
      "未対応",
      "公開中"
    ];

    // ヘッダー順: [投稿ID, 日時, 名前, カテゴリ, 内容, 返信状態, 管理ステータス]
    sheet.appendRow(row);

    return { success: true, message: "投稿が完了しました" };
  } catch (error) {
    return {
      success: false,
      error: String(error && error.message || error)
    };
  }
}

function addEvent_(params) {
  try {
    const title = String(params.title || "").trim();
    const start = parseDateOrThrow_(params.start, "start");
    const end = parseDateOrThrow_(params.end, "end");
    const place = String(params.place || "").trim();
    const creator = String(params.creator || "").trim();
    const minParticipants = Number(params.minParticipants || 0);
    const maxParticipants = Number(params.maxParticipants || 0);
    const description = String(params.description || "").trim();

    if (!title) {
      throw new Error("title は必須です。");
    }
    if (end.getTime() <= start.getTime()) {
      throw new Error("end は start より後の日時を指定してください。");
    }

    const calendar = CalendarApp.getCalendarById(TOWN_CALENDAR_ID);
    if (!calendar) {
      throw new Error("指定カレンダーが見つかりません。TOWN_CALENDAR_ID を確認してください。");
    }

    const eventDescription = description + (creator ? "\n企画者: " + creator : "");
    const event = calendar.createEvent(title, start, end, {
      location: place,
      description: eventDescription
    });

    const eventId = "EV-" + new Date().getTime();
    const row = [
      eventId,
      String(event.getId() || ""),
      Utilities.formatDate(start, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      Utilities.formatDate(end, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      title,
      creator,
      place,
      minParticipants,
      maxParticipants,
      description
    ];

    const spreadsheet = getLedgerSpreadsheet();
    const sheet = getOrCreateSheet_(spreadsheet, "イベント企画");
    sheet.appendRow(row);

    return {
      success: true,
      eventId: eventId,
      calendarEventId: String(event.getId() || "")
    };
  } catch (error) {
    return {
      success: false,
      error: String(error && error.message || error)
    };
  }
}

function addRecurringEvent_(params) {
  try {
    const title = String(params.title || "").trim();
    const place = String(params.place || "").trim();
    const creator = String(params.creator || "").trim();
    const minParticipants = Number(params.minParticipants || 0);
    const maxParticipants = Number(params.maxParticipants || 0);
    const description = String(params.description || "").trim();
    const durationMinutes = Math.max(1, Number(params.durationMinutes || 60));

    if (!title) {
      throw new Error("title は必須です。");
    }

    const starts = computeRecurringStartsForOneYear_(params);
    if (starts.length === 0) {
      throw new Error("定例日を計算できませんでした。パラメータを確認してください。");
    }
    if (starts.length !== 12) {
      throw new Error("定例行事は12回分の日時が必要です。specificDates または条件を見直してください。");
    }

    const calendar = CalendarApp.getCalendarById(TOWN_CALENDAR_ID);
    if (!calendar) {
      throw new Error("指定カレンダーが見つかりません。TOWN_CALENDAR_ID を確認してください。");
    }

    const spreadsheet = getLedgerSpreadsheet();
    const sheet = getOrCreateSheet_(spreadsheet, "イベント企画");
    const createdIds = [];
    const createdCalendarIds = [];

    starts.forEach(function(startDate) {
      const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
      const eventDescription = description + (creator ? "\n企画者: " + creator : "");
      const calendarEvent = calendar.createEvent(title, startDate, endDate, {
        location: place,
        description: eventDescription
      });

      const eventId = "EV-" + startDate.getTime() + "-" + Math.floor(Math.random() * 1000);
      const row = [
        eventId,
        String(calendarEvent.getId() || ""),
        Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
        Utilities.formatDate(endDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
        title,
        creator,
        place,
        minParticipants,
        maxParticipants,
        description
      ];
      sheet.appendRow(row);
      createdIds.push(eventId);
      createdCalendarIds.push(String(calendarEvent.getId() || ""));
    });

    return {
      success: true,
      count: createdIds.length,
      eventIds: createdIds,
      calendarEventIds: createdCalendarIds
    };
  } catch (error) {
    return {
      success: false,
      error: String(error && error.message || error)
    };
  }
}

function joinEvent_(params) {
  try {
    const eventId = String(params.eventId || "").trim();
    const name = String(params.name || "").trim();
    const contact = String(params.contact || "").trim();

    if (!eventId || !name || !contact) {
      throw new Error("eventId, name, contact は必須です。");
    }

    const spreadsheet = getLedgerSpreadsheet();
    const eventRows = readSheetAsObjects_("イベント企画");
    const targetEvent = eventRows.find(function(row) {
      return String(row["イベントID"] || "").trim() === eventId;
    });

    if (!targetEvent) {
      throw new Error("指定イベントが見つかりません: " + eventId);
    }

    const maxParticipants = Number(targetEvent["最大人数"] || 0);
    const joinRows = readSheetAsObjects_("イベント参加者");
    const currentCount = joinRows.filter(function(row) {
      return String(row["イベントID"] || "").trim() === eventId;
    }).length;

    if (maxParticipants > 0 && currentCount >= maxParticipants) {
      return {
        success: false,
        message: "定員に達したため参加登録できません"
      };
    }

    const participantSheet = getOrCreateSheet_(spreadsheet, "イベント参加者");
    const row = [
      "EN-" + new Date().getTime(),
      eventId,
      name,
      contact,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss")
    ];
    participantSheet.appendRow(row);

    return {
      success: true,
      message: "参加登録が完了しました"
    };
  } catch (error) {
    return {
      success: false,
      error: String(error && error.message || error)
    };
  }
}

function reserveEquipment_(params) {
  try {
    const applicant = String(params.applicant || "").trim();
    const phone = String(params.phone || "").trim();
    const group = String(params.group || "").trim();
    const items = Array.isArray(params.items) ? params.items : [];

    if (!applicant) {
      throw new Error("applicant は必須です。");
    }
    if (items.length === 0) {
      throw new Error("items は1件以上必要です。");
    }

    const normalizedItems = items.map(function(item, index) {
      const equipment = String(item?.equipment || item?.equipmentLabel || item?.equipmentName || item?.name || "").trim();
      const quantity = Number(item?.quantity || 0);
      const loanDate = parseDateOrThrow_(item?.loanDate || item?.startDate || item?.loan || item?.start, "items[" + index + "].loanDate");
      const returnDate = parseDateOrThrow_(item?.returnDate || item?.endDate || item?.return || item?.end, "items[" + index + "].returnDate");

      if (!equipment) {
        throw new Error("items[" + index + "].equipment は必須です。");
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("items[" + index + "].quantity は1以上で指定してください。");
      }
      if (loanDate.getTime() > returnDate.getTime()) {
        throw new Error("items[" + index + "].loanDate は returnDate 以下で指定してください。");
      }

      return {
        equipment: equipment,
        equipmentId: String(item?.equipmentId || "").trim(),
        quantity: quantity,
        loanDate: loanDate,
        returnDate: returnDate
      };
    });

    const spreadsheet = getLedgerSpreadsheet();
    const masters = readSheetAsObjects_("備品台帳");
    const reservations = readSheetAsObjects_("備品予約");
    const equipmentCalendar = CalendarApp.getCalendarById(EQUIPMENT_CALENDAR_ID);

    if (!equipmentCalendar) {
      throw new Error("備品予約用カレンダーが見つかりません。EQUIPMENT_CALENDAR_ID を確認してください。");
    }

    // 先に全件の在庫判定を行い、1件でも不足があれば全体を中断する。
    for (let i = 0; i < normalizedItems.length; i += 1) {
      const item = normalizedItems[i];
      const master = masters.find(function(row) {
        return String(row["備品名"] || "").trim() === item.equipment;
      });

      if (!master) {
        throw new Error("備品台帳に存在しない備品です: " + item.equipment);
      }

      const totalStock = Number(master["総在庫数"] || 0);
      const usedQty = reservations
        .filter(function(row) {
          if (String(row["備品名"] || "").trim() !== item.equipment) {
            return false;
          }

          const status = String(row["ステータス"] || "").trim();
          if (status === "キャンセル") {
            return false;
          }

          const reservedLoanDate = parseDateOrNull_(row["貸出日"]);
          const reservedReturnDate = parseDateOrNull_(row["返納日"]);
          if (!reservedLoanDate || !reservedReturnDate) {
            return false;
          }

          const overlap = !(reservedReturnDate.getTime() < item.loanDate.getTime() || reservedLoanDate.getTime() > item.returnDate.getTime());
          return overlap;
        })
        .reduce(function(sum, row) {
          return sum + Number(row["数量"] || 0);
        }, 0);

      const remaining = totalStock - usedQty;
      if (remaining < item.quantity) {
        return {
          success: false,
          message: "「" + item.equipment + "」は指定期間中に在庫が不足（残り" + Math.max(0, remaining) + "個）しているため、予約を完了できません。"
        };
      }
    }

    const createdRows = [];
    normalizedItems.forEach(function(item, index) {
      const calendarEndDate = new Date(item.returnDate.getTime());
      calendarEndDate.setDate(calendarEndDate.getDate() + 1);

      const calendarEvent = equipmentCalendar.createAllDayEvent(
        "備品貸出: " + item.equipment,
        item.loanDate,
        calendarEndDate
      );

      const reservationId = "EQ-" + new Date().getTime() + "-" + (index + 1);
      const row = [
        reservationId,
        String(calendarEvent.getId() || ""),
        item.equipment,
        item.quantity,
        toDate_(item.loanDate),
        toDate_(item.returnDate),
        applicant + (phone || group ? " / " + [phone, group].filter(Boolean).join(" / ") : ""),
        "予約確定"
      ];

      appendRow_("備品予約", row);
      createdRows.push(row);
    });

    return {
      success: true,
      message: "備品の予約が完了しました"
    };
  } catch (error) {
    return {
      success: false,
      error: String(error && error.message || error)
    };
  }
}

function uploadPhoto_(params) {
  try {
    const photoDataRaw = String(params.photoData || params.base64Data || "").trim();
    const fileName = String(params.fileName || "photo.jpg").trim();
    const uploader = String(params.uploader || params.uploaderName || params.authorName || "").trim();
    const comment = String(params.comment || params.description || "").trim();
    const album = String(params.album || params.category || "").trim();

    if (!photoDataRaw) {
      throw new Error("photoData は必須です。");
    }

    const match = photoDataRaw.match(/^data:([^;]+);base64,(.*)$/i);
    const mimeType = match ? match[1] : (String(params.mimeType || "").trim() || "image/jpeg");
    const base64Body = match ? match[2] : photoDataRaw;
    const bytes = Utilities.base64Decode(base64Body);
    const blob = Utilities.newBlob(bytes, mimeType, fileName || ("photo_" + generateId_("IMG") + ".jpg"));

    const folder = DriveApp.getFolderById(GALLERY_FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    const imageUrl = "https://drive.google.com/uc?export=view&id=" + fileId;
    const photoId = "PH-" + new Date().getTime();
    const postedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd");

    const row = [
      photoId,
      fileId,
      imageUrl,
      postedAt,
      uploader,
      comment,
      album
    ];

    appendRow_("写真メタデータ", row);

    return {
      success: true,
      message: "写真のアップロードが完了しました"
    };
  } catch (error) {
    return {
      success: false,
      error: String(error && error.message || error)
    };
  }
}

function readSheetAsObjects_(sheetName) {
  const spreadsheet = getLedgerSpreadsheet();
  const sheet = getOrCreateSheet_(spreadsheet, sheetName);
  const values = sheet.getDataRange().getValues();
  if (!values || values.length <= 1) {
    return [];
  }

  const headers = values[0].map(function(header) {
    return String(header || "").trim();
  });

  return values.slice(1)
    .filter(function(row) {
      return row.some(function(cell) {
        return String(cell || "") !== "";
      });
    })
    .map(function(row) {
      const obj = {};
      headers.forEach(function(header, index) {
        obj[header] = row[index];
      });
      return obj;
    });
}

function appendRow_(sheetName, rowValues) {
  const spreadsheet = getLedgerSpreadsheet();
  const sheet = getOrCreateSheet_(spreadsheet, sheetName);
  ensureColumnCount_(sheet, rowValues.length);
  sheet.appendRow(rowValues);
}

function parsePostJson_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch (error) {
    const normalized = String(raw || "").trim();
    if (!normalized) {
      body = {};
    } else if (normalized.indexOf("=") >= 0 && normalized.indexOf("{") === -1) {
      const params = {};
      normalized.split("&").forEach(function(pair) {
        const parts = pair.split("=");
        const key = decodeURIComponent(parts[0] || "");
        const value = decodeURIComponent(parts[1] || "");
        params[key] = value;
      });
      body = params;
    } else {
      throw error;
    }
  }
  if (!body || typeof body !== "object") {
    throw new Error("POSTボディはJSONオブジェクトである必要があります。");
  }
  return body;
}

function ensureLedgerStructure_() {
  const spreadsheet = getLedgerSpreadsheet();

  Object.keys(SHEET_NAME_ALIASES).forEach(function(fromName) {
    const toName = SHEET_NAME_ALIASES[fromName];
    const fromSheet = spreadsheet.getSheetByName(fromName);
    const toSheet = spreadsheet.getSheetByName(toName);
    if (fromSheet && !toSheet) {
      fromSheet.setName(toName);
    }
  });

  Object.keys(LEDGER_HEADERS).forEach(function(sheetName) {
    const headers = LEDGER_HEADERS[sheetName];
    const sheet = getOrCreateSheet_(spreadsheet, sheetName);
    ensureColumnCount_(sheet, headers.length);
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(function(value) {
      return String(value || "").trim();
    });
    const same = current.join("||") === headers.join("||");
    if (!same) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    }
  });
}

function normalizeDateText_(value) {
  const date = parseDateOrNull_(value);
  return date ? toDate_(date) : "";
}

function toIsoTextOrOriginal_(value) {
  const date = parseDateOrNull_(value);
  if (!date) {
    return String(value || "").trim();
  }
  return toIso_(date);
}

function jsonResponse_(payload) {
  // Apps ScriptのTextOutputは任意ヘッダー設定に制約があるため、CORS情報もJSONに含める。
  const envelope = {
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

function computeRecurringStartsForOneYear_(params) {
  const startTime = parseTimeParts_(params.startTime || params.time || "09:00");

  // 1) specificDates があれば優先し、先頭12件を採用する。
  const specificDates = Array.isArray(params.specificDates) ? params.specificDates : [];
  if (specificDates.length > 0) {
    return specificDates
      .map(function(dateText) {
        const date = parseDateOrNull_(dateText);
        if (!date) {
          return null;
        }
        return new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          startTime.hours,
          startTime.minutes,
          0,
          0
        );
      })
      .filter(function(date) {
        return !!date;
      })
      .sort(function(a, b) {
        return a.getTime() - b.getTime();
      })
      .slice(0, 12);
  }

  // 2) 毎月第X曜日パターン（例: 第2日曜）で12回分を生成する。
  const weekOfMonth = normalizeWeekOfMonth_(params.weekOfMonth || params.nth || 1);
  const dayOfWeek = normalizeDayOfWeek_(params.dayOfWeek || params.weekday || 0);
  const base = parseDateOrNull_(params.start || params.startDate) || new Date();

  const starts = [];
  for (let i = 0; i < 12; i += 1) {
    const year = base.getFullYear();
    const month = base.getMonth() + i;
    const firstDay = new Date(year, month, 1);
    const target = nthWeekdayOfMonth_(firstDay.getFullYear(), firstDay.getMonth(), weekOfMonth, dayOfWeek);
    target.setHours(startTime.hours, startTime.minutes, 0, 0);
    starts.push(target);
  }

  return starts;
}

function parseTimeParts_(text) {
  const match = String(text || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { hours: 9, minutes: 0 };
  }
  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return { hours: hours, minutes: minutes };
}

function normalizeWeekOfMonth_(value) {
  const lowered = String(value || "").toLowerCase();
  if (lowered === "last" || lowered === "-1") {
    return -1;
  }
  const n = Number(value);
  if (n >= 1 && n <= 5) {
    return n;
  }
  return 1;
}

function normalizeDayOfWeek_(value) {
  const map = {
    sun: 0,
    sunday: 0,
    日: 0,
    mon: 1,
    monday: 1,
    月: 1,
    tue: 2,
    tuesday: 2,
    火: 2,
    wed: 3,
    wednesday: 3,
    水: 3,
    thu: 4,
    thursday: 4,
    木: 4,
    fri: 5,
    friday: 5,
    金: 5,
    sat: 6,
    saturday: 6,
    土: 6
  };
  const key = String(value || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    return map[key];
  }
  const n = Number(value);
  if (n >= 0 && n <= 6) {
    return n;
  }
  return 0;
}

function nthWeekdayOfMonth_(year, month, weekOfMonth, dayOfWeek) {
  if (weekOfMonth === -1) {
    const lastDay = new Date(year, month + 1, 0);
    const diff = (lastDay.getDay() - dayOfWeek + 7) % 7;
    return new Date(year, month, lastDay.getDate() - diff);
  }

  const firstDay = new Date(year, month, 1);
  const firstDiff = (dayOfWeek - firstDay.getDay() + 7) % 7;
  const date = 1 + firstDiff + (weekOfMonth - 1) * 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if (date > daysInMonth) {
    const lastDay = new Date(year, month + 1, 0);
    const diff = (lastDay.getDay() - dayOfWeek + 7) % 7;
    return new Date(year, month, lastDay.getDate() - diff);
  }
  return new Date(year, month, date);
}

function parseDateOrThrow_(value, fieldName) {
  const date = parseDateOrNull_(value);
  if (!date) {
    throw new Error(fieldName + " の日時形式が不正です。");
  }
  return date;
}

function parseDateOrNull_(value) {
  if (!value && value !== 0) {
    return null;
  }
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return value;
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
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
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmss");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return prefix + "-" + ts + "-" + rand;
}

/**
 * 同名スプレッドシートを Drive から検索して開く。
 */
function openSpreadsheetByName_(spreadsheetName) {
  const files = DriveApp.getFilesByName(spreadsheetName);

  if (!files.hasNext()) {
    throw new Error("対象スプレッドシートが見つかりません: " + spreadsheetName);
  }

  const file = files.next();
  if (files.hasNext()) {
    throw new Error("同名スプレッドシートが複数あります。名前を一意にしてください: " + spreadsheetName);
  }

  return SpreadsheetApp.open(file);
}

/**
 * シートがなければ作成し、あれば既存を返す。
 */
function getOrCreateSheet_(spreadsheet, sheetName) {
  const existing = spreadsheet.getSheetByName(sheetName);
  return existing || spreadsheet.insertSheet(sheetName);
}

/**
 * ヘッダー設定に必要な列数まで列を拡張する。
 */
function ensureColumnCount_(sheet, requiredColumns) {
  const currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}

function addPeople_(params) {
  try {
    const userId = String(params.userId || params.email || "").trim();
    const pin = String(params.pin || "").trim();
    const name = String(params.name || "").trim();
    const role = String(params.role || "一般").trim();

    if (!userId || !pin || !name) {
      throw new Error("userId, pin, name は必須です。");
    }

    appendRow_("役員_会員台帳", [userId, pin, name, role === "役員" ? "役員" : "一般"]);
    return { success: true, message: "役員_会員台帳へ登録しました" };
  } catch (error) {
    return { success: false, error: String(error && error.message || error) };
  }
}

function addEquipmentMaster_(params) {
  try {
    const equipmentId = String(params.equipmentId || generateId_("EQM")).trim();
    const equipmentName = String(params.equipmentName || params.name || "").trim();
    const stock = Number(params.stock || 0);
    const location = String(params.location || "").trim();
    const state = String(params.state || "良好").trim();
    const memo = String(params.memo || "").trim();

    if (!equipmentName) {
      throw new Error("equipmentName は必須です。");
    }
    if (!Number.isFinite(stock) || stock < 0) {
      throw new Error("stock は0以上の数値で指定してください。");
    }

    appendRow_("備品台帳", [equipmentId, equipmentName, stock, location, state || "良好", memo]);
    return { success: true, message: "備品台帳へ登録しました" };
  } catch (error) {
    return { success: false, error: String(error && error.message || error) };
  }
}

function addEventCategory_(params) {
  try {
    const categoryName = String(params.categoryName || params.name || "").trim();
    const creator = String(params.creator || "").trim();
    const note = String(params.note || params.memo || "").trim();
    if (!categoryName) {
      throw new Error("categoryName は必須です。");
    }

    appendRow_("イベントカテゴリ", [
      categoryName,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      creator,
      note
    ]);

    return { success: true, message: "イベントカテゴリへ登録しました" };
  } catch (error) {
    return { success: false, error: String(error && error.message || error) };
  }
}

function uploadDocument_(params) {
  try {
    const destination = String(params.destination || "documents").trim();
    const category = String(params.category || "").trim();
    const title = String(params.title || params.fileName || "document.pdf").trim();
    const uploader = String(params.uploader || params.uploaderName || "").trim();
    const fileDataRaw = String(params.fileData || params.base64Data || "").trim();

    if (!fileDataRaw) {
      throw new Error("fileData は必須です。");
    }

    const match = fileDataRaw.match(/^data:([^;]+);base64,(.*)$/i);
    const mimeType = match ? match[1] : (String(params.mimeType || "application/pdf").trim() || "application/pdf");
    const base64Body = match ? match[2] : fileDataRaw;
    const bytes = Utilities.base64Decode(base64Body);
    const blob = Utilities.newBlob(bytes, mimeType, title);

    const targetFolderId = String(params.folderId || GALLERY_FOLDER_ID || "").trim();
    const folder = DriveApp.getFolderById(targetFolderId);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    const docUrl = file.getUrl();
    appendRow_("文書メタデータ", [
      "DOC-" + new Date().getTime(),
      fileId,
      docUrl,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd"),
      uploader,
      category,
      title,
      destination
    ]);

    return {
      success: true,
      message: "文書のアップロードが完了しました",
      fileId: fileId,
      url: docUrl
    };
  } catch (error) {
    return { success: false, error: String(error && error.message || error) };
  }
}