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
// Add pl_PL
arrDictionaries["1045"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/pl_PL/pl_PL.aff',
	__dirname + '/../Dictionaries/pl_PL/pl_PL.dic');
// Add pt_BR
arrDictionaries["1046"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/pt_BR/pt_BR.aff',
	__dirname + '/../Dictionaries/pt_BR/pt_BR.dic');
// Add pt_PT
arrDictionaries["2070"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/pt_PT/pt_PT.aff',
	__dirname + '/../Dictionaries/pt_PT/pt_PT.dic');
// Add vi_VN
arrDictionaries["1066"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/vi_VN/vi_VN.aff',
	__dirname + '/../Dictionaries/vi_VN/vi_VN.dic');
// Add ko_KR
arrDictionaries["1042"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/ko_KR/ko_KR.aff',
	__dirname + '/../Dictionaries/ko_KR/ko_KR.dic');
// Add uk_UA
arrDictionaries["1058"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/uk_UA/uk_UA.aff',
	__dirname + '/../Dictionaries/uk_UA/uk_UA.dic');
// Add tr_TR
arrDictionaries["1055"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/tr_TR/tr_TR.aff',
	__dirname + '/../Dictionaries/tr_TR/tr_TR.dic');
// Add ca_ES
arrDictionaries["1027"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/ca_ES/ca_ES.aff',
	__dirname + '/../Dictionaries/ca_ES/ca_ES.dic');
// Add da_DK
arrDictionaries["1030"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/da_DK/da_DK.aff',
	__dirname + '/../Dictionaries/da_DK/da_DK.dic');
// Add de_AT
arrDictionaries["3079"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/de_AT/de_AT.aff',
	__dirname + '/../Dictionaries/de_AT/de_AT.dic');
// Add de_CH
arrDictionaries["2055"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/de_CH/de_CH.aff',
	__dirname + '/../Dictionaries/de_CH/de_CH.dic');
// Add hu_HU
arrDictionaries["1038"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/hu_HU/hu_HU.aff',
	__dirname + '/../Dictionaries/hu_HU/hu_HU.dic');
// Add lt_LT
arrDictionaries["1063"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/lt_LT/lt_LT.aff',
	__dirname + '/../Dictionaries/lt_LT/lt_LT.dic');
// Add nb_NO
arrDictionaries["1044"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/nb_NO/nb_NO.aff',
	__dirname + '/../Dictionaries/nb_NO/nb_NO.dic');
// Add nl_NL
arrDictionaries["1043"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/nl_NL/nl_NL.aff',
	__dirname + '/../Dictionaries/nl_NL/nl_NL.dic');
// Add nn_NO
arrDictionaries["2068"] = new nodehun.Dictionary(__dirname + '/../Dictionaries/nn_NO/nn_NO.aff',
	__dirname + '/../Dictionaries/nn_NO/nn_NO.dic');

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