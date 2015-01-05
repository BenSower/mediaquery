var Tunnel =  require('tunnel-ssh');
var mysql  = require('mysql');
var config = require('../config');

/*
Constructor, returns a ssh tunneled mysql-connection object
*/
function MysqlConnector(){
    var self = this;
	self.mysqlTunnel = self.connectSSHTunnel(function(mysqlTunnel){
		self.connectMysql(function(){ return self; });
	});
}

/*
* Establishes a ssh tunnel
*/
MysqlConnector.prototype.connectSSHTunnel = function (callback){
    var self = this;
	console.log("Creating ssh tunnel to " + config.sshConfig.host);
	var mysqlTunnel = new Tunnel(config);
	mysqlTunnel.connect(function (err) {
		if (err) {
			console.error('error connecting: ' + err.stack);
			return;
		}
		console.log("Tunnel connected");
		callback(mysqlTunnel);
		return mysqlTunnel;
	});
}

/*
* connects to the mysql db
*/
MysqlConnector.prototype.connectMysql = function (callback){
    var self = this;
	//initializes connection, but does not actually connect it
	self.connection = mysql.createConnection(config.database);

	console.log("Trying to connect to Mysql DB...");
	//actually establishes a connection to the mysql-db
	self.connection.connect(function(err) {
		if (err) {
		  console.error('error connecting: ' + err.stack);
		  return;
		}
		console.log('Connected to Mysql DB on ' + config.remoteHost);
		callback();
	});
};

/*
* returns @rows selected by @query
*/
MysqlConnector.prototype.query = function (query, callback, maxRetries, retry){
    var self = this;
    retry = (retry == undefined) ? 1 : retry;
    maxRetries = (maxRetries == undefined) ? 10 : maxRetries;

    if (self.connection == undefined && retry <= maxRetries){
    	console.log("Connection not yet established, waiting and trying again. Attempt :" + retry + "/" +maxRetries);
    	setTimeout(function() {
            self.query(query, callback, maxRetries, retry +1);
        }, 3000);
        return;
    }
    else if (self.connection == undefined && retry >= maxRetries) {
    	console.log("Connection could not be established, quitting");
	   	return;
    }
	self.connection.query(query, function(err, rows, fields) {
		  if (err) throw err;
		  callback(rows);
	});
}

/*
* closes the connection
*/
MysqlConnector.prototype.close = function () {
	var self = this;
	if (self.connection == undefined){
		console.log("connection not yet established, cannot close it");
		return;
	}
	self.connection.end();
	console.log("closing tunnel");
	self.tunnel.close();
}


module.exports = MysqlConnector;