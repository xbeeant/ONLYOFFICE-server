/*
 * (c) Copyright Ascensio System SIA 2010-2017
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
 * You can contact Ascensio System SIA at Lubanas st. 125a-25, Riga, Latvia,
 * EU, LV-1021.
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
const config = require('config');
const co = require('co');
const logger = require('./../../Common/sources/logger');
const sqlBase = require('./baseConnector');
const converterService = require('./converterservice');
const pubsubRedis = require('./pubsubRedis.js');
const queueService = require('./../../Common/sources/taskqueueRabbitMQ');
const constants = require('./../../Common/sources/constants');
const utils = require('./../../Common/sources/utils');

const cfgRedisPrefix = config.get('services.CoAuthoring.redis.prefix');
const redisKeyCollectLost = cfgRedisPrefix + constants.REDIS_KEY_COLLECT_LOST;

const LOOP_TIMEOUT = 1000;
const EXEC_TIMEOUT = utils.CONVERTION_TIMEOUT;

(function collectlost() {
  return co(function*() {
    let exitCode = 0;
    let queue = null;
    try {
      logger.debug('collectlost start');

      var redisClient = pubsubRedis.getClientRedis();

      queue = new queueService();
      yield queue.initPromise(true, false, false, false);

      //collect documents without callback url
      const selectRes = yield sqlBase.getEmptyCallbacks();

      let docIds = [];
      for (let i = 0; i < selectRes.length; ++i) {
        docIds.push(selectRes[i].id);
      }
      logger.debug('collectlost docIds:%j', docIds);
      if (docIds.length > 0) {
        let multi = redisClient.multi([['sadd', redisKeyCollectLost].concat(docIds)]);
        yield utils.promiseRedis(multi, multi.exec);
      }
      for (let i = 0; i < docIds.length; ++i) {
        let docId = docIds[i];
        yield* converterService.convertFromChanges(docId, undefined, false, undefined, undefined, undefined, undefined,
          queue, redisKeyCollectLost);
      }

      logger.debug('collectlost start wait');
      const startTime = new Date().getTime();
      while (true) {
        let curTime = new Date().getTime() - startTime;
        if (curTime >= EXEC_TIMEOUT) {
          exitCode = 1;
          logger.debug('collectlost timeout');
          break;
        }
        const remainingFiles = yield utils.promiseRedis(redisClient, redisClient.scard, redisKeyCollectLost);
        logger.debug('collectlost remaining files:%d', remainingFiles);
        if (remainingFiles <= 0) {
          break;
        }
        yield utils.sleep(LOOP_TIMEOUT);
      }
      //clean up
      yield utils.promiseRedis(redisClient, redisClient.del, redisKeyCollectLost);

      logger.debug('collectlost end');
    } catch (e) {
      logger.error('collectlost error:\r\n%s', e.stack);
    } finally {
      try {
        if (queue) {
          yield queue.close();
        }
      } catch (e) {
        logger.error('collectlost error:\r\n%s', e.stack);
      }
      process.exit(exitCode);
    }
  });
})();
