var config = require('./config.json');

process.env.NODE_ENV = config['server']['mode'];

var logger = require('./../../Common/sources/logger');

// 2. Express server
var express = require('express');

var http = require('http');
var https = require('https');

var fs = require("fs");
	
var app = express();
var server = {};

if(config['ssl'])
{
	var privateKey = fs.readFileSync(config['ssl']['key']).toString();
	var certificate = fs.readFileSync(config['ssl']['cert']).toString();
	
	var options = {key: privateKey, cert:certificate};
	
	server = https.createServer(options, app);
}
else
{
	server = http.createServer(app);
}

app.configure(function(){
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(express.static(__dirname + '/public'));
});

app.configure('development', function () {
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
    app.use(express.errorHandler());
});

var spellCheck  = require('./spellCheck');

spellCheck.install(server, function(){
	server.listen(config['server']['port'], function(){
		logger.info("Express server listening on port %d in %s mode", config['server']['port'], app.settings.env);
	});
	
	app.get('/index.html', function(req, res) {
		res.send('Server is functioning normally');
	});
});
