const { Sequelize, DataTypes } = require("sequelize");

// 从环境变量中读取数据库配置
const {
  MYSQL_USERNAME,
  MYSQL_PASSWORD,
  MYSQL_ADDRESS = "",
  MYSQL_DATABASE = "nodejs_demo",
} = process.env;

const [host, port] = MYSQL_ADDRESS.split(":");

const sequelize = new Sequelize(MYSQL_DATABASE, MYSQL_USERNAME, MYSQL_PASSWORD, {
  host,
  port,
  dialect: "mysql" /* one of 'mysql' | 'mariadb' | 'postgres' | 'mssql' */,
  logging: false,
});

// 定义数据模型
const Counter = sequelize.define("Counter", {
  count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
});

const ParkingFeedback = sequelize.define("ParkingFeedback", {
  feedbackKey: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  openid: {
    type: DataTypes.STRING(128),
    allowNull: true,
  },
  action: {
    type: DataTypes.ENUM("recommend", "risk", "issue"),
    allowNull: false,
  },
  reasonId: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  reasonIds: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  reasonLabel: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  address: {
    type: DataTypes.STRING(512),
    allowNull: true,
  },
  parkingId: {
    type: DataTypes.STRING(128),
    allowNull: true,
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true,
  },
  longitude: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true,
  },
  parkingType: {
    type: DataTypes.STRING(128),
    allowNull: true,
  },
  distance: {
    type: DataTypes.FLOAT,
    allowNull: true,
  },
  source: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  rawPayload: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  indexes: [
    { fields: ["feedbackKey"] },
    { fields: ["openid"] },
    { fields: ["action"] },
  ],
});

const Subscription = sequelize.define("Subscription", {
  openid: {
    type: DataTypes.STRING(128),
    allowNull: false,
    unique: true,
  },
  selectedTypes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  city: {
    type: DataTypes.STRING(128),
    allowNull: true,
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true,
  },
  longitude: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true,
  },
  backendStatus: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  rawPayload: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
});

const PushLog = sequelize.define("PushLog", {
  openid: {
    type: DataTypes.STRING(128),
    allowNull: true,
  },
  alertType: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING(64),
    allowNull: false,
    defaultValue: "created",
  },
  rawPayload: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
});

// 数据库初始化方法
async function init() {
  await Counter.sync({ alter: true });
  await ParkingFeedback.sync({ alter: true });
  await Subscription.sync({ alter: true });
  await PushLog.sync({ alter: true });
}

// 导出初始化方法和模型
module.exports = {
  init,
  Counter,
  ParkingFeedback,
  Subscription,
  PushLog,
};
