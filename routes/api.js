'use strict';
var MongoClient = require('mongodb').MongoClient,
    config = require('../config'),
    express = require('express'),
    async = require('async'),
    crypto = require('crypto'),
    ObjectID = require('mongodb').ObjectID,
    mongoUrl = process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || config.mongodb.mongoUrl,
    router = express.Router(),
    TASKS_PER_GAME = 4,
    MAX_DIST_TO_TASK = (process.env.DEBUG) ? 20 : 0.2, //maximal distance to task in km
    MysqlConnector = require('../backend/mysqlConnector'),
    db = new MysqlConnector();


router.post('/task/create', function(req, res) {
    console.log('Adding ' + req.body.taskName + ' with location ' + req.body.location + ' to db');
    console.log(req.body);
    MongoClient.connect(mongoUrl, function(err, db) {
        if (err) throw err;
        //console.log(req.body);
        var collection = db.collection(config.mongodb.taskTable);
        collection.ensureIndex({
            'location': '2dsphere'
        }, function(err) {
            if (err) throw err;
        });

        var lon = parseFloat(req.body.location[0]);
        var lat = parseFloat(req.body.location[1]);

        collection.insert({
            taskName: req.body.taskName,
            userId: req.body.userId,
            completeCount: Number(req.body.completeCount),
            assignCount: Number(req.body.assignCount),
            riddleText: req.body.riddleText,
            hints: req.body.hints,
            location: {
                type: 'Point',
                coordinates: [lon, lat],
                category: 'task'
            }
        }, function(err, obj) {
            var msg = (err) ? {
                msg: err
            } : {
                msg: 'OK'
            };
            res.json(msg);
        });

    });
});

function getSha1OfString(string) {
    var hash = crypto.createHash('sha1')
        .update(string)
        .digest('hex');
    return hash.toString();
}
router.post('/register', function(req, res) {
    console.log('registering new user: ' + req.body.username);
    MongoClient.connect(mongoUrl, function(err, db) {
        if (err) throw err;
        var collection = db.collection(config.mongodb.userTable);
        collection.ensureIndex({
            username: 1
        }, {
            unique: true
        }, function(err) {
            if (err) {
                console.log(err);
            } else {
                var hash = getSha1OfString(req.body.password);

                var user = {
                    username: req.body.username,
                    password: hash,
                    tasksCompleted: [],
                    activeGame: null
                };
                collection.insert(user, function(err) {
                    if (err) {
                        console.log(err);
                        res.redirect('/register');
                    } else {
                        res.redirect('/login');
                    }
                    db.close();
                });
            }
        });

    });
});


router.post('/game/createHunt', function(req, res) {
    MongoClient.connect(mongoUrl, function(err, db) {

        var lon = parseFloat(req.body.lon),
            lat = parseFloat(req.body.lat),
            user = req.session.userInfo.username;

        if (lon === undefined || lat === undefined || user === undefined) {
            console.log('Missing info in request. Query: lon ' + lon + ' lat ' + lat + ' user ' + user);
            res.redirect('/login');
        } else {
            getTasksForLocation(lon, lat, function(tasks) {
                var newGame = {
                    'tasks': tasks,
                    'index': -1
                };

                if (err) throw err;
                var gameTableConnection = db.collection(config.mongodb.gameTable);
                gameTableConnection.insert(newGame, function(err, docs) {
                    if (err) throw err;
                    //res.status(200).send('OK');
                    res.send(docs[0]._id);
                    addActiveGameToUser(docs[0]._id, user);
                });
            });
        }

    });
});



function addActiveGameToUser(gameId, username) {
    MongoClient.connect(mongoUrl, function(err, db) {
        var connection = db.collection(config.mongodb.userTable);
        connection.update({
                'username': username
            }, {
                $set: {
                    activeGame: new ObjectID(gameId)
                }
            },
            function(err, docs) {
                if (err) throw err;
                db.close();
            });
    });
}


function queryMediaQ(query, fn) {
    db.query(query, function(rows, fields) {
        fn(rows, fields);
    }, 10);
}


router.get('/statistics', function(req, res) {
    getStatsByUsername(req.session.userInfo.username, function(error, userStats) {
        if (userStats !== null) {
            res.json(userStats);
        } else {
            res.json({
                'msg': 'could not find user'
            });
            console.log('User could not be found');
        }
    });
});

function getStatsByUsername(username, fn) {
    //get data from mediaq and geohunt (userstats and taskStats) 
    async.parallel({
            mediaQ: function(callback) {
                getMediaQStats(callback, username);
            },
            geoHunt: function(callback) {
                getGeoHuntStats(callback, username);
            },
            tasks: function(callback) {
                getTaskStats(callback);
            },
            videoValidation: function(callback) {
                getValidatedVideoCount(callback, username);
            }
        },
        function(err, results) {
            fn(null, results);
        });
}

function getMediaQStats(callback, username) {
    var query = 'SELECT UserName,' +
        ' DeviceOs, LastActivityDate, count(VideoId) AS \'Uploaded Videos\'' +
        ' FROM MediaQ_V2.VIDEO_INFO' +
        ' INNER JOIN MediaQ_V2.VIDEO_USER USING(VideoId)' +
        ' INNER JOIN MediaQ_V2.USERS_PROFILES USING(UserId)' +
        ' WHERE UserName = \'' + db.sanitizeString(username) + '\'' +
        ' Order By count(VideoId) DESC;';
    queryMediaQ(query, function(rows) {
        callback(null, rows[0]);
    });
}

//Gets the videos uploaded by the user and compares them to his completed tasks
function getValidatedVideoCount(callback, username) {
    var query = 'SELECT  VideoId,' +
        '    CONCAT_WS(\',\',' +
        '            GROUP_CONCAT(Plat),' +
        '            GROUP_CONCAT(Plng)) AS coords' +
        ' FROM MediaQ_V2.VIDEO_USER' +
        ' INNER JOIN MediaQ_V2.USERS_PROFILES USING (UserId)' +
        ' INNER JOIN MediaQ_V2.VIDEO_METADATA USING (VideoId)' +
        ' WHERE UserName = \'' + db.sanitizeString(username) + '\'' +
        ' GROUP BY VideoId;';
    //gets the videos uploaded by user
    queryMediaQ(query, function(rows) {
        var successfullyValidatedVideos = [];

        //gets the data of user 
        getUserData(function(userData) {
            //gets only the tasks with their location from userdata 
            getTaskLocationFromUserData(userData, function(tasks) {
                for (var i = 0; i < rows.length; i++) {
                    validateVideoData(rows[i], tasks, function(succVideoData) {
                        //console.log(validatedVideos);
                        if (succVideoData !== null) {
                            //console.log('User uploaded a video matching a task: \n' + JSON.stringify(succVideoData));
                            successfullyValidatedVideos.push(succVideoData);
                        }
                    });
                }
                callback(null, successfullyValidatedVideos);
            });
        }, username);
    });
}

//returns an object containing the taskId and location of all tasks
//completed by the user
function getTaskLocationFromUserData(userData, callback) {
        async.map(userData.tasksCompleted, function(task, callback) {
            getTaskById(task, function(task) {
                task = {
                    _id: task._id,
                    location: task.location.coordinates
                };
                callback(null, task);
            });
        }, function(err, tasks) {
            callback(tasks);
        });
    }
    //compares the videos lon/lat to the ones of the tasks
function validateVideoData(videoData, tasks, callback) {
    var coords = videoData.coords.split(',');
    var distance = MAX_DIST_TO_TASK;
    var offset = coords.length / 2;
    for (var i = 0; i < offset; i++) {
        var videoLon = coords[i + offset],
            videoLat = coords[i];
        for (var j = 0; j < tasks.length; j++) {
            var taskLon = tasks[j].location[0],
                taskLat = tasks[j].location[1];
            distance = getDistanceFromLonLatInKm(videoLon, videoLat, taskLon, taskLat);
            //stop, if video coordinates match task
            if (distance < MAX_DIST_TO_TASK) {
                break;
            }
        }
        if (distance < MAX_DIST_TO_TASK) {
            var succVideoData = {
                taskId: tasks[j]._id,
                videoId: videoData.VideoId,
                distanceToTask: distance
            };
            callback(succVideoData);
            break;
        }
    }
    callback(null);
}

function getGeoHuntStats(callback, username) {
    getUserData(function(user) {
        user = {
            userName: username,
            tasksCompleted: user.tasksCompleted.length
        };
        callback(null, user);
    }, username);
}

function getUserData(callback, username) {
    MongoClient.connect(mongoUrl, function(err, db) {
        if (err) callback(err, null);

        var collection = db.collection(config.mongodb.userTable);
        collection.findOne({
            'username': username
        }, function(err2, user) {

            if (err2) {
                callback(err, null);
                throw err;
            }
            db.close();
            callback(user);
        });
    });
}

function getTaskStats(callback) {
    MongoClient.connect(mongoUrl, function(err, db) {
        if (err) throw err;
        var collection = db.collection(config.mongodb.taskTable);
        collection.count(function(err, taskCount) {
            if (err) throw err;
            db.close();
            callback(null, {
                count: taskCount
            });
        });
    });
}


router.get('/game/getActiveTask/:gameId', function(req, res) {
    MongoClient.connect(mongoUrl, function(err, db) {
        if (err) throw err;
        var id = req.param('gameId'),
            collection = db.collection(config.mongodb.gameTable);

        collection.findOne({
            '_id': new ObjectID(id)
        }, function(err, game) {
            if (err) throw err;
            //console.log(game.tasks[game.index]._id);
            if (game.tasks.indexOf(null) !== -1) {
                console.log('Error finding tasks for game ' + id);
                console.log('at least one task is missing: ' + game.tasks);
                res.json({
                    'msg': 'error, no task found'
                });
            } else if (game.index == TASKS_PER_GAME) {
                res.json({
                    'msg': 'Game Over!',
                    'info': 'Spiel zu Ende, lade jetzt alle Videos die du aufgenommen hast in mediaQ hoch, um deine Highscore zu verbessern!'
                });
            } else {
                var task = game.tasks[game.index];
                res.json({
                    'msg': 'ok',
                    'task': {
                        id: task._id,
                        taskName: task.taskName,
                        riddleText: task.riddleText,
                        hint1: task.hints[0],
                        hint2: task.hints[1]
                    }
                });
                incrementTaskdata(task._id, 'assignCount', function(err, taskId) {
                    if (err) console.log(err);
                    console.log('successfully updated task with id ' + taskId);
                });
            }

            db.close();
        });
    });
});

//increments the task-counter of the active game
function incrementGame(db, gameId, cb) {
    var collection = db.collection(config.mongodb.gameTable);
    collection.update({
        '_id': new ObjectID(gameId)
    }, {
        $inc: { //increment game-index by 1
            'index': 1
        }
    }, function(err) {
        if (err) throw err;
        console.log('Successfully incremented index of game ' + gameId);
        db.close();
        cb();
    });
}


function incrementTaskdata(taskId, field, cb) {
    MongoClient.connect(mongoUrl, function(err, db) {
        var collection = db.collection(config.mongodb.taskTable);
        var incQuery = {};
        incQuery[field] = 1;
        collection.update({
            '_id': new ObjectID(taskId)
        }, {
            $inc: incQuery //increment game-index by 1
        }, function(err) {
            if (err) throw err;
            cb(null, taskId);
        });
    });
}

function addCompleteTaskToUser(taskId, username) {
    MongoClient.connect(mongoUrl, function(err, db) {
        var connection = db.collection(config.mongodb.userTable);
        console.log(taskId, username);
        connection.update({
                'username': username
            }, {
                $push: {
                    tasksCompleted: new ObjectID(taskId)
                }
            },
            function(err, docs) {
                if (err) throw err;
                db.close();
            });
    });
}

router.post('/game/taskComplete/:gameId', function(req, res) {
    MongoClient.connect(mongoUrl, function(err, db) {
        var gameId = req.param('gameId');

        if (req.body.isSkipping === 'true') {
            incrementGame(db, gameId, function() {
                res.json({
                    'msg': 'ok'
                });
            });
        } else if (req.body.isSkipping === 'false' && req.body.location !== '' && req.body.taskId !== undefined) {
            getTaskById(req.body.taskId, function(task) {
                var lonPlayer = req.body.location.lon,
                    latPlayer = req.body.location.lat,
                    accuracy = req.body.location.accuracy;

                var lonTask = task.location.coordinates[0],
                    latTask = task.location.coordinates[1];
                var distance = getDistanceFromLonLatInKm(lonPlayer, latPlayer, lonTask, latTask);
                console.log('Location of Task: lon = ' + lonTask + ' lat = ' + latTask);
                console.log('Location of Player: lon = ' + lonPlayer + ' lat = ' + latPlayer + ' Accuracy: ' + accuracy);
                console.log('Distance to task: ' + distance + ' km');
                //accuracy > 6000 to allow computer based debugging...
                if ((accuracy < 200 || accuracy > 600) && distance < MAX_DIST_TO_TASK) {
                    incrementGame(db, gameId, function() {
                        res.json({
                            'msg': 'Correct location'
                        });
                    });
                    incrementTaskdata(req.body.taskId, 'completeCount', function(err, taskId) {
                        if (err) console.log(err);
                        console.log('successfully updated task with id ' + taskId);
                        addCompleteTaskToUser(req.body.taskId, req.session.userInfo.username);
                    });
                    console.log('User found location');
                } else {
                    res.json({
                        'msg': 'Incorrect location'
                    });
                    console.log('User wasn\'t close or accuracy not good enough! (' + accuracy + ')');
                }
            });
        }

    });
});


function getTaskById(id, cb) {
    MongoClient.connect(mongoUrl, function(err, db) {
        if (err) throw err;
        var collection = db.collection(config.mongodb.taskTable),
            query = {
                _id: new ObjectID(id)
            };
        collection.findOne(query, function(err, task) {
            if (err) throw err;
            db.close();
            cb(task);
        });
    });
}


function getAllTasks(lon, lat, cb) {
    MongoClient.connect(mongoUrl, function(err, db) {
        if (err) throw err;
        var collection = db.collection(config.mongodb.taskTable);
        var query = {
            'location': {
                $near: {
                    $geometry: {
                        'type': 'Point',
                        'coordinates': [lon, lat]
                    },
                    $maxDistance: 25000
                }
            }
        };
        collection.find(query).toArray(function(err, tasks) {
            if (err) throw err;
            db.close();
            cb(tasks);
        });
    });
}

//atm only randomly selects tasks and returns them
//TODO: Do this with a correct algorithm based on lon and lat! 
function getTasksForLocation(lon, lat, cb) {

    getAllTasks(lon, lat, function(tasks) {

        var taskList = [],
            numbers = [];
        for (var i = 0; i < tasks.length; i++) {
            numbers[i] = i;
        }
        numbers = shuffle(numbers);

        for (i = 0; i < TASKS_PER_GAME; i++) {
            taskList[i] = tasks[numbers[i]];
        }

        cb(taskList);
    });
}


function shuffle(o) {
    for (var j, x, i = o.length; i; j = parseInt(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
    return o;
}



function getDistanceFromLonLatInKm(lon1, lat1, lon2, lat2) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1); // deg2rad below
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}


module.exports = router;
