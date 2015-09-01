'use strict';
var config = require('./config.json');
var amqp = require('amqplib/callback_api');

var cfgRabbitUrl = config['rabbitmq']['url'];
var cfgRabbitLogin = config['rabbitmq']['login'];
var cfgRabbitPassword = config['rabbitmq']['password'];
var cfgRabbitConnectionTimeout = config['rabbitmq']['connectionTimeout'];
var cfgRabbitAuthMechanism = config['rabbitmq']['authMechanism'];
var cfgRabbitVhost = config['rabbitmq']['vhost'];
var cfgRabbitNoDelay = config['rabbitmq']['noDelay'];
var cfgRabbitSslEnabled = config['rabbitmq']['sslenabled'];

function connetPromise() {
  return new Promise(function(resolve, reject) {
    var option = {
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
    amqp.connect(cfgRabbitUrl, option, function(err, conn) {
      if (null != err) {
        reject(err);
      } else {
        resolve(conn);
      }
    });
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
