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

const oracledb = require('oracledb');
const config = require('config');
const connectorUtilities = require("./connectorUtilities");

const configSql = config.get('services.CoAuthoring.sql');
const cfgTableResult = configSql.get('tableResult');
const cfgMaxPacketSize = configSql.get('max_allowed_packet');

const connectionConfiguration = {
  user: configSql.get('dbUser'),
  password: configSql.get('dbPass'),
  connectString: `${configSql.get('dbHost')}:${configSql.get('dbPort')}/${configSql.get('dbName')}`,
  poolMin: 0,
  poolMax: configSql.get('connectionlimit')
};
let pool = null;

oracledb.fetchAsString = [ oracledb.NCLOB, oracledb.CLOB ];
oracledb.autoCommit = true;

function columnsToLowercase(rows) {
  const formattedRows = [];
  for (const row of rows) {
    const newRow = {};
    for (const column in row) {
      if (row.hasOwnProperty(column)) {
        newRow[column.toLowerCase()] = row[column];
      }
    }

    formattedRows.push(newRow);
  }

  return formattedRows;
}

async function sqlQuery(ctx, sqlCommand, callbackFunction, opt_noModifyRes, opt_noLog, opt_values) {
  // Query must not have any ';' in oracle connector.
  const correctedSql = sqlCommand.replace(/;/g, '');

  try {
    if (!pool) {
      pool = await oracledb.createPool(connectionConfiguration);
    }

    const connection = await pool.getConnection();

    const handler = (error, result) => {
      if (error) {
        if (!opt_noLog) {
          ctx.logger.error('sqlQuery error sqlCommand: %s: %s', correctedSql, error.stack);
        }

        callbackFunction?.(error);

        return;
      }

      connection.close();

      let output = { rows: [], affectedRows: 0 };
      if (!opt_noModifyRes) {
        if (result?.rowsAffected) {
          output = { affectedRows: result.rowsAffected };
        }

        if (result?.rows) {
          output = columnsToLowercase(result.rows);
        }
      } else {
        output = result;
      }

      callbackFunction?.(error, output);
    };

    const bondedValues = opt_values ?? [];
    const outputFormat = { outFormat: !opt_noModifyRes ? oracledb.OUT_FORMAT_OBJECT : oracledb.OUT_FORMAT_ARRAY };
    connection.execute(correctedSql, bondedValues, outputFormat, handler);
  } catch (error) {
    if (!opt_noLog) {
      ctx.logger.error('sqlQuery error while pool manipulation: %s', error.stack);
    }

    callbackFunction?.(error);
  }
}

function addSqlParameter(parameter, accumulatedArray) {
  const currentIndex = accumulatedArray.push(parameter) - 1;
  return `:${currentIndex}`;
}

function concatParams(firstParameter, secondParameter) {
  return `${firstParameter} || ${secondParameter} || ''`;
}

function getTableColumns(ctx, tableName) {
  return new Promise((resolve, reject) => {
    sqlQuery(ctx, `SELECT LOWER(column_name) AS column_name FROM user_tab_columns WHERE table_name = '${tableName.toUpperCase()}'`, function (error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

function upsert(ctx, task, opt_updateUserIndex) {
  return new Promise((resolve, reject) => {
    task.completeDefaults();

    let cbInsert = task.callback;
    if (task.callback) {
      const userCallback = new connectorUtilities.UserCallback();
      userCallback.fromValues(task.userIndex, task.callback);
      cbInsert = userCallback.toSQLInsert();
    }

    const dateNow = new Date();

    const values = [];
    const tenant = addSqlParameter(task.tenant, values);
    const id = addSqlParameter(task.key, values);
    const lastOpenDate = addSqlParameter(dateNow, values);

    let callback = '';
    if (task.callback) {
      const parameter = addSqlParameter(JSON.stringify(task.callback), values);
      callback = `, callback = callback || '${connectorUtilities.UserCallback.prototype.delimiter}{"userIndex":' || (user_index + 1) || ',"callback":' || ${parameter} || '}'`;
    }

    let baseUrl = '';
    if (task.baseurl) {
      const parameter = addSqlParameter(task.baseurl, values);
      baseUrl = `, baseurl = ${parameter}`;
    }

    let userIndex = '';
    if (opt_updateUserIndex) {
      userIndex = ', user_index = user_index + 1';
    }

    const updateQuery = `last_open_date = ${lastOpenDate}${callback}${baseUrl}${userIndex}`
    const condition = `tenant = ${tenant} AND id = ${id}`

    let mergeSqlCommand = `MERGE INTO ${cfgTableResult} USING DUAL ON (${condition})`
      + ` WHEN MATCHED THEN UPDATE SET ${updateQuery}`;

    const valuesPlaceholder = [
      addSqlParameter(task.tenant, values),
      addSqlParameter(task.key, values),
      addSqlParameter(task.status, values),
      addSqlParameter(task.statusInfo, values),
      addSqlParameter(dateNow, values),
      addSqlParameter(task.userIndex, values),
      addSqlParameter(task.changeId, values),
      addSqlParameter(cbInsert, values),
      addSqlParameter(task.baseurl, values)
    ];

    mergeSqlCommand += ` WHEN NOT MATCHED THEN INSERT (tenant, id, status, status_info, last_open_date, user_index, change_id, callback, baseurl) VALUES (${valuesPlaceholder.join(', ')})`;

    sqlQuery(ctx, mergeSqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, false, false, values);
  });
}

async function insertChanges(ctx, tableChanges, startIndex, objChanges, docId, index, user, callback) {
  if (startIndex === objChanges.length) {
    return;
  }

  let packetCapacityReached = false;
  let currentIndex = startIndex;
  let lengthUtf8Current = 'INSERT ALL  SELECT 1 FROM DUAL'.length;
  let insertAllSqlCommand = 'INSERT ALL ';
  const values = [];

  const maxInsertionClauseLength = `INTO ${tableChanges} VALUES(:9991,:9992,:9993,:9994,:9995,:9996,:9997,:9998) `.length;
  const indexBytes = 4;
  const timeBytes = 8;
  for (; currentIndex < objChanges.length; ++currentIndex, ++index) {
    // 4 bytes is maximum for utf8 symbol.
    const lengthUtf8Row = maxInsertionClauseLength + indexBytes + timeBytes
      + 4 * (ctx.tenant.length + docId.length + user.id.length + user.idOriginal.length + user.username.length + objChanges[currentIndex].change.length);

    if (lengthUtf8Row + lengthUtf8Current >= cfgMaxPacketSize && currentIndex > startIndex) {
      packetCapacityReached = true;
      break;
    }

    const valuesPlaceholder= [
      addSqlParameter(ctx.tenant, values),
      addSqlParameter(docId, values),
      addSqlParameter(index, values),
      addSqlParameter(user.id, values),
      addSqlParameter(user.idOriginal, values),
      addSqlParameter(user.username, values),
      addSqlParameter(objChanges[currentIndex].change, values),
      addSqlParameter(objChanges[currentIndex].time, values)
    ];

    insertAllSqlCommand += `INTO ${tableChanges} VALUES(${valuesPlaceholder.join(',')}) `;
  }

  insertAllSqlCommand += 'SELECT 1 FROM DUAL';

  await sqlQuery(ctx, insertAllSqlCommand, function (error, result) {
    if (error) {
      callback(error, null, true);

      return;
    }

    if (packetCapacityReached) {
      insertChanges(ctx, tableChanges, currentIndex, objChanges, docId, index, user, callback);
    } else {
      callback(error, result, true);
    }
  }, false, false, values);
}

module.exports = {
  sqlQuery,
  addSqlParameter,
  concatParams,
  getTableColumns,
  upsert,
  insertChanges
}