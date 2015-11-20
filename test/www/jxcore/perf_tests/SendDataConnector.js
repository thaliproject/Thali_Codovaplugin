'use strict';

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;

var logger = function (value) {
    console.log(new Date().toJSON() + ' SendDataConnector.js: ' + value);
}

function SendDataConnector(rounds,dataAmount,reTryTimeout,reTryMaxCount,dataTimeOut) {
    this.roundsToDo         = rounds;
    this.doneRounds         = 0;
    this.toSendDataAmount   = dataAmount;
    this.reTryTimeout       = reTryTimeout;
    this.reTryMaxCount      = reTryMaxCount;
    this.dataTimeOut        = dataTimeOut;
    this.clientSocket       = null;
    this.reTryTimer         = null;
    this.receivedCounter    = 0;
    this.tryRounds          = 0;
    this.resultArray        = [];
    this.connectionCount    = 0;
}

inherits(SendDataConnector, EventEmitter);

SendDataConnector.prototype.Start = function(peer) {
    logger('Start called with peer ' + peer.peerIdentifier);
    this.peer = peer;
    //reset the values to make sure they are clean when we start
    this.startTime = new Date();
    this.endTime = new Date();
    this.endReason ="";
    this.doneRounds         = 0;
    this.receivedCounter    = 0;
    this.tryRounds          = 0;
    this.resultArray        = [];
    this.connectionCount    = 0;

    this.doConnect(this.peer);
}

SendDataConnector.prototype.ReStart = function(peer) {
    var self = this;
    logger('ReStart called with peer ' + peer.peerIdentifier);
    this.peer = peer;
    if(!this.peer){
        return;
    }

    // make sure any previous connections are really out
    if(this.clientSocket != null) {
        logger("CLIENT closeClientSocket");
        this.clientSocket.end()
        this.clientSocket = null;
    }

    setTimeout(function () {
        Mobile('Disconnect').callNative(self.peer.peerIdentifier, function () {
            logger("Mobile.Disconnect() callback with peer " + self.peer.peerIdentifier);
            logger('Connect (retry count ' + self.tryRounds + ') to peer ' +
                         self.peer.peerIdentifier + ' with availability status: '  +
                         self.peer.peerAvailable);
            self.doConnect(self.peer);
        });
    }, self.reTryTimeout);
}


SendDataConnector.prototype.Stop = function(callback) {
    var self = this;
    logger("CLIENT Stop now");
    if(this.reTryTimer != null) {
        logger("Stop retry timer");
        clearTimeout(this.reTryTimer);
        this.reTryTimer = null;
    }

    if (this.dataTimerId != null) {
        logger("Stop data retrieving timer");
        clearTimeout(this.dataTimerId);
        this.dataTimerId = null;
    }

    //Closing Client socket, will also close connection
    if(this.clientSocket != null) {
        logger("CLIENT closeClientSocket");
        this.clientSocket.end();
        this.clientSocket = null;
    }

    if(!self.peer){
        return;
    }

    var peerIdentifier = self.peer.peerIdentifier;
    Mobile('Disconnect').callNative(peerIdentifier, function () {
        logger("Mobile.Disconnect() callback with peer " + peerIdentifier);
        callback();
    });
}

SendDataConnector.prototype.doConnect = function(peer) {
    logger('doConnect called with peer ' + peer.peerIdentifier);
    var self = this;

    if(!this.peer){
        return;
    }

    logger("do connect now");
    this.connectionCount++;

    Mobile('Connect').callNative(peer.peerIdentifier, function (err, port) {
        logger("CLIENT connected to " + port + ", error: " + err);

        if (err != null && err.length > 0) {
            logger("CLIENT Can not Connect: " + err);
            self.endReason = err;
            self.tryAgain();

        } else if (port > 0) {
            logger("CLIENT starting client ");

            self.clientSocket = net.connect(port, function () {
                // self.toSendDataAmount is the wanted amount of data in bytes.
                // The size of a single character is in a string is 2 bytes.
                // Below, the wanted amount of data is generated so that an array is
                // filled with integers that is turned into a string. For example,
                // a loop two times would generate something like: [1, 2].toString() -> '1,2'.
                // The size of that example string would be 3 * 2 = 6 bytes, because
                // a comma is entered between array values.
                logger('CLIENT now sending ' + (self.toSendDataAmount - self.receivedCounter) + ' bytes of data');
                var numbers = [];
                // The right length for the array is calculated below by first splitting
                // the byte amount by two, which gives the amount of characters we need.
                // Number one is added, to even the fact that comma doesn't get appended
                // after the last character. Then, the number is split by two, because
                // each number in the array results also in one additional comma in the
                // resulting string.
                for (var i = 0; i < ((((self.toSendDataAmount - self.receivedCounter) / 2) + 1) / 2); i++) {
                    numbers[i] = Math.floor(Math.random() * 10);
                }
                self.resetDataTimeout(peer);
                self.clientSocket.write(numbers.toString());
            });
            self.clientSocket.on('data', function (data) {
                var receivedString = data.toString().trim();
                var acknowledgmentCount = (receivedString.match(/ACK/g) || []).length;
                if (acknowledgmentCount > 0) {
                    self.receivedCounter = self.receivedCounter + (acknowledgmentCount * 10000);
                    self.resetDataTimeout(peer);
                }

                logger('CLIENT is data received : ' + self.receivedCounter);

                if(self.receivedCounter >= self.toSendDataAmount){
                    if (self.dataTimerId != null) {
                        clearTimeout(self.dataTimerId);
                        self.dataTimerId = null;
                    }

                    self.endReason = "OK";
                    logger('got all data for this round');

                    //we only reset the value once we have gotten all data, so any re-connect will sent only missing data
                    self.receivedCounter = 0;
                    self.oneRoundDoneNow();
                }
            });

            self.clientSocket.on('error', function (ex) {
                logger("CLIENT got error : " + ex);
                //just making sure that if we get error while disconnecting
                // we are then not calling the tryAgain twice
                if(!self.disconnecting) {
                    self.tryAgain();
                }
            });
        }else{
            logger("Port in invalid : " + port);
            if(!self.disconnecting) {
                self.tryAgain();
            }
        }
    });
}

SendDataConnector.prototype.resetDataTimeout = function(peer) {
    logger('resetDataTimeout called with peer ' + peer.peerIdentifier);
    var self = this;
    if (self.dataTimerId != null) {
        clearTimeout(self.dataTimerId);
        self.dataTimerId = null;
    }

    if(self.dataTimeOut) {
        self.dataTimerId = setTimeout(function () {
            logger('Receiving data timeout now');
            self.endReason = "DATA-TIMEOUT";

            self.disconnecting = true;
            //Closing Client socket, will also close connection
            if(self.clientSocket != null) {
                logger("CLIENT closeClientSocket");
                self.clientSocket.end();
                self.clientSocket.destroy();
                self.clientSocket = null;
            }
            self.tryAgain();
            self.disconnecting = false;
            logger("----------------- closeClientSocket");

        }, self.dataTimeOut);
    }
}

SendDataConnector.prototype.tryAgain = function() {
    var self = this;

    if(self.reTryTimer != null){
        return;
    }

    //Closing Client socket, will also close connection
    if(this.clientSocket != null) {
        logger("CLIENT closeClientSocket");
        this.clientSocket.end();
        this.clientSocket = null;
    }

    this.tryRounds++;
    if(this.tryRounds >= self.reTryMaxCount) {
        this.oneRoundDoneNow();
        return;
    }

    logger("tryAgain afer: " + self.reTryTimeout + " ms.");
    //lets try again after a short while
    self.reTryTimer = setTimeout(function () {

        if(!self.peer){
            return;
        }

        logger("re-try now : " + self.peer.peerIdentifier);
        self.reTryTimer = null
        self.ReStart(self.peer);
    }, self.reTryTimeout);
}

SendDataConnector.prototype.oneRoundDoneNow = function() {
    var self = this;

    if(!this.peer){
        return;
    }

    this.endTime = new Date();
    var responseTime = this.endTime - this.startTime;
    this.resultArray.push({"name":this.peer.peerIdentifier,"time":responseTime,"result":this.endReason,"connections":this.connectionCount,"tryCount":this.peer.tryCount});
    this.emit('debug','round[' +this.doneRounds + '] time: ' + responseTime + ' ms, rnd: ' + this.connectionCount + ', ex: ' + this.endReason);

    this.doneRounds++;
    if(this.roundsToDo > this.doneRounds){
        this.tryRounds = 0;
        this.receivedCounter = 0;

        //reset the values to make sure they are clean when we start new round
        this.startTime = new Date();
        this.endTime = new Date();
        this.endReason ="";
        this.connectionCount = 0;
        this.Stop(function () {
            this.ReStart(self.peer);
        });
        return;
    }

    //if we get this far, then we are done
    this.Stop(function () {
        self.weAreDoneNow();
    });
}

SendDataConnector.prototype.getCurrentTest = function() {
    if(!this.peer){
        return;
    }

    return {"connections":this.peer.tryCount, "name":this.peer.peerIdentifier,"time":0,"result":"Fail"};
}

SendDataConnector.prototype.getResultArray = function() {
    return this.resultArray;
}

SendDataConnector.prototype.weAreDoneNow = function() {
    //reset these for next peer test
    this.tryRounds = 0;
    this.startTime = new Date();
    this.endTime = new Date();
    this.endReason ="";
    this.connectionCount = 0;

    var tmpArr = this.resultArray;
    this.resultArray = [];
    this.peer = null;
    this.emit('done', JSON.stringify(tmpArr));
}

module.exports = SendDataConnector;
