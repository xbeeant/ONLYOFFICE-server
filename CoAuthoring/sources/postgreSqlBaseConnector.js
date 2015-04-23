var pg = require('pg');
var config = require('./config.json');
var configSql = config['sql'];
var connectionString = 'postgres://' + configSql['user'] + ':' + configSql['pass'] + '@' + configSql['host'] +
	(configSql['dbport'] ? (':' + configSql['dbport']) : '') + '/' + configSql['database'];

var logger = require('./../../Common/sources/logger');

exports.sqlQuery = function (sqlCommand, callbackFunction) {
	pg.connect(connectionString, function (err, connection, done) {
		if(err) {
			logger.error('pool.getConnection error: %s', err);
			if (callbackFunction) callbackFunction(err, null);
			return;
		}

		connection.query(sqlCommand, function (error, result) {
			//call `done()` to release the client back to the pool
			done();

			if (error) logger.error('sqlQuery: %s sqlCommand: %s', error.message, sqlCommand.slice(0, 50));
			if (callbackFunction) callbackFunction(error, result ? result.rows : result);
		});
	});
};
exports.sqlEscape = function (value) {
	return value.replace( /(\')/g, "\\'" );
};