const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const {
  init: initDB,
  Counter,
  ParkingFeedback,
  Subscription,
  PushLog,
} = require("./db");

const logger = morgan("tiny");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

function ok(res, data = {}) {
  res.send({
    code: 0,
    data,
  });
}

function fail(res, message, status = 400, extra = {}) {
  res.status(status).send({
    code: status,
    message,
    ...extra,
  });
}

function getOpenid(req) {
  return req.headers["x-wx-openid"] || req.headers["x-wx-from-openid"] || "";
}

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (err) {
    return "";
  }
}

function parseReasonIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function toNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error("[api] request failed", err);
      fail(res, "server_error", 500);
    }
  };
}

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/health", async (req, res) => {
  ok(res, {
    service: "typhoon-helper-api",
    status: "ok",
    time: new Date().toISOString(),
  });
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({
      truncate: true,
    });
  }
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  ok(res, result);
});

app.post("/api/parking-feedback", wrap(async (req, res) => {
  const body = req.body || {};
  const feedbackKey = String(body.key || body.feedbackKey || "").trim();
  const action = String(body.action || "").trim();
  const validActions = ["recommend", "risk", "issue"];

  if (!feedbackKey) return fail(res, "feedback_key_required");
  if (!validActions.includes(action)) return fail(res, "invalid_action");

  const openid = String(getOpenid(req) || body.openid || "").trim();
  const reasonIds = parseReasonIds(body.reasonIds || body.reasonId);
  const values = {
    feedbackKey,
    openid: openid || null,
    action,
    reasonId: String(body.reasonId || reasonIds[0] || ""),
    reasonIds: stringify(reasonIds),
    reasonLabel: String(body.reasonLabel || ""),
    name: String(body.name || ""),
    address: String(body.address || ""),
    parkingId: String(body.parkingId || ""),
    latitude: toNumberOrNull(body.latitude),
    longitude: toNumberOrNull(body.longitude),
    parkingType: String(body.parkingType || ""),
    distance: toNumberOrNull(body.distance),
    source: String(body.source || "miniapp"),
    rawPayload: stringify(body),
  };

  let record = null;
  if (openid) {
    record = await ParkingFeedback.findOne({
      where: {
        feedbackKey,
        openid,
      },
    });
  }

  if (record) {
    await record.update(values);
  } else {
    record = await ParkingFeedback.create(values);
  }

  ok(res, {
    id: record.id,
    feedbackKey,
    action,
    saved: true,
  });
}));

app.get("/api/parking-feedback/summary", wrap(async (req, res) => {
  const keys = String(req.query.keys || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const where = keys.length ? { feedbackKey: keys } : {};
  const rows = await ParkingFeedback.findAll({
    where,
    order: [["updatedAt", "DESC"]],
    limit: keys.length ? 2000 : 500,
  });
  const summary = {};

  rows.forEach((row) => {
    const item = row.toJSON();
    const key = item.feedbackKey;
    if (!summary[key]) {
      summary[key] = {
        key,
        recommendCount: 0,
        riskCount: 0,
        issueCount: 0,
        tags: [],
        lastUpdatedAt: item.updatedAt,
      };
    }

    if (item.action === "recommend") summary[key].recommendCount += 1;
    if (item.action === "risk") summary[key].riskCount += 1;
    if (item.action === "issue") summary[key].issueCount += 1;

    String(item.reasonLabel || "")
      .split("、")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach((tag) => {
        if (!summary[key].tags.includes(tag)) summary[key].tags.push(tag);
      });

    if (new Date(item.updatedAt).getTime() > new Date(summary[key].lastUpdatedAt).getTime()) {
      summary[key].lastUpdatedAt = item.updatedAt;
    }
  });

  ok(res, {
    items: Object.values(summary),
  });
}));

app.post("/api/subscribe", wrap(async (req, res) => {
  const body = req.body || {};
  const openid = String(getOpenid(req) || body.openid || "").trim();

  if (!openid) return fail(res, "openid_required", 401);

  const values = {
    openid,
    selectedTypes: stringify(body.selectedTypes || []),
    city: String(body.city || body.locationName || ""),
    latitude: toNumberOrNull(body.latitude),
    longitude: toNumberOrNull(body.longitude),
    backendStatus: "registered",
    rawPayload: stringify(body),
  };

  let record = await Subscription.findOne({ where: { openid } });
  if (record) {
    await record.update(values);
  } else {
    record = await Subscription.create(values);
  }

  ok(res, {
    id: record.id,
    openid,
    registered: true,
  });
}));

app.post("/api/push/typhoon-alert", wrap(async (req, res) => {
  const secret = process.env.PUSH_API_SECRET || "";
  const requestKey = req.headers["x-api-key"] || req.headers.authorization || "";

  if (!secret) {
    await PushLog.create({
      alertType: String((req.body && req.body.alertType) || ""),
      title: String((req.body && req.body.title) || ""),
      status: "push_secret_not_configured",
      rawPayload: stringify(req.body || {}),
    });
    return fail(res, "push_secret_not_configured", 503);
  }

  if (requestKey !== secret && requestKey !== `Bearer ${secret}`) {
    return fail(res, "unauthorized", 401);
  }

  const body = req.body || {};
  const log = await PushLog.create({
    openid: String(body.openid || ""),
    alertType: String(body.alertType || ""),
    title: String(body.title || ""),
    status: "accepted",
    rawPayload: stringify(body),
  });

  ok(res, {
    id: log.id,
    accepted: true,
    message: "push request recorded; template sending will be implemented after template ids are configured",
  });
}));

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});

// 和风天气缓存代理:服务端共享内存缓存,所有用户共用一份
app.use(require("./qweather-proxy"));

const port = process.env.PORT || 80;

async function bootstrap() {
  // 数据库初始化失败不阻塞启动,缓存代理等无 DB 依赖接口仍可用
  try {
    await initDB();
    console.log("[bootstrap] 数据库初始化成功");
  } catch (err) {
    console.error("[bootstrap] 数据库初始化失败,带 DB 的接口将不可用:", err && err.message);
  }
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
