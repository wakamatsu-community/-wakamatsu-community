const fs = require('fs');
const path = require('path');
const express = require('express');
const admin = require('firebase-admin');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const STATIC_DIRS = [path.join(ROOT, 'dist'), ROOT];
const CACHE_TTL_MS = 60 * 1000; // 60秒キャッシュ
const WARM_UP_COLLECTIONS = ['events', 'eventPlanning'];

let firebaseInitialized = false;

// ---------- インメモリキャッシュ ----------
const collectionCache = new Map();

function getCached(key) {
  const entry = collectionCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    collectionCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  collectionCache.set(key, { value, timestamp: Date.now() });
}

function invalidateCache(collectionName) {
  for (const key of collectionCache.keys()) {
    if (key.startsWith(collectionName + ':')) {
      collectionCache.delete(key);
    }
  }
}
// -----------------------------------------

function countBraceDelta(text) {
  let delta = 0;
  for (const char of String(text)) {
    if (char === '{') {
      delta += 1;
    } else if (char === '}') {
      delta -= 1;
    }
  }
  return delta;
}

function loadDotEnvLocal() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const prefix = 'FIREBASE_SERVICE_ACCOUNT=';
  let collecting = false;
  let buffer = '';
  let braceDepth = 0;

  for (const line of lines) {
    if (!collecting) {
      if (!line.startsWith(prefix)) {
        continue;
      }

      collecting = true;
      buffer = line.slice(prefix.length);
      braceDepth += countBraceDelta(buffer);
      if (braceDepth <= 0 && buffer.trim()) {
        process.env.FIREBASE_SERVICE_ACCOUNT = buffer.trim();
        return;
      }
      continue;
    }

    buffer += `\n${line}`;
    braceDepth += countBraceDelta(line);
    if (braceDepth <= 0) {
      process.env.FIREBASE_SERVICE_ACCOUNT = buffer.trim();
      return;
    }
  }
}

function initializeFirestore() {
  if (firebaseInitialized) {
    return admin.firestore();
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT が未設定です。');
  }

  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  firebaseInitialized = true;
  return admin.firestore();
}

function toIso(value) {
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
  }
  return String(value);
}

function normalizeDoc(data, id) {
  const source = data && typeof data === 'object' ? data : {};
  const date = String(source.date || source['日付'] || '').trim();
  const time = String(source.time || source['時間'] || '').trim();
  const start = toIso(source.start || source['開始日時'] || '');
  const end = toIso(source.end || source['終了日時'] || '');

  return {
    ...source,
    id: String(source.id || id || '').trim(),
    eventId: String(source.eventId || source.id || id || '').trim(),
    title: String(source.title || source['タイトル'] || source['行事名'] || source['イベント名'] || '').trim(),
    date: date || (start ? start.slice(0, 10) : ''),
    time,
    start,
    end,
    place: String(source.place || source['場所'] || source['会場'] || '').trim(),
    description: String(source.description || source['説明'] || source['内容'] || '').trim(),
    note: String(source.note || source['備考'] || source['メモ'] || '').trim(),
    category: String(source.category || source['カテゴリ'] || '').trim(),
    scheduleLabel: String(source.scheduleLabel || source['開催日程'] || date || start || '').trim()
  };
}

function sortDocs(rows, collectionName) {
  const preferredField = collectionName === 'eventPlanning' ? 'start' : 'start';
  return rows.sort((left, right) => {
    const leftKey = String(left?.[preferredField] || left?.date || left?.scheduleLabel || left?.eventId || left?.id || '');
    const rightKey = String(right?.[preferredField] || right?.date || right?.scheduleLabel || right?.eventId || right?.id || '');
    return leftKey.localeCompare(rightKey, 'ja');
  });
}

async function fetchFromFirestore(collectionName, query) {
  const db = initializeFirestore();
  let ref = db.collection(collectionName);

  if (query.orderBy) {
    ref = ref.orderBy(String(query.orderBy), String(query.direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc');
  }

  const limit = Number(query.limit || 200);
  if (Number.isFinite(limit) && limit > 0) {
    ref = ref.limit(limit);
  }

  const snapshot = await ref.get();
  const data = sortDocs(snapshot.docs.map((doc) => normalizeDoc(doc.data(), doc.id)), collectionName);
  return { data, collection: collectionName, count: data.length, _source: 'firestore-server' };
}

async function readCollection(collectionName, query) {
  const cacheKey = `${collectionName}:${JSON.stringify(query)}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return { ...cached, _source: 'firestore-cache' };
  }

  const result = await fetchFromFirestore(collectionName, query);
  setCache(cacheKey, result);
  return result;
}

async function readDocument(collectionName, id) {
  const db = initializeFirestore();
  const snapshot = await db.collection(collectionName).doc(id).get();
  if (!snapshot.exists) {
    return null;
  }
  return normalizeDoc(snapshot.data(), snapshot.id);
}

function startServer() {
  loadDotEnvLocal();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      serviceAccountConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
      cachedCollections: Array.from(collectionCache.keys())
    });
  });

  app.delete('/api/cache', (_req, res) => {
    collectionCache.clear();
    res.json({ ok: true, message: 'Cache cleared' });
  });

  app.get('/api/firestore/:collection', async (req, res) => {
    try {
      const result = await readCollection(req.params.collection, req.query);
      res.json(result);
    } catch (error) {
      console.error('Firestore collection read failed:', error);
      const message = String(error && error.message || error);
      if (String(error && error.code || '') === '5' || message.includes('NOT_FOUND')) {
        res.status(503).json({
          error: 'Firestore database not ready. Firebase コンソールで Firestore を有効化し、デフォルトデータベースを作成してください。',
          details: message
        });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/firestore/:collection/:id', async (req, res) => {
    try {
      const result = await readDocument(req.params.collection, req.params.id);
      if (!result) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(result);
    } catch (error) {
      console.error('Firestore document read failed:', error);
      const message = String(error && error.message || error);
      if (String(error && error.code || '') === '5' || message.includes('NOT_FOUND')) {
        res.status(503).json({
          error: 'Firestore database not ready. Firebase コンソールで Firestore を有効化し、デフォルトデータベースを作成してください。',
          details: message
        });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    const relativePath = req.path.replace(/^\//, '');
    for (const baseDir of STATIC_DIRS) {
      const candidate = path.join(baseDir, relativePath);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        res.sendFile(candidate);
        return;
      }
    }

    for (const baseDir of STATIC_DIRS) {
      const candidate = path.join(baseDir, 'index.html');
      if (fs.existsSync(candidate)) {
        res.sendFile(candidate);
        return;
      }
    }

    res.status(404).send('Not found');
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    warmUp();
  });
}

async function warmUp() {
  try {
    initializeFirestore();
    console.log('[warmup] Firestore connection initialized');
    for (const col of WARM_UP_COLLECTIONS) {
      const result = await readCollection(col, {});
      console.log(`[warmup] ${col}: ${result.count} 件をキャッシュしました`);
    }
  } catch (err) {
    console.warn('[warmup] 起動時プリロード失敗（初回リクエストで再試行します）:', err.message);
  }
}

startServer();