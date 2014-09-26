/*
* 1) Для view-режима обновляем страницу (без быстрого перехода), чтобы пользователь не считался за редактируемого и не
* 	держал документ для сборки (если не ждать, то непонятен быстрый переход из view в edit, когда документ уже собрался)
* 2) Если пользователь во view-режиме, то он не участвует в редактировании (только в chat-е). При открытии он получает
* 	все актуальные изменения в документе на момент открытия. Для view-режима не принимаем изменения и не отправляем их
* 	view-пользователям (т.к. непонятно что делать в ситуации, когда 1-пользователь наделал изменений,
* 	сохранил и сделал undo).
*
* Схема сохранения:
* а) Один пользователь - первый раз приходят изменения без индекса, затем изменения приходят с индексом, можно делать
* 	undo-redo (история не трется). Если автосохранение включено, то оно на любое действие (не чаще 5-ти секунд).
* b) Как только заходит второй пользователь, начинается совместное редактирование. На документ ставится lock, чтобы
* 	первый пользователь успел сохранить документ (либо прислать unlock)
* c) Когда пользователей 2 или больше, каждое сохранение трет историю и присылается целиком (без индекса). Если
* 	автосохранение включено, то сохраняется не чаще раз в 10-минут.
* d) Когда пользователь остается один, после принятия чужих изменений начинается пункт 'а'
*
* Схема работы с сервером:
* а) Когда все уходят, спустя время c_oAscSaveTimeOutDelay на сервер документов шлется команда на сборку.
* b) Если приходит статус '1' на CommandService.ashx, то удалось сохранить и поднять версию. Очищаем callback-и и
* 	изменения из базы и из памяти.
* с) Если приходит статус, отличный от '1', то трем callback-и, а изменения оставляем. Т.к. можно будет зайти в старую
* 	версию и получить несобранные изменения.
*
* При поднятии сервера, если он упал, мы получаем callback-и из базы, и только для них запускаем сборку, если были
* изменения.
* */

var sockjs = require('sockjs'),
    _ = require('underscore'),
	https = require('https'),
	http = require('http'),
	url = require('url'),
	logger = require('./../../Common/sources/logger'),
	config = require('./config.json'),
	mysqlBase = require('./mySqlBase');

var defaultHttpPort = 80, defaultHttpsPort = 443;
var objChanges = {}, messages = {}, connections = [], objServiceInfo = {};

// Максимальное число изменений, посылаемое на сервер (не может быть нечетным, т.к. пересчет обоих индексов должен быть)
var maxCountSaveChanges = 20000;

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

var FileStatus  = {
	None			: 0,
	Ok				: 1,
	WaitQueue		: 2,
	NeedParams		: 3,
	Convert			: 4,
	Err				: 5,
	ErrToReload		: 6,
	SaveVersion		: 7,
	UpdateVersion	: 8
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

function sendData(conn, data) {
	conn.write(JSON.stringify(data));
}

function getOriginalParticipantsId(docId) {
	var result = [], tmpObject = {}, elConnection;
	for (var i = 0, length = connections.length; i < length; ++i) {
		elConnection = connections[i].connection;
		if (elConnection.docId === docId && false === elConnection.isViewer)
			tmpObject[elConnection.user.idOriginal] = 1;
	}
	for(var name in tmpObject) if (tmpObject.hasOwnProperty(name))
		result.push(name);
	return result;
}

function sendServerRequest (server, postData) {
	if (!server.host || !server.path)
		return;
	var options = {
		host: server.host,
		path: server.path,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': postData.length
		},
		rejectUnauthorized: false
	};
	if (server.port)
		options.port = server.port;

	var requestFunction = server.https ? https.request : http.request;

	logger.info('postData: ' + postData);
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
	req.write(postData);
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
			mysqlBase.insertCallback(docId, callback.href);
		} else if (c_oAscServerStatus.Closed === status) {
			// Удалить из базы
			mysqlBase.deleteCallback(docId);
			delete objServiceInfo[docId];
		}
	}

	var sendData = JSON.stringify({'key': docId, 'status': status, 'url': '', 'users': participants});
	sendServerRequest(callback, sendData);
}

function dropUserFromDocument (docId, userId, description) {
	var elConnection;
	for (var i = 0, length = connections.length; i < length; ++i) {
		elConnection = connections[i].connection;
		if (elConnection.docId === docId && userId === elConnection.user.idOriginal) {
			sendData(elConnection,
				{
					type			: "drop",
					description		: description
				});//Or 0 if fails
		}
	}
}

// Удаляем изменения из памяти (используется только с основного сервера, для очистки!)
function removeChanges (id, isCorrupted) {
	logger.info('removeChanges: ' + id);
	// remove messages from memory
	delete messages[id];

	// Нужно удалить из базы callback-ов
	mysqlBase.deleteCallback(id);
	delete objServiceInfo[id];

	if (!isCorrupted) {
		// remove changes from memory
		delete objChanges[id];
		// Нужно удалить изменения из базы
		mysqlBase.deleteChangesByDocId(id);
	} else
		logger.error('saved corrupted id = ' + id);
}

exports.install = function (server, callbackFunction) {
    'use strict';
    var sockjs_opts = {sockjs_url:"http://cdn.sockjs.org/sockjs-0.3.min.js"},
        sockjs_echo = sockjs.createServer(sockjs_opts),
		indexUser = {},
        locks = {},
		lockDocuments = {},
		arrSaveLock = {},
		saveTimers = {},// Таймеры сохранения, после выхода всех пользователей
        urlParse = new RegExp("^/doc/([0-9-.a-zA-Z_=]*)/c.+", 'i');
	var asc_coAuthV	= '3.0.2';

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
					case 'getLock'				: getLock(conn, data); break;
					case 'getLockRange'			: getLockRange(conn, data); break;
					case 'getLockPresentation'	: getLockPresentation(conn, data); break;
					case 'saveChanges'			: saveChanges(conn, data); break;
					case 'isSaveLock'			: isSaveLock(conn, data); break;
					case 'unSaveLock'			: unSaveLock(conn, data); break;
					case 'getMessages'			: getMessages(conn, data); break;
					case 'unLockDocument'		: checkEndAuthLock(data.isSave, conn.docId, conn.user.id, null, conn.sessionId); break;
				}
            } catch (e) {
                logger.error("error receiving response:" + e);
            }

        });
        conn.on('error', function () {
            logger.error("On error");
        });
        conn.on('close', function () {
            var connection = this, userLocks, participants, reconnected, curChanges;
			var docId = conn.docId;
			if (null == docId)
				return;

            logger.info("Connection closed or timed out");
            //Check if it's not already reconnected

            //Notify that participant has gone
            connections = _.reject(connections, function (el) {
                return el.connection.id === connection.id;//Delete this connection
            });
			reconnected = _.any(connections, function (el) {
                return el.connection.sessionId === connection.sessionId;//This means that client is reconnected
            });

			var state = (false == reconnected) ? false : undefined;
			participants = getParticipants(docId);
            sendParticipantsState(participants, state, connection);

            if (!reconnected) {
				// Для данного пользователя снимаем лок с сохранения
				if (undefined != arrSaveLock[docId] && connection.user.id == arrSaveLock[docId].user) {
					// Очищаем предыдущий таймер
					if (null != arrSaveLock[docId].saveLockTimeOutId)
						clearTimeout(arrSaveLock[docId].saveLockTimeOutId);
					arrSaveLock[docId] = undefined;
				}

				// Только если редактируем
				if (false === connection.isViewer) {
					// Если у нас нет пользователей, то удаляем все сообщения
					if (!hasEditors(docId)) {
						// Очищаем предыдущий таймер
						if (null != arrSaveLock[docId] && null != arrSaveLock[docId].saveLockTimeOutId)
							clearTimeout(arrSaveLock[docId].saveLockTimeOutId);
						// На всякий случай снимаем lock
						arrSaveLock[docId] = undefined;

						// Send changes to save server
						curChanges = objChanges[docId];
						if (curChanges && 0 < curChanges.length) {
							saveTimers[docId] = setTimeout(function () {
								sendChangesToServer(conn.server, docId, conn.documentFormatSave);
							}, c_oAscSaveTimeOutDelay);
						} else {
							// Отправляем, что все ушли и нет изменений (чтобы выставить статус на сервере об окончании редактирования)
							sendStatusDocument(docId, true);
						}
					} else
						sendStatusDocument(docId, false);

					//Давайдосвиданья!
					//Release locks
					userLocks = getUserLocks(docId, connection.sessionId);
					if (0 < userLocks.length) {
						_.each(participants, function (participant) {
							if (!participant.connection.isViewer) {
								sendData(participant.connection, {type: "releaseLock", locks: _.map(userLocks, function (e) {
									return {
										block: e.block,
										user: e.user,
										time: Date.now(),
										changes: null
									};
								})});
							}
						});
					}

					// Для данного пользователя снимаем Lock с документа
					checkEndAuthLock(false, docId, connection.user.id, participants);
				}
            }
        });
    });

	function getUserLocks (docId, sessionId) {
		var userLocks = [], i;
		var docLock = locks[docId];
		if (docLock) {
			if ("array" === typeOf (docLock)) {
				for (i = 0; i < docLock.length; ++i) {
					if (docLock[i].sessionId === sessionId) {
						userLocks.push(docLock[i]);
						docLock.splice(i, 1);
						--i;
					}
				}
			} else {
				for (i in docLock) {
					if (docLock[i].sessionId === sessionId) {
						userLocks.push(docLock[i]);
						delete docLock[i];
					}
				}
			}
		}
		return userLocks;
	}

	function checkEndAuthLock (isSave, docId, userId, participants, sessionId) {
		var result = false, connection;
		if (lockDocuments.hasOwnProperty(docId) && userId === lockDocuments[docId].id) {
			delete lockDocuments[docId];

			if (!participants)
				participants = getParticipants(docId);

			var participantsMap = _.map(participants, function (conn) {
				var tmpUser = conn.connection.user;
				return {
					id			: tmpUser.id,
					username	: tmpUser.name,
					indexUser	: tmpUser.indexUser,
					view		: conn.connection.isViewer
				};
			});

			_.each(participants, function (participant) {
				connection = participant.connection;
				if (userId !== connection.user.id && !connection.isViewer) {
					sendData(connection, {
						type: "auth",
						result: 1,
						sessionId: connection.sessionId,
						participants: participantsMap,
						messages: messages[connection.docid],
						locks: locks[connection.docId],
						changes: objChanges[connection.docId],
						indexUser: indexUser[connection.docId]
					});
				}
			});

			result = true;
		} else if (isSave) {
			//Release locks
			var userLocks = getUserLocks(docId, sessionId);
			//Release locks
			if (0 < userLocks.length) {
				if (!participants)
					participants = getParticipants(docId);

				_.each(participants, function (participant) {
					connection = participant.connection;
					if (userId !== connection.user.id && !connection.isViewer) {
						sendData(connection, {type: "releaseLock", locks: _.map(userLocks, function (e) {
							return {
								block: e.block,
								user: e.user,
								time: Date.now(),
								changes: null
							};
						})});
					}
				});
			}
		}
		return result;
	}

    function sendParticipantsState(participants, stateConnect, oConnection) {
		var tmpUser = oConnection.user;
        _.each(participants, function (participant) {
			if (participant.connection.user.id !== tmpUser.id) {
				sendData(participant.connection, {
					type		: "connectState",
					state		: stateConnect,
					id			: tmpUser.id,
					username	: tmpUser.name,
					indexUser	: tmpUser.indexUser,
					view		: oConnection.isViewer
				});
			}
        });
    }

	function sendFileError(conn, errorId) {
		sendData(conn, {type : 'error', description: errorId});
	}

	function getParticipants(docId, excludeUserId, excludeViewer) {
		return _.filter(connections, function (el) {
			return el.connection.docId === docId && el.connection.user.id !== excludeUserId &&
				el.connection.isViewer !== excludeViewer;
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
			'url': '/CommandService.ashx?c=saved&status=0&key=' + docId,
			'outputformat': documentFormatSave,
			'data': c_oAscSaveTimeOutDelay
		});
		sendServerRequest(server, sendData);
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

			if (oRecalcIndexColumns && oRecalcIndexColumns.hasOwnProperty(sheetId)) {
				// Пересчет колонок
				oRangeOrObjectId["c1"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c1"]);
				oRangeOrObjectId["c2"] = oRecalcIndexColumns[sheetId].getLockMe2(oRangeOrObjectId["c2"]);
			}
			if (oRecalcIndexRows && oRecalcIndexRows.hasOwnProperty(sheetId)) {
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
		// Проверка версий
		if (data.version !== asc_coAuthV) {
			sendFileError(conn, 'Old Version Sdk');
			return;
		}

		//TODO: Do authorization etc. check md5 or query db
		if (data.token && data.user) {
			var docId;
			var user = data.user;
			//Parse docId
			var parsed = urlParse.exec(conn.url);
			if (parsed.length > 1) {
				docId = conn.docId = parsed[1];
			} else {
				//TODO: Send some shit back
			}

			// Очищаем таймер сохранения
			if (false === data.isViewer && saveTimers[docId])
				clearTimeout(saveTimers[docId]);

			// Увеличиваем индекс обращения к документу
			if (!indexUser.hasOwnProperty(docId))
				indexUser[docId] = 0;
			else
				indexUser[docId] += 1;

			conn.sessionState = 1;
			conn.user = {
				id			: user.id + indexUser[docId],
				idOriginal	: user.id,
				name		: user.name,
				indexUser	: indexUser[docId]
			};
			conn.isViewer = data.isViewer;

			conn.server = data.server;
			if (!conn.server.port) conn.server.port = '';

			conn.documentFormatSave = data.documentFormatSave;
			//Set the unique ID
			if (data.sessionId !== null && _.isString(data.sessionId) && data.sessionId !== "") {
				logger.info("restored old session id=" + data.sessionId);

				// Останавливаем сборку (вдруг она началась)
				// Когда переподсоединение, нам нужна проверка на сборку файла
				mysqlBase.checkStatusFile(docId, function (err, result) {
					if (null !== err || 0 === result.length) {
						// error database
						sendFileError(conn, 'DataBase error');
						return;
					}

					var status = result[0]['tr_status'];
					if (FileStatus.Ok === status) {
						// Все хорошо, статус обновлять не нужно
					} else if (FileStatus.SaveVersion === status) {
						// Обновим статус файла (идет сборка, нужно ее остановить)
						mysqlBase.updateStatusFile(docId);
					} else if (FileStatus.UpdateVersion === status) {
						// error version
						sendFileError(conn, 'Update Version error');
						return;
					} else {
						// Other error
						sendFileError(conn, 'Other error');
						return;
					}

					//Kill previous connections
					connections = _.reject(connections, function (el) {
						return el.connection.sessionId === data.sessionId;//Delete this connection
					});
					conn.sessionId = data.sessionId;//restore old

					endAuth(conn, true);
				});

			} else {
				conn.sessionId = conn.id;
				endAuth(conn, false);
			}
		}
	}
	function endAuth(conn, bIsRestore) {
		var docId = conn.docId;
		connections.push({connection:conn});
		var participants = getParticipants(docId);
		var tmpConnection, tmpUser, firstParticipantNoView, participantsMap = [], countNoView = 0;
		for (var i = 0; i < participants.length; ++i) {
			tmpConnection = participants[i].connection;
			tmpUser = tmpConnection.user;
			participantsMap.push({
				id			: tmpUser.id,
				username	: tmpUser.name,
				indexUser	: tmpUser.indexUser,
				view		: tmpConnection.isViewer
			});
			if (!tmpConnection.isViewer) {
				++countNoView;
				if (!firstParticipantNoView)
					firstParticipantNoView = participantsMap[participantsMap.length - 1];
			}
		}

		// Отправляем на внешний callback только для тех, кто редактирует
		if (!conn.isViewer)
			sendStatusDocument(docId, false);

		if (!bIsRestore && 2 === countNoView && !conn.isViewer) {
			// Ставим lock на документ
			lockDocuments[docId] = firstParticipantNoView;
		}

		// Для view не ждем снятия lock-а
		var sendObject = lockDocuments[docId] && !conn.isViewer ? {
			type			: "waitAuth",
			lockDocument	: lockDocuments[docId]
		} : {
			type			: "auth",
			result			: 1,
			sessionId		: conn.sessionId,
			participants	: participantsMap,
			messages		: messages[docId],
			locks			: locks[docId],
			changes			: objChanges[docId],
			indexUser		: indexUser[docId]
		};

		sendData(conn, sendObject);//Or 0 if fails

		sendParticipantsState(participants, true, conn);
	}
	function onMessage(conn, data) {
		var participants = getParticipants(conn.docId),
			msg = {docid:conn.docId, message:data.message, time:Date.now(), user:conn.user.id, username:conn.user.name};

		if (!messages.hasOwnProperty(conn.docId)) {
			messages[conn.docId] = [msg];
		} else {
			messages[conn.docId].push(msg);
		}

		// insert
		logger.info("insert message: " + JSON.stringify(msg));

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"message", messages:[msg]});
		});
	}
	function getLock(conn, data) {
		var participants = getParticipants(conn.docId, undefined, true), documentLocks;
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
				documentLocks[arrayBlocks[i]] = {time:Date.now(), user:conn.user.id,
					block:arrayBlocks[i], sessionId:conn.sessionId};
			}
		}

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"getLock", locks:locks[conn.docId]});
		});
	}
	// Для Excel block теперь это объект { sheetId, type, rangeOrObjectId, guid }
	function getLockRange(conn, data) {
		var participants = getParticipants(conn.docId, undefined, true), documentLocks, documentLock;
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
				if (documentLock.user === conn.user.id &&
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
					if (documentLock.user === conn.user.id) {
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

				if (documentLock.user === conn.user.id || !(documentLock.block) ||
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
				documentLocks.push({time:Date.now(), user:conn.user.id, block:blockRange, sessionId:conn.sessionId});
			}
		}

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"getLock", locks:locks[conn.docId]});
		});
	}
	// Для презентаций это объект { type, val } или { type, slideId, objId }
	function getLockPresentation(conn, data) {
		var participants = getParticipants(conn.docId, undefined, true), documentLocks, documentLock;
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

				if (documentLock.user === conn.user.id || !(documentLock.block))
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
				documentLocks.push({time:Date.now(), user:conn.user.id, block:blockRange, sessionId:conn.sessionId});
			}
		}

		_.each(participants, function (participant) {
			sendData(participant.connection, {type:"getLock", locks:locks[conn.docId]});
		});
	}
	// Для Excel необходимо делать пересчет lock-ов при добавлении/удалении строк/столбцов
	function saveChanges(conn, data) {
		var docId = conn.docId, userId = conn.user.id;
		var participants = getParticipants(docId, userId, true);

		if (!objChanges.hasOwnProperty(docId))
			objChanges[docId] = [];

		var deleteIndex = (null != data.deleteIndex) ? data.deleteIndex : -1;
		var startIndex = data.startIndex + (-1 !== deleteIndex ? deleteIndex : 0);
		var objChange, bUpdate = false;
		if (data.startSaveChanges && -1 !== deleteIndex) {
			while (true) {
				// Пользователь один и ему нужно сместить свои изменения
				objChange = objChanges[docId].pop();
				if (!objChange) {
					logger.error("old sdk used");
					return;
				}

				if (objChange.startIndex === deleteIndex) {
					// Удаляем запись и все
					mysqlBase.deleteChanges(objChange);
					break;
				} else if (objChange.startIndex > deleteIndex) {
					// Удаляем запись и продолжаем
					mysqlBase.deleteChanges(objChange);
				} else {
					// Нужно удалить часть изменений из массива и добавить новые
					// Обновляем время, и соединяем массив (если он не превышает размеры)
					objChange.time = Date.now();

					// ToDo подумать, может как-то улучшить это?
					var oldChanges = JSON.parse(objChange.changes);
					var sliceChanges = oldChanges.slice(0, deleteIndex - objChange.startIndex);
					var newChanges = JSON.parse(data.changes);
					if (maxCountSaveChanges < newChanges.length + sliceChanges.length) {
						objChange.changes =	JSON.stringify(sliceChanges);
						mysqlBase.updateChanges(objChange);
						_.each(participants, function (participant) {
							sendData(participant.connection, {type: 'saveChanges', time: objChange.time,
								changes: objChange.changes, user: userId, locks: []});
						});
						objChanges[docId].push(objChange);
					} else {
						newChanges = sliceChanges.concat(newChanges);
						objChange.changes =	JSON.stringify(newChanges);
						bUpdate = true;
					}
					break;
				}
			}
		}

		if (!bUpdate) {
			objChange = {docid: docId, changes: data.changes, time: Date.now(), user: userId,
				useridoriginal: conn.user.idOriginal, insertId: -1, startIndex: startIndex};
		}

		// Изменения пишем частями, т.к. в базу нельзя писать большими порциями
		if (bUpdate) {
			logger.info("updateChanges");
			mysqlBase.updateChanges(objChange);
		} else {
			logger.info("insertChanges");
			mysqlBase.insertChanges(objChange, conn.server, conn.documentFormatSave);
		}
		objChanges[docId].push(objChange);

		// Для Excel нужно пересчитать индексы для lock-ов
		if (data.isExcel && false !== data.isCoAuthoring) {
			var oElement = null;
			var oRecalcIndexColumns = null, oRecalcIndexRows = null;
			var oChanges = JSON.parse(objChange.changes);
			for (var nIndexChanges = 0; nIndexChanges < oChanges.length; ++nIndexChanges) {
				oElement = oChanges[nIndexChanges];
				if (oElement.hasOwnProperty("type")) {
					if ("0" === oElement["type"]) {
						// Это мы получили recalcIndexColumns
						oRecalcIndexColumns = _addRecalcIndex(oElement["index"]);
					} else if ("1" === oElement["type"]) {
						// Это мы получили recalcIndexRows
						oRecalcIndexRows = _addRecalcIndex(oElement["index"]);
					}
				}
			}

			// Теперь нужно пересчитать индексы для lock-элементов
			if (null !== oRecalcIndexColumns || null !== oRecalcIndexRows) {
				_recalcLockArray(userId, locks[docId], oRecalcIndexColumns, oRecalcIndexRows);
			}
		}

		if (data.endSaveChanges) {
			//Release locks
			var userLocks = getUserLocks(docId, conn.sessionId);
			// Для данного пользователя снимаем Lock с документа
			if (!checkEndAuthLock(false, docId, userId)) {
				var arrLocks = _.map(userLocks, function (e) {
					return {
						block:e.block,
						user:e.user,
						time:Date.now(),
						changes:null
					};
				});
				_.each(participants, function (participant) {
					sendData(participant.connection, {type: 'saveChanges', time: objChange.time,
						changes: objChange.changes, user: userId, locks: arrLocks});
				});
			}
		} else {
			_.each(participants, function (participant) {
				sendData(participant.connection, {type: 'saveChanges', time: objChange.time,
					changes: objChange.changes, user: userId, locks: []});
			});
			sendData(conn, {type: 'savePartChanges'});
		}
	}
	// Можем ли мы сохранять ?
	function isSaveLock(conn) {
		var _docId = conn.docId;
		var _userId = conn.user.id;
		var _time = Date.now();
		var isSaveLock = (undefined === arrSaveLock[_docId]) ? false : arrSaveLock[_docId].savelock;
		if (false === isSaveLock) {
			arrSaveLock[conn.docId] = {docid:_docId, savelock:true, time:Date.now(), user:conn.user.id};
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
		sendData(conn, {type:"saveLock", saveLock:isSaveLock});
	}
	// Снимаем лок с сохранения
	function unSaveLock(conn) {
		if (undefined != arrSaveLock[conn.docId] && conn.user.id != arrSaveLock[conn.docId].user) {
			// Не можем удалять не свой лок
			return;
		}
		// Очищаем предыдущий таймер
		if (arrSaveLock[conn.docId] && null != arrSaveLock[conn.docId].saveLockTimeOutId)
			clearTimeout(arrSaveLock[conn.docId].saveLockTimeOutId);

		arrSaveLock[conn.docId] = undefined;

		// Отправляем только тому, кто спрашивал (всем отправлять нельзя)
		sendData(conn, {type:"unSaveLock"});
	}
	// Возвращаем все сообщения для документа
	function getMessages(conn) {
		sendData(conn, {type:"message", messages:messages[conn.docId]});
	}

    sockjs_echo.installHandlers(server, {prefix:'/doc/[0-9-.a-zA-Z_=]*/c', log:function (severity, message) {
		//TODO: handle severity
		logger.info(message);
    }});

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
						useridoriginal: element.useridoriginal, insertId: -1}; // Пишем пока без времени (это не особо нужно)
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

	mysqlBase.loadChanges(callbackLoadChangesMySql);
};
// Команда с сервера (в частности teamlab)
exports.commandFromServer = function (query) {
	// Ключ id-документа
	var docId = query.key;
	if (null == docId)
		return c_oAscServerCommandErrors.DocumentIdError;

	logger.info('commandFromServer: docId = ' + docId + ' c = ' + query.c);
	var result = c_oAscServerCommandErrors.NoError;
	switch(query.c) {
		case 'info':
			// Подписка на эвенты:
			// - если пользователей нет и изменений нет, то отсылаем стату "закрыто" и в базу не добавляем
			// - если пользователей нет, а изменения есть, то отсылаем статус "редактируем" без пользователей, но добавляем в базу
			// - если есть пользователи, то просто добавляем в базу
			if (!objServiceInfo[docId]) {
				try {
					var parseObject = url.parse(decodeURIComponent(query.callback));
					var isHttps = 'https:' === parseObject.protocol;
					var port = parseObject.port;
					if (!port)
						port = isHttps ? defaultHttpsPort : defaultHttpPort;
					objServiceInfo[docId] = {
						'https'		: isHttps,
						'host'		: parseObject.hostname,
						'port'		: port,
						'path'		: parseObject.path,
						'href'		: parseObject.href
					};
				} catch (e) {return c_oAscServerCommandErrors.ParseError;}
			}
			sendStatusDocument(docId, true);
			break;
		case 'drop':
			dropUserFromDocument(docId, query.userid, query.description);
			break;
		case 'saved':
			// Результат от менеджера документов о статусе обработки сохранения файла после сборки
			removeChanges(docId, '1' !== query.status);
			break;
		default:
			result = c_oAscServerCommandErrors.CommandError;
			break;
	}

	return result;
};