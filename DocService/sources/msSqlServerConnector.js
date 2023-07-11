/*
 * (c) Copyright Ascensio System SIA 2010-2023
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';

const sql = require("mssql");
const config = require('config');
const connectorUtilities = require('./connectorUtilities');

const configSql = config.get('services.CoAuthoring.sql');
const cfgTableResult = configSql.get('tableResult');
const cfgMaxPacketSize = configSql.get('max_allowed_packet');

const poolConfig = {
  user: configSql.get('dbUser'),
  password: configSql.get('dbPass'),
  server: configSql.get('dbHost'),
  database: configSql.get('dbName'),
  pool: {
    max: configSql.get('connectionlimit'),
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const connectionErrorCodes = [
  'ELOGIN',
  'ETIMEOUT',
  'EDRIVER',
  'EALREADYCONNECTED',
  'EALREADYCONNECTING',
  'ENOTOPEN',
  'EINSTLOOKUP',
  'ESOCKET',
  'ECONNCLOSED'
];

const placeholderPrefix = 'ph_';

function errorHandle(message, error, ctx) {
  ctx.logger.error(`${message}:`);

  if (error.precedingErrors?.length) {
    error.precedingErrors.forEach(category => ctx.logger.error(category.originalError));
  } else {
    ctx.logger.error(error.originalError);
  }
}

function dataType(value) {
  let type = sql.TYPES.NChar(1);
  switch (typeof value) {
    case "number": {
      type = sql.TYPES.Decimal(18, 0);
      break;
    }
    case "string": {
      type = sql.TYPES.NVarChar(sql.MAX);
      break;
    }
    case "object": {
      if (value instanceof Date) {
        type = sql.TYPES.DateTime()
      }

      break;
    }
  }

  return type;
}

function convertPlaceholdersValues(values) {
  if (!Array.isArray(values)) {
    return values instanceof Object ? values : {};
  }

  const placeholdersObject = {};
  for (const index in values) {
    placeholdersObject[`${placeholderPrefix}${index}`] = values[index];
  }

  return placeholdersObject;
}

function registerPlaceholderValues(values, statement) {
  for (const key of Object.keys(values)) {
    statement.input(`${placeholderPrefix}${key}`, dataType(values[key]));
  }
}

function sqlQuery(ctx, sqlCommand, callbackFunction, opt_noModifyRes = false, opt_noLog = false, opt_values = {}) {
  return executeSql(ctx, sqlCommand, opt_values, opt_noModifyRes, opt_noLog).then(
    result => callbackFunction?.(null, result),
    error => callbackFunction?.(error)
  );
}

async function executeSql(ctx, sqlCommand, values = {}, noModifyRes = false, noLog = false) {
  try {
    await sql.connect(poolConfig);

    const statement = new sql.PreparedStatement();
    const placeholders = convertPlaceholdersValues(values);
    registerPlaceholderValues(placeholders, statement)

    await statement.prepare(sqlCommand);
    const result = await statement.execute(placeholders);
    await statement.unprepare();

    if (!result.recordset && !result.rowsAffected?.length) {
      return { rows: [], affectedRows: 0 };
    }

    let output = result;
    if (!noModifyRes) {
      if (result.recordset) {
        output = result.recordset
      } else {
        output = { affectedRows: result.rowsAffected.pop() };
      }
    }

    return output;
  } catch (error) {
    if (!noLog) {
      if (connectionErrorCodes.includes(error.code)) {
        errorHandle('sqlQuery error while pool manipulation', error, ctx);
      } else {
        errorHandle(`sqlQuery error while executing query: ${sqlCommand} `, error, ctx);
      }
    }

    throw error;
  }
}

function addSqlParameterObjectBased(parameter, name, accumulatedObject) {
  accumulatedObject[name] = parameter;
  return `@${placeholderPrefix}${name}`;
}

function addSqlParameter(parameter, accumulatedArray) {
  const currentIndex = accumulatedArray.push(parameter) - 1;
  return `@${placeholderPrefix}${currentIndex}`;
}

function concatParams(...parameters) {
  return `CONCAT(${parameters.join(', ')})`;
}

function getTableColumns(ctx, tableName) {
  const sqlCommand = `SELECT column_name FROM information_schema.COLUMNS WHERE TABLE_NAME = '${tableName}' AND TABLE_SCHEMA = 'dbo';`;
  return executeSql(ctx, sqlCommand);
}

function upsert(ctx, task, opt_updateUserIndex) {
  task.completeDefaults();

  let cbInsert = task.callback;
  if (task.callback) {
    const userCallback = new connectorUtilities.UserCallback();
    userCallback.fromValues(task.userIndex, task.callback);
    cbInsert = userCallback.toSQLInsert();
  }

  const dateNow = new Date();

  const values = {};
  const insertValuesPlaceholder = [
    addSqlParameterObjectBased(task.tenant, 'tenant', values),
    addSqlParameterObjectBased(task.key, 'key', values),
    addSqlParameterObjectBased(task.status, 'status', values),
    addSqlParameterObjectBased(task.statusInfo, 'statusInfo', values),
    addSqlParameterObjectBased(dateNow, 'dateNow', values),
    addSqlParameterObjectBased(task.userIndex, 'userIndex', values),
    addSqlParameterObjectBased(task.changeId, 'changeId', values),
    addSqlParameterObjectBased(cbInsert, 'cbInsert', values),
    addSqlParameterObjectBased(task.baseurl, 'baseurl', values),
  ];

  const tenant = insertValuesPlaceholder[0];
  const id = insertValuesPlaceholder[1];
  const lastOpenDate = insertValuesPlaceholder[4];
  const baseUrl = insertValuesPlaceholder[8];
  const insertValues = insertValuesPlaceholder.join(', ');
  const columns = ['tenant', 'id', 'status', 'status_info', 'last_open_date', 'user_index', 'change_id', 'callback', 'baseurl']
  const sourceColumns = columns.join(', ');
  const sourceValues = columns.map(column => `source.${column}`).join(', ');

  const condition = `target.tenant = ${tenant} AND target.id = ${id}`;
  let updateColumns = `target.last_open_date = ${lastOpenDate}`;

  if (task.callback) {
    const parameter = addSqlParameterObjectBased(JSON.stringify(task.callback), 'callback', values);
    const concatenatedColumns = concatParams(
      'target.callback', `'${connectorUtilities.UserCallback.prototype.delimiter}{"userIndex":'`, '(target.user_index + 1)', `',"callback":'`, parameter, `'}'`
    );

    executeSql(ctx, `select ${concatParams('NULL', `',"smth":'`, 'NULL', '@ph_callback')} as result;`, { callback: '" HaHAhAHAh "' }).then(result => ctx.logger.debug('!!!!!!!!!!!!!!!!!!!!!!!!!', result))
    updateColumns += `, target.callback = ${concatenatedColumns}`;
  }

  if (task.baseurl) {
    updateColumns += `, target.baseurl = ${baseUrl}`;
  }

  if (opt_updateUserIndex) {
    updateColumns += ', target.user_index = target.user_index + 1';
  }

  let sqlMerge = `MERGE INTO ${cfgTableResult} AS target `
    + `USING(VALUES(${insertValues})) AS source(${sourceColumns}) `
    + `ON(${condition}) `
    + `WHEN MATCHED THEN UPDATE SET ${updateColumns} `
    + `WHEN NOT MATCHED THEN INSERT(${sourceColumns}) VALUES(${sourceValues}) `
    + `OUTPUT $ACTION as action, INSERTED.user_index as insertId;`;
  
  return executeSql(ctx, sqlMerge, values, true).then(
    result => {
      const insertId = result.recordset[0].insertId;
      const affectedRows = result.recordset[0].action === 'UPDATE' ? 2 : 1;

      return { affectedRows, insertId };
    }
  );
}

function insertChanges(ctx, tableChanges, startIndex, objChanges, docId, index, user, callback) {
  if (startIndex === objChanges.length) {
    return;
  }

  let capacityReached = false;
  let currentIndex = startIndex;
  let lengthUtf8Current = 'INSERT INTO  SELECT 1 FROM DUAL'.length

  let sqlInsert = `INSERT INTO ${tableChanges} VALUES`
}

module.exports = {
  sqlQuery,
  addSqlParameter,
  concatParams,
  getTableColumns,
  upsert,
  // insertChanges
};