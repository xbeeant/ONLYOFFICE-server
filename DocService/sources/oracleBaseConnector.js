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
const cfgTableResult = config.get('services.CoAuthoring.sql.tableResult');

const connectionConfiguration = {
  user: configSql.get('dbUser'),
  password: configSql.get('dbPass'),
  connectString: `${configSql.get('dbHost')}:${configSql.get('dbPort')}/${configSql.get('dbName')}`,
  poolMin: 0,
  poolMax: configSql.get('connectionlimit')
};
let pool = null;

oracledb.fetchAsString = [ oracledb.NCLOB ];
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

function reconfigureParametersBinding(parameters) {
  if (!parameters) {
    return {};
  }

  const objectConfiguration = {};
  for (const index in parameters) {
    objectConfiguration[`:${index}`] = parameters[index];
  }

  return objectConfiguration;
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

        connection.close();
        callbackFunction?.(error);

        return;
      }

      let output = { rows: [], affectedRows: 0 };
      if (result?.rowsAffected) {
        output = { affectedRows: result.rowsAffected };
      }

      if (result?.rows) {
        output = !opt_noModifyRes ? columnsToLowercase(result.rows) : result.rows;
      }

      callbackFunction?.(error, output);
    };

    const bondedValues = reconfigureParametersBinding(opt_values);
    const outputFormat = { outFormat: !opt_noModifyRes ? oracledb.OUT_FORMAT_OBJECT : oracledb.OUT_FORMAT_ARRAY };
    connection.execute(correctedSql, bondedValues, outputFormat, handler);

    connection.close();
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

    const updateQuery = `last_open_date = ${addSqlParameter(dateNow, values)}${callback}${baseUrl}${userIndex}`
    const condition = `tenant = ${valuesPlaceholder[0]} AND id = ${valuesPlaceholder[1]}`

    let mergeSqlCommand = `MERGE INTO ${cfgTableResult} USING DUAL ON (${condition})`
      + ` WHEN MATCHED THEN UPDATE SET ${updateQuery}`
      + ` WHEN NOT MATCHED THEN INSERT (tenant, id, status, status_info, last_open_date, user_index, change_id, callback, baseurl) VALUES (${valuesPlaceholder.join(', ')})`;

    sqlQuery(ctx, mergeSqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }, false, false, values);
  });
}

module.exports = {
  sqlQuery,
  addSqlParameter,
  concatParams,
  getTableColumns,
  upsert
}