var sockjs = require('sockjs'),
    _ = require('underscore'),
	dataBase  = null,
	mysqlBase = null,
	https = require('https'),
	http = require('http'),
	url = require('url'),
	logger = require('./../../Common/sources/logger'),
	config = require('./config.json');
if (config["mongodb"])
	dataBase = require('./database');
if (config["mysql"])
	mysqlBase = require('./mySqlBase');

var defaultServerPort = 80, httpsPort = 443;
var objChanges = {}, objChangesTmp = {}, messages = {}, connections = [], objServiceInfo = {};

var c_oAscServerStatus = {
	NotFound	: 0,
	Editing		: 1,
	MustSave	: 2,
	Corrupted	: 3,
	Closed		: 4
};

var c_oAscServerCommandErrors = {
	NoError			: 0,
	DocumentIdError	: 1,
	ParseError		: 2,
	CommandError	: 3
};

var c_oAscSaveTimeOutDelay = 5000;	// Время ожидания для сохранения на сервере (для отработки F5 в браузере)

var c_oAscRecalcIndexTypes = {
	RecalcIndexAdd:		1,
	RecalcIndexRemove:	2
};

/**
 * lock types
 * @const
 */
var c_oAscLockTypes = {
	kLockTypeNone	: 1, // никто не залочил данный объект
	kLockTypeMine	: 2, // данный объект залочен текущим пользователем
	kLockTypeOther	: 3, // данный объект залочен другим(не текущим) пользователем
	kLockTypeOther2	: 4, // данный объект залочен другим(не текущим) пользователем (обновления уже пришли)
	kLockTypeOther3	: 5  // данный объект был залочен (обновления пришли) и снова стал залочен
};

var c_oAscLockTypeElem = {
	Range:	1,
	Object:	2,
	Sheet:	3
};
var c_oAscLockTypeElemSubType = {
	DeleteColumns:		1,
	InsertColumns:		2,
	DeleteRows:			3,
	InsertRows:			4,
	ChangeProperties:	5
};

var c_oAscLockTypeElemPresentation = {
	Object		: 1,
	Slide		: 2,
	Presentation: 3
};

function CRecalcIndexElement(recalcType, position, bIsSaveIndex) {
	if ( !(this instanceof CRecalcIndexElement) ) {
		return new CRecalcIndexElement (recalcType, position, bIsSaveIndex);
	}

	this._recalcType	= recalcType;		// Тип изменений (удаление или добавление)
	this._position		= position;			// Позиция, в которой произошли изменения
	this._count			= 1;				// Считаем все изменения за простейшие
	this.m_bIsSaveIndex	= !!bIsSaveIndex;	// Это индексы из изменений других пользователей (которые мы еще не применили)

	return this;
}

CRecalcIndexElement.prototype = {
	constructor: CRecalcIndexElement,

	// Пересчет для других
	getLockOther: function (position, type) {
		var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? +1 : -1;
		if (position === this._position && c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
			true === this.m_bIsSaveIndex) {
			// Мы еще не применили чужие изменения (поэтому для insert не нужно отрисовывать)
			// RecalcIndexRemove (потому что перевертываем для правильной отработки, от другого пользователя
			// пришло RecalcIndexAdd
			return null;
		} else if (position === this._position &&
			c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
			c_oAscLockTypes.kLockTypeMine === type && false === this.m_bIsSaveIndex) {
			// Для пользователя, который удалил столбец, рисовать залоченные ранее в данном столбце ячейки
			// не нужно
			return null;
		} else if (position < this._position)
			return position;
		else
			return (position + inc);
	},
	// Пересчет для других (только для сохранения)
	getLockSaveOther: function (position, type) {
		if (this.m_bIsSaveIndex)
			return position;

		var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? +1 : -1;
		if (position === this._position && c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
			true === this.m_bIsSaveIndex) {
			// Мы еще не применили чужие изменения (поэтому для insert не нужно отрисовывать)
			// RecalcIndexRemove (потому что перевертываем для правильной отработки, от другого пользователя
			// пришло RecalcIndexAdd
			return null;
		} else if (position === this._position &&
			c_oAscRecalcIndexTypes.RecalcIndexRemove === this._recalcType &&
			c_oAscLockTypes.kLockTypeMine === type && false === this.m_bIsSaveIndex) {
			// Для пользователя, который удалил столбец, рисовать залоченные ранее в данном столбце ячейки
			// не нужно
			return null;
		} else if (position < this._position)
			return position;
		else
			return (position + inc);
	},
	// Пересчет для себя
	getLockMe: function (position) {
		var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? -1 : +1;
		if (position < this._position)
			return position;
		else
			return (position + inc);
	},
	// Только когда от других пользователей изменения (для пересчета)
	getLockMe2: function (position) {
		var inc = (c_oAscRecalcIndexTypes.RecalcIndexAdd === this._recalcType) ? -1 : +1;
		if (true !== this.m_bIsSaveIndex || position < this._position)
			return position;
		else
			return (position + inc);
	}
};

function CRecalcIndex() {
	if ( !(this instanceof CRecalcIndex) ) {
		return new CRecalcIndex ();
	}

	this._arrElements = [];		// Массив CRecalcIndexElement

	return this;
}

CRecalcIndex.prototype = {
	constructor: CRecalcIndex,
	add: function (recalcType, position, count, bIsSaveIndex) {
		for (var i = 0; i < count; ++i)
			this._arrElements.push(new CRecalcIndexElement(recalcType, position, bIsSaveIndex));
	},
	clear: function () {
		this._arrElements.length = 0;
	},

	// Пересчет для других
	getLockOther: function (position, type) {
		var newPosition = position;
		var count = this._arrElements.length;
		for (var i = 0; i < count; ++i) {
			newPosition = this._arrElements[i].getLockOther(newPosition, type);
			if (null === newPosition)
				break;
		}

		return newPosition;
	},
	// Пересчет для других (только для сохранения)
	getLockSaveOther: function (position, type) {
		var newPosition = position;
		var count = this._arrElements.length;
		for (var i = 0; i < count; ++i) {
			newPosition = this._arrElements[i].getLockSaveOther(newPosition, type);
			if (null === newPosition)
				break;
		}

		return newPosition;
	},
	// Пересчет для себя
	getLockMe: function (position) {
		var newPosition = position;
		var count = this._arrElements.length;
		for (var i = count - 1; i >= 0; --i) {
			newPosition = this._arrElements[i].getLockMe(newPosition);
			if (null === newPosition)
				break;
		}

		return newPosition;
	},
	// Только когда от других пользователей изменения (для пересчета)
	getLockMe2: function (position) {
		var newPosition = position;
		var count = this._arrElements.length;
		for (var i = count - 1; i >= 0; --i) {
			newPosition = this._arrElements[i].getLockMe2(newPosition);
			if (null === newPosition)
				break;
		}

		return newPosition;
	}
};

function removeSaveChanges(id, deleteMessages) {
	if (deleteMessages) {
		// remove messages from dataBase
		if (dataBase)
			dataBase.remove ("messages", {docid:id});
		// remove messages from memory
		delete messages[id];
	}

	// remove changes from dataBase
	if (dataBase)
		dataBase.remove ("changes", {docid:id});
	// remove changes from memory
	delete objChanges[id];
}

function sendData(conn, data) {
	conn.write(JSON.stringify(data));
}

function getOriginalParticipantsId(docId) {
	var result = [], tmpObject = {}, elConnection;
	for (var i = 0, length = connections.length; i < length; ++i) {
		elConnection = connections[i].connection;
		if (elConnection.docId === docId && false === elConnection.isViewer)
			tmpObject[elConnection.userIdOriginal] = 1;
	}
	for(var name in tmpObject) if (tmpObject.hasOwnProperty(name))
		result.push(name);
	return result;
}

function sendServerRequest (serverHost, serverPort, serverPath, sendData) {
	if (!serverHost || !serverPath)
		return;
	var options = {
		host: serverHost,
		port: serverPort ? serverPort : defaultServerPort,
		path: serverPath,
		method: 'POST'
	};

	var requestFunction = httpsPort === serverPort ? https.request : http.request;

	var req = requestFunction(options, function(res) {
		res.setEncoding('utf8');
		res.on('data', function(replyData) {
			logger.info('replyData: ' + replyData);
		});
		res.on('end', function() {
			logger.info('end');
		});
	});

	req.on('error', function(e) {
		logger.warn('problem with request on server: ' + e.message);
	});

	// write data to request body
	req.write(sendData);
	req.end();
}

// Отправка статуса, чтобы знать когда документ начал редактироваться, а когда закончился
function sendStatusDocument (docId, bChangeBase) {
	var callback = objServiceInfo[docId];
	if (null == callback)
		return;

	var status = c_oAscServerStatus.Editing;
	var participants = getOriginalParticipantsId(docId);
	var docChanges;
	if (0 === participants.length && !((docChanges = objChanges[docId]) && 0 < docChanges.length))
		status = c_oAscServerStatus.Closed;

	if (bChangeBase) {
		if (c_oAscServerStatus.Editing === status) {
			// Добавить в базу
			if (mysqlBase)
				mysqlBase.insertCallback(docId, callback.href);
		} else if (c_oAscServerStatus.Closed === status) {
			// Удалить из базы
			if (mysqlBase)
				mysqlBase.deleteCallback(docId);
			delete objServiceInfo[docId];
		}
	}

	var sendData = JSON.stringify({'key': docId, 'status': status, 'url': '', 'users': participants});
	sendServerRequest(callback.hostname, callback.port, callback.path, sendData);
}

function dropUserFromDocument (docId, userId, description) {
	var elConnection;
	for (var i = 0, length = connections.length; i < length; ++i) {
		elConnection = connections[i].connection;
		if (elConnection.docId === docId && userId === elConnection.userIdOriginal) {
			sendData(elConnection,
				{
					type			: "drop",
					description		: description
				});//Or 0 if fails
		}
	}
}

exports.install = function (server, callbackFunction) {
    'use strict';
    var sockjs_opts = {sockjs_url:"http://cdn.sockjs.org/sockjs-0.3.min.js"},
        sockjs_echo = sockjs.createServer(sockjs_opts),
		indexUser = {},
        locks = {},
		arrSaveLock = {},
		saveTimers = {},// Таймеры сохранения, после выхода всех пользователей
        urlParse = new RegExp("^/doc/([0-9-.a-zA-Z_=]*)/c.+", 'i');

    sockjs_echo.on('connection', function (conn) {
		if (null == conn) {
			logger.error ("null == conn");
			return;
        }
        conn.on('data', function (message) {
            try {
                var data = JSON.parse(message);
				switch (data.type) {
					case 'auth'					: auth(conn, data); break;
					case 'message'				: onMessage(conn, data); break;
					case 'getlock'				: getLock(conn, data); break;
					case 'getlockrange'			: getLockRange(conn, data); break;
					case 'getlockpresentation'	: getLockPresentation(conn, data); break;
					case 'savechanges'			: saveChanges(conn, data); break;
					case 'issavelock'			: isSaveLock(conn, data); break;
					case 'unsavelock'			: unSaveLock(conn, data); break;
					case 'getmessages'			: getMessages(conn, data); break;
				}
            } catch (e) {
                logger.error("error receiving response:" + e);
            }

        });
        conn.on('error', function () {
            logger.error("On error");
        });
        conn.on('close', function () {
            var connection = this, docLock, userLocks, participants, reconected, curChanges;

            logger.info("Connection closed or timed out");
            //Check if it's not already reconnected

            //Notify that participant has gone
            connections = _.reject(connections, function (el) {
                return el.connection.id === connection.id;//Delete this connection
            });
            reconected = _.any(connections, function (el) {
                return el.connection.sessionId === connection.sessionId;//This means that client is reconected
            });

			var state = (false == reconected) ? false : undefined;
			participants = getParticipants(conn.docId);
            sendParticipantsState(participants, state, connection.userId, connection.userName, connection.userColor);

            if (!reconected) {
				// Для данного пользователя снимаем лок с сохранения
				if (undefined != arrSaveLock[conn.docId] && connection.userId == arrSaveLock[conn.docId].user) {
					// Очищаем предыдущий таймер
					if (null != arrSaveLock[conn.docId].saveLockTimeOutId)
						clearTimeout(arrSaveLock[conn.docId].saveLockTimeOutId);
					arrSaveLock[conn.docId] = undefined;
				}

				// Только если редактируем
				if (false === connection.isViewer) {
					// Если у нас нет пользователей, то удаляем все сообщения
					if (!hasEditors(conn.docId)) {
						// Очищаем предыдущий таймер
						if (null != arrSaveLock[conn.docId] && null != arrSaveLock[conn.docId].saveLockTimeOutId)
							clearTimeout(arrSaveLock[conn.docId].saveLockTimeOutId);
						// На всякий случай снимаем lock
						arrSaveLock[conn.docId] = undefined;

						// Send changes to save server
						curChanges = objChanges[conn.docId];
						if (curChanges && 0 < curChanges.length) {
							for (var i = 0; i < curChanges.length; ++i) {
								delete curChanges[i].skipChange;
							}
							saveTimers[conn.docId] = setTimeout(function () {
								sendChangesToServer(conn.server, conn.docId, conn.documentFormatSave);
							}, c_oAscSaveTimeOutDelay);
						} else {
							// Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
							sendStatusDocument(conn.docId, true);
						}
					} else
						sendStatusDocument(conn.docId, false);
				}
				
                //Давайдосвиданья!
                //Release locks
                docLock = locks[connection.docId];
                if (docLock) {
					userLocks = [];
					
					if ("array" === typeOf (docLock)) {
						for (var nIndex = 0; nIndex < docLock.length; ++nIndex) {
							if (docLock[nIndex].sessionId === connection.sessionId) {
								userLocks.push(docLock[nIndex]);
								docLock.splice(nIndex, 1);
								--nIndex;
							}
						}
					} else {
						for (var keyLockElem in docLock) if (docLock.hasOwnProperty(keyLockElem)) {
							if (docLock[keyLockElem].sessionId === connection.sessionId) {
								userLocks.push(docLock[keyLockElem]);
								delete docLock[keyLockElem];
							}
						}
					}
					
                    _.each(participants, function (participant) {
                        sendData(participant.connection, {type:"releaselock", locks:_.map(userLocks, function (e) {
                            return {
                                block:e.block,
                                user:e.user,
                                time:Date.now(),
                                changes:null
                            };
                        })});
                    });
                }
            }
        });
    });

    function sendParticipantsState(participants, stateConnect, _userId, _userName, _userColor) {
        _.each(participants, function (participant) {
			if (participant.connection.userId !== _userId) {
				sendData(participant.connection,
					{
						type		: "connectstate",
						state		: stateConnect,
						id			: _userId,
						username	: _userName,
						color		: _userColor
					});
			}
        });
    }

	function getParticipants(docId, excludeUserId) {
		return _.filter(connections, function (el) {
			return el.connection.docId === docId && el.connection.userId !== excludeUserId;
		});
	}
	function hasEditors(docId) {
		var result = false, elConnection;
		for (var i = 0, length = connections.length; i < length; ++i) {
			elConnection = connections[i].connection;
			if (elConnection.docId === docId && false === elConnection.isViewer) {
				result = true;
				break;
			}
		}
		return result;
	}
	
	function sendChangesToServer(server, docId, documentFormatSave) {
		var sendData = JSON.stringify({'id': docId, 'c': 'sfc',
			'url': '/RemoveChanges.ashx?id=' + docId,
			'outputformat': documentFormatSave,
			'data': c_oAscSaveTimeOutDelay
		});
		sendServerRequest(server.host, server.port, server.path, sendData);
	}

	// Пересчет только для чужих Lock при сохранении на клиенте, который добавлял/удалял строки или столбцы
	function _recalcLockArray (userId, _locks, oRecalcIndexColumns, oRecalcIndexRows) {
		if (null == _locks)
			return;
		var count = _locks.length;
		var element = null, oRangeOrObjectId = null;
		var i;
		var sheetId = -1;

		for (i = 0; i < count; ++i) {
			// Для самого себя не пересчитываем
			if (userId === _locks[i].user)
				continue;
			element = _locks[i].block;
			if (c_oAscLockTypeElem.Range !== element["type"] ||
				c_oAscLockTypeElemSubType.InsertColumns === element["subType"] ||
				c_oAscLockTypeElemSubType.InsertRows === element["subType"])
				continue;
			sheetId = element["sheetId"];

			oRangeOrObjectId = element["rangeOrObjectId"];

			if (oRecalcIndexColumns.hasOwnProperty(sheetId)) {
				// Пересчет колонок
				oRangeOrObjectId["c1"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c1"]);
				oRangeOrObjectId["c2"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c2"]);
			}
			if (oRecalcIndexRows.hasOwnProperty(sheetId)) {
				// Пересчет строк
				oRangeOrObjectId["r1"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r1"]);
				oRangeOrObjectId["r2"] = oRecalcIndexRows[sheetId].getLockMe2(oRangeOrObjectId["r2"]);
			}
		}
	}
	function _addRecalcIndex (oRecalcIndex) {
		var nIndex = 0;
		var nRecalcType = c_oAscRecalcIndexTypes.RecalcIndexAdd;
		var oRecalcIndexElement = null;
		var oRecalcIndexResult = {};

		for (var sheetId in oRecalcIndex) {
			if (oRecalcIndex.hasOwnProperty(sheetId)) {
				if (!oRecalcIndexResult.hasOwnProperty(sheetId)) {
					oRecalcIndexResult[sheetId] = new CRecalcIndex();
				}
				for (; nIndex < oRecalcIndex[sheetId]._arrElements.length; ++nIndex) {
					oRecalcIndexElement = oRecalcIndex[sheetId]._arrElements[nIndex];
					if (true === oRecalcIndexElement.m_bIsSaveIndex)
						continue;
					nRecalcType = (c_oAscRecalcIndexTypes.RecalcIndexAdd === oRecalcIndexElement._recalcType) ?
						c_oAscRecalcIndexTypes.RecalcIndexRemove : c_oAscRecalcIndexTypes.RecalcIndexAdd;
					// Дублируем для возврата результата (нам нужно пересчитать только по последнему индексу
					oRecalcIndexResult[sheetId].add(nRecalcType, oRecalcIndexElement._position,
						oRecalcIndexElement._count, /*bIsSaveIndex*/true);
				}
			}
		}

		return oRecalcIndexResult;
	}
	
	function compareExcelBlock(newBlock, oldBlock) {
		// Это lock для удаления или добавления строк/столбцов
		if (null !== newBlock.subType && null !== oldBlock.subType)
			return true;
		
		// Не учитываем lock от ChangeProperties (только если это не lock листа)
		if ((c_oAscLockTypeElemSubType.ChangeProperties === oldBlock.subType &&
				c_oAscLockTypeElem.Sheet !== newBlock.type) ||
			(c_oAscLockTypeElemSubType.ChangeProperties === newBlock.subType &&
				c_oAscLockTypeElem.Sheet !== oldBlock.type))
			return false;
			
		var resultLock = false;
		if (newBlock.type === c_oAscLockTypeElem.Range) {
			if (oldBlock.type === c_oAscLockTypeElem.Range) {
				// Не учитываем lock от Insert
				if (c_oAscLockTypeElemSubType.InsertRows === oldBlock.subType || c_oAscLockTypeElemSubType.InsertColumns === oldBlock.subType) {
					resultLock = false;
				} else if (isInterSection(newBlock.rangeOrObjectId, oldBlock.rangeOrObjectId)) {
					resultLock = true;
				}
			} else if (oldBlock.type === c_oAscLockTypeElem.Sheet) {
				resultLock = true;
			}
		} else if (newBlock.type === c_oAscLockTypeElem.Sheet) {
			resultLock = true;
		} else if (newBlock.type === c_oAscLockTypeElem.Object) {
			if (oldBlock.type === c_oAscLockTypeElem.Sheet) {
				resultLock = true;
			} else if (oldBlock.type === c_oAscLockTypeElem.Object && oldBlock.rangeOrObjectId === newBlock.rangeOrObjectId) {
				resultLock = true;
			}
		}
		return resultLock;
	}
	function isInterSection(range1, range2) {
		if (range2.c1 > range1.c2 || range2.c2 < range1.c1 || range2.r1 > range1.r2 || range2.r2 < range1.r1)
			return false;
		return true;
	}
	
	// Тип объекта
	function typeOf(obj) {
		if (obj === undefined) {return "undefined";}
		if (obj === null) {return "null";}
		return Object.prototype.toString.call(obj).slice(8, -1).toLowerCase();
	}
	// Сравнение для презентаций
	function comparePresentationBlock(newBlock, oldBlock) {
		var resultLock = false;

		switch (newBlock.type) {
			case c_oAscLockTypeElemPresentation.Presentation:
				if (c_oAscLockTypeElemPresentation.Presentation === oldBlock.type)
					resultLock = newBlock.val === oldBlock.val;
				break;
			case c_oAscLockTypeElemPresentation.Slide:
				if (c_oAscLockTypeElemPresentation.Slide === oldBlock.type)
					resultLock = newBlock.val === oldBlock.val;
				else if (c_oAscLockTypeElemPresentation.Object === oldBlock.type)
					resultLock = newBlock.val === oldBlock.slideId;
				break;
			case c_oAscLockTypeElemPresentation.Object:
				if (c_oAscLockTypeElemPresentation.Slide === oldBlock.type)
					resultLock = newBlock.slideId === oldBlock.val;
				else if (c_oAscLockTypeElemPresentation.Object === oldBlock.type)
					resultLock = newBlock.objId === oldBlock.objId;
				break;
		}
		return resultLock;
	}

	function auth(conn, data) {
		//TODO: Do authorization etc. check md5 or query db
		if (data.token && data.user) {
			var user = data.user;
			//Parse docId
			var parsed = urlParse.exec(conn.url);
			if (parsed.length > 1) {
				conn.docId = parsed[1];
			} else {
				//TODO: Send some shit back
			}

			// Очищаем таймер сохранения
			if (false === data.isViewer && saveTimers[conn.docId])
				clearTimeout(saveTimers[conn.docId]);

			// Увеличиваем индекс обращения к документу
			if (!indexUser.hasOwnProperty(conn.docId)) {
				indexUser[conn.docId] = 1;
			} else {
				indexUser[conn.docId] += 1;
			}

			conn.sessionState = 1;
			conn.userId = user.id + indexUser[conn.docId];
			conn.userIdOriginal = user.id;
			conn.userName = user.name;
			conn.userColor = user.color;
			conn.isViewer = data.isViewer;

			conn.server = data.server;
			if (!conn.server.port) conn.server.port = '';

			conn.documentFormatSave = data.documentFormatSave;
			//Set the unique ID
			if (data.sessionId !== null && _.isString(data.sessionId) && data.sessionId !== "") {
				logger.info("restored old session id=" + data.sessionId);

				//Kill previous connections
				connections = _.reject(connections, function (el) {
					return el.connection.sessionId === data.sessionId;//Delete this connection
				});
				conn.sessionId = data.sessionId;//restore old

			} else {
				conn.sessionId = conn.id;
			}
			connections.push({connection:conn});
			var participants = getParticipants(conn.docId);
			var participantsMap = _.map(participants, function (conn) {
				return {id: conn.connection.userId,
					username: conn.connection.userName, color: conn.connection.userColor};});

			// Отправляем только для тех, кто редактирует
			if (false === conn.isViewer)
				sendStatusDocument(conn.docId, false);

			sendData(conn,
				{
					type			: "auth",
					result			: 1,
					sessionId		: conn.sessionId,
					participants	: participantsMap,
					messages		: messages[conn.docid],
					locks			: locks[conn.docId],
					changes			: objChanges[conn.docId],
					indexUser		: indexUser[conn.docId]
				});//Or 0 if fails
			sendParticipantsState(participants, true, conn.userId, conn.userName, conn.userColor);
		}
	}
	function onMessage(conn, data) {
		var participants = getParticipants(conn.docId),
			msg = {docid:conn.docId, message:data.message, time:Date.now(), user:conn.userId, username:conn.userName};

		if (!messages.hasOwnProperty(conn.docId)) {
			messages[conn.docId] = [msg];
		} else {
			messages[conn.docId].push(msg);
		}

		// insert in dataBase
		logger.info("database insert message: " + JSON.stringify(msg));
		if (dataBase)
			dataBase.insert ("messages", msg);

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"message", messages:[msg]});
		});
	}
	function getLock(conn, data) {
		var participants = getParticipants(conn.docId), documentLocks;
		if (!locks.hasOwnProperty(conn.docId)) {
			locks[conn.docId] = {};
		}
		documentLocks = locks[conn.docId];

		// Data is array now
		var arrayBlocks = data.block;
		var isLock = false;
		var i = 0;
		var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
		for (; i < lengthArray; ++i) {
			logger.info("getLock id: " + arrayBlocks[i]);
			if (documentLocks.hasOwnProperty(arrayBlocks[i]) && documentLocks[arrayBlocks[i]] !== null) {
				isLock = true;
				break;
			}
		}
		if (0 === lengthArray)
			isLock = true;

		if (!isLock) {
			//Ok. take lock
			for (i = 0; i < lengthArray; ++i) {
				documentLocks[arrayBlocks[i]] = {time:Date.now(), user:conn.userId, block:arrayBlocks[i], sessionId:conn.sessionId};
			}
		}

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"getlock", locks:locks[conn.docId]});
		});
	}
	// Для Excel block теперь это объект { sheetId, type, rangeOrObjectId, guid }
	function getLockRange(conn, data) {
		var participants = getParticipants(conn.docId), documentLocks, documentLock;
		if (!locks.hasOwnProperty(conn.docId)) {
			locks[conn.docId] = [];
		}
		documentLocks = locks[conn.docId];

		// Data is array now
		var arrayBlocks = data.block;
		var isLock = false;
		var isExistInArray = false;
		var i = 0, blockRange = null;
		var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
		for (; i < lengthArray && false === isLock; ++i) {
			blockRange = arrayBlocks[i];
			for (var keyLockInArray in documentLocks) {
				if (true === isLock)
					break;
				if (!documentLocks.hasOwnProperty(keyLockInArray))
					continue;
				documentLock = documentLocks[keyLockInArray];
				// Проверка вхождения объекта в массив (текущий пользователь еще раз прислал lock)
				if (documentLock.user === conn.userId &&
					blockRange.sheetId === documentLock.block.sheetId &&
					blockRange.type === c_oAscLockTypeElem.Object &&
					documentLock.block.type === c_oAscLockTypeElem.Object &&
					documentLock.block.rangeOrObjectId === blockRange.rangeOrObjectId) {
					isExistInArray = true;
					break;
				}

				if (c_oAscLockTypeElem.Sheet === blockRange.type &&
					c_oAscLockTypeElem.Sheet === documentLock.block.type) {
					// Если текущий пользователь прислал lock текущего листа, то не заносим в массив, а если нового, то заносим
					if (documentLock.user === conn.userId) {
						if (blockRange.sheetId === documentLock.block.sheetId) {
							// уже есть в массиве
							isExistInArray = true;
							break;
						} else {
							// новый лист
							continue;
						}
					} else {
						// Если кто-то залочил sheet, то больше никто не может лочить sheet-ы (иначе можно удалить все листы)
						isLock = true;
						break;
					}
				}

				if (documentLock.user === conn.userId || !(documentLock.block) ||
					blockRange.sheetId !== documentLock.block.sheetId)
					continue;
				isLock = compareExcelBlock(blockRange, documentLock.block);
			}
		}
		if (0 === lengthArray)
			isLock = true;

		if (!isLock && !isExistInArray) {
			//Ok. take lock
			for (i = 0; i < lengthArray; ++i) {
				blockRange = arrayBlocks[i];
				documentLocks.push({time:Date.now(), user:conn.userId, block:blockRange, sessionId:conn.sessionId});
			}
		}

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"getlock", locks:locks[conn.docId]});
		});
	}
	// Для презентаций это объект { type, val } или { type, slideId, objId }
	function getLockPresentation(conn, data) {
		var participants = getParticipants(conn.docId), documentLocks, documentLock;
		if (!locks.hasOwnProperty(conn.docId)) {
			locks[conn.docId] = [];
		}
		documentLocks = locks[conn.docId];

		// Data is array now
		var arrayBlocks = data.block;
		var isLock = false;
		var isExistInArray = false;
		var i = 0, blockRange = null;
		var lengthArray = (arrayBlocks) ? arrayBlocks.length : 0;
		for (; i < lengthArray && false === isLock; ++i) {
			blockRange = arrayBlocks[i];
			for (var keyLockInArray in documentLocks) {
				if (true === isLock)
					break;
				if (!documentLocks.hasOwnProperty(keyLockInArray))
					continue;
				documentLock = documentLocks[keyLockInArray];

				if (documentLock.user === conn.userId || !(documentLock.block))
					continue;
				isLock = comparePresentationBlock(blockRange, documentLock.block);
			}
		}
		if (0 === lengthArray)
			isLock = true;

		if (!isLock && !isExistInArray) {
			//Ok. take lock
			for (i = 0; i < lengthArray; ++i) {
				blockRange = arrayBlocks[i];
				documentLocks.push({time:Date.now(), user:conn.userId, block:blockRange, sessionId:conn.sessionId});
			}
		}

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"getlock", locks:locks[conn.docId]});
		});
	}
	// Для Excel необходимо делать пересчет lock-ов при добавлении/удалении строк/столбцов
	function saveChanges(conn, data) {
		var docId = conn.docId;

		//if (false === data.isCoAuthoring && data.startSaveChanges) {
		//	// Мы еще не в совместном редактировании, нужно удалить старые изменения
		//	removeSaveChanges(docId, /*deleteMessages*/false);
		//}

		var deleteIndex = (null != data.deleteIndex) ? data.deleteIndex : -1;
		var objChange, bUpdate = false;
		if (data.startSaveChanges) {
			if (!objChangesTmp.hasOwnProperty(docId))
				delete objChangesTmp[docId];

			// Пользователь один и ему нужно сместить свои изменения
			if (-1 !== deleteIndex) {
				objChange = objChanges[docId].pop();
				if (!objChange) {
					logger.error("old sdk used");
					return;
				}
				bUpdate = true;
			} else
				objChange = {docid: docId, changes: data.changes, time: Date.now(),
					user: conn.userId, useridoriginal: conn.userIdOriginal, insertId: -1};
		} else {
			objChange = objChangesTmp[docId];
			bUpdate = true;
		}

		if (bUpdate) {
			// Обновляем время, и соединяем массив (ToDo подумать, может как-то улучшить это?)
			objChange.time = Date.now();
			var newChanges = JSON.parse(data.changes);
			var oldChanges = JSON.parse(objChange.changes);
			// Нужно начать не с самого начала (пользователь один)
			if (-1 !== deleteIndex && data.startSaveChanges) {
				oldChanges.splice(data.deleteIndex, oldChanges.length - data.deleteIndex);
			}

			newChanges = oldChanges.concat(newChanges);
			objChange.changes =	JSON.stringify(newChanges);
		}

		if (!data.endSaveChanges) {
			objChangesTmp[docId] = objChange;
			sendData(conn, {type:"savePartChanges"});
		} else {
			// Только когда пришли все изменения, то пишем в базу и добавляем изменения
			if (!objChanges.hasOwnProperty(docId)) {
				objChanges[docId] = [objChange];
			} else {
				objChanges[docId].push(objChange);
			}
			// insert in dataBase
			logger.info("database insert changes: " + JSON.stringify(objChange));
			if (dataBase)
				dataBase.insert("changes", objChange);
			if (mysqlBase) {
				if (-1 !== deleteIndex)
					mysqlBase.updateChanges(objChange);
				else
					mysqlBase.insertChanges(objChange, conn.server, conn.documentFormatSave);
			}

			if (data.isExcel && false !== data.isCoAuthoring) {
				var oElement = null;
				var oRecalcIndexColumns = null, oRecalcIndexRows = null;
				var oChanges = JSON.parse(objChange.changes);
				var nCount = oChanges.length;
				var nIndexChanges = 0;
				for (; nIndexChanges < nCount; ++nIndexChanges) {
					oElement = oChanges[nIndexChanges];
					if ("object" === typeof oElement) {
						if ("0" === oElement["type"]) {
							// Это мы получили recalcIndexColumns
							oRecalcIndexColumns = _addRecalcIndex(oElement["index"]);
						} else if ("1" === oElement["type"]) {
							// Это мы получили recalcIndexRows
							oRecalcIndexRows = _addRecalcIndex(oElement["index"]);
						}
					}

					// Теперь нужно пересчитать индексы для lock-элементов
					if (null !== oRecalcIndexColumns && null !== oRecalcIndexRows) {
						_recalcLockArray(conn.userId, locks[docId], oRecalcIndexColumns, oRecalcIndexRows);

						oRecalcIndexColumns = null;
						oRecalcIndexRows = null;
						break;
					}
				}
			}

			if (!objChangesTmp.hasOwnProperty(docId))
				delete objChangesTmp[docId];

			//Release locks
			var userLocks;
			var docLock = locks[docId];
			if (docLock) {
				if ("array" === typeOf (docLock)) {
					userLocks = [];
					for (var nIndex = 0; nIndex < docLock.length; ++nIndex) {
						if (null !== docLock[nIndex] && docLock[nIndex].sessionId === conn.sessionId) {
							userLocks.push(docLock[nIndex]);
							docLock.splice(nIndex, 1);
							--nIndex;
						}
					}
				} else {
					userLocks = _.filter(docLock, function (el) {
						return el !== null && el.sessionId === conn.sessionId;
					});
					for (var i = 0; i < userLocks.length; i++) {
						delete docLock[userLocks[i].block];
					}
				}
			}

			var participants = getParticipants(docId, conn.userId);
			_.each(participants, function (participant) {
				sendData(participant.connection, {type:"savechanges", changes:objChange.changes, user:conn.userId, locks:_.map(userLocks, function (e) {
					return {
						block:e.block,
						user:e.user,
						time:Date.now(),
						changes:null
					};
				})});
			});
		}
	}
	// Можем ли мы сохранять ?
	function isSaveLock(conn) {
		var _docId = conn.docId;
		var _userId = conn.userId;
		var _time = Date.now();
		var isSaveLock = (undefined === arrSaveLock[_docId]) ? false : arrSaveLock[_docId].savelock;
		if (false === isSaveLock) {
			arrSaveLock[conn.docId] = {docid:_docId, savelock:true, time:Date.now(), user:conn.userId};
			var _tmpSaveLock = arrSaveLock[_docId];
			// Вдруг не придет unlock,  пустим timeout на lock 60 секунд
			arrSaveLock[conn.docId].saveLockTimeOutId = setTimeout(function () {
				if (_tmpSaveLock && _userId == _tmpSaveLock.user && _time == _tmpSaveLock.time) {
					// Снимаем лок с сохранения
					arrSaveLock[_docId] = undefined;
				}
			}, 60000);
		}

		// Отправляем только тому, кто спрашивал (всем отправлять нельзя)
		sendData(conn, {type:"savelock", savelock:isSaveLock});
	}
	// Снимаем лок с сохранения
	function unSaveLock(conn) {
		if (undefined != arrSaveLock[conn.docId] && conn.userId != arrSaveLock[conn.docId].user) {
			// Не можем удалять не свой лок
			return;
		}
		// Очищаем предыдущий таймер
		if (arrSaveLock[conn.docId] && null != arrSaveLock[conn.docId].saveLockTimeOutId)
			clearTimeout(arrSaveLock[conn.docId].saveLockTimeOutId);

		arrSaveLock[conn.docId] = undefined;

		// Отправляем только тому, кто спрашивал (всем отправлять нельзя)
		sendData(conn, {type:"unsavelock"});
	}
	// Возвращаем все сообщения для документа
	function getMessages(conn) {
		sendData(conn, {type:"message", messages:messages[conn.docId]});
	}

    sockjs_echo.installHandlers(server, {prefix:'/doc/[0-9-.a-zA-Z_=]*/c', log:function (severity, message) {
		//TODO: handle severity
		logger.info(message);
    }});
	
	var callbackLoadMessages = function (arrayElements){
		if (null != arrayElements) {
			messages = arrayElements;
			
			// remove all messages from dataBase
			if (dataBase)
				dataBase.remove ("messages", {});
		}
		if (dataBase)
			dataBase.load ("changes", callbackLoadChanges);
		else
			callbackLoadChanges(null);
	};
	
	var callbackLoadChanges = function (arrayElements){
		if (null != arrayElements) {
			// ToDo Send changes to save server
			
			// remove all changes from dataBase
			if (dataBase)
				dataBase.remove ("changes", {});
		}
		callbackFunction ();
	};

	var callbackLoadChangesMySql = function (arrayElements){
		var createTimer = function (id, objProp) {
			return setTimeout(function () {
				sendChangesToServer(objProp.server,	id, objProp.documentFormatSave);
			}, c_oAscSaveTimeOutDelay);
		};
		if (null != arrayElements) {
			// add elements
			var docId, objChange, i, element, objProps = {};
			for (i = 0; i < arrayElements.length; ++i) {
				element = arrayElements[i];
				docId = element.docid;
				try {
					objChange = {docid:docId, changes:element.data, user:element.userid,
						useridoriginal: element.useridoriginal}; // Пишем пока без времени (это не особо нужно)
					if (!objChanges.hasOwnProperty(docId)) {
						objChanges[docId] = [objChange];
						objProps[docId] = {server: {
							host: element.serverHost, port: element.serverPort, path: element.serverPath
						}, documentFormatSave: element.documentFormatSave};
					} else
						objChanges[docId].push(objChange);
				} catch (e) {}
			}
			// Send to server
			for (i in objChanges) if (objChanges.hasOwnProperty(i)) {
				// Send changes to save server
				if (objChanges[i] && 0 < objChanges[i].length) {
					saveTimers[i] = createTimer(i, objProps[i]);
				}
			}
		}
		callbackFunction ();
	};
	
	if (dataBase)
		dataBase.load("messages", callbackLoadMessages);
	else if (mysqlBase)
		mysqlBase.loadChanges(callbackLoadChangesMySql);
	else
		callbackLoadMessages(null);
};
// Удаляем изменения из памяти (используется только с основного сервера, для очистки!)
exports.removeChanges = function (id) {
	removeSaveChanges(id, /*isDeleteMessages*/true);

	// Нужно удалить из базы callback-ов
	if (mysqlBase)
		mysqlBase.deleteCallback(id);
	delete objServiceInfo[id];
};
// Команда с сервера (в частности teamlab)
exports.commandFromServer = function (query) {
	// Ключ id-документа
	var docId = query.key;
	if (null == docId)
		return c_oAscServerCommandErrors.DocumentIdError;

	var result = c_oAscServerCommandErrors.NoError;
	switch(query.c) {
		case "info":
			// Подписка на эвенты:
			// - если пользователей нет и изменений нет, то отсылаем стату "закрыто" и в базу не добавляем
			// - если пользователей нет, а изменения есть, то отсылаем статус "редактируем" без пользователей, но добавляем в базу
			// - если есть пользователи, то просто добавляем в базу
			if (!objServiceInfo[docId]) {
				try {
					var parseObject = url.parse(decodeURIComponent(query.callback));
					var port = parseObject.port;
					if (!port)
						port = 'https:' === parseObject.protocol ? httpsPort : defaultServerPort;
					objServiceInfo[docId] = {
						'href'		: parseObject.href,
						'hostname'	: parseObject.hostname,
						'port'		: port,
						'path'		: parseObject.path
					};
				} catch (e) {return c_oAscServerCommandErrors.ParseError;}
			}
			sendStatusDocument(docId, true);
			break;
		case "drop":
			dropUserFromDocument(docId, query.userid, query.description);
			break;
		default:
			result = c_oAscServerCommandErrors.CommandError;
			break;
	}

	return result;
};