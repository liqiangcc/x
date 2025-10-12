-- =============================================================================
-- Database Schema for Stock Data
--
-- Author: Gemini
-- Date: 2025-09-07
--
-- This script contains the DDL (Data Definition Language) statements to create
-- the necessary tables for storing stock market data fetched from the API.
--
-- The schema includes tables for:
-- 1. sectors: Information about market sectors/blocks.
-- 2. stocks: Information about individual stocks.
-- 3. stock_sectors: A linking table for the many-to-many relationship
--    between stocks and sectors.
-- 4. klines: Time-series K-line data for stocks, sectors, and indices.
-- 5. etf_info: Information about ETF funds.
-- 6. etf_klines: Time-series K-line data for ETFs.
-- =============================================================================


-- 1. 板块信息表 (sectors)
-- 用于存储所有行业板块的基本信息。
CREATE TABLE IF NOT EXISTS sectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_code TEXT UNIQUE NOT NULL, -- 板块代码 (来自 f12 字段)
    sector_name TEXT,                 -- 板块名称 (来自 f14 字段)
    market_id TEXT,                   -- 市场ID (来自 f13 字段)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- 2. 股票信息表 (stocks)
-- 用于存储个股的基本信息。
CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT UNIQUE NOT NULL, -- 股票代码 (来自 f12 字段)
    stock_name TEXT,                 -- 股票名称 (来自 f14 字段)
    market_id TEXT,                  -- 市场ID (来自 f13 字段)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- 3. 股票与板块关系表 (stock_sectors)
-- 这是一个关联表，用于记录哪些股票属于哪些板块 (多对多关系)。
CREATE TABLE IF NOT EXISTS stock_sectors (
    stock_id INTEGER,
    sector_id INTEGER,
    PRIMARY KEY (stock_id, sector_id),
    FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE,
    FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE CASCADE
);


-- 4. K线数据表 (klines)
-- 用于存储股票、板块或指数的历史K线数据。
-- 采用合并存储方案 (方案一)，所有周期的K线数据都存放在此表中。
CREATE TABLE IF NOT EXISTS klines (
    secid TEXT NOT NULL,          -- 证券ID (例如 '1.600519' 或 '90.BK0433')
    klt INTEGER NOT NULL,         -- K线类型 (101=日K, 102=周K, 103=月K等)
    timestamp TEXT NOT NULL,      -- 时间戳 (来自 f51 字段, K线时间点)
    open REAL,                    -- 开盘价 (f52)
    close REAL,                   -- 收盘价 (f53)
    high REAL,                    -- 最高价 (f54)
    low REAL,                     -- 最低价 (f55)
    volume INTEGER,               -- 成交量 (f56)
    turnover REAL,                -- 成交额 (f57)
    amplitude_pct REAL,           -- 振幅% (f58)
    change_pct REAL,              -- 涨跌幅% (f59)
    change_amount REAL,           -- 涨跌额 (f60)
    turnover_rate_pct REAL,       -- 换手率% (f61)
    PRIMARY KEY (secid, klt, timestamp)
);


-- 5. ETF基金信息表 (etf_info)
-- 用于存储ETF基金的基本信息和实时行情。
DROP TABLE IF EXISTS etf_info;
CREATE TABLE IF NOT EXISTS etf_info (
    SECURITY_CODE TEXT PRIMARY KEY,
    MARKET TEXT,
    SECURITY_NAME_ABBR TEXT,
    name TEXT,
    scale REAL,
    establishment_date TEXT,
    fund_type TEXT,
    fund_manager TEXT,
    management_company TEXT,
    fund_rating TEXT,
    NEW_PRICE REAL,
    CHANGE_RATE REAL,
    CHANGE REAL,
    VOLUME INTEGER,
    DEAL_AMOUNT REAL,
    INDEX_NAME TEXT,
    creation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- 6. ETF K线数据表 (etf_klines)
-- 用于存储ETF的历史K线数据。
CREATE TABLE IF NOT EXISTS etf_klines (
    secid TEXT NOT NULL,          -- 证券ID (例如 'SZ.159915')
    klt INTEGER NOT NULL,         -- K线类型 (101=日K, 102=周K, 103=月K等)
    timestamp TEXT NOT NULL,      -- 时间戳 (K线时间点)
    open REAL,
    close REAL,
    high REAL,
    low REAL,
    volume INTEGER,
    turnover REAL,
    amplitude_pct REAL,
    change_pct REAL,
    change_amount REAL,
    turnover_rate_pct REAL,
    PRIMARY KEY (secid, klt, timestamp)
);
