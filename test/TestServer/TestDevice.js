/**
 * Created by juksilve on 1.9.2015.
 */

'use strict';

function TestDevice(deviceSocket,name) {
    this.socket = deviceSocket;
    this.deviceName = name;
}
TestDevice.prototype.getName = function(){
    return this.deviceName;
}

TestDevice.prototype.SendCommand = function(command,test,data){
    this.socket.emit('command', JSON.stringify({command: command, testName: test, testData:data}));
}

TestDevice.prototype.SendEndUnitTest = function(data){
    this.socket.emit('end_unit_test', JSON.stringify({data:data}));
}

TestDevice.prototype.SendStartUnitTest = function(data){
    this.socket.emit('start_unit_test', JSON.stringify({data:data}));
}

module.exports = TestDevice;