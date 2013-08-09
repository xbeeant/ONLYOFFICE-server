var sockjs = require('sockjs'),
	nodehun = require('nodehun');
var arrDictionaries = {};

function CheckDictionary( dict, correct, uncorect)
{
	if(dict)
	{
		dict.spellSuggest(correct, function(a,b){
			if(!a)
				logger.error('Error: spelling correct word %s failed!', correct)
			});
			
		dict.spellSuggestions(uncorect,function(a,b){
			if(a)
				logger.error('Error: spelling uncorect word %s failed!', uncorect)
			});
	}
	else
	{
		logger.error('Error: no dictionary');
	}
}

// Add en_US
arrDictionaries["1033"] = new nodehun.Dictionary(__dirname + '/../Dictionaries1/en_US/en_US.aff',
	__dirname + '/../Dictionaries/en_US/en_US.dic');
	
//CheckDictionary( arrDictionaries["1033"], 'color', 'calor' )

// Add ru_RU
arrDictionaries["1049"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/ru_RU/ru_RU.aff',
	__dirname + '/../Dictionaries/ru_RU/ru_RU.dic');
// Add de_DE
arrDictionaries["1031"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/de_DE/de_DE.aff',
	__dirname + '/../Dictionaries/de_DE/de_DE.dic');
// Add es_ES
arrDictionaries["3082"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/es_ES/es_ES.aff',
	__dirname + '/../Dictionaries/es_ES/es_ES.dic');
// Add fr_FR
arrDictionaries["1036"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/fr_FR/fr_FR.aff',
	__dirname + '/../Dictionaries/fr_FR/fr_FR.dic');
// Add it_IT
arrDictionaries["1040"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/it_IT/it_IT.aff',
	__dirname + '/../Dictionaries/it_IT/it_IT.dic');
// Add lv_LV
arrDictionaries["1062"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/lv_LV/lv_LV.aff',
	__dirname + '/../Dictionaries/lv_LV/lv_LV.dic');
// Add cs_CZ
arrDictionaries["1029"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/cs_CZ/cs_CZ.aff',
	__dirname + '/../Dictionaries/cs_CZ/cs_CZ.dic');
// Add el_GR
arrDictionaries["1032"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/el_GR/el_GR.aff',
	__dirname + '/../Dictionaries/el_GR/el_GR.dic');

var logger = require('./../../Common/sources/logger');
 
exports.install = function (server, callbackFunction) {
	'use strict';
	var sockjs_opts = {sockjs_url:"http://cdn.sockjs.org/sockjs-0.3.min.js"},
		sockjs_echo = sockjs.createServer(sockjs_opts),
		dataHandler;

	sockjs_echo.on('connection', function (conn) {
		if (null == conn) {
			logger.error ("null == conn");
			return;
		}
		conn.on('data', function (message) {
			try {
				var data = JSON.parse(message);
				dataHandler[data.type](conn, data);
			} catch (e) {
				logger.error("error receiving response:" + e);
			}

		});
		conn.on('error', function () {
			logger.error("On error");
		});
		conn.on('close', function () {
			logger.info("Connection closed or timed out");
		});
	});

	function sendData(conn, data) {
		conn.write(JSON.stringify(data));
	}

	dataHandler = (function () {
		function spellCheck(conn, data) {
			function checkEnd() {
				if (0 === data.usrWordsLength) {
					//data.end = new Date();
					//console.log("time - " + (data.end.getTime() - data.start.getTime()));
					sendData(conn, { type:"spellCheck", spellCheckData:JSON.stringify(data) });
				}
			}
			function spellSuggest(index, word, lang) {
				var oDictionary = arrDictionaries[lang];
				if (undefined === oDictionary) {
					data.usrCorrect[index] = false;
					--data.usrWordsLength;
					checkEnd();
				}

				if ("spell" === data.type) {
					oDictionary.spellSuggest(word, function (a, b) {
						data.usrCorrect[index] = a;
						--data.usrWordsLength;
						checkEnd();
					});
				} else if ("suggest" === data.type) {
					oDictionary.spellSuggestions(word, function (a, b) {
						data.usrSuggest[index] = b;
						--data.usrWordsLength;
						checkEnd();
					});
				}
			}

			data = JSON.parse(data.spellCheckData);
			// Ответ
			data.usrCorrect = [];
			data.usrSuggest = [];
			data.usrWordsLength = data.usrWords.length;

			//data.start = new Date();
			for (var i = 0, length = data.usrWords.length; i < length; ++i) {
				spellSuggest(i, data.usrWords[i], data.usrLang[i]);
			}
		}

		return {
			spellCheck:spellCheck
		};
	}());

	sockjs_echo.installHandlers(server, {prefix:'/doc/[0-9-.a-zA-Z_=]*/c', log:function (severity, message) {
		//TODO: handle severity
		logger.info(message);
	}});

	callbackFunction();
};