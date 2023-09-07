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

const mysql = require('mysql2');
const connectorUtilities = require('./connectorUtilities');
const config = require('config');

const configSql = config.get('services.CoAuthoring.sql');
const cfgTableResult = config.get('services.CoAuthoring.sql.tableResult');

const pool  = mysql.createPool({
  host		: configSql.get('dbHost'),
  port		: configSql.get('dbPort'),
  user		: configSql.get('dbUser'),
  password	: configSql.get('dbPass'),
  database	: configSql.get('dbName'),
  charset		: configSql.get('charset'),
  connectionLimit	: configSql.get('connectionlimit'),
  timezone	: 'Z',
  flags : '-FOUND_ROWS'
});

function sqlQuery(ctx, sqlCommand, callbackFunction, opt_noModifyRes = false, opt_noLog = false, opt_values = []) {
  pool.getConnection(function(connectionError, connection) {
    if (connectionError) {
      if (!opt_noLog) {
        ctx.logger.error('pool.getConnection error: %s', connectionError);
      }

      callbackFunction?.(connectionError, null);

      return;
    }

    let queryCallback = function (error, result) {
      connection.release();
      if (error && !opt_noLog) {
        ctx.logger.error('_______________________error______________________');
        ctx.logger.error('sqlQuery: %s sqlCommand: %s', error.code, sqlCommand);
        ctx.logger.error(error);
        ctx.logger.error('_____________________end_error____________________');
      }

      let output;
      if (!opt_noModifyRes) {
        output = result?.affectedRows ? { affectedRows: result.affectedRows } : result;
      } else {
        output = result;
      }

      output = output ?? { rows: [], affectedRows: 0 };

      callbackFunction?.(error, output);
    };

    connection.query(sqlCommand, opt_values, queryCallback);
  });
}

function closePool() {
  pool.end();
}

function addSqlParameter(val, values) {
  values.push(val);
  return '?';
}

function concatParams(val1, val2) {
  return `CONCAT(COALESCE(${val1}, ''), COALESCE(${val2}, ''))`;
}

function upsert(ctx, task) {
  return new Promise(function(resolve, reject) {
    task.completeDefaults();
    let dateNow = new Date();
    let values = [];
    let cbInsert = task.callback;
    if (task.callback) {
      let userCallback = new connectorUtilities.UserCallback();
      userCallback.fromValues(task.userIndex, task.callback);
      cbInsert = userCallback.toSQLInsert();
    }
    let p0 = addSqlParameter(task.tenant, values);
    let p1 = addSqlParameter(task.key, values);
    let p2 = addSqlParameter(task.status, values);
    let p3 = addSqlParameter(task.statusInfo, values);
    let p4 = addSqlParameter(dateNow, values);
    let p5 = addSqlParameter(task.userIndex, values);
    let p6 = addSqlParameter(task.changeId, values);
    let p7 = addSqlParameter(cbInsert, values);
    let p8 = addSqlParameter(task.baseurl, values);
    let p9 = addSqlParameter(dateNow, values);
    var sqlCommand = `INSERT INTO ${cfgTableResult} (tenant, id, status, status_info, last_open_date, user_index, change_id, callback, baseurl)`+
      ` VALUES (${p0}, ${p1}, ${p2}, ${p3}, ${p4}, ${p5}, ${p6}, ${p7}, ${p8}) ON DUPLICATE KEY UPDATE` +
      ` last_open_date = ${p9}`;
    if (task.callback) {
      let p10 = addSqlParameter(JSON.stringify(task.callback), values);
      sqlCommand += `, callback = CONCAT(callback , '${connectorUtilities.UserCallback.prototype.delimiter}{"userIndex":' , (user_index + 1) , ',"callback":', ${p10}, '}')`;
    }
    if (task.baseurl) {
      let p11 = addSqlParameter(task.baseurl, values);
      sqlCommand += `, baseurl = ${p11}`;
    }

    sqlCommand += ', user_index = LAST_INSERT_ID(user_index + 1);';

    sqlQuery(ctx, sqlCommand, function(error, result) {
      if (error) {
        reject(error);
      } else {
        const insertId = result.affectedRows === 1 ? task.userIndex : result.insertId;
        //if CLIENT_FOUND_ROWS don't specify 1 row is inserted , 2 row is updated, and 0 row is set to its current values
        //http://dev.mysql.com/doc/refman/5.7/en/insert-on-duplicate.html
        const isInsert = result.affectedRows === 1;

        resolve({ isInsert, insertId });
      }
    }, true, false, values);
  });
}

module.exports = {
  sqlQuery,
  closePool,
  addSqlParameter,
  concatParams,
  upsert
}