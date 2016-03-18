/*
 *
 * (c) Copyright Ascensio System Limited 2010-2016
 *
 * This program is freeware. You can redistribute it and/or modify it under the terms of the GNU 
 * General Public License (GPL) version 3 as published by the Free Software Foundation (https://www.gnu.org/copyleft/gpl.html). 
 * In accordance with Section 7(a) of the GNU GPL its Section 15 shall be amended to the effect that 
 * Ascensio System SIA expressly excludes the warranty of non-infringement of any third-party rights.
 *
 * THIS PROGRAM IS DISTRIBUTED WITHOUT ANY WARRANTY; WITHOUT EVEN THE IMPLIED WARRANTY OF MERCHANTABILITY OR
 * FITNESS FOR A PARTICULAR PURPOSE. For more details, see GNU GPL at https://www.gnu.org/copyleft/gpl.html
 *
 * You can contact Ascensio System SIA by email at sales@onlyoffice.com
 *
 * The interactive user interfaces in modified source and object code versions of ONLYOFFICE must display 
 * Appropriate Legal Notices, as required under Section 5 of the GNU GPL version 3.
 *
 * Pursuant to Section 7 ยง 3(b) of the GNU GPL you must retain the original ONLYOFFICE logo which contains 
 * relevant author attributions when distributing the software. If the display of the logo in its graphic 
 * form is not reasonably feasible for technical reasons, you must include the words "Powered by ONLYOFFICE" 
 * in every copy of the program you distribute. 
 * Pursuant to Section 7 ยง 3(e) we decline to grant you any rights under trademark law for use of our trademarks.
 *
*/
'use strict';
var config = require('config');
var amqp = require('amqplib/callback_api');
var logger = require('./logger');

var cfgRabbitUrl = config.get('rabbitmq.url');
var cfgRabbitLogin = config.get('rabbitmq.login');
var cfgRabbitPassword = config.get('rabbitmq.password');
var cfgRabbitConnectionTimeout = config.get('rabbitmq.connectionTimeout');
var cfgRabbitAuthMechanism = config.get('rabbitmq.authMechanism');
var cfgRabbitVhost = config.get('rabbitmq.vhost');
var cfgRabbitNoDelay = config.get('rabbitmq.noDelay');
var cfgRabbitSslEnabled = config.get('rabbitmq.sslenabled');

var RECONNECT_TIMEOUT = 1000;

var connetOptions = {
  login: cfgRabbitLogin,
  password: cfgRabbitPassword,
  connectionTimeout: cfgRabbitConnectionTimeout,
  authMechanism: cfgRabbitAuthMechanism,
  vhost: cfgRabbitVhost,
  noDelay: cfgRabbitNoDelay,
  ssl: {
    enabled: cfgRabbitSslEnabled
  }
};

function connetPromise(closeCallback) {
  return new Promise(function(resolve, reject) {
    function startConnect() {
      amqp.connect(cfgRabbitUrl, connetOptions, function(err, conn) {
        if (null != err) {
          logger.error('[AMQP] %s', err.stack);
          setTimeout(startConnect, RECONNECT_TIMEOUT);
        } else {
          conn.on('error', function(err) {
            logger.error('[AMQP] conn error', err.stack);
          });
          var closeEventCallback = function() {
            //in some case receive multiple close events
            conn.removeListener('close', closeEventCallback);
            console.debug("[AMQP] conn close");
            closeCallback();
          };
          conn.on('close', closeEventCallback);
          logger.debug('[AMQP] connected');
          resolve(conn);
        }
      });
    }
    startConnect();
  });
}
function createChannelPromise(conn) {
  return new Promise(function(resolve, reject) {
    conn.createChannel(function(err, channel) {
      if (null != err) {
        reject(err);
      } else {
        resolve(channel);
      }
    });
  });
}
function createConfirmChannelPromise(conn) {
  return new Promise(function(resolve, reject) {
    conn.createConfirmChannel(function(err, channel) {
      if (null != err) {
        reject(err);
      } else {
        resolve(channel);
      }
    });
  });
}
function assertExchangePromise(channel, exchange, type, options) {
  return new Promise(function(resolve, reject) {
    channel.assertExchange(exchange, type, options, function(err, ok) {
      if (null != err) {
        reject(err);
      } else {
        resolve(ok.exchange);
      }
    });
  });
}
function assertQueuePromise(channel, queue, options) {
  return new Promise(function(resolve, reject) {
    channel.assertQueue(queue, options, function(err, ok) {
      if (null != err) {
        reject(err);
      } else {
        resolve(ok.queue);
      }
    });
  });
}
function consumePromise(channel, queue, messageCallback, options) {
  return new Promise(function(resolve, reject) {
    channel.consume(queue, messageCallback, options, function(err, ok) {
      if (null != err) {
        reject(err);
      } else {
        resolve(ok);
      }
    });
  });
}

module.exports.connetPromise = connetPromise;
module.exports.createChannelPromise = createChannelPromise;
module.exports.createConfirmChannelPromise = createConfirmChannelPromise;
module.exports.assertExchangePromise = assertExchangePromise;
module.exports.assertQueuePromise = assertQueuePromise;
module.exports.consumePromise = consumePromise;
